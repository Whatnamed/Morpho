import {
  applyConversationSummaryRevision,
  buildConversationCompactionPlan,
  validateConversationSummary,
  type ConversationTokenLimits
} from "@/domain/morpho/conversationCompaction";
import type { ConversationSummary } from "@/domain/morpho/types";
import type { AgentTurnCoordinator, AgentTurnCoordinatorActionResult } from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import type { AgentTurnCompactionMode } from "./agentTurnLifecycle";
import {
  createAPlusExternalActionRunningError,
  hashAPlusExternalActionBody,
  isAPlusExternalActionRunningError,
  postAPlusExternalAction,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";

export type AgentCompactionAPlusResult = Readonly<
  | { status: "notNeeded"; actionId: string }
  | { status: "applied"; actionId: string; revisionId: string }
  | { status: "cancelled"; actionId: string }
  | { status: "running"; actionId: string; externalAction: APlusExternalActionDescriptor }
  | { status: "failed"; actionId: string; reason: string }
>;

export async function runAgentCompactionAPlus(input: Readonly<{
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
  const plan = buildConversationCompactionPlan({
    workspace,
    ...(input.limits ? { limits: input.limits } : {}),
    ...(input.force ? { force: "compact" as const } : {})
  });
  const expectedPreviousRevisionId = plan?.previousSummaryRevision?.id;
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
  if (!plan) {
    requireOk(input.coordinator.completeCompaction(input.actionId, { kind: "notNeeded" }));
    return { status: "notNeeded", actionId: input.actionId };
  }

  const server = input.coordinator.getServerSnapshot();
  if (!server) throw new Error("Compaction 缺少 Server Turn Journal Snapshot。");
  const requestId = server.latestRequestId ?? input.actionId;
  const stepSequence = server.latestStepSequence > 0 ? server.latestStepSequence : 1;
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
    sourceStartMessageId: plan.sourceStartMessageId,
    sourceEndMessageId: plan.sourceEndMessageId,
    messages: plan.sourceMessages.map((message) => ({
      id: message.id,
      role: message.role,
      body: message.body
    }))
  });
  let externalAction: APlusExternalActionDescriptor;
  if (input.restoredExternalAction) {
    if (
      input.restoredExternalAction.actionKind !== "compaction" ||
      input.restoredExternalAction.actionId !== input.actionId ||
      await hashAPlusExternalActionBody(input.restoredExternalAction.requestBody) !==
        input.restoredExternalAction.requestHash
    ) {
      return fail(
        input,
        "external_action_request_payload_unavailable",
        "A+ Compaction 的持久化请求 Body 缺失、损坏或 Action 身份不匹配。"
      );
    }
    externalAction = input.restoredExternalAction;
  } else {
    externalAction = {
      actionId: input.actionId,
      actionKind: "compaction",
      requestBody: generatedRequestBody,
      requestHash: await hashAPlusExternalActionBody(generatedRequestBody)
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
      return { status: "running", actionId: input.actionId, externalAction: error.action };
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
    return { status: "running", actionId: input.actionId, externalAction: running.action };
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

  requireOk(input.coordinator.markLocalPersistenceRequired());
  const applied = input.host.commitWorkspace((current) => {
    const result = applyConversationSummaryRevision(current, {
      summary: summary.summary,
      sourceMessageIds: plan.sourceMessages.map((message) => message.id),
      ...(expectedPreviousRevisionId ? { expectedPreviousRevisionId } : {}),
      estimatedInputTokens: plan.estimatedInputTokens,
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
  return { status: "failed", actionId: input.actionId, reason: error.message };
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
  return { status: "failed", actionId: input.actionId, reason: error.message };
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
  return { status: "failed", actionId: input.actionId, reason: error.message };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
