import { acknowledgePersistedExternalResult, flushPendingExternalResultAcks } from "./externalResultClient";
import { evaluateAgentTaskFulfillment, taskFulfillmentNotice } from "./agentTaskFulfillment";
import { requirementCovered, sourceReceipt } from "./agentSourceReads";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { captureDeliveryGenerationBaseline } from "@/domain/morpho/deliveryInspection";
import { hashProductValue } from "@/shared/agentProductHash";
import { materializeContinuationImages } from "./agentContinuationImages";
import { recordDeliveredVisualObservations } from "@/domain/morpho/visualObservation";
import { advanceRequiredAgentReadState, buildRequiredAgentReadReminder } from "./agentTaskStrategy";
import { buildTurnTaskContexts, buildProviderTaskContext, buildProviderComparisonTaskContext } from "./taskContext";
import { buildConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";
import type { AgentTurnOutcome, AiMessage } from "@/domain/morpho/types";
import type {
  APlusAgentContinuationItem,
  APlusAgentProviderRequest
} from "@/shared/agentTurnJournalProtocol";
import { storeMessageCitations, updateAiMessage } from "./aiConversationMessages";
import { runAgentCompaction } from "./agentCompactionOrchestrator";
import {
  hashAPlusExternalActionBody,
  requestAgentWebSearchAPlus,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";
import { executeAgentToolBatchAPlus } from "./agentToolBatchAPlus";
import {
  AgentTurnCoordinator,
  type AgentTurnCoordinatorActionResult,
  type AgentTurnCoordinatorHost,
  type AgentTurnCoordinatorRecoverySnapshot
} from "./agentTurnCoordinator";
import { createAgentTurnCoordinatorHttpHost } from "./agentTurnCoordinatorHttpHost";
import { createAgentTurnDisplayAdapterAPlus } from "./agentTurnDisplayAdapterAPlus";
import {
  isAgentTurnHostSessionDetachedError,
  showAgentTurnRecoveryPending,
  type AgentTurnHost
} from "./agentTurnHost";
import { reduceAgentTurnLifecycle, type AgentTurnLifecycleState } from "./agentTurnLifecycle";
import { finalizeAgentTurn } from "./agentTurnMessages";
import { appendAgentTurnMessages } from "./agentTurnMessages";
import { createAgentTrace } from "./agentMessageTrace";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  prepareAgentTurnProductAPlus,
  rebuildAgentProviderConversation,
  createEmptyAgentTurnRecoveryFacts,
  restorePreparedAgentTurnProductAPlus,
  snapshotAgentTurnRuntimeFacts,
  type PreparedAgentTurnAPlus,
  type RunMorphoAgentTurnAPlusInput
} from "./agentTurnProductPreparationAPlus";
import {
  A_PLUS_TURN_RECOVERY_RECORD_VERSION,
  createAgentTurnRecoveryStore,
  type AgentTurnRecoveryStore,
  type APlusTurnRecoveryMetadata,
  type APlusTurnRecoveryRuntime
} from "./agentTurnRecoveryStore";
import { getManualCompactionStatusText } from "./manualConversationCompaction";
import { buildTaskContext } from "./taskContext";

const MAX_PROVIDER_STEPS = 16;

export type AgentTurnRunnerAPlusDependencies = Readonly<{
  coordinatorHost?: AgentTurnCoordinatorHost;
  recoveryStore?: AgentTurnRecoveryStore;
  createId?: () => string;
}>;

type APlusSession = Readonly<{
  localProjectId: string;
  host: AgentTurnHost;
  coordinator: AgentTurnCoordinator;
  prepared: PreparedAgentTurnAPlus;
  turnInput: RunMorphoAgentTurnAPlusInput;
  recovery: RecoveryWriter;
}>;

type ActiveAPlusSession = Readonly<{
  coordinator: AgentTurnCoordinator;
  controller: AbortController;
  host: AgentTurnHost;
  finish: () => Promise<void>;
  resume: () => Promise<"recovered" | "pending" | "failed">;
}>;

type RequestReconciliationResult = "usable" | "pending" | "failed";

const activeSessions = new Map<string, ActiveAPlusSession>();
const driveQueues = new WeakMap<AgentTurnCoordinator, Promise<void>>();

export async function runMorphoAgentTurn(
  input: RunMorphoAgentTurnAPlusInput,
  host: AgentTurnHost,
  dependencies: AgentTurnRunnerAPlusDependencies = {}
): Promise<void> {
  const localProjectId = host.readWorkspace().project.id;
  if (activeSessions.has(localProjectId)) return;
  const recoveryStore = dependencies.recoveryStore ?? createAgentTurnRecoveryStore();
  if (recoveryStore.hasPersistedRecord(localProjectId)) {
    const recovered = await recoverMorphoAgentTurn(localProjectId, host, {
      ...dependencies,
      recoveryStore
    });
    if (recovered !== "none") return;
  }

  let prepared: PreparedAgentTurnAPlus;
  try {
    prepared = await prepareAgentTurnProductAPlus(input, host);
  } catch (error) {
    failPreparation(host, input.draft, error);
    return;
  }
  const createId = dependencies.createId ?? createRuntimeId;
  const creationIdempotencyKey = createId();
  const runtime = buildRecoveryRuntime(input, prepared);
  const recovery = new RecoveryWriter(
    recoveryStore,
    localProjectId,
    creationIdempotencyKey,
    {
      userMessageId: prepared.userMessageId,
      assistantMessageId: prepared.assistantMessageId,
      traceId: prepared.localAgentTurnId,
      localPersistence: "notRequired",
      runtime
    }
  );
  const coordinator = new AgentTurnCoordinator({
    localProjectId,
    creationIdempotencyKey,
    host: dependencies.coordinatorHost ?? createAgentTurnCoordinatorHttpHost({ fetch: host.fetch }),
    createRequestId: createId,
    onDisplayEvent: createAgentTurnDisplayAdapterAPlus({ host, prepared }),
    onRecoverySnapshotChanged: (snapshot) => recovery.observe(snapshot),
    persistRequestIntent: (snapshot) => recovery.persistRequestIntent(snapshot)
  });
  const session: APlusSession = {
    localProjectId,
    host,
    coordinator,
    prepared,
    turnInput: input,
    recovery
  };
  installActiveSession(session);

  try {
    const initialized = await coordinator.initialize();
    if (initialized.status === "denied") {
      await terminateDeniedSession(session, initialized);
      return;
    }
    if (!await recovery.flush()) {
      await failRecoveryPersistence(session);
      return;
    }
    await persistInitialWorkspace(session);
    if (!await recovery.flush()) {
      await failRecoveryPersistence(session);
      return;
    }
    if (coordinator.getLifecycleSnapshot()?.phase === "terminal") {
      await finalizeSession(session);
      return;
    }
    if (coordinator.getLifecycleSnapshot()?.phase === "compacting") {
      session.host.ui.setStreaming(false);
      showAgentTurnRecoveryPending(session.host.ui);
      return;
    }
    await maybeCompact(session, "automatic");
    if (coordinator.getLifecycleSnapshot()?.phase === "terminal") {
      await finalizeSession(session);
      return;
    }
    if (coordinator.getLifecycleSnapshot()?.phase === "compacting") {
      session.host.ui.setStreaming(false);
      showAgentTurnRecoveryPending(session.host.ui);
      return;
    }
    const started = await coordinator.startInitialRequest(session.recovery.metadata.runtime.providerBaseRequest);
    if (await reconcileRequestResult(session, started, true) !== "usable") return;
    await driveSessionSerialized(session);
  } catch (error) {
    await terminateUnexpectedSession(session, error);
  } finally {
    const lifecycle = coordinator.getLifecycleSnapshot();
    if (!lifecycle || lifecycle.phase === "terminal" || prepared.controller.signal.aborted) {
      releaseActiveSession(localProjectId, coordinator);
    }
  }
}

export async function recoverMorphoAgentTurn(
  localProjectId: string,
  host: AgentTurnHost,
  dependencies: AgentTurnRunnerAPlusDependencies = {}
): Promise<"none" | "recovered" | "pending" | "failed"> {
  const active = activeSessions.get(localProjectId);
  if (active) return active.resume();
  const store = dependencies.recoveryStore ?? createAgentTurnRecoveryStore();
  const loaded = await store.load(localProjectId);
  if (loaded.status === "none") return "none";
  if (loaded.status === "invalid") {
    await store.clear(localProjectId);
    host.ui.showFailure();
    host.ui.setStreaming(false);
    return "failed";
  }
  const record = loaded.record;
  if (record.localProjectId !== host.readWorkspace().project.id) {
    await store.clear(localProjectId);
    host.ui.showFailure();
    return "failed";
  }
  let restoredProduct: ReturnType<typeof restorePreparedAgentTurnProductAPlus>;
  try {
    restoredProduct = restorePreparedAgentTurnProductAPlus(record.metadata.runtime, host);
  } catch {
    // A deterministic local identity conflict must not leave a Recovery Record
    // that permanently blocks the next legal Turn.
    await store.clear(localProjectId);
    host.ui.showFailure();
    host.ui.setStreaming(false);
    return "failed";
  }
  const recovery = new RecoveryWriter(
    store,
    record.localProjectId,
    record.creationIdempotencyKey,
    record.metadata
  );
  const createId = dependencies.createId ?? createRuntimeId;
  const restored = AgentTurnCoordinator.restore({
    snapshot: record.coordinator,
    host: dependencies.coordinatorHost ?? createAgentTurnCoordinatorHttpHost({ fetch: host.fetch }),
    createRequestId: createId,
    onDisplayEvent: createAgentTurnDisplayAdapterAPlus({
      host,
      prepared: restoredProduct.prepared
    }),
    onRecoverySnapshotChanged: (snapshot) => recovery.observe(snapshot),
    persistRequestIntent: (snapshot) => recovery.persistRequestIntent(snapshot)
  });
  if (restored.status === "failed") {
    await store.clear(localProjectId);
    host.ui.showFailure();
    host.ui.setStreaming(false);
    return "failed";
  }
  const session: APlusSession = {
    localProjectId,
    host,
    coordinator: restored.coordinator,
    prepared: restoredProduct.prepared,
    turnInput: restoredProduct.input,
    recovery
  };
  installActiveSession(session);
  try {
    if (record.metadata.pendingConfirmation) {
      const requested = host.ui.requestPendingConfirmation(record.metadata.pendingConfirmation.value);
      if (requested.status !== "accepted") {
        // Keep the durable A+ Recovery Record and expose a retry affordance. A
        // local/Compare confirmation already occupying the slot must never be
        // overwritten by a recovered Agent card.
        showAgentTurnRecoveryPending(host.ui);
      }
    }
    if (restored.coordinator.getLifecycleSnapshot()?.phase === "terminal") {
      await finalizeSession(session);
      return "recovered";
    }
    const compactionRecovered = recoverInterruptedCompaction(session);
    const restoredPhase = restored.coordinator.getLifecycleSnapshot()?.phase;
    if (!compactionRecovered && restoredPhase !== "compacting" && restoredPhase !== "executingTools") {
      const snapshot = restored.coordinator.exportRecoverySnapshot();
      if (snapshot?.activeRequest || snapshot?.lastRequest) {
        const queried = await restored.coordinator.recoverServerExecutionStatus();
        const reconciliation = await reconcileRequestResult(session, queried, true);
        if (reconciliation !== "usable") return reconciliation;
      }
    }
    await driveSessionSerialized(session);
    return restored.coordinator.getLifecycleSnapshot()?.phase === "terminal"
      ? "recovered"
      : "pending";
  } catch (error) {
    await terminateUnexpectedSession(session, error);
    return "failed";
  } finally {
    const lifecycle = restored.coordinator.getLifecycleSnapshot();
    if (lifecycle?.phase === "terminal") {
      releaseActiveSession(localProjectId, restored.coordinator);
    }
  }
}

/**
 * Reconciles an A+ Session that is still owned by the current page.  This is
 * deliberately query-only: an active Provider Request is never started a
 * second time after the SSE/display transport has gone away.
 */
export async function resumeMorphoAgentTurn(
  localProjectId: string,
  host: AgentTurnHost,
  dependencies: AgentTurnRunnerAPlusDependencies = {}
): Promise<"none" | "recovered" | "pending" | "failed"> {
  const active = activeSessions.get(localProjectId);
  if (active) return active.resume();
  return recoverMorphoAgentTurn(localProjectId, host, dependencies);
}

export async function cancelMorphoAgentTurn(
  localProjectId: string,
  reason = "用户停止了当前 AI 任务。"
): Promise<boolean> {
  const active = activeSessions.get(localProjectId);
  if (!active) return false;
  active.host.streamFlushSlot.get()?.();
  active.host.streamFlushSlot.set(null);
  active.controller.abort(new DOMException(reason, "AbortError"));
  active.host.ui.setStreaming(false);
  const lifecycle = active.coordinator.getLifecycleSnapshot();
  if (lifecycle?.phase === "compacting") {
    // The compaction orchestrator observes the AbortSignal and emits the one
    // authoritative COMPACTION_CANCELLED event.
    await active.finish();
    releaseTerminalActiveSession(localProjectId, active.coordinator);
    return true;
  }
  await active.coordinator.requestCancellation(reason);
  await active.finish();
  releaseTerminalActiveSession(localProjectId, active.coordinator);
  return true;
}

/** Models a browser document being discarded: local display ownership ends,
 * while the server execution remains governed by Journal reconciliation. */
export function detachMorphoAgentTurnForPageUnload(localProjectId: string): void {
  activeSessions.delete(localProjectId);
}

export async function acknowledgeMorphoAgentPendingConfirmation(
  localProjectId: string,
  store: AgentTurnRecoveryStore = createAgentTurnRecoveryStore()
): Promise<boolean> {
  const loaded = await store.load(localProjectId);
  if (
    loaded.status !== "ok" ||
    !loaded.record.metadata.pendingConfirmation ||
    loaded.record.coordinator.lifecycle.phase !== "terminal"
  ) return false;
  await store.clear(localProjectId);
  return true;
}

export async function runManualCompactionTurn(
  input: RunMorphoAgentTurnAPlusInput,
  host: AgentTurnHost,
  dependencies: AgentTurnRunnerAPlusDependencies = {}
): Promise<void> {
  const localProjectId = host.readWorkspace().project.id;
  if (activeSessions.has(localProjectId)) return;
  const recovered = await recoverMorphoAgentTurn(localProjectId, host, dependencies);
  if (recovered !== "none") return;
  const workspace = host.readWorkspace();
  const context = buildTaskContext(workspace, {
    kind: "general",
    draft: input.draft,
    selectedObjectIds: input.selectedObjectIds
  });
  const now = new Date(host.now()).toISOString();
  const suffix = host.randomSuffix();
  const localAgentTurnId = `a-plus-manual-compact-${host.now()}-${suffix}`;
  const userMessageId = `ai-user-a-plus-compact-${host.now()}-${suffix}`;
  const assistantMessageId = `ai-assistant-a-plus-compact-${host.now()}-${suffix}`;
  host.commitWorkspace((current) => ({
    workspace: appendAgentTurnMessages(current, {
      userMessageId,
      assistantMessageId,
      userBody: input.draft,
      assistantBody: getManualCompactionStatusText("running"),
      createdAt: now,
      contextObjectIds: context.objectIds,
      workIntent: "discussion",
      taskMode: "chatAnalysis",
      contextVisibility: "uiOnly",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      taskStrategy: "discussion",
      agentTrace: { ...createAgentTrace(now), agentTurnId: localAgentTurnId },
      agentTurnId: localAgentTurnId
    }),
    value: undefined
  }));
  host.ui.setDraft("");
  host.ui.openConversation();
  host.ui.setStreaming(true);
  const runtime: APlusTurnRecoveryRuntime = {
    input: {
      draft: input.draft,
      taskMode: input.taskMode,
      recommendedTaskMode: input.recommendedTaskMode,
      workIntent: input.workIntent,
      recommendedWorkIntent: input.recommendedWorkIntent,
      selectedObjectIds: [...input.selectedObjectIds],
      pendingDeliveryDraftTarget: null,
      directionPreviewCount: input.directionPreviewCount,
      agentTurnMode: input.agentTurnMode,
      imageGenerationModelId: input.imageGenerationModelId,
      ...(input.readConversationTokenLimits()
        ? { conversationTokenLimits: input.readConversationTokenLimits() }
        : {})
    },
    providerBaseRequest: {
      input: [],
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      mode: input.agentTurnMode,
      capabilityIntent: { comparisonAnalysis: false, webSearch: false }
    },
    continuationItems: [],
    localAgentTurnId,
    createdAt: now,
    executionTaskMode: "chatAnalysis",
    executionTaskModeSource: "userSelected",
    executionWorkIntent: "discussion",
    executionWorkIntentSource: "userSelected",
    imageAttachmentObjectIds: [],
    documentExtractObjectIds: [],
    allowStructuredComparison: false,
    facts: createEmptyAgentTurnRecoveryFacts()
  };
  const restoredProduct = restorePreparedAgentTurnProductAPlus(runtime, host);
  const createId = dependencies.createId ?? createRuntimeId;
  const creationIdempotencyKey = createId();
  const actionId = `compact:manual:${createId()}`;
  const recovery = new RecoveryWriter(
    dependencies.recoveryStore ?? createAgentTurnRecoveryStore(),
    localProjectId,
    creationIdempotencyKey,
    {
      userMessageId,
      assistantMessageId,
      traceId: localAgentTurnId,
      localPersistence: "notRequired",
      runtime,
      compaction: {
        mode: "manual",
        actionId,
        ...(workspace.ai.conversationCompaction.summaryRevisionId
          ? { expectedPreviousRevisionId: workspace.ai.conversationCompaction.summaryRevisionId }
          : {}),
        summaryApplyState: "notApplied"
      }
    }
  );
  const coordinator = new AgentTurnCoordinator({
    localProjectId,
    creationIdempotencyKey,
    host: dependencies.coordinatorHost ?? createAgentTurnCoordinatorHttpHost({ fetch: host.fetch }),
    createRequestId: createId,
    onRecoverySnapshotChanged: (snapshot) => recovery.observe(snapshot),
    persistRequestIntent: (snapshot) => recovery.persistRequestIntent(snapshot)
  });
  const session: APlusSession = {
    localProjectId,
    host,
    coordinator,
    prepared: restoredProduct.prepared,
    turnInput: restoredProduct.input,
    recovery
  };
  installActiveSession(session);
  let keepSessionForRecovery = false;
  try {
    const initialized = await coordinator.initialize();
    if (initialized.status === "denied") {
      await terminateDeniedSession(session, initialized);
      return;
    }
    await persistInitialWorkspace(session);
    const result = await runAgentCompaction({
      mode: "manual",
      actionId,
      coordinator,
      host,
      localProjectId,
      limits: input.readConversationTokenLimits(),
      force: true,
      signal: restoredProduct.prepared.controller.signal,
      onExternalActionIntent: (action) => persistExternalActionIntent(session, action),
      onSummaryApplied: ({ revisionId, delivery }) => recordAppliedCompaction(
        recovery,
        "manual",
        actionId,
        revisionId, delivery
      )
    });
    if (result.status === "running") {
      keepSessionForRecovery = true;
      await recordCompactionResult(session, result, {
        mode: "manual",
        actionId,
        ...(workspace.ai.conversationCompaction.summaryRevisionId
          ? { expectedPreviousRevisionId: workspace.ai.conversationCompaction.summaryRevisionId }
          : {}),
        summaryApplyState: "notApplied"
      });
      host.ui.setStreaming(false);
      showAgentTurnRecoveryPending(host.ui);
      return;
    }
    recovery.updateMetadata((metadata) => ({
      ...metadata,
      compaction: {
        mode: "manual",
        actionId,
        ...(metadata.compaction?.expectedPreviousRevisionId
          ? { expectedPreviousRevisionId: metadata.compaction.expectedPreviousRevisionId }
          : {}),
        summaryApplyState: result.status === "applied" ? "applied" : result.status === "failed" ? "failed" : "notApplied",
        ...(result.status === "applied" ? { appliedRevisionId: result.revisionId } : {})
      }
    }));
    host.commitWorkspace((current) => ({
      workspace: {
        ...current,
        ai: {
          ...current.ai,
          messages: current.ai.messages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  body: result.status === "cancelled"
                    ? "上下文压缩已取消，旧 Summary Revision 保持不变。"
                    : getManualCompactionStatusText(
                        result.status === "applied"
                          ? "completed"
                          : result.status === "notNeeded"
                            ? "notNeeded"
                            : "failed"
                      )
                }
              : message
          )
        }
      },
      value: undefined
    }));
    const lifecycle = coordinator.getLifecycleSnapshot();
    if (lifecycle && lifecycle.phase !== "terminal") requireCoordinatorOk(coordinator.finalizeTurn());
    await finalizeSession(session);
  } catch (error) {
    await terminateUnexpectedSession(session, error);
  } finally {
    if (!keepSessionForRecovery) releaseActiveSession(localProjectId, coordinator);
  }
}

function driveSessionSerialized(session: APlusSession): Promise<void> {
  const previous = driveQueues.get(session.coordinator) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => driveSession(session));
  driveQueues.set(session.coordinator, next);
  return next;
}

async function driveSession(session: APlusSession): Promise<void> {
  for (let step = 0; step < MAX_PROVIDER_STEPS; step += 1) {
    if (isAgentTurnHostSessionDetachedError(session.prepared.controller.signal.reason)) {
      return;
    }
    const lifecycle = session.coordinator.getLifecycleSnapshot();
    if (!lifecycle) return;
    if (lifecycle.phase === "terminal") {
      await finalizeSession(session);
      return;
    }
    if (lifecycle.serverExecutionStatus === "externallyCompleted" && lifecycle.persistence === "pending" &&
      lifecycle.fault.kind === "none" && session.coordinator.getProviderOutputSnapshot()?.producedUserVisibleEffect) {
      await finalizeSession(session);
      return;
    }
    if (lifecycle.phase === "awaitingConfirmation") {
      requireCoordinatorOk(session.coordinator.finalizeTurn());
      await finalizeSession(session);
      return;
    }
    if (lifecycle.phase === "cancelling") {
      if (lifecycle.serverExecutionStatus === "providerRunning") return;
      requireCoordinatorOk(session.coordinator.finalizeTurn());
      await finalizeSession(session);
      return;
    }
    if (lifecycle.phase === "recovering") {
      const recovered = await session.coordinator.recoverServerExecutionStatus();
      if (await reconcileRequestResult(session, recovered, false) !== "usable") return;
      continue;
    }
    if (lifecycle.phase === "compacting") {
      const metadata = session.recovery.metadata.compaction;
      if (!metadata) {
        await terminateDeniedSession(session, {
          status: "denied",
          code: "compaction_recovery_metadata_missing",
          error: "Compaction 正在执行，但缺少可重放的 Action 身份。",
          recoverable: false,
          lifecycle
        });
        return;
      }
      const result = await runAgentCompaction({
        mode: metadata.mode,
        actionId: metadata.actionId,
        coordinator: session.coordinator,
        host: session.host,
        localProjectId: session.localProjectId,
        limits: session.turnInput.readConversationTokenLimits(),
        signal: session.prepared.controller.signal,
        ...(session.recovery.metadata.pendingExternalAction?.actionKind === "compaction" &&
          session.recovery.metadata.pendingExternalAction.actionId === metadata.actionId
          ? { restoredExternalAction: session.recovery.metadata.pendingExternalAction }
          : {}),
        onExternalActionIntent: (action) => persistExternalActionIntent(session, action),
        onSummaryApplied: ({ revisionId, delivery }) => recordAppliedCompaction(
          session.recovery,
          metadata.mode,
          metadata.actionId,
          revisionId, delivery
        )
      });
      await recordCompactionResult(session, result, metadata);
      if (result.status === "running") {
        session.host.ui.setStreaming(false);
        showAgentTurnRecoveryPending(session.host.ui);
        return;
      }
      continue;
    }
    if (
      lifecycle.phase === "requestingProvider" &&
      lifecycle.serverExecutionStatus === "providerRunning"
    ) {
      // The server owns the in-flight execution. Refresh recovery and later
      // user actions are query-only; the Provider call is never started twice.
      session.host.ui.setStreaming(false);
      showAgentTurnRecoveryPending(session.host.ui);
      return;
    }
    if (
      lifecycle.phase === "continuing" &&
      lifecycle.serverExecutionStatus === "providerRunning"
    ) {
      // A streamed Tool payload is still display-only while the external
      // request is running.  Wait for Journal to say awaitingNextRequest
      // before executing any local effect.
      session.host.ui.setStreaming(false);
      showAgentTurnRecoveryPending(session.host.ui);
      return;
    }
    if (
      (lifecycle.phase === "continuing" && lifecycle.providerOutput.kind === "received") ||
      lifecycle.phase === "executingTools"
    ) {
      const output = session.coordinator.getProviderOutputSnapshot();
      if (!output) {
        await terminateDeniedSession(session, {
          status: "denied",
          code: "providerContinuationPayloadUnavailable",
          error: "Provider Tool payload 未保存在本地 Recovery Record。",
          recoverable: false,
          lifecycle
        });
        return;
      }
      const requestIdentity = {
        serverTurnId: lifecycle.turnId,
        localProjectId: session.localProjectId,
        requestId: output.requestId,
        stepSequence: output.stepSequence
      };
      session.recovery.updateMetadata((metadata) => ({
        ...metadata,
        runtime: {
          ...metadata.runtime,
          continuationItems: mergeContinuationItems(
            metadata.runtime.continuationItems,
            output.toolCalls.map((call) => ({
              type: "function_call" as const,
              callId: call.callId,
              name: call.name,
              argumentsText: call.argumentsText
            }))
          )
        }
      }));
      if (!await session.recovery.flush()) {
        await failRecoveryPersistence(session);
        return;
      }
      const batch = await executeAgentToolBatchAPlus({
        toolCalls: output.toolCalls,
        providerOutputText: output.outputText,
        coordinator: session.coordinator,
        host: session.host,
        turnInput: session.turnInput,
        prepared: session.prepared,
        externalRequest: requestIdentity,
        requestWebSearch: (input) => requestAgentWebSearchAPlus({
          fetch: session.host.fetch,
          ...input
        }),
        ...(session.recovery.metadata.pendingExternalAction
          ? { restoredPendingExternalAction: session.recovery.metadata.pendingExternalAction }
          : {}),
        onExternalActionIntent: ({ callId, action }) =>
          persistExternalActionIntent(session, action, callId),
        ...(session.recovery.metadata.pendingConfirmation
          ? { restoredPendingConfirmation: session.recovery.metadata.pendingConfirmation }
          : {}),
        onCallTerminal: async ({ terminal, continuationItem, pendingConfirmation }) => {
          session.recovery.updateMetadata((metadata) => ({
            ...metadata,
            runtime: {
              ...metadata.runtime,
              facts: snapshotAgentTurnRuntimeFacts(session.prepared.runtimeState),
              continuationItems: continuationItem
                ? mergeContinuationItems(metadata.runtime.continuationItems, [continuationItem])
                : metadata.runtime.continuationItems
            },
            ...(pendingConfirmation ? { pendingConfirmation } : {}),
            toolExecutionIntents: mergeToolExecutionIntent(
              metadata.toolExecutionIntents,
              {
                callId: terminal.callId,
                stableOperationId: `a-plus-effect-${lifecycle.turnId}-${terminal.callId}`,
                status: "terminal",
                observedAt: new Date(session.host.now()).toISOString()
              }
            )
          }));
          return session.recovery.flush();
        },
        onCallIntent: async ({ callId, stableOperationId }) => {
          session.recovery.updateMetadata((metadata) => ({
            ...metadata,
            toolExecutionIntents: mergeToolExecutionIntent(
              metadata.toolExecutionIntents,
              {
                callId,
                stableOperationId,
                status: "intent",
                observedAt: new Date(session.host.now()).toISOString()
              }
            )
          }));
          return session.recovery.flush();
        }
      });
      session.recovery.updateMetadata((metadata) => ({
        ...metadata,
        runtime: {
          ...metadata.runtime,
          facts: snapshotAgentTurnRuntimeFacts(session.prepared.runtimeState),
          continuationItems: mergeContinuationItems(
            metadata.runtime.continuationItems,
            batch.continuationItems
          )
        },
        ...(batch.pendingConfirmation
          ? { pendingConfirmation: batch.pendingConfirmation }
          : {}),
        ...(batch.status !== "externalActionRunning"
          ? { pendingExternalAction: undefined }
          : {})
      }));
      if (batch.status === "externalActionRunning" && batch.externalAction) {
        session.recovery.updateMetadata((metadata) => ({
          ...metadata,
          pendingExternalAction: {
            status: "running",
            actionId: batch.externalAction!.actionId,
            actionKind: batch.externalAction!.actionKind,
            callId: batch.externalAction!.callId,
            requestBody: batch.externalAction!.requestBody,
            requestHash: batch.externalAction!.requestHash,
            ...(batch.externalAction!.externalEffect ? { externalEffect: batch.externalAction!.externalEffect } : {}),
            lastObservedAt: new Date(session.host.now()).toISOString()
          }
        }));
      }
      await session.recovery.flush();
      if (batch.status === "pendingConfirmation") continue;
      if (batch.status === "externalActionRunning") {
        session.host.ui.setStreaming(false);
        showAgentTurnRecoveryPending(session.host.ui);
        return;
      }
      if (isAgentTurnHostSessionDetachedError(session.prepared.controller.signal.reason)) {
        return;
      }
      if (session.prepared.controller.signal.aborted) {
        await session.coordinator.requestCancellation("用户停止了 Tool Batch。");
        continue;
      }
      const afterBatch = session.coordinator.getLifecycleSnapshot();
      if (afterBatch?.fault.kind === "present" && afterBatch.fault.error.kind !== "retryable") {
        requireCoordinatorOk(session.coordinator.finalizeTurn());
        continue;
      }
      if (await stopUnsupportedLegacyContinuation(session)) return;
      await maybeCompact(session, "preContinuation");
      const afterCompaction = session.coordinator.getLifecycleSnapshot();
      if (!afterCompaction || afterCompaction.phase === "terminal") continue;
      if (afterCompaction.phase === "compacting") {
        session.host.ui.setStreaming(false);
        showAgentTurnRecoveryPending(session.host.ui);
        return;
      }
      const continuationRequest = await freshContinuationProviderRequest(session);
      const continued = await session.coordinator.startContinuation(continuationRequest);
      if (await reconcileRequestResult(session, continued, true) !== "usable") return;
      continue;
    }
    if (
      lifecycle.phase === "continuing" &&
      lifecycle.providerOutput.kind === "consumed" &&
      session.recovery.metadata.runtime.continuationItems.length > 0
    ) {
      if (await stopUnsupportedLegacyContinuation(session)) return;
      await maybeCompact(session, "preContinuation");
      if (session.coordinator.getLifecycleSnapshot()?.phase === "compacting") {
        session.host.ui.setStreaming(false);
        showAgentTurnRecoveryPending(session.host.ui);
        return;
      }
      const continued = await session.coordinator.startContinuation(
        await freshContinuationProviderRequest(session)
      );
      if (await reconcileRequestResult(session, continued, true) !== "usable") return;
      continue;
    }
    if (
      lifecycle.phase === "requestingProvider" &&
      lifecycle.serverExecutionStatus === "created"
    ) {
      if (await stopUnsupportedLegacyContinuation(session)) return;
      const started = await session.coordinator.startInitialRequest(
        session.recovery.metadata.runtime.providerBaseRequest
      );
      if (await reconcileRequestResult(session, started, true) !== "usable") return;
      continue;
    }
    await terminateDeniedSession(session, {
      status: "denied",
      code: "runtime_state_not_progressable",
      error: `A+ Runtime 无法从 ${lifecycle.phase}/${lifecycle.serverExecutionStatus} 继续。`,
      recoverable: false,
      lifecycle
    });
    return;
  }
  await terminateDeniedSession(session, {
    status: "denied",
    code: "provider_step_limit",
    error: "A+ Provider Continuation 超过本地安全步数上限。",
    recoverable: false,
    lifecycle: session.coordinator.getLifecycleSnapshot()
  });
}

async function stopUnsupportedLegacyContinuation(session: APlusSession): Promise<boolean> {
  const request = session.recovery.metadata.runtime.providerBaseRequest;
  if (request.taskContract || request.promptContractVersion === MORPHO_AGENT_PROMPT_CONTRACT_VERSION) return false;
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  if (!lifecycle) return false;
  await terminateDeniedSession(session, { status: "denied", code: "legacy_prompt_contract_continuation_unavailable",
    error: "旧回合的 Prompt Contract 已不支持继续。已保留可恢复的在途操作结果；本轮未重建任务范围或增加授权，请重新发起后续任务。",
    recoverable: false, lifecycle });
  return true;
}

async function reconcileRequestResult(
  session: APlusSession,
  result: AgentTurnCoordinatorActionResult,
  allowExactRetry: boolean
): Promise<RequestReconciliationResult> {
  if (result.status === "denied" && result.code === "request_intent_persistence_failed") {
    await failRecoveryPersistence(session);
    return "failed";
  }
  syncRecoveryRuntimeFacts(session);
  const currentLifecycle = session.coordinator.getLifecycleSnapshot();
  const waitingForFinalTextSave = currentLifecycle?.phase !== "terminal" &&
    currentLifecycle?.serverExecutionStatus === "externallyCompleted" && currentLifecycle.persistence === "pending";
  if (waitingForFinalTextSave) session.recovery.updateMetadata(metadata => ({ ...metadata, localPersistence: "required" }));
  if (!await session.recovery.flush() && waitingForFinalTextSave) {
    await failRecoveryPersistence(session);
    return "failed";
  }
  if (result.status === "ok") {
    const output = session.coordinator.getProviderOutputSnapshot();
    if (output?.delivery && !waitingForFinalTextSave) {
      const saved = session.host.persistWorkspace?.();
      if (saved?.phase !== "saved" || saved.isDirty || !await session.recovery.flush()) {
        session.host.ui.setStreaming(false);
        showAgentTurnRecoveryPending(session.host.ui);
        return "pending";
      }
      await acknowledgePersistedExternalResult(session.localProjectId, output.delivery, session.host.fetch);
    }
    markDeliveredReads(session);
    syncRecoveryRuntimeFacts(session);
    await session.recovery.flush();
    return "usable";
  }
  if (result.code === "request_not_observed" && result.recoverable && allowExactRetry) {
    if (await stopUnsupportedLegacyContinuation(session)) return "failed";
    const retried = await session.coordinator.retryActiveRequest();
    await session.recovery.flush();
    if (retried.status === "ok") return reconcileRequestResult(session, retried, false);
    return reconcileRequestResult(session, retried, false);
  }
  if (result.code === "server_turn_not_found") {
    await terminateMissingServerTurnSession(session, result);
    return "failed";
  }
  if (
    result.recoverable &&
    (result.code === "journal_query_failed" ||
      result.code === "external_execution_pending_reconciliation" ||
      result.code === "external_action_running" || result.code === "external_result_pending")
  ) {
    // A query-only pause must leave the current page usable.  The session is
    // intentionally retained so the explicit Resume action can reconcile it
    // later, but it must not look like an endlessly streaming turn.
    session.host.ui.setStreaming(false);
    showAgentTurnRecoveryPending(session.host.ui);
    return "pending";
  }
  await terminateDeniedSession(session, result);
  return "failed";
}

function syncRecoveryRuntimeFacts(session: APlusSession): void {
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    runtime: {
      ...metadata.runtime,
      facts: snapshotAgentTurnRuntimeFacts(session.prepared.runtimeState)
    }
  }));
}

async function maybeCompact(
  session: APlusSession,
  mode: "automatic" | "preContinuation"
): Promise<Awaited<ReturnType<typeof runAgentCompaction>> | undefined> {
  if (!buildConversationCompactionPlan({ workspace: session.host.readWorkspace() })) return undefined;
  const actionId = `compact:${mode}:${createRuntimeId()}`;
  const previousRevisionId = session.host.readWorkspace().ai.conversationCompaction.summaryRevisionId;
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    compaction: {
      mode,
      actionId,
      ...(previousRevisionId ? { expectedPreviousRevisionId: previousRevisionId } : {}),
      summaryApplyState: "notApplied"
    }
  }));
  await session.recovery.flush();
  const result = await runAgentCompaction({
    mode,
    actionId,
    coordinator: session.coordinator,
    host: session.host,
    localProjectId: session.localProjectId,
    limits: session.turnInput.readConversationTokenLimits(),
    signal: session.prepared.controller.signal,
    onExternalActionIntent: (action) => persistExternalActionIntent(session, action),
    onSummaryApplied: ({ revisionId, delivery }) => recordAppliedCompaction(
      session.recovery,
      mode,
      actionId,
      revisionId, delivery
    )
  });
  await recordCompactionResult(session, result, {
    mode,
    actionId,
    ...(previousRevisionId ? { expectedPreviousRevisionId: previousRevisionId } : {}),
    summaryApplyState: "notApplied"
  });
  return result;
}

async function recordCompactionResult(
  session: APlusSession,
  result: Awaited<ReturnType<typeof runAgentCompaction>>,
  metadata: NonNullable<APlusTurnRecoveryMetadata["compaction"]>
): Promise<void> {
  session.recovery.updateMetadata((current) => ({
    ...current,
    compaction: {
      mode: metadata.mode,
      actionId: metadata.actionId,
      ...(metadata.expectedPreviousRevisionId
        ? { expectedPreviousRevisionId: metadata.expectedPreviousRevisionId }
        : {}),
      summaryApplyState: result.status === "applied"
        ? "applied"
        : result.status === "failed"
          ? "failed"
          : metadata.summaryApplyState,
      ...(result.status === "applied" ? { appliedRevisionId: result.revisionId } : {})
    },
    ...(result.status === "running" ? {
      pendingExternalAction: {
        status: "running" as const,
        actionId: result.externalAction.actionId,
        actionKind: result.externalAction.actionKind,
        requestBody: result.externalAction.requestBody,
        requestHash: result.externalAction.requestHash,
        ...(result.externalAction.compactionApplyBoundary
          ? { compactionApplyBoundary: result.externalAction.compactionApplyBoundary }
          : {}),
        lastObservedAt: new Date(session.host.now()).toISOString()
      }
    } : { pendingExternalAction: undefined })
  }));
  if (result.status === "applied") {
    const runtime = session.recovery.metadata.runtime;
    const rebuilt = rebuildAgentProviderConversation({ workspace: session.host.readWorkspace(), base: runtime.providerBaseRequest,
      userMessageId: session.prepared.userMessageId, limits: session.turnInput.readConversationTokenLimits() });
    session.recovery.updateMetadata((current) => ({ ...current, runtime: { ...current.runtime, providerBaseRequest: rebuilt } }));
  }
  await session.recovery.flush();
}

async function persistExternalActionIntent(
  session: APlusSession,
  action: APlusExternalActionDescriptor,
  callId?: string
): Promise<boolean> {
  if (await hashAPlusExternalActionBody(action.requestBody) !== action.requestHash) return false;
  const existing = session.recovery.metadata.pendingExternalAction;
  const sameAction = existing &&
    existing.actionId === action.actionId &&
    existing.actionKind === action.actionKind &&
    existing.requestHash === action.requestHash &&
    existing.callId === callId;
  const nextSerializedImageItem = existing &&
    existing.actionKind === "image" &&
    action.actionKind === "image" &&
    existing.callId === callId &&
    Boolean(callId);
  if (existing && !sameAction && !nextSerializedImageItem) return false;
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    pendingExternalAction: {
      status: "acquired",
      actionId: action.actionId,
      actionKind: action.actionKind,
      ...(callId ? { callId } : {}),
      requestBody: action.requestBody,
      requestHash: action.requestHash,
      ...(action.externalEffect ? { externalEffect: action.externalEffect } : {}),
      ...(action.compactionApplyBoundary
        ? { compactionApplyBoundary: action.compactionApplyBoundary }
        : {}),
      lastObservedAt: new Date(session.host.now()).toISOString()
    }
  }));
  return session.recovery.flush();
}

async function recordAppliedCompaction(
  recovery: RecoveryWriter,
  mode: "automatic" | "preContinuation" | "manual",
  actionId: string,
  revisionId: string,
  delivery?: import("@/shared/externalResultProtocol").ExternalResultManifest
): Promise<boolean> {
  recovery.updateMetadata((metadata) => ({
    ...metadata,
    ...(delivery && metadata.pendingExternalAction ? { pendingExternalAction: { ...metadata.pendingExternalAction, delivery } } : {}),
    compaction: {
      mode,
      actionId,
      ...(metadata.compaction?.expectedPreviousRevisionId
        ? { expectedPreviousRevisionId: metadata.compaction.expectedPreviousRevisionId }
        : {}),
      summaryApplyState: "applied",
      appliedRevisionId: revisionId
    }
  }));
  return recovery.flush();
}

function recoverInterruptedCompaction(session: APlusSession): boolean {
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  if (lifecycle?.phase !== "compacting") return false;
  const metadata = session.recovery.metadata.compaction;
  if (
    metadata?.summaryApplyState === "applied" &&
    metadata.appliedRevisionId &&
    session.host.readWorkspace().ai.conversationSummaryRevisions[metadata.appliedRevisionId]
  ) {
    const saved = session.host.persistWorkspace?.();
    if (saved?.phase !== "saved" || saved.isDirty) return false;
    if (session.coordinator.getLifecycleSnapshot()?.persistence === "pending") requireCoordinatorOk(session.coordinator.markLocalPersistenceSucceeded());
    requireCoordinatorOk(session.coordinator.completeCompaction(metadata.actionId, {
      kind: "applied",
      revisionId: metadata.appliedRevisionId
    }));
    return true;
  }
  // Keep the lifecycle in `compacting` until the same Action ID is queried
  // again.  A refresh must not turn a still-running server action into a
  // local failure or create a second compaction request.
  return false;
}

async function persistInitialWorkspace(session: APlusSession): Promise<void> {
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  if (!lifecycle || lifecycle.phase === "terminal") return;
  requireCoordinatorOk(session.coordinator.markLocalPersistenceRequired());
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    localPersistence: "required"
  }));
  const persisted = session.host.persistWorkspace?.();
  if (persisted?.phase === "saved" && !persisted.isDirty) {
    requireCoordinatorOk(session.coordinator.markLocalPersistenceSucceeded());
    session.recovery.updateMetadata((metadata) => ({
      ...metadata,
      localPersistence: "succeeded"
    }));
    return;
  }
  const error = {
    kind: "terminal" as const,
    code: "workspace_persistence_failed",
    message: persisted?.error ?? "Workspace 持久化端口不可用。",
    recoverable: false as const
  };
  requireCoordinatorOk(session.coordinator.markLocalPersistenceFailed(
    `${lifecycle.turnId}:initial-persistence`,
    error
  ));
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    localPersistence: "failed"
  }));
  requireCoordinatorOk(session.coordinator.finalizeTurn());
}

async function finalizeSession(session: APlusSession): Promise<void> {
  let lifecycle = session.coordinator.getLifecycleSnapshot();
  if (!lifecycle) return;
  const finalTextSave = lifecycle.phase !== "terminal" && lifecycle.serverExecutionStatus === "externallyCompleted" &&
    lifecycle.persistence === "pending" && lifecycle.fault.kind === "none" &&
    session.coordinator.getProviderOutputSnapshot()?.producedUserVisibleEffect;
  let terminal: Extract<AgentTurnLifecycleState, { phase: "terminal" }>;
  if (finalTextSave) {
    // Prepare the final Workspace from the same pure reducer, without publishing completion.
    const succeeded = reduceAgentTurnLifecycle(lifecycle, { type: "LOCAL_PERSISTENCE_SUCCEEDED", turnId: lifecycle.turnId });
    if (!succeeded.ok) throw new Error(succeeded.error.message);
    const preview = reduceAgentTurnLifecycle(succeeded.state, { type: "TURN_FINALIZED", turnId: lifecycle.turnId });
    if (!preview.ok) throw new Error(preview.error.message);
    if (preview.state.phase !== "terminal") return;
    terminal = preview.state;
  } else {
    if (lifecycle.phase !== "terminal") {
      requireCoordinatorOk(session.coordinator.finalizeTurn());
      lifecycle = session.coordinator.getLifecycleSnapshot();
    }
    if (!lifecycle || lifecycle.phase !== "terminal") return;
    terminal = lifecycle;
  }
  const previousMessages = session.host.readWorkspace().ai.messages.filter(message =>
    message.id === session.prepared.userMessageId || message.id === session.prepared.assistantMessageId);
  markDeliveredReads(session);
  const outcome = mapOverallOutcome(terminal.outcome.kind);
  const completedAt = new Date(session.host.now()).toISOString();
  session.host.commitWorkspace((current) => {
    const assistant = current.ai.messages.find(
      (message) => message.id === session.prepared.assistantMessageId
    );
    const fulfillment = evaluateAgentTaskFulfillment({ contract: session.recovery.metadata.runtime.providerBaseRequest.taskContract,
      workspace: current, reads: session.prepared.runtimeState.readReceipts, effects: session.prepared.runtimeState.effectReceipts,
      providerCompleted: terminal.serverExecutionStatus === "externallyCompleted" && Boolean(session.coordinator.getProviderOutputSnapshot()?.outputText.trim() || assistant?.body.trim()) });
    const notice = terminal.serverExecutionStatus === "externallyCompleted" ? taskFulfillmentNotice(fulfillment) : "";
    const originalBody = finalTextSave && !assistant?.body.trim()
      ? session.coordinator.getProviderOutputSnapshot()!.outputText : terminalAssistantBody(assistant, terminal);
    const body = notice && !originalBody.includes(notice) ? `${originalBody}\n\n${notice}`.trim() : originalBody;
    let workspace = finalizeAgentTurn(current, {
      agentTurnId: session.prepared.localAgentTurnId,
      userMessageId: session.prepared.userMessageId,
      assistantMessageId: session.prepared.assistantMessageId,
      outcome,
      assistantBody: body,
      assistantStatus: messageStatus(terminal.outcome.kind),
      traceStatus: traceStatus(terminal.outcome.kind),
      summary: terminal.outcome.reasons.join("、"),
      completedAt
    });
    workspace = { ...workspace, ai: { ...workspace.ai, messages: workspace.ai.messages.map((message) => message.id === session.prepared.assistantMessageId ? { ...message, taskFulfillment: fulfillment } : message) } };
    if (session.prepared.runtimeState.collectedCitations.length > 0) {
      workspace = storeMessageCitations(workspace, {
        messageId: session.prepared.assistantMessageId,
        operationId: session.prepared.localAgentTurnId,
        citations: session.prepared.runtimeState.collectedCitations
      });
    }
    return { workspace, value: undefined };
  });
  const persisted = session.host.persistWorkspace?.();
  const saved = persisted?.phase === "saved" && !persisted.isDirty;
  if (finalTextSave) {
    if (!saved) {
      // Remove the uncommitted completion draft; other Workspace content is untouched.
      session.host.commitWorkspace(current => ({ workspace: { ...current, ai: { ...current.ai,
        messages: current.ai.messages.map(message => previousMessages.find(previous => previous.id === message.id) ?? message)
      } }, value: undefined }));
      requireCoordinatorOk(session.coordinator.markLocalPersistenceFailed(`${lifecycle.turnId}:final-text-persistence`, {
        kind: "retryable", code: "final_text_persistence_failed", message: "最终对话尚未保存；只能恢复同一结果并重试本地保存。", recoverable: true
      }));
      session.recovery.updateMetadata(metadata => ({ ...metadata, localPersistence: "failed" }));
      await session.recovery.flush();
      session.host.ui.setStreaming(false);
      session.host.ui.showFailure();
      return;
    }
    requireCoordinatorOk(session.coordinator.markLocalPersistenceSucceeded());
    requireCoordinatorOk(session.coordinator.finalizeTurn());
    session.recovery.updateMetadata(metadata => ({ ...metadata, localPersistence: "succeeded" }));
  }
  const priorPersistenceFailure =
    terminal.persistence === "failed" ||
    session.recovery.metadata.localPersistence === "failed";
  session.host.abortSlot.set(null);
  session.host.streamFlushSlot.set(null);
  session.host.ui.setStreaming(false);
  if (!saved || priorPersistenceFailure) {
    session.host.ui.showFailure();
    session.recovery.updateMetadata((metadata) => ({
      ...metadata,
      localPersistence: priorPersistenceFailure ? metadata.localPersistence : "failed"
    }));
    await session.recovery.flush();
    return;
  }
  session.recovery.updateMetadata((metadata) => ({
    ...metadata,
    localPersistence: "succeeded"
  }));
  const recoverySaved = await session.recovery.flush();
  if (!recoverySaved) {
    session.host.ui.showFailure();
    return;
  }
  const compactionDelivery = session.recovery.metadata.pendingExternalAction?.actionKind === "compaction"
    ? session.recovery.metadata.pendingExternalAction.delivery : undefined;
  if (compactionDelivery && session.recovery.metadata.compaction?.summaryApplyState === "applied") {
    await acknowledgePersistedExternalResult(session.localProjectId, compactionDelivery, session.host.fetch);
  }
  const output = session.coordinator.getProviderOutputSnapshot();
  if (output?.delivery) await acknowledgePersistedExternalResult(session.localProjectId, output.delivery, session.host.fetch);
  if (typeof window !== "undefined") await flushPendingExternalResultAcks(session.localProjectId, session.host.fetch);
  if (!session.recovery.metadata.pendingConfirmation) {
    await session.recovery.clear();
  }
}

async function failRecoveryPersistence(session: APlusSession): Promise<void> {
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  if (!lifecycle || lifecycle.phase === "terminal") {
    session.host.ui.showFailure();
    session.host.ui.setStreaming(false);
    return;
  }
  if (lifecycle.persistence !== "pending") {
    requireCoordinatorOk(session.coordinator.markLocalPersistenceRequired());
  }
  requireCoordinatorOk(session.coordinator.markLocalPersistenceFailed(
    `${lifecycle.turnId}:recovery-persistence`,
    {
      kind: "terminal",
      code: "recovery_record_persistence_failed",
      message: "A+ Recovery Record 无法持久化，已停止启动外部执行。",
      recoverable: false
    }
  ));
  const current = session.coordinator.getLifecycleSnapshot();
  if (current && current.phase !== "terminal") {
    requireCoordinatorOk(session.coordinator.finalizeTurn());
  }
  await finalizeSession(session);
}

async function terminateDeniedSession(
  session: APlusSession,
  denied: Extract<AgentTurnCoordinatorActionResult, { status: "denied" }>
): Promise<void> {
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  recordAssistantFailureDetail(session, denied.error, !lifecycle);
  if (lifecycle && lifecycle.phase !== "terminal" && lifecycle.fault.kind === "none") {
    const recorded = session.coordinator.recordLocalError(
      `runtime:${denied.code}`,
      {
        kind: denied.code.includes("conflict") ? "conflict" : "terminal",
        code: denied.code.slice(0, 80),
        message: denied.error.slice(0, 800),
        recoverable: false
      }
    );
    if (recorded.status === "denied" && recorded.code !== "illegalTransition") {
      session.host.ui.showFailure();
    }
  }
  const current = session.coordinator.getLifecycleSnapshot();
  if (
    current &&
    current.phase !== "terminal" &&
    current.serverExecutionStatus !== "providerRunning" &&
    current.phase !== "executingTools" &&
    current.phase !== "compacting"
  ) {
    const finalized = session.coordinator.finalizeTurn();
    if (finalized.status === "ok") await finalizeSession(session);
  }
  session.host.ui.showFailure();
  session.host.ui.setStreaming(false);
  if (!lifecycle) session.host.persistWorkspace?.();
  await session.recovery.flush();
}

async function terminateMissingServerTurnSession(
  session: APlusSession,
  denied: Extract<AgentTurnCoordinatorActionResult, { status: "denied" }>
): Promise<void> {
  const detail = denied.error.trim().slice(0, 800) || "Server Turn 已不可恢复。";
  const completedAt = new Date(session.host.now()).toISOString();
  session.host.commitWorkspace((current) => {
    const assistant = current.ai.messages.find(
      (message) => message.id === session.prepared.assistantMessageId
    );
    const previous = assistant?.body.trim() ?? "";
    const body = previous.includes(detail)
      ? previous
      : [previous, detail].filter(Boolean).join("\n\n");
    return {
      workspace: finalizeAgentTurn(current, {
        agentTurnId: session.prepared.localAgentTurnId,
        userMessageId: session.prepared.userMessageId,
        assistantMessageId: session.prepared.assistantMessageId,
        outcome: session.prepared.runtimeState.hasAgentToolResult
          ? "partialSuccess"
          : "failedDuringProvider",
        assistantBody: body,
        assistantStatus: "failed",
        traceStatus: "failed",
        summary: detail,
        completedAt
      }),
      value: undefined
    };
  });
  const persisted = session.host.persistWorkspace?.();
  const finalizedLocally = !session.host.persistWorkspace ||
    (persisted?.phase === "saved" && !persisted.isDirty);
  session.prepared.controller.abort(new DOMException(detail, "AbortError"));
  session.host.abortSlot.set(null);
  session.host.streamFlushSlot.set(null);
  session.host.ui.setStreaming(false);
  session.host.ui.showFailure();
  if (finalizedLocally) {
    await session.recovery.clear();
  } else {
    session.recovery.updateMetadata((metadata) => ({
      ...metadata,
      localPersistence: "failed"
    }));
    await session.recovery.flush();
  }
  releaseActiveSession(session.localProjectId, session.coordinator);
}

function recordAssistantFailureDetail(
  session: APlusSession,
  rawDetail: string,
  finalizeBeforeExecution: boolean
): void {
  const detail = rawDetail.trim().slice(0, 800) || "A+ Runtime 执行失败。";
  const completedAt = new Date(session.host.now()).toISOString();
  session.host.commitWorkspace((current) => {
    const assistant = current.ai.messages.find(
      (message) => message.id === session.prepared.assistantMessageId
    );
    const previous = assistant?.body.trim() ?? "";
    const body = previous.includes(detail)
      ? previous
      : [previous, detail].filter(Boolean).join("\n\n");
    if (finalizeBeforeExecution) {
      return {
        workspace: finalizeAgentTurn(current, {
          agentTurnId: session.prepared.localAgentTurnId,
          userMessageId: session.prepared.userMessageId,
          assistantMessageId: session.prepared.assistantMessageId,
          outcome: "failedBeforeExecution",
          assistantBody: body,
          assistantStatus: "failed",
          traceStatus: "failed",
          summary: detail,
          completedAt
        }),
        value: undefined
      };
    }
    return {
      workspace: updateAiMessage(current, session.prepared.assistantMessageId, body, "streaming", {
        ...(assistant?.agentTrace ? { agentTrace: assistant.agentTrace } : {})
      }),
      value: undefined
    };
  });
}

async function terminateUnexpectedSession(session: APlusSession, error: unknown): Promise<void> {
  if (
    isAgentTurnHostSessionDetachedError(error) ||
    isAgentTurnHostSessionDetachedError(session.prepared.controller.signal.reason)
  ) {
    return;
  }
  const message = error instanceof Error ? error.message : "A+ Runtime 执行失败。";
  await terminateDeniedSession(session, {
    status: "denied",
    code: "a_plus_runtime_failed",
    error: message,
    recoverable: false,
    lifecycle: session.coordinator.getLifecycleSnapshot()
  });
}

function buildRecoveryRuntime(
  input: RunMorphoAgentTurnAPlusInput,
  prepared: PreparedAgentTurnAPlus
): APlusTurnRecoveryRuntime {
  return {
    input: {
      draft: input.draft,
      taskMode: input.taskMode,
      recommendedTaskMode: input.recommendedTaskMode,
      workIntent: input.workIntent,
      recommendedWorkIntent: input.recommendedWorkIntent,
      selectedObjectIds: [...input.selectedObjectIds],
      pendingDeliveryDraftTarget: input.pendingDeliveryDraftTarget
        ? { ...input.pendingDeliveryDraftTarget }
        : null,
      directionPreviewCount: input.directionPreviewCount,
      agentTurnMode: input.agentTurnMode,
      imageGenerationModelId: input.imageGenerationModelId,
      ...(input.readConversationTokenLimits()
        ? { conversationTokenLimits: input.readConversationTokenLimits() }
        : {})
    },
    pendingReadStepSequence: 1,
    pendingReadIds: prepared.runtimeState.readReceipts.map((receipt) => receipt.id),
    providerBaseRequest: cloneProviderRequest(prepared.providerRequest),
    sourceSnapshots: prepared.context.sourceSnapshots?.map((snapshot) => ({ ...snapshot })),
    continuationItems: [],
    localAgentTurnId: prepared.localAgentTurnId,
    createdAt: prepared.createdAt,
    executionTaskMode: prepared.executionTaskMode,
    executionTaskModeSource: prepared.executionTaskModeSource,
    executionWorkIntent: prepared.executionWorkIntent,
    executionWorkIntentSource: prepared.executionWorkIntentSource,
    imageAttachmentObjectIds: [...prepared.imageAttachmentObjectIds],
    documentExtractObjectIds: [...prepared.documentExtractObjectIds],
    allowStructuredComparison: prepared.allowStructuredComparison,
    facts: snapshotAgentTurnRuntimeFacts(prepared.runtimeState)
  };
}

function markDeliveredReads(session: APlusSession): void {
  // Called only after Coordinator observes the exact submitted request. An old
  // active request is never rebuilt; its receipts were already frozen in Recovery.
  const output = session.coordinator.getProviderOutputSnapshot();
  if (!output || output.stepSequence !== session.recovery.metadata.runtime.pendingReadStepSequence || output.requestId !== session.coordinator.getServerSnapshot()?.latestRequestId) return;
  const ids = new Set(session.recovery.metadata.runtime.pendingReadIds ?? []);
  session.prepared.runtimeState.readReceipts.forEach((receipt) => { if (ids.has(receipt.id)) receipt.delivered = true; });
  session.host.commitWorkspace((workspace) => ({
    workspace: recordDeliveredVisualObservations(workspace, session.prepared.runtimeState.readReceipts.filter((receipt) => ids.has(receipt.id)), output.requestId, output.stepSequence),
    value: undefined
  }));
  const state = session.prepared.runtimeState.requiredReadState;
  for (const tool of state.requiredTools) {
    const requirements = state.requirements.filter((requirement) => requirement.tool === tool);
    if (requirements.every((requirement) => requirementCovered(requirement, session.prepared.runtimeState.readReceipts, session.host.readWorkspace()))) {
      state.completedTools.add(tool); state.failedTools.delete(tool);
    } else state.completedTools.delete(tool);
  }
}

async function freshContinuationProviderRequest(session: APlusSession): Promise<APlusAgentProviderRequest> {
  const runtime = session.recovery.metadata.runtime;
  const base = continuationProviderRequest(runtime);
  if (!base.taskContract) return base;
  const workspace = session.host.readWorkspace();
  const contexts = buildTurnTaskContexts(workspace, base.taskContract);
  // Refresh local adapters only for the next request, preserving the frozen
  // source baseline that domain writes validate against.
  for (const [id, context] of Object.entries(contexts.activityContexts)) {
    context.sourceSnapshots = session.prepared.activityContexts[id]?.sourceSnapshots;
    (session.prepared.activityContexts as Record<string, typeof context>)[id] = context;
  }
  const state = session.prepared.runtimeState;
  const stepSequence = (session.coordinator.getServerSnapshot()?.latestStepSequence ?? 0) + 1;
  const deliveryTarget = session.turnInput.pendingDeliveryDraftTarget;
  const delivery = deliveryTarget ? workspace.objects[deliveryTarget.deliveryObjectId] : undefined;
  const deliveryContext = deliveryTarget && delivery?.type === "delivery" && delivery.visibility === "active"
    ? buildDeliverySectionContext(workspace, delivery, deliveryTarget.sectionId) : undefined;
  let deliveryInput: APlusAgentProviderRequest["input"] = [];
  if (deliveryContext && deliveryTarget) {
    const serialized = JSON.stringify(deliveryContext), contentHash = hashProductValue(serialized);
    const receipt = { ...sourceReceipt(workspace, deliveryTarget.deliveryObjectId, "delivery", `continuation:delivery:${stepSequence}`, "request"),
      contentHash, sectionId: deliveryTarget.sectionId, representation: "text" as const, status: serialized.length > 8000 ? "partial" as const : "full" as const,
      range: { start: 0, end: Math.min(serialized.length, 8000), total: serialized.length, ...(serialized.length > 8000 ? { nextStart: 8000 } : {}) } };
    state.readReceipts.push(receipt);
    const baseline = captureDeliveryGenerationBaseline(workspace, deliveryTarget.deliveryObjectId, deliveryTarget.sectionId);
    if (baseline) state.deliveryGenerationEvidence.push({ receiptId: receipt.id, contentHash, baseline });
    deliveryInput = [{ role: "user", content: [{ type: "input_text", text: `<untrusted_delivery_section>\n${serialized.slice(0, 8000)}\n</untrusted_delivery_section>` }] }];
  }
  const visual = base.taskContract.readContractVersion === 1 ? materializeContinuationImages({ base,
    observations: state.observationMessages, reads: state.readReceipts, effects: state.effectReceipts,
    workspace, contract: base.taskContract, stepSequence }) : undefined;
  if (visual) state.readReceipts = visual.reads;
  // Completion is derived from current coverage, never retained from a read
  // whose authority changed during the preceding tool batch.
  state.requiredReadState.completedTools = new Set(state.requiredReadState.requiredTools.filter((tool) =>
    state.requiredReadState.requirements.filter((requirement) => requirement.tool === tool)
      .every((requirement) => requirementCovered(requirement, state.readReceipts, workspace))));
  const nextReceipts = state.readReceipts.map((receipt) => ({ ...receipt, delivered: true }));
  const anticipated = { ...state.requiredReadState, completedTools: new Set(state.requiredReadState.requiredTools.filter((tool) =>
    state.requiredReadState.requirements.filter((requirement) => requirement.tool === tool)
      .every((requirement) => requirementCovered(requirement, nextReceipts, workspace)))) };
  const advanced = advanceRequiredAgentReadState(anticipated);
  state.requiredReadState = { ...advanced.state, completedTools: state.requiredReadState.completedTools };
  const reminder = advanced.action === "remind" ? `${buildRequiredAgentReadReminder(advanced.missingTools)}\n${JSON.stringify(base.taskContract.requiredReads.filter((requirement) => !requirementCovered(requirement, state.readReceipts, workspace)))}` : "";
  const fresh = { role: "user" as const, content: [{ type: "input_text" as const, text: `<morpho_fresh_context>\n${JSON.stringify(Object.entries(contexts.activityContexts).map(([id, context]) => ({ activityId: id, context: context.kind === "comparison" ? buildProviderComparisonTaskContext(context) : buildProviderTaskContext(context) })))}\n${reminder}\n</morpho_fresh_context>` }] };
  const request = { ...base, input: [...(visual?.input ?? base.input), fresh, ...deliveryInput] };
  // Persist the newly built body before submission. Coordinator owns exact
  // replay after submission; recovery never reconstructs that active body.
  session.recovery.updateMetadata((metadata) => ({ ...metadata, runtime: { ...metadata.runtime, pendingReadStepSequence: stepSequence, pendingReadIds: state.readReceipts.filter((receipt) => !receipt.delivered && (receipt.kind !== "image" || receipt.requestImageStatus === "materialized")).map((receipt) => receipt.id), providerBaseRequest: { ...request, continuationItems: undefined }, facts: snapshotAgentTurnRuntimeFacts(state) } }));
  if (!await session.recovery.flush()) throw new Error("新 continuation 读取回执无法持久化。");
  return request;
}

function continuationProviderRequest(runtime: APlusTurnRecoveryRuntime): APlusAgentProviderRequest {
  return {
    ...cloneProviderRequest(runtime.providerBaseRequest),
    continuationItems: runtime.continuationItems.map((item) => ({ ...item }))
  };
}

function mergeContinuationItems(
  previous: readonly APlusAgentContinuationItem[],
  next: readonly APlusAgentContinuationItem[]
): readonly APlusAgentContinuationItem[] {
  const keys = new Set(previous.map(continuationItemKey));
  const additions = next.filter((item) => {
    const key = continuationItemKey(item);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return [...previous.map((item) => ({ ...item })), ...additions.map((item) => ({ ...item }))];
}

function mergeToolExecutionIntent(
  previous: APlusTurnRecoveryMetadata["toolExecutionIntents"],
  next: NonNullable<APlusTurnRecoveryMetadata["toolExecutionIntents"]>[number]
): NonNullable<APlusTurnRecoveryMetadata["toolExecutionIntents"]> {
  const existing = previous?.filter((intent) => intent.callId !== next.callId) ?? [];
  return [...existing, { ...next }];
}

function continuationItemKey(item: APlusAgentContinuationItem): string {
  return `${item.type}:${item.callId}`;
}

function cloneProviderRequest(request: APlusAgentProviderRequest): APlusAgentProviderRequest {
  return structuredClone(request);
}

function installActiveSession(session: APlusSession): void {
  activeSessions.set(session.localProjectId, {
    coordinator: session.coordinator,
    controller: session.prepared.controller,
    host: session.host,
    finish: () => driveSessionSerialized(session),
    resume: () => resumeActiveSession(session)
  });
}

function releaseActiveSession(
  localProjectId: string,
  coordinator: AgentTurnCoordinator
): void {
  const active = activeSessions.get(localProjectId);
  if (active?.coordinator !== coordinator) return;
  activeSessions.delete(localProjectId);
}

function releaseTerminalActiveSession(
  localProjectId: string,
  coordinator: AgentTurnCoordinator
): void {
  const active = activeSessions.get(localProjectId);
  if (active?.coordinator !== coordinator) return;
  if (coordinator.getLifecycleSnapshot()?.phase !== "terminal") return;
  releaseActiveSession(localProjectId, coordinator);
}

async function resumeActiveSession(
  session: APlusSession
): Promise<"recovered" | "pending" | "failed"> {
  const lifecycle = session.coordinator.getLifecycleSnapshot();
  if (!lifecycle) {
    session.host.ui.setStreaming(false);
    session.host.ui.showFailure();
    return "failed";
  }
  if (lifecycle.phase === "terminal") {
    await finalizeSession(session);
    releaseActiveSession(session.localProjectId, session.coordinator);
    return "recovered";
  }
  session.host.ui.setStreaming(true);
  try {
    if (lifecycle.phase !== "compacting" && lifecycle.phase !== "executingTools") {
      const reconciled = await session.coordinator.recoverServerExecutionStatus();
      const reconciliation = await reconcileRequestResult(session, reconciled, false);
      if (reconciliation !== "usable") return reconciliation;
    }
    await driveSessionSerialized(session);
    const next = session.coordinator.getLifecycleSnapshot();
    if (next?.phase === "terminal") {
      releaseActiveSession(session.localProjectId, session.coordinator);
      return "recovered";
    }
    return "pending";
  } catch (error) {
    await terminateUnexpectedSession(session, error);
    return "failed";
  }
}

function requireCoordinatorOk(result: AgentTurnCoordinatorActionResult): void {
  if (result.status === "denied") throw new Error(`${result.code}: ${result.error}`);
}

function failPreparation(host: AgentTurnHost, draft: string, error: unknown): void {
  host.abortSlot.set(null);
  host.ui.setStreaming(false);
  host.ui.setDraft(draft);
  host.ui.showFailure();
  if (error instanceof Error && error.name === "AbortError") return;
}

function mapOverallOutcome(
  outcome: Extract<AgentTurnLifecycleState, { phase: "terminal" }>['outcome']['kind']
): AgentTurnOutcome {
  if (outcome === "completed") return "success";
  if (outcome === "partiallyCompleted") return "partialSuccess";
  if (outcome === "pendingConfirmation") return "pendingConfirmation";
  if (outcome === "cancelled") return "cancelledDuringProvider";
  return "failedDuringProvider";
}

function messageStatus(
  outcome: Extract<AgentTurnLifecycleState, { phase: "terminal" }>['outcome']['kind']
): Exclude<AiMessage["status"], undefined | "streaming"> {
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "failed") return "failed";
  return "done";
}

function traceStatus(
  outcome: Extract<AgentTurnLifecycleState, { phase: "terminal" }>['outcome']['kind']
): "done" | "failed" | "cancelled" {
  return outcome === "cancelled" ? "cancelled" : outcome === "failed" ? "failed" : "done";
}

function terminalAssistantBody(
  assistant: AiMessage | undefined,
  lifecycle: Extract<AgentTurnLifecycleState, { phase: "terminal" }>
): string {
  if (assistant?.body.trim()) return assistant.body;
  if (lifecycle.outcome.kind === "pendingConfirmation") return "等待你确认后再执行这个操作。";
  if (lifecycle.outcome.kind === "cancelled") return "当前 Agent 回合已取消，已有本地结果会保留。";
  if (lifecycle.outcome.kind === "partiallyCompleted") return "当前 Agent 回合部分完成，已有本地结果会保留。";
  if (lifecycle.outcome.kind === "completed") return "当前 Agent 回合已完成。";
  return "当前 Agent 回合未能完成。";
}

function createRuntimeId(): string {
  return crypto.randomUUID();
}

class RecoveryWriter {
  private latestSnapshot: AgentTurnCoordinatorRecoverySnapshot | undefined;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;

  constructor(
    private readonly store: AgentTurnRecoveryStore,
    private readonly localProjectId: string,
    private readonly creationIdempotencyKey: string,
    private currentMetadata: APlusTurnRecoveryMetadata
  ) {}

  get metadata(): APlusTurnRecoveryMetadata {
    return this.currentMetadata;
  }

  observe(snapshot: AgentTurnCoordinatorRecoverySnapshot): void {
    this.latestSnapshot = snapshot;
    this.enqueue();
  }

  updateMetadata(
    transform: (metadata: APlusTurnRecoveryMetadata) => APlusTurnRecoveryMetadata
  ): void {
    this.currentMetadata = transform(this.currentMetadata);
    this.enqueue();
  }

  async flush(): Promise<boolean> {
    await this.queue;
    return !this.failed;
  }

  async persistRequestIntent(snapshot: AgentTurnCoordinatorRecoverySnapshot): Promise<boolean> {
    // Explicitly enqueue this exact intent: observer exceptions must not make a
    // successful flush of an older snapshot authorize a new POST.
    this.observe(snapshot);
    return this.flush();
  }

  async clear(): Promise<void> {
    await this.queue;
    await this.store.clear(this.localProjectId);
  }

  private enqueue(): void {
    const snapshot = this.latestSnapshot;
    if (!snapshot) return;
    const metadata = structuredClone(this.currentMetadata);
    this.queue = this.queue.then(async () => {
      try {
        await this.store.save({
          recordVersion: A_PLUS_TURN_RECOVERY_RECORD_VERSION,
          localProjectId: this.localProjectId,
          serverTurnId: snapshot.serverSnapshot.serverTurnId,
          creationIdempotencyKey: this.creationIdempotencyKey,
          coordinator: snapshot,
          metadata,
          updatedAt: new Date().toISOString()
        });
      } catch {
        this.failed = true;
      }
    });
  }
}
