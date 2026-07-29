import {
  applyConversationSummaryRevision,
  buildConversationCompactionPlan,
  getUsableConversationMessages,
  validateConversationSummary,
  type ConversationTokenLimits
} from "@/domain/morpho/conversationCompaction";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { hashSourceMessageIds } from "@/shared/agentProductHash";
import type { AgentTurnCoordinator, AgentTurnCoordinatorActionResult } from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import type { AgentTurnCompactionMode } from "./agentTurnLifecycle";
import {
  createAPlusExternalActionRunningError,
  hashAPlusExternalActionBody,
  isAPlusExternalActionRunningError,
  postAPlusExternalAction,
  type APlusCompactionApplyBoundary,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";

type CompactionSourceMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  body: string;
}>;

type CompactionExecutionBoundary = APlusCompactionApplyBoundary & Readonly<{
  messages: readonly CompactionSourceMessage[];
}>;

type PersistedCompactionRequest = Readonly<{
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  actionId: string;
  mode: AgentTurnCompactionMode;
  expectedPreviousRevisionId?: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  messages: readonly CompactionSourceMessage[];
}>;

export type AgentCompactionAPlusResult = Readonly<
  | { status: "notNeeded"; actionId: string }
  | { status: "applied"; actionId: string; revisionId: string }
  | { status: "cancelled"; actionId: string }
  | { status: "running"; actionId: string; externalAction: APlusExternalActionDescriptor }
  | { status: "failed"; actionId: string; code: string; reason: string }
>;

export async function runAgentCompaction(input: Readonly<{
  mode: AgentTurnCompactionMode;
  actionId: string;
  coordinator: AgentTurnCoordinator;
  host: AgentTurnHost;
  localProjectId: string;
  limits?: ConversationTokenLimits;
  force?: boolean;
  signal: AbortSignal;
  restoredExternalAction?: APlusExternalActionDescriptor;
  onExternalActionIntent?: (action: APlusExternalActionDescriptor) => Promise<boolean> | boolean;
  onSummaryApplied?: (input: Readonly<{
    actionId: string;
    revisionId: string;
  }>) => Promise<boolean> | boolean;
}>): Promise<AgentCompactionAPlusResult> {
  const workspace = input.host.readWorkspace();
  const plan = input.restoredExternalAction
    ? undefined
    : buildConversationCompactionPlan({
        workspace,
        ...(input.limits ? { limits: input.limits } : {}),
        ...(input.force ? { force: "compact" as const } : {})
      });
  let restoredRequest: PersistedCompactionRequest | undefined;
  let restoredRequestInvalid = false;
  if (input.restoredExternalAction) {
    restoredRequest = await parseRestoredCompactionRequest(input);
    restoredRequestInvalid = !restoredRequest;
  }
  const restoredBoundary = restoredRequest && input.restoredExternalAction?.compactionApplyBoundary
    ? mergeRestoredCompactionBoundary(restoredRequest, input.restoredExternalAction.compactionApplyBoundary)
    : undefined;
  if (restoredRequest && !restoredBoundary) restoredRequestInvalid = true;
  const freshBoundary: CompactionExecutionBoundary | undefined = plan
    ? {
        sourceStartMessageId: plan.sourceStartMessageId,
        sourceEndMessageId: plan.sourceEndMessageId,
        sourceMessageIds: plan.sourceMessages.map((message) => message.id),
        sourceMessageIdsHash: plan.sourceMessageIdsHash,
        ...(plan.previousSummaryRevision
          ? { expectedPreviousRevisionId: plan.previousSummaryRevision.id }
          : {}),
        estimatedInputTokens: plan.estimatedInputTokens,
        messages: plan.sourceMessages.map((message) => ({
          id: message.id,
          role: message.role,
          body: message.body
        }))
      }
    : undefined;
  const executionBoundary = input.restoredExternalAction ? restoredBoundary : freshBoundary;
  const expectedPreviousRevisionId = executionBoundary?.expectedPreviousRevisionId ??
    plan?.previousSummaryRevision?.id;
  const currentLifecycle = input.coordinator.getLifecycleSnapshot();
  if (!(currentLifecycle?.phase === "compacting" && currentLifecycle.actionId === input.actionId)) {
    requireOk(input.coordinator.startCompaction(
      input.mode,
      input.actionId,
      expectedPreviousRevisionId
    ));
  } else if (!input.restoredExternalAction) {
    return fail(
      input,
      "external_action_request_payload_unavailable",
      "A+ Compaction 已进入恢复阶段，但原始 External Action 请求 Body 不可用，不能重新构造。"
    );
  }
  if (restoredRequestInvalid) {
    return fail(
      input,
      "external_action_request_payload_unavailable",
      "A+ Compaction 的持久化请求或原始 Summary Apply Boundary 缺失、损坏或身份不匹配。"
    );
  }
  if (!input.restoredExternalAction && !plan) {
    requireOk(input.coordinator.completeCompaction(input.actionId, { kind: "notNeeded" }));
    return { status: "notNeeded", actionId: input.actionId };
  }
  if (!executionBoundary) {
    return fail(
      input,
      "external_action_request_payload_unavailable",
      "A+ Compaction 缺少可验证的原始 Summary Apply Boundary。"
    );
  }

  const server = input.coordinator.getServerSnapshot();
  if (!server) throw new Error("Compaction 缺少 Server Turn Journal Snapshot。");
  const requestId = server.latestRequestId ?? input.actionId;
  const stepSequence = server.latestStepSequence > 0 ? server.latestStepSequence : 1;
  let externalAction: APlusExternalActionDescriptor;
  if (input.restoredExternalAction) {
    externalAction = input.restoredExternalAction;
  } else {
    if (!plan) throw new Error("Compaction fresh request 缺少当前 Plan。");
    const generatedRequestBody = JSON.stringify({
      localProjectId: input.localProjectId,
      requestId,
      stepSequence,
      actionId: input.actionId,
      mode: input.mode,
      ...(expectedPreviousRevisionId ? { expectedPreviousRevisionId } : {}),
      ...(plan.previousSummaryRevision
        ? { previousSummary: plan.previousSummaryRevision.summary }
        : {}),
      sourceStartMessageId: executionBoundary.sourceStartMessageId,
      sourceEndMessageId: executionBoundary.sourceEndMessageId,
      messages: executionBoundary.messages.map((message) => ({
        id: message.id,
        role: message.role,
        body: message.body
      }))
    });
    externalAction = {
      actionId: input.actionId,
      actionKind: "compaction",
      requestBody: generatedRequestBody,
      requestHash: await hashAPlusExternalActionBody(generatedRequestBody),
      compactionApplyBoundary: toPersistedApplyBoundary(executionBoundary)
    };
    if (input.onExternalActionIntent && !await input.onExternalActionIntent(externalAction)) {
      return fail(
        input,
        "external_action_intent_persistence_failed",
        "A+ Compaction External Action 身份未能在发送前写入 Recovery Record。"
      );
    }
  }
  const requestBody = externalAction.requestBody;
  let response: Response;
  try {
    response = await postAPlusExternalAction({
      fetch: input.host.fetch,
      url: `/api/ai/agent/turns/${encodeURIComponent(server.serverTurnId)}/actions/compaction`,
      actionId: input.actionId,
      actionKind: "compaction",
      requestBody,
      signal: input.signal,
      message: "Compaction 请求响应丢失，服务器状态未知；本地只进行同身份查询，不重复压缩。"
    });
  } catch (error) {
    if (input.signal.aborted || isAbortError(error)) {
      requireOk(input.coordinator.cancelCompaction(input.actionId, "用户取消了 Compaction。"));
      return { status: "cancelled", actionId: input.actionId };
    }
    if (isAPlusExternalActionRunningError(error)) {
      return {
        status: "running",
        actionId: input.actionId,
        externalAction: withCompactionApplyBoundary(error.action, executionBoundary)
      };
    }
    return fail(input, "compaction_transport_failed", "Compaction 网络请求失败。");
  }
  const body = await readJson(response);
  if (response.status === 202) {
    const running = await createAPlusExternalActionRunningError({
      actionId: externalAction.actionId,
      actionKind: externalAction.actionKind,
      requestBody: externalAction.requestBody,
      message: isRecord(body) && typeof body.error === "string"
        ? body.error
        : "Compaction 仍在服务器执行；本地只进行同身份查询，不重复执行。"
    });
    return {
      status: "running",
      actionId: input.actionId,
      externalAction: withCompactionApplyBoundary(running.action, executionBoundary)
    };
  }
  if (!response.ok || !isRecord(body) || !("summary" in body)) {
    if (response.status === 499 || input.signal.aborted) {
      requireOk(input.coordinator.cancelCompaction(input.actionId, "用户取消了 Compaction。"));
      return { status: "cancelled", actionId: input.actionId };
    }
    return fail(
      input,
      isRecord(body) && typeof body.code === "string" ? body.code : `http_${response.status}`,
      isRecord(body) && typeof body.error === "string" ? body.error : "Compaction 执行失败。"
    );
  }
  const summary = validateConversationSummary(body.summary);
  if (summary.status !== "ok") {
    return fail(input, "invalid_compaction_summary", summary.reason);
  }

  const boundaryValidation = validateCompactionApplyBoundary(
    input.host.readWorkspace(),
    executionBoundary
  );
  if (boundaryValidation.status === "conflict") {
    return fail(input, boundaryValidation.code, boundaryValidation.reason);
  }

  requireOk(input.coordinator.markLocalPersistenceRequired());
  const applied = input.host.commitWorkspace((current) => {
    const result = applyConversationSummaryRevision(current, {
      summary: summary.summary,
      sourceMessageIds: [...executionBoundary.sourceMessageIds],
      ...(expectedPreviousRevisionId ? { expectedPreviousRevisionId } : {}),
      estimatedInputTokens: executionBoundary.estimatedInputTokens,
      now: new Date(input.host.now()).toISOString()
    });
    return { workspace: result.workspace, value: result };
  });
  if (applied.status !== "applied") {
    return failAfterPersistenceRequired(
      input,
      "summary_revision_conflict",
      applied.reason
    );
  }
  requireOk(input.coordinator.completeCompaction(input.actionId, {
    kind: "applied",
    revisionId: applied.revision.id
  }));
  if (input.onSummaryApplied) {
    let recoveryRecorded = false;
    try {
      recoveryRecorded = await input.onSummaryApplied({
        actionId: input.actionId,
        revisionId: applied.revision.id
      });
    } catch {
      recoveryRecorded = false;
    }
    if (!recoveryRecorded) {
      return failAfterCompactionApplied(
        input,
        "recovery_record_persistence_failed",
        "Summary Revision 已应用，但 A+ Recovery Record 未能持久化。"
      );
    }
  }
  const persistence = input.host.persistWorkspace?.();
  if (persistence?.phase !== "saved" || persistence.isDirty) {
    return failAfterCompactionApplied(
      input,
      "workspace_persistence_failed",
      persistence?.error ?? "Summary Revision 未能持久化。"
    );
  }
  requireOk(input.coordinator.markLocalPersistenceSucceeded());
  return { status: "applied", actionId: input.actionId, revisionId: applied.revision.id };
}

async function parseRestoredCompactionRequest(input: Readonly<{
  actionId: string;
  mode: AgentTurnCompactionMode;
  localProjectId: string;
  restoredExternalAction?: APlusExternalActionDescriptor;
}>): Promise<PersistedCompactionRequest | undefined> {
  const action = input.restoredExternalAction;
  if (!action ||
    action.actionKind !== "compaction" ||
    action.actionId !== input.actionId ||
    await hashAPlusExternalActionBody(action.requestBody) !== action.requestHash
  ) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(action.requestBody);
  } catch {
    return undefined;
  }
  if (!isRecord(value) ||
    value.localProjectId !== input.localProjectId ||
    !isIdentifier(value.requestId) ||
    !Number.isSafeInteger(value.stepSequence) ||
    (value.stepSequence as number) < 1 ||
    value.actionId !== input.actionId ||
    value.mode !== input.mode ||
    (value.expectedPreviousRevisionId !== undefined && !isIdentifier(value.expectedPreviousRevisionId)) ||
    !isIdentifier(value.sourceStartMessageId) ||
    !isIdentifier(value.sourceEndMessageId) ||
    !Array.isArray(value.messages) ||
    value.messages.length < 2 ||
    value.messages.length > 128
  ) return undefined;
  const messages = value.messages.map(parseCompactionSourceMessage);
  if (messages.some((message) => !message)) return undefined;
  const sourceMessages = messages as CompactionSourceMessage[];
  const sourceMessageIds = sourceMessages.map((message) => message.id);
  if (new Set(sourceMessageIds).size !== sourceMessageIds.length ||
    sourceMessageIds[0] !== value.sourceStartMessageId ||
    sourceMessageIds.at(-1) !== value.sourceEndMessageId ||
    sourceMessages.at(-1)?.role !== "assistant"
  ) return undefined;
  return {
    localProjectId: input.localProjectId,
    requestId: value.requestId,
    stepSequence: value.stepSequence as number,
    actionId: input.actionId,
    mode: input.mode,
    ...(typeof value.expectedPreviousRevisionId === "string"
      ? { expectedPreviousRevisionId: value.expectedPreviousRevisionId }
      : {}),
    sourceStartMessageId: value.sourceStartMessageId,
    sourceEndMessageId: value.sourceEndMessageId,
    messages: sourceMessages
  };
}

function parseCompactionSourceMessage(value: unknown): CompactionSourceMessage | undefined {
  if (!isRecord(value) ||
    !isIdentifier(value.id) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.body !== "string" ||
    value.body.length < 1 ||
    value.body.length > 24_000
  ) return undefined;
  return { id: value.id, role: value.role, body: value.body };
}

function mergeRestoredCompactionBoundary(
  request: PersistedCompactionRequest,
  boundary: APlusCompactionApplyBoundary
): CompactionExecutionBoundary | undefined {
  const sourceMessageIds = request.messages.map((message) => message.id);
  if (
    boundary.sourceStartMessageId !== request.sourceStartMessageId ||
    boundary.sourceEndMessageId !== request.sourceEndMessageId ||
    boundary.sourceMessageIds.length !== sourceMessageIds.length ||
    boundary.sourceMessageIds.some((id, index) => id !== sourceMessageIds[index]) ||
    boundary.sourceMessageIdsHash !== hashSourceMessageIds(sourceMessageIds) ||
    (boundary.expectedPreviousRevisionId ?? undefined) !==
      (request.expectedPreviousRevisionId ?? undefined) ||
    !Number.isSafeInteger(boundary.estimatedInputTokens) ||
    boundary.estimatedInputTokens < 0
  ) return undefined;
  return {
    ...toPersistedApplyBoundary(boundary),
    messages: request.messages
  };
}

function toPersistedApplyBoundary(
  boundary: APlusCompactionApplyBoundary
): APlusCompactionApplyBoundary {
  return {
    sourceStartMessageId: boundary.sourceStartMessageId,
    sourceEndMessageId: boundary.sourceEndMessageId,
    sourceMessageIds: [...boundary.sourceMessageIds],
    sourceMessageIdsHash: boundary.sourceMessageIdsHash,
    ...(boundary.expectedPreviousRevisionId
      ? { expectedPreviousRevisionId: boundary.expectedPreviousRevisionId }
      : {}),
    estimatedInputTokens: boundary.estimatedInputTokens
  };
}

function withCompactionApplyBoundary(
  action: APlusExternalActionDescriptor,
  boundary: APlusCompactionApplyBoundary
): APlusExternalActionDescriptor {
  return {
    ...action,
    compactionApplyBoundary: toPersistedApplyBoundary(boundary)
  };
}

function validateCompactionApplyBoundary(
  workspace: MorphoWorkspace,
  boundary: CompactionExecutionBoundary
): Readonly<
  | { status: "ok" }
  | { status: "conflict"; code: "compaction_source_changed" | "summary_revision_conflict"; reason: string }
> {
  const currentRevisionId = workspace.ai.conversationCompaction.summaryRevisionId;
  if ((currentRevisionId ?? undefined) !== (boundary.expectedPreviousRevisionId ?? undefined)) {
    return {
      status: "conflict",
      code: "summary_revision_conflict",
      reason: "Compaction 的 Summary base revision 已在 External Action 执行期间变化。"
    };
  }
  const usableMessages = getUsableConversationMessages(workspace.ai.messages);
  const previousRevision = currentRevisionId
    ? workspace.ai.conversationSummaryRevisions[currentRevisionId]
    : undefined;
  if (currentRevisionId && !previousRevision) {
    return {
      status: "conflict",
      code: "summary_revision_conflict",
      reason: "Compaction 的 Summary base revision 不再存在。"
    };
  }
  const previousEndIndex = previousRevision
    ? usableMessages.findIndex((message) => message.id === previousRevision.sourceEndMessageId)
    : -1;
  if (previousRevision && previousEndIndex < 0) {
    return {
      status: "conflict",
      code: "compaction_source_changed",
      reason: "Compaction 原始消息范围的前置 Summary 边界不再存在。"
    };
  }
  const sourceRange = usableMessages.slice(
    previousEndIndex + 1,
    previousEndIndex + 1 + boundary.messages.length
  );
  if (sourceRange.length !== boundary.messages.length ||
    sourceRange.some((message, index) => {
      const original = boundary.messages[index];
      return !original ||
        message.id !== original.id ||
        message.role !== original.role ||
        message.body !== original.body;
    })
  ) {
    return {
      status: "conflict",
      code: "compaction_source_changed",
      reason: "Compaction 原始消息正文、顺序或成员已变化，旧 Summary 不会应用。"
    };
  }
  return { status: "ok" };
}

function failAfterCompactionApplied(
  input: Readonly<{
    actionId: string;
    coordinator: AgentTurnCoordinator;
  }>,
  code: string,
  reason: string
): AgentCompactionAPlusResult {
  const error = {
    kind: "terminal" as const,
    code: boundedCode(code),
    message: reason.slice(0, 800),
    recoverable: false as const
  };
  const faultId = `${input.actionId}:${error.code}`;
  requireOk(input.coordinator.markLocalPersistenceFailed(faultId, error));
  requireOk(input.coordinator.finalizeTurn());
  return { status: "failed", actionId: input.actionId, code: error.code, reason: error.message };
}

function failAfterPersistenceRequired(
  input: Readonly<{
    actionId: string;
    coordinator: AgentTurnCoordinator;
  }>,
  code: string,
  reason: string
): AgentCompactionAPlusResult {
  const error = {
    kind: "terminal" as const,
    code: boundedCode(code),
    message: reason.slice(0, 800),
    recoverable: false as const
  };
  const faultId = `${input.actionId}:${error.code}`;
  requireOk(input.coordinator.markLocalPersistenceFailed(faultId, error));
  requireOk(input.coordinator.failCompaction(input.actionId, faultId, error));
  return { status: "failed", actionId: input.actionId, code: error.code, reason: error.message };
}

function fail(
  input: Readonly<{
    actionId: string;
    coordinator: AgentTurnCoordinator;
  }>,
  code: string,
  reason: string
): AgentCompactionAPlusResult {
  const error = {
    kind: "terminal" as const,
    code: boundedCode(code),
    message: reason.slice(0, 800),
    recoverable: false as const
  };
  requireOk(input.coordinator.failCompaction(input.actionId, `${input.actionId}:${error.code}`, error));
  return { status: "failed", actionId: input.actionId, code: error.code, reason: error.message };
}

function requireOk(result: AgentTurnCoordinatorActionResult): void {
  if (result.status === "denied") throw new Error(`${result.code}: ${result.error}`);
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

function boundedCode(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 80);
  return normalized || "compaction_failed";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
