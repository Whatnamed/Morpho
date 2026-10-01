import { isAgentReadReceipt, type AgentEffectReceipt } from "@/shared/agentReadCoverage";
import { failRequiredAgentRead } from "./agentTaskStrategy";
import { compileVisualGenerationPlan } from "@/domain/operations/imagePromptCompiler";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
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
  hashAPlusExternalActionBody,
  buildAPlusImageBatchIdentity,
  buildAPlusImageChildActionId,
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
import { getAgentToolAuthorizationBlockReason } from "./agentToolAuthority";
import { getTurnActivityForTool } from "@/shared/turnTaskContract";
import { buildProviderComparisonTaskContext, buildProviderTaskContext } from "./taskContext";
import { mergeAgentSearchCitations, webSearchSourcesToCitations } from "./agentTurnLimits";

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
    preparedAction?: APlusExternalActionDescriptor;
    onBeforeSend?: (action: APlusExternalActionDescriptor) => Promise<boolean> | boolean;
  }) => Promise<{
    sources: Array<{ title: string; url: string; domain?: string; snippet?: string; excerpt?: string }>;
    failedSourceCount?: number;
    timedOutSourceCount?: number;
  }>;
  restoredPendingExternalAction?: Readonly<APlusExternalActionDescriptor & { callId?: string }>;
  onExternalActionIntent?: (input: Readonly<{
    callId: string;
    action: APlusExternalActionDescriptor;
  }>) => Promise<boolean> | boolean;
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
  const legacyRecovery = !input.prepared.providerRequest.taskContract;
  if (input.restoredPendingExternalAction && !hasMatchingExternalActionCall(
    input.restoredPendingExternalAction,
    parsedCalls
  )) {
    throw new AgentToolBatchAPlusError(
      "external_action_request_payload_unavailable",
      "A+ External Action 的持久化请求 Body 没有对应的 Tool Call，不能猜测新的请求。"
    );
  }
  const visualActivity = getTurnActivityForTool(input.prepared.taskContract, "generate_visuals");
  const visualContext = visualActivity ? input.prepared.activityContexts[visualActivity.id]! : input.prepared.context;
  const visualSelectedObjects = visualActivity ? visualActivity.sourceObjectIds.map((id) => input.host.readWorkspace().objects[id]).filter((object) => Boolean(object)) : input.turnInput.selectedObjects;
  const selectedDirectionCount = visualSelectedObjects
    .filter((object) => object.type === "conceptDirection").length;
  const validVisualCalls = legacyRecovery ? [] : parsedCalls.flatMap((entry) =>
    entry.status === "valid" && entry.parsed.name === "generate_visuals"
      ? [{
          callId: entry.call.callId,
          plan: compileVisualGenerationPlan({
            workspace: input.host.readWorkspace(),
            kind: entry.parsed.args.kind,
            intents: entry.parsed.args.items,
            selectedSourceObjectIds: visualContext.objectIds,
            allowedReferenceObjectIds: visualActivity?.referenceObjectIds,
            projectReferenceObjectIds: Object.values(input.host.readWorkspace().objects)
              .filter((object) => object.type === "image" && object.role === "reference")
              .map((object) => object.id),
            modelId: input.turnInput.imageGenerationModelId,
            currentUserInput: visualActivity?.instruction ?? input.turnInput.draft
          })
        }]
      : []
  );
  const visualBatch = validVisualCalls.length > 0
    ? buildAgentVisualGenerationBatch({
        calls: validVisualCalls,
        expected: visualActivity?.expectedVisualCount ? {
          totalItems: visualActivity.expectedVisualCount, requestedPreviewCount: visualActivity.requestedPreviewCount, source: "explicitTotal"
        } : resolveExpectedVisualGenerationCount({
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
    const recoverExactAction = legacyRecovery && input.restoredPendingExternalAction &&
      hasMatchingExternalActionCall(input.restoredPendingExternalAction, [entry]);
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
    if ((stopRemaining && !recoverExactAction) || input.prepared.controller.signal.aborted) {
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
      // An exact persisted action is an execution fact, not a new effect grant.
      // Keep this path outside the normal executor/authority profile.
      const generatedEarlier = input.prepared.runtimeState.effectReceipts.filter((receipt) => receipt.tool === "generate_visuals" && !callIds.includes(receipt.callId)).flatMap((receipt) => receipt.objectIds);
      const generationLimit = entry.parsed.name === "generate_visuals" && visualActivity?.expectedVisualCount && new Set(generatedEarlier).size >= visualActivity.expectedVisualCount ? "本轮已完成授权图像数量；只读观察不能授权另一批生成。" : undefined;
      const authorityBlockReason = recoverExactAction ? undefined : generationLimit ?? getAgentToolAuthorizationBlockReason(input.prepared.authorityProfile, entry.parsed, input.host.readWorkspace());
      if (authorityBlockReason) {
        terminal = {
          status: "failed",
          callId,
          error: {
            kind: "terminal",
            code: "agent_tool_not_authorized",
            message: authorityBlockReason,
            recoverable: false
          }
        };
        providerResult = { status: "failed", code: "agent_tool_not_authorized" };
        stopRemaining = true;
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
      const executionPolicy = recoverExactAction ? "execute" : resolveAgentToolExecutionPolicy({
        name: entry.parsed.name,
        mode: input.turnInput.agentTurnMode,
        explicitUserCommand:
          entry.parsed.name === "generate_visuals"
            ? input.turnInput.taskMode === "imageGeneration" &&
              input.prepared.executionTaskMode === "imageGeneration"
            : entry.parsed.name !== "submit_memory_update" ||
              input.prepared.authorityProfile.allowMemoryWrite
      });
      if (executionPolicy === "requireConfirmation") {
        const activity = getTurnActivityForTool(input.prepared.taskContract, entry.parsed.name);
        const context = activity ? input.prepared.activityContexts[activity.id]! : input.prepared.context;
        const selectedObjectIds = activity ? [...activity.sourceObjectIds] : input.turnInput.selectedObjectIds;
        const selectedObjects = selectedObjectIds.map((id) => input.host.readWorkspace().objects[id]).filter((object) => Boolean(object));
        const confirmationValue = buildPendingAgentActionConfirmation({
          parsed: entry.parsed,
          workspace: input.host.readWorkspace(),
          compiledVisualPlan:
            entry.parsed.name === "generate_visuals" && visualBatch?.status === "ok"
              ? visualBatch.plan
              : undefined,
          draft: input.turnInput.draft,
          contextObjectIds: context.objectIds,
          sourceSnapshots: context.sourceSnapshots,
          citations: input.prepared.runtimeState.collectedCitations,
          selectedObjects,
          selectedObjectIds,
          userMessageId: input.prepared.userMessageId,
          assistantMessageId: input.prepared.assistantMessageId,
          imageAttachmentObjectIds: input.prepared.imageAttachmentObjectIds,
          documentExtractObjectIds: input.prepared.documentExtractObjectIds,
          documentFragmentExtractObjectIds: context.documentFragmentExtracts.map((item) => item.objectId)
        });
        const confirmationId = `${input.externalRequest.serverTurnId}:${callId}`;
        const requested = input.host.ui.requestPendingConfirmation(confirmationValue);
        if (requested.status !== "accepted") {
          terminal = {
            status: "failed",
            callId,
            error: {
              kind: "terminal",
              code: requested.code,
              message: "当前已有待确认操作，未隐藏或覆盖新的 Agent 确认。",
              recoverable: false
            }
          };
          providerResult = { status: "failed", code: requested.code };
        } else {
          terminal = {
            status: "pendingConfirmation",
            callId,
            confirmationId,
            unresolvedWorkIds: []
          };
          providerResult = { status: "pendingConfirmation", confirmationId };
          pendingConfirmation = { confirmationId, callId, value: confirmationValue };
        }
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
          capturedConfirmation,
          restoredExternalAction: input.restoredPendingExternalAction
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
          const result = recoverExactAction
            ? await recoverLegacyExternalAction(input, input.restoredPendingExternalAction!, callId)
            : await executeAgentTool({ ...executorInput, parsed: entry.parsed });
          providerResult = result;
          const returnedPending = isRecord(result) && result.status === "pendingConfirmation";
          if (returnedPending || capturedConfirmation.value) {
            const confirmationValue = capturedConfirmation.value;
            if (!confirmationValue) {
              throw new Error("Tool 返回 Pending Confirmation，但没有可持久化的确认内容。");
            }
            const confirmationId = `${input.externalRequest.serverTurnId}:${callId}`;
            const requested = input.host.ui.requestPendingConfirmation(confirmationValue);
            if (requested.status !== "accepted") {
              terminal = {
                status: "failed",
                callId,
                error: {
                  kind: "terminal",
                  code: requested.code,
                  message: "当前已有待确认操作，未隐藏或覆盖新的 Agent 确认。",
                  recoverable: false
                }
              };
              providerResult = { status: "failed", code: requested.code };
              stopRemaining = true;
            } else {
              terminal = {
                status: "pendingConfirmation",
                callId,
                confirmationId,
                unresolvedWorkIds: []
              };
              pendingConfirmation = { confirmationId, callId, value: confirmationValue };
              stopRemaining = true;
            }
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
            const code = isRecord(error) && typeof error.code === "string"
              ? error.code.slice(0, 80)
              : "tool_execution_failed";
            terminal = {
              status: "failed",
              callId,
              error: {
                kind: "terminal",
                code,
                message,
                recoverable: false
              }
            };
            providerResult = { status: "failed", code, error: message };
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
    }
    if (entry.status === "valid") {
      const tool = entry.parsed.name;
      if (terminal.status === "failed" && input.prepared.runtimeState.requiredReadState.requiredTools.includes(tool as import("./agentTaskStrategy").RequiredAgentReadToolName)) {
        input.prepared.runtimeState.requiredReadState = failRequiredAgentRead(input.prepared.runtimeState.requiredReadState, tool as import("./agentTaskStrategy").RequiredAgentReadToolName).state;
      }
      const result = isRecord(providerResult) ? providerResult : {};
      const activity = getTurnActivityForTool(input.prepared.taskContract, tool);
      const ids = [result.objectIds, result.directionIds].flatMap((value) => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
      if (typeof result.researchObjectId === "string") ids.push(result.researchObjectId);
      const workspace = input.host.readWorkspace();
      const effect: AgentEffectReceipt = { callId, tool, resultStatus: typeof result.status === "string" ? result.status.slice(0, 80) : undefined, activityId: activity?.id, status: terminal.status, objectIds: [...new Set(ids)].filter((id) => Boolean(workspace.objects[id])),
        revisionIds: ids.flatMap((id) => { const object = workspace.objects[id]; return object?.type === "conceptDirection" ? [object.currentRevisionId] : []; }),
        ...(terminal.status === "executed" ? { persistence: terminal.persistence } : {}),
        ...Object.fromEntries(["proposalId", "draftId", "analysisId", "deliveryObjectId", "sectionId"].flatMap((key) => typeof result[key] === "string" ? [[key, result[key]]] : [])) };
      input.prepared.runtimeState.effectReceipts = [...input.prepared.runtimeState.effectReceipts.filter((receipt) => receipt.callId !== callId), effect];
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
      const serialized: unknown = JSON.parse(continuationItem.output);
      if (isRecord(serialized)) {
        const receipts = [serialized.receipt, ...(Array.isArray(serialized.receipts) ? serialized.receipts : [])].filter(isAgentReadReceipt);
        input.prepared.runtimeState.readReceipts.push(...receipts);
      }
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

async function recoverLegacyExternalAction(
  input: Parameters<typeof executeAgentToolBatchAPlus>[0],
  action: Readonly<APlusExternalActionDescriptor & { callId?: string }>,
  callId: string
): Promise<unknown> {
  const body: unknown = JSON.parse(action.requestBody);
  if (await hashAPlusExternalActionBody(action.requestBody) !== action.requestHash || !isRecord(body) ||
    body.actionId !== action.actionId || body.localProjectId !== input.externalRequest.localProjectId ||
    body.requestId !== input.externalRequest.requestId || body.stepSequence !== input.externalRequest.stepSequence ||
    (action.actionKind === "image" && body.claimCallId !== callId)) {
    throw new AgentToolBatchAPlusError("external_action_request_payload_unavailable", "旧 Recovery 的 exact Action 身份或请求校验失败，不能构造替代请求。");
  }
  if (action.actionKind === "webSearch") {
    const result = await input.requestWebSearch({ identity: input.externalRequest, actionId: action.actionId,
      queries: [], preparedAction: action, signal: input.prepared.controller.signal });
    const citations = webSearchSourcesToCitations(result.sources);
    input.prepared.runtimeState.collectedCitations = mergeAgentSearchCitations(input.prepared.runtimeState.collectedCitations, citations);
    input.prepared.runtimeState.hasWebSearchEvidence = true;
    return { ...result, citations, recovered: true, provenance: { kind: "providerExternalEvidence", grantsAuthority: false } };
  }
  const workspace = input.host.readWorkspace();
  const identity = await buildAPlusImageBatchIdentity(input.externalRequest.serverTurnId, callId);
  const operation = workspace.operations[identity.operationId];
  const plan = operation?.imageGeneration?.plan;
  const childIds = plan ? await Promise.all(plan.items.map((item) => buildAPlusImageChildActionId(callId, item.id))) : [];
  if (!plan || !childIds.includes(action.actionId)) {
    throw new AgentToolBatchAPlusError("external_action_request_payload_unavailable", "旧 Image Recovery 缺少匹配 exact Action 的原始 Operation Plan，不能重新编译。");
  }
  const result = await input.host.executeVisualGenerationPlan({ workspaceSnapshot: workspace,
    draft: operation.userInput, plan, sourceObjectIds: operation.inputSnapshot.selectedObjectIds,
    selectedDirectionIds: [...new Set(plan.items.flatMap((item) => item.targetDirectionId ? [item.targetDirectionId] : []))],
    selectedImageIds: operation.inputSnapshot.selectedObjectIds.filter((id) => workspace.objects[id]?.type === "image"),
    requestedPreviewCount: operation.imageGeneration?.requestedPreviewCount,
    signal: input.prepared.controller.signal, aPlusExternalAction: { ...input.externalRequest, actionId: callId },
    restoredExternalAction: action, recoverExactExternalActionOnly: true });
  return { status: "recovered", objectIds: result.createdObjectIds, failedItems: result.failedItems };
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasMatchingExternalActionCall(
  action: Readonly<APlusExternalActionDescriptor & { callId?: string }>,
  parsedCalls: ReturnType<typeof parseMorphoAgentToolCallBatch>
): boolean {
  return parsedCalls.some((entry) => {
    if (entry.status !== "valid") return false;
    if (action.callId && action.callId !== entry.call.callId) return false;
    if (action.actionKind === "webSearch") {
      return entry.parsed.name === "search_web_evidence" && action.actionId === entry.call.callId;
    }
    if (action.actionKind === "image") {
      return entry.parsed.name === "generate_visuals" && Boolean(action.callId);
    }
    return false;
  });
}

function buildExecutorInput(input: Readonly<{
  input: Parameters<typeof executeAgentToolBatchAPlus>[0];
  parsed: MorphoAgentToolArguments;
  callId: string;
  batchState: AgentToolBatchState;
  capturedConfirmation: { value?: PendingAiConfirmation };
  restoredExternalAction?: Readonly<APlusExternalActionDescriptor & { callId?: string }>;
}>): AgentToolExecutorInput {
  const { prepared, host, turnInput, externalRequest } = input.input;
  const activity = getTurnActivityForTool(prepared.taskContract, input.parsed.name, input.parsed.name === "request_confirmation" ? input.parsed.args.action : undefined);
  const context = activity ? prepared.activityContexts[activity.id]! : prepared.context;
  const selectedObjectIds = activity ? [...activity.sourceObjectIds] : turnInput.selectedObjectIds;
  const selectedObjects = selectedObjectIds.map((id) => host.readWorkspace().objects[id]).filter((object) => Boolean(object));
  return {
    callId: input.callId,
    stableOperationId: `a-plus-effect-${externalRequest.serverTurnId}-${input.callId}`,
    context,
    providerTaskContext: context.kind === "comparison" ? buildProviderComparisonTaskContext(context) : buildProviderTaskContext(context),
    runtimeState: prepared.runtimeState,
    authorityProfile: prepared.authorityProfile,
    batchState: input.batchState,
    commitWorkspace: host.commitWorkspace,
    readWorkspace: host.readWorkspace,
    draft: turnInput.draft,
    modelOutputText: input.input.providerOutputText,
    userMessageId: prepared.userMessageId,
    assistantMessageId: prepared.assistantMessageId,
    userMessageCreatedAt: prepared.createdAt,
    selectedObjectIds,
    selectedObjects,
    allowStructuredComparison: prepared.allowStructuredComparison,
    imageAttachmentObjectIds: prepared.imageAttachmentObjectIds,
    documentExtractObjectIds: prepared.documentExtractObjectIds,
    ...(prepared.deliverySectionContext
      ? { deliverySectionContext: prepared.deliverySectionContext }
      : {}),
    requiredMemoryUpdates: prepared.requiredMemoryUpdates,
    imageGenerationModelId: turnInput.imageGenerationModelId,
    signal: prepared.controller.signal,
    requestWebSearch: (queries) => {
      const restoredAction = input.parsed.name === "search_web_evidence" &&
        input.restoredExternalAction?.actionKind === "webSearch" &&
        input.restoredExternalAction.actionId === input.callId &&
        (!input.restoredExternalAction.callId || input.restoredExternalAction.callId === input.callId)
        ? input.restoredExternalAction
        : undefined;
      return input.input.requestWebSearch({
        identity: externalRequest,
        actionId: input.callId,
        queries,
        signal: prepared.controller.signal,
        ...(restoredAction ? { preparedAction: restoredAction } : {}),
        ...(!restoredAction && input.input.onExternalActionIntent
          ? {
              onBeforeSend: (action: APlusExternalActionDescriptor) =>
                input.input.onExternalActionIntent!({ callId: input.callId, action })
            }
          : {})
      });
    },
    executeVisualGenerationPlan: (visualInput) => host.executeVisualGenerationPlan({
      ...visualInput,
      aPlusExternalAction: {
        ...externalRequest,
        actionId: input.callId
      },
      ...(
        input.parsed.name === "generate_visuals" &&
        input.restoredExternalAction?.actionKind === "image" &&
        input.restoredExternalAction.callId === input.callId
          ? { restoredExternalAction: input.restoredExternalAction }
          : {}
      ),
      ...(
        input.parsed.name === "generate_visuals" &&
        !(input.restoredExternalAction?.actionKind === "image" &&
          input.restoredExternalAction.callId === input.callId) &&
        input.input.onExternalActionIntent
          ? {
              onExternalActionIntent: (actionInput: Readonly<{
                actionId: string;
                action: APlusExternalActionDescriptor;
              }>) => input.input.onExternalActionIntent!({
                callId: input.callId,
                action: actionInput.action
              })
            }
          : {}
      )
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
          contextObjectIds: context.objectIds,
          selectedObjects
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
  return serialized.length <= 120_000
    ? serialized
    : JSON.stringify({ status: "partial", truncated: true, preview: serialized.slice(0, 90_000), receipts: isRecord(value) ? [value.receipt, ...(Array.isArray(value.receipts) ? value.receipts : [])].filter(isAgentReadReceipt).map((receipt) => ({ ...receipt, status: "partial", range: undefined })) : [] });
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
