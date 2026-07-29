import { compileVisualGenerationPlan } from "@/domain/operations/imagePromptCompiler";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import type { APlusAgentContinuationItem, APlusToolCall } from "@/shared/agentTurnJournalProtocol";
import { buildPendingAgentActionConfirmation, buildRequestedAgentActionConfirmation } from "./agentConfirmation";
import { finishAgentToolActivityInWorkspace, startLocalAgentToolActivity } from "./agentMessageTrace";
import {
  executeAgentTool,
  type AgentToolBatchState,
  type AgentToolExecutorInput
} from "./agentToolExecutors";
import { buildAgentToolActivityDescriptor } from "./agentToolActivity";
import {
  isAPlusExternalActionRunningError,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";
import type { AgentTurnCoordinator, AgentTurnCoordinatorActionResult } from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import type { ToolCallTerminalResult } from "./agentTurnLifecycle";
import type { PreparedAgentTurnAPlus, RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import { buildAgentVisualGenerationBatch, resolveExpectedVisualGenerationCount } from "./agentVisualGenerationBatch";
import {
  getAgentToolEffect,
  parseMorphoAgentToolCallBatch,
  resolveAgentToolExecutionPolicy,
  type AgentFunctionCall,
  type MorphoAgentToolArguments
} from "./morphoAgent";

export type APlusExternalRequestIdentity = Readonly<{
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
}>;

export type AgentToolBatchAPlusResult = Readonly<{
  status: "completed" | "pendingConfirmation" | "cancelled" | "failed" | "externalActionRunning";
  continuationItems: readonly APlusAgentContinuationItem[];
  terminalResults: readonly ToolCallTerminalResult[];
  externalAction?: Readonly<APlusExternalActionDescriptor & { callId: string }>;
  pendingConfirmation?: Readonly<{
    confirmationId: string;
    callId: string;
    value: PendingAiConfirmation;
  }>;
}>;

export async function executeAgentToolBatchAPlus(input: Readonly<{
  toolCalls: readonly APlusToolCall[];
  providerOutputText: string;
  coordinator: AgentTurnCoordinator;
  host: AgentTurnHost;
  turnInput: RunMorphoAgentTurnAPlusInput;
  prepared: PreparedAgentTurnAPlus;
  externalRequest: APlusExternalRequestIdentity;
  requestWebSearch: (input: {
    identity: APlusExternalRequestIdentity;
    actionId: string;
    queries: string[];
    signal: AbortSignal;
  }) => Promise<{
    sources: Array<{ title: string; url: string; domain?: string; snippet?: string; excerpt?: string }>;
    failedSourceCount?: number;
    timedOutSourceCount?: number;
  }>;
  restoredPendingConfirmation?: AgentToolBatchAPlusResult["pendingConfirmation"];
  onCallTerminal?: (input: Readonly<{
    terminal: ToolCallTerminalResult;
    continuationItem?: APlusAgentContinuationItem;
    pendingConfirmation?: NonNullable<AgentToolBatchAPlusResult["pendingConfirmation"]>;
  }>) => Promise<boolean>;
  onCallIntent?: (input: Readonly<{
    callId: string;
    stableOperationId: string;
  }>) => Promise<boolean>;
}>): Promise<AgentToolBatchAPlusResult> {
  const callIds = input.toolCalls.map((call) => call.callId);
  const duplicate = findDuplicate(callIds);
  if (duplicate) {
    throw new AgentToolBatchAPlusError("duplicate_tool_call", `重复 Tool Call ID：${duplicate}`);
  }
  const lifecycleAtStart = input.coordinator.getLifecycleSnapshot();
  const existingResults = lifecycleAtStart?.phase === "executingTools"
    ? lifecycleAtStart.activeToolBatch.results
    : [];
  if (lifecycleAtStart?.phase === "executingTools") {
    if (!sameOrderedIds(lifecycleAtStart.activeToolBatch.declaredCallIds, callIds)) {
      throw new AgentToolBatchAPlusError(
        "tool_batch_recovery_mismatch",
        "恢复的 Tool Batch 与已声明 Call 集合不一致。"
      );
    }
  } else {
    requireOk(input.coordinator.beginToolBatch(callIds));
  }
  const calls = input.toolCalls.map<AgentFunctionCall>((call) => ({
    id: call.callId,
    callId: call.callId,
    name: call.name,
    argumentsText: call.argumentsText
  }));
  const parsedCalls = parseMorphoAgentToolCallBatch(calls);
  const selectedDirectionCount = input.turnInput.selectedObjects
    .filter((object) => object.type === "conceptDirection").length;
  const validVisualCalls = parsedCalls.flatMap((entry) =>
    entry.status === "valid" && entry.parsed.name === "generate_visuals"
      ? [{
          callId: entry.call.callId,
          plan: compileVisualGenerationPlan({
            workspace: input.host.readWorkspace(),
            kind: entry.parsed.args.kind,
            intents: entry.parsed.args.items,
            selectedSourceObjectIds: input.prepared.context.objectIds,
            projectReferenceObjectIds: Object.values(input.host.readWorkspace().objects)
              .filter((object) => object.type === "image" && object.role === "reference")
              .map((object) => object.id),
            modelId: input.turnInput.imageGenerationModelId,
            currentUserInput: input.turnInput.draft
          })
        }]
      : []
  );
  const visualBatch = validVisualCalls.length > 0
    ? buildAgentVisualGenerationBatch({
        calls: validVisualCalls,
        expected: resolveExpectedVisualGenerationCount({
          draft: input.turnInput.draft,
          kind: validVisualCalls[0]!.plan.kind,
          selectedDirectionCount,
          defaultPreviewCount: input.turnInput.directionPreviewCount
        })
      })
    : null;
  const batchState: AgentToolBatchState = { visualBatch, pendingAgentActionCreated: false };
  const terminalResults: ToolCallTerminalResult[] = [];
  const continuationItems: APlusAgentContinuationItem[] = input.toolCalls.map((call) => ({
    type: "function_call",
    callId: call.callId,
    name: call.name,
    argumentsText: call.argumentsText
  }));
  let pendingConfirmation: AgentToolBatchAPlusResult["pendingConfirmation"];
  let runningExternalAction: Readonly<APlusExternalActionDescriptor & { callId: string }> | undefined;
  let stopRemaining = false;

  for (const entry of parsedCalls) {
    const callId = entry.call.callId;
    const existing = existingResults.find((result) => result.callId === callId);
    if (existing) {
      terminalResults.push(existing);
      if (existing.status === "pendingConfirmation") {
        if (!input.restoredPendingConfirmation ||
          input.restoredPendingConfirmation.callId !== callId) {
          throw new AgentToolBatchAPlusError(
            "pending_confirmation_payload_unavailable",
            "Pending Confirmation 的本地恢复 Payload 不可用。"
          );
        }
        pendingConfirmation = input.restoredPendingConfirmation;
        stopRemaining = true;
      } else {
        const recoveredItem: APlusAgentContinuationItem = {
          type: "function_call_output",
          callId,
          output: boundedOutput(recoveredProviderResult(existing))
        };
        continuationItems.push(recoveredItem);
        if (input.onCallTerminal && !await input.onCallTerminal({
          terminal: existing,
          continuationItem: recoveredItem
        })) {
          throw new AgentToolBatchAPlusError(
            "recovery_record_persistence_failed",
            "已完成 Tool Call 的恢复结果无法持久化。"
          );
        }
      }
      continue;
    }
    let terminal: ToolCallTerminalResult;
    let providerResult: unknown;
    if (stopRemaining || input.prepared.controller.signal.aborted) {
      terminal = { status: "cancelled", callId, reason: "当前 Tool Batch 已停止继续执行。" };
      providerResult = { status: "cancelled", reason: terminal.reason };
    } else if (entry.status === "invalid") {
      terminal = {
        status: "failed",
        callId,
        error: {
          kind: "terminal",
          code: "invalid_tool_arguments",
          message: entry.error,
          recoverable: false
        }
      };
      providerResult = { status: "failed", code: "invalid_tool_arguments", error: entry.error };
    } else {
      const activity = buildAgentToolActivityDescriptor(entry.parsed, {
        workspace: input.host.readWorkspace(),
        selectedObjects: input.turnInput.selectedObjects
      });
      input.host.commitWorkspace((current) => {
        const assistant = current.ai.messages.find((message) => message.id === input.prepared.assistantMessageId);
        if (!assistant?.agentTrace) return { workspace: current, value: undefined };
        return {
          workspace: {
            ...current,
            ai: {
              ...current.ai,
              messages: current.ai.messages.map((message) =>
                message.id === input.prepared.assistantMessageId && message.agentTrace
                  ? {
                      ...message,
                      agentTrace: startLocalAgentToolActivity(message.agentTrace, {
                        toolCallId: callId,
                        toolName: entry.parsed.name,
                        activityKind: activity.activityKind,
                        label: activity.label,
                        detail: activity.detail
                      }, new Date(input.host.now()).toISOString())
                    }
                  : message
              )
            }
          },
          value: undefined
        };
      });
      const executionPolicy = resolveAgentToolExecutionPolicy({
        name: entry.parsed.name,
        mode: input.turnInput.agentTurnMode,
        explicitUserCommand:
          entry.parsed.name !== "submit_memory_update" || input.prepared.requiredMemoryUpdates.length > 0
      });
      if (executionPolicy === "requireConfirmation") {
        const confirmationValue = buildPendingAgentActionConfirmation({
          parsed: entry.parsed,
          compiledVisualPlan:
            entry.parsed.name === "generate_visuals" && visualBatch?.status === "ok"
              ? visualBatch.plan
              : undefined,
          draft: input.turnInput.draft,
          contextObjectIds: input.prepared.context.objectIds,
          citations: input.prepared.runtimeState.collectedCitations,
          selectedObjects: input.turnInput.selectedObjects,
          selectedObjectIds: input.turnInput.selectedObjectIds,
          userMessageId: input.prepared.userMessageId,
          assistantMessageId: input.prepared.assistantMessageId,
          imageAttachmentObjectIds: input.prepared.imageAttachmentObjectIds,
          documentExtractObjectIds: input.prepared.documentExtractObjectIds,
          documentFragmentExtractObjectIds: input.prepared.context.documentFragmentExtracts.map((item) => item.objectId)
        });
        const confirmationId = `${input.externalRequest.serverTurnId}:${callId}`;
        input.host.ui.setPendingConfirmation(confirmationValue);
        terminal = {
          status: "pendingConfirmation",
          callId,
          confirmationId,
          unresolvedWorkIds: []
        };
        providerResult = { status: "pendingConfirmation", confirmationId };
        pendingConfirmation = { confirmationId, callId, value: confirmationValue };
        stopRemaining = true;
      } else if (executionPolicy === "requireExplicitUserCommand") {
        terminal = {
          status: "failed",
          callId,
          error: {
            kind: "terminal",
            code: "explicit_user_command_required",
            message: "该操作需要用户当前消息中的明确指令。",
            recoverable: false
          }
        };
        providerResult = { status: "failed", code: "explicit_user_command_required" };
      } else {
        const capturedConfirmation: { value?: PendingAiConfirmation } = {};
        const executorInput = buildExecutorInput({
          input,
          parsed: entry.parsed,
          callId,
          batchState,
          capturedConfirmation
        });
        if (input.onCallIntent && !await input.onCallIntent({
          callId,
          stableOperationId: executorInput.stableOperationId
        })) {
          throw new AgentToolBatchAPlusError(
            "recovery_record_persistence_failed",
            "Tool Call 执行意图无法写入 A+ Recovery Record。"
          );
        }
        try {
          const result = await executeAgentTool({ ...executorInput, parsed: entry.parsed });
          providerResult = result;
          const returnedPending = isRecord(result) && result.status === "pendingConfirmation";
          if (returnedPending || capturedConfirmation.value) {
            const confirmationValue = capturedConfirmation.value;
            if (!confirmationValue) {
              throw new Error("Tool 返回 Pending Confirmation，但没有可持久化的确认内容。");
            }
            const confirmationId = `${input.externalRequest.serverTurnId}:${callId}`;
            input.host.ui.setPendingConfirmation(confirmationValue);
            terminal = {
              status: "pendingConfirmation",
              callId,
              confirmationId,
              unresolvedWorkIds: []
            };
            pendingConfirmation = { confirmationId, callId, value: confirmationValue };
            stopRemaining = true;
          } else {
            const effect = getAgentToolEffect(entry.parsed.name);
            const didProduceLocalEffect = Boolean(
              effect.pendingDraftWrite || effect.reversibleWorkspaceWrite || effect.memoryWrite
            );
            let persistence: "notRequired" | "succeeded" | "failed" = "notRequired";
            if (didProduceLocalEffect) {
              requireOk(input.coordinator.markLocalPersistenceRequired());
              const persisted = input.host.persistWorkspace?.();
              if (persisted?.phase === "saved" && !persisted.isDirty) {
                requireOk(input.coordinator.markLocalPersistenceSucceeded());
                persistence = "succeeded";
              } else {
                requireOk(input.coordinator.markLocalPersistenceFailed(
                  `${callId}:persistence`,
                  {
                    kind: "terminal",
                    code: "workspace_persistence_failed",
                    message: persisted?.error ?? "Workspace 持久化端口不可用或未完成保存。",
                    recoverable: false
                  }
                ));
                persistence = "failed";
              }
            }
            const failedItems = isRecord(result) && Array.isArray(result.failedItems)
              ? result.failedItems
              : [];
            const unresolvedWorkIds = failedItems.map((_, index) => `${callId}:item:${index}`);
            unresolvedWorkIds.forEach((workId) => requireOk(input.coordinator.recordUnresolvedWork(workId)));
            terminal = {
              status: "executed",
              callId,
              localEffect: didProduceLocalEffect ? "produced" : "none",
              persistence,
              unresolvedWorkIds
            };
          }
        } catch (error) {
          if (input.prepared.controller.signal.aborted || isAbortError(error)) {
            terminal = { status: "cancelled", callId, reason: "用户取消了当前 Tool。" };
            providerResult = { status: "cancelled", reason: terminal.reason };
          } else if (isAPlusExternalActionRunningError(error)) {
            runningExternalAction = { ...error.action, callId };
            break;
          } else {
            const message = error instanceof Error ? error.message.slice(0, 800) : "Tool 执行失败。";
            terminal = {
              status: "failed",
              callId,
              error: {
                kind: "terminal",
                code: "tool_execution_failed",
                message,
                recoverable: false
              }
            };
            providerResult = { status: "failed", code: "tool_execution_failed", error: message };
          }
        }
      }
      input.host.commitWorkspace((current) => ({
        workspace: finishAgentToolActivityInWorkspace(
          current,
          input.prepared.assistantMessageId,
          callId,
          terminal.status === "failed" ? "failed" : "done"
        ),
        value: undefined
      }));
    }
    requireOk(input.coordinator.recordToolCallTerminalResult(terminal));
    terminalResults.push(terminal);
    let continuationItem: APlusAgentContinuationItem | undefined;
    if (terminal.status !== "pendingConfirmation") {
      continuationItem = {
        type: "function_call_output",
        callId,
        output: boundedOutput(providerResult)
      };
      continuationItems.push(continuationItem);
    }
    if (input.onCallTerminal && !await input.onCallTerminal({
      terminal,
      ...(continuationItem ? { continuationItem } : {}),
      ...(terminal.status === "pendingConfirmation" && pendingConfirmation
        ? { pendingConfirmation }
        : {})
    })) {
      throw new AgentToolBatchAPlusError(
        "recovery_record_persistence_failed",
        "Tool Call 终态无法写入 A+ Recovery Record。"
      );
    }
  }

  if (runningExternalAction) {
    return {
      status: "externalActionRunning",
      continuationItems,
      terminalResults,
      externalAction: runningExternalAction
    };
  }

  requireOk(input.coordinator.finalizeToolBatch());
  const lifecycle = input.coordinator.getLifecycleSnapshot();
  const batchOutcome = lifecycle?.toolBatches.at(-1)?.outcome.kind;
  return {
    status: pendingConfirmation
      ? "pendingConfirmation"
      : batchOutcome === "pendingConfirmation"
        ? "pendingConfirmation"
      : batchOutcome === "cancelled"
        ? "cancelled"
        : batchOutcome === "failed"
          ? "failed"
          : "completed",
    continuationItems,
    terminalResults,
    ...(pendingConfirmation ? { pendingConfirmation } : {})
  };
}

function recoveredProviderResult(result: ToolCallTerminalResult): unknown {
  switch (result.status) {
    case "executed":
      return {
        status: "completed",
        recovered: true,
        localEffect: result.localEffect,
        persistence: result.persistence,
        unresolvedWorkIds: result.unresolvedWorkIds
      };
    case "failed":
      return {
        status: "failed",
        recovered: true,
        code: result.error.code,
        error: result.error.message
      };
    case "cancelled":
      return { status: "cancelled", recovered: true, reason: result.reason };
    case "pendingConfirmation":
      return { status: "pendingConfirmation", recovered: true };
  }
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildExecutorInput(input: Readonly<{
  input: Parameters<typeof executeAgentToolBatchAPlus>[0];
  parsed: MorphoAgentToolArguments;
  callId: string;
  batchState: AgentToolBatchState;
  capturedConfirmation: { value?: PendingAiConfirmation };
}>): AgentToolExecutorInput {
  const { prepared, host, turnInput, externalRequest } = input.input;
  return {
    callId: input.callId,
    stableOperationId: `a-plus-effect-${externalRequest.serverTurnId}-${input.callId}`,
    context: prepared.context,
    providerTaskContext: prepared.providerTaskContext,
    runtimeState: prepared.runtimeState,
    batchState: input.batchState,
    commitWorkspace: host.commitWorkspace,
    readWorkspace: host.readWorkspace,
    draft: turnInput.draft,
    modelOutputText: input.input.providerOutputText,
    userMessageId: prepared.userMessageId,
    assistantMessageId: prepared.assistantMessageId,
    userMessageCreatedAt: prepared.createdAt,
    selectedObjectIds: turnInput.selectedObjectIds,
    selectedObjects: turnInput.selectedObjects,
    allowStructuredComparison: prepared.allowStructuredComparison,
    imageAttachmentObjectIds: prepared.imageAttachmentObjectIds,
    documentExtractObjectIds: prepared.documentExtractObjectIds,
    ...(prepared.deliverySectionContext
      ? { deliverySectionContext: prepared.deliverySectionContext }
      : {}),
    requiredMemoryUpdates: prepared.requiredMemoryUpdates,
    imageGenerationModelId: turnInput.imageGenerationModelId,
    signal: prepared.controller.signal,
    requestWebSearch: (queries) => input.input.requestWebSearch({
      identity: externalRequest,
      actionId: input.callId,
      queries,
      signal: prepared.controller.signal
    }),
    executeVisualGenerationPlan: (visualInput) => host.executeVisualGenerationPlan({
      ...visualInput,
      aPlusExternalAction: {
        ...externalRequest,
        actionId: input.callId
      }
    }),
    ui: {
      selectObjects: host.ui.selectObjects,
      focusObject: host.ui.focusObject,
      openProposal: host.ui.openProposal,
      clearPendingDeliveryDraftTarget: host.ui.clearPendingDeliveryDraftTarget,
      requestConfirmation: (args, compiledVisualPlan) => {
        input.capturedConfirmation.value = buildRequestedAgentActionConfirmation({
          args,
          compiledVisualPlan,
          workspace: host.readWorkspace(),
          draft: turnInput.draft,
          contextObjectIds: prepared.context.objectIds,
          selectedObjects: turnInput.selectedObjects
        });
      }
    }
  };
}

function requireOk(result: AgentTurnCoordinatorActionResult): void {
  if (result.status === "denied") {
    throw new AgentToolBatchAPlusError(result.code, result.error);
  }
}

function boundedOutput(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? null);
  } catch {
    serialized = JSON.stringify({ status: "failed", code: "non_serializable_tool_output" });
  }
  return serialized.length <= 16_000
    ? serialized
    : JSON.stringify({ status: "completed", truncated: true, preview: serialized.slice(0, 15_000) });
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  return values.find((value) => seen.has(value) || !seen.add(value));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentToolBatchAPlusError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentToolBatchAPlusError";
  }
}
