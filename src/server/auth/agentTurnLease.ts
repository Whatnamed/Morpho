import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { createServerSupabaseClient } from "@/infrastructure/supabase/server";

export type AgentTurnLeaseOutcome =
  | "success"
  | "cancelledBeforeExecution"
  | "failedBeforeExecution"
  | "partialSuccess"
  | "pendingConfirmation";

export type AgentTurnLease = {
  id: string;
  agentTurnId: string;
  expiresAt: string;
  providerCallCount: number;
  webSearchCallCount: number;
  nextProviderSequence: number;
};

export type AgentTurnLeaseResult =
  | { status: "allowed"; lease: AgentTurnLease }
  | {
      status: "denied";
      httpStatus: 401 | 403 | 409 | 429 | 503;
      error: string;
      reason?: string;
    };

type AgentTurnLeaseClient = {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error?: unknown;
    }>;
  };
  rpc(name: string, args: Record<string, unknown>): {
    single(): Promise<{ data: unknown; error: unknown }>;
  };
};

type LeaseRpcRow = {
  allowed: boolean;
  denial_reason: string | null;
  lease_id: string | null;
  expires_at: string | null;
  provider_call_count: number;
  web_search_call_count: number;
  next_provider_sequence: number;
};

export type AgentTurnLeaseStartInput = {
  agentTurnId: string;
  initialRequestHash: string;
  requestManifestHash: string;
  runtimeItemId: string;
};

export type AgentTurnLeaseContinuationInput = {
  leaseId: string;
  agentTurnId: string;
  continuationKind: "providerContinuation" | "conversationSummary" | "webSearch";
  expectedSequence: number;
  requestHash: string;
  requestManifestHash: string;
  runtimeItemId?: string;
};

export function hashAgentTurnLeaseValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function startAgentTurnLease(input: AgentTurnLeaseStartInput): Promise<AgentTurnLeaseResult> {
  const client = await createLeaseClient();
  return client.status === "denied"
    ? client
    : startAgentTurnLeaseForClient(client.client, input);
}

export async function continueAgentTurnLease(
  input: AgentTurnLeaseContinuationInput
): Promise<AgentTurnLeaseResult> {
  const client = await createLeaseClient();
  return client.status === "denied"
    ? client
    : continueAgentTurnLeaseForClient(client.client, input);
}

export async function completeAgentTurnLease(input: {
  leaseId: string;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
}): Promise<
  | { status: "completed"; statusName: string }
  | { status: "denied"; httpStatus: 401 | 403 | 409 | 429 | 503; error: string }
> {
  const client = await createLeaseClient();
  if (client.status === "denied") {
    return client;
  }
  const auth = await requireUser(client.client);
  if (auth) {
    return auth;
  }
  const result = await client.client.rpc("complete_agent_turn_lease", {
    p_lease_id: input.leaseId,
    p_agent_turn_id: input.agentTurnId,
    p_outcome: input.outcome
  }).single();
  if (result.error || !isRecord(result.data) ||
    typeof result.data.completed !== "boolean" || typeof result.data.status_name !== "string") {
    return { status: "denied", httpStatus: 503, error: "Agent 回合状态服务暂时不可用，请稍后重试。" };
  }
  return result.data.completed
    ? { status: "completed", statusName: result.data.status_name }
    : { status: "denied", httpStatus: 403, error: "Agent Turn Lease 无效或不属于当前用户。" };
}

export async function startAgentTurnLeaseForClient(
  client: AgentTurnLeaseClient,
  input: AgentTurnLeaseStartInput
): Promise<AgentTurnLeaseResult> {
  const auth = await requireUser(client);
  if (auth) {
    return auth;
  }
  const result = await client.rpc("start_agent_turn_lease", {
    p_agent_turn_id: input.agentTurnId,
    p_initial_request_hash: input.initialRequestHash,
    p_request_manifest_hash: input.requestManifestHash,
    p_runtime_item_id: input.runtimeItemId
  }).single();
  return normalizeLeaseResult(result, input.agentTurnId, "start");
}

export async function continueAgentTurnLeaseForClient(
  client: AgentTurnLeaseClient,
  input: AgentTurnLeaseContinuationInput
): Promise<AgentTurnLeaseResult> {
  const auth = await requireUser(client);
  if (auth) {
    return auth;
  }
  const result = await client.rpc("continue_agent_turn_lease", {
    p_lease_id: input.leaseId,
    p_agent_turn_id: input.agentTurnId,
    p_continuation_kind: input.continuationKind,
    p_expected_sequence: input.expectedSequence,
    p_request_hash: input.requestHash,
    p_request_manifest_hash: input.requestManifestHash,
    p_runtime_item_id: input.runtimeItemId ?? null
  }).single();
  return normalizeLeaseResult(result, input.agentTurnId, "continue");
}

export function agentTurnLeaseDeniedResponse(
  result: Extract<AgentTurnLeaseResult, { status: "denied" }>
): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.httpStatus });
}

async function createLeaseClient(): Promise<
  | { status: "allowed"; client: AgentTurnLeaseClient }
  | Extract<AgentTurnLeaseResult, { status: "denied" }>
> {
  const created = await createServerSupabaseClient();
  return created.status === "failed"
    ? { status: "denied", httpStatus: 503, error: created.reason }
    : { status: "allowed", client: created.client as unknown as AgentTurnLeaseClient };
}

async function requireUser(
  client: AgentTurnLeaseClient
): Promise<Extract<AgentTurnLeaseResult, { status: "denied" }> | undefined> {
  const user = await client.auth.getUser();
  return user.error || !user.data.user
    ? { status: "denied", httpStatus: 401, error: "请先登录 Morpho。" }
    : undefined;
}

function normalizeLeaseResult(
  result: { data: unknown; error: unknown },
  agentTurnId: string,
  operation: "start" | "continue"
): AgentTurnLeaseResult {
  if (result.error || !isLeaseRpcRow(result.data)) {
    return { status: "denied", httpStatus: 503, error: "Agent Turn Lease 服务暂时不可用，请稍后重试。" };
  }
  if (
    result.data.allowed && result.data.lease_id && result.data.expires_at
  ) {
    return {
      status: "allowed",
      lease: {
        id: result.data.lease_id,
        agentTurnId,
        expiresAt: result.data.expires_at,
        providerCallCount: result.data.provider_call_count,
        webSearchCallCount: result.data.web_search_call_count,
        nextProviderSequence: result.data.next_provider_sequence
      }
    };
  }
  const reason = result.data.denial_reason ?? "unknown";
  if (reason === "quota_exceeded") {
    return { status: "denied", httpStatus: 429, error: "今日文本 AI 额度已用完，请明天再试。", reason };
  }
  if (reason === "provider_limit" || reason === "web_search_limit") {
    return { status: "denied", httpStatus: 429, error: "本轮 Agent 调用次数已达到安全上限。", reason };
  }
  if (reason === "pending" || reason === "blocked") {
    return {
      status: "denied",
      httpStatus: 403,
      error: reason === "blocked"
        ? "当前测试资格不可用。如需继续使用，请联系项目管理员。"
        : "当前账号尚未获得测试资格，请联系项目管理员。",
      reason
    };
  }
  if (
    reason === "turn_exists" ||
    reason === "request_hash_conflict" ||
    reason === "sequence_replay" ||
    reason === "sequence_skip"
  ) {
    return { status: "denied", httpStatus: 409, error: "Agent 回合请求与当前 Lease 顺序冲突。", reason };
  }
  return {
    status: "denied",
    httpStatus: operation === "continue" ? 403 : 409,
    error: reason === "expired"
      ? "Agent Turn Lease 已过期，请重新发起本轮。"
      : reason === "closed"
        ? "Agent Turn Lease 已结束，不能继续调用。"
        : "Agent Turn Lease 无效或不属于当前用户。",
    reason
  };
}

function isLeaseRpcRow(value: unknown): value is LeaseRpcRow {
  return isRecord(value) &&
    typeof value.allowed === "boolean" &&
    (value.denial_reason === null || typeof value.denial_reason === "string") &&
    (value.lease_id === null || typeof value.lease_id === "string") &&
    (value.expires_at === null || typeof value.expires_at === "string") &&
    typeof value.provider_call_count === "number" &&
    typeof value.web_search_call_count === "number" &&
    typeof value.next_provider_sequence === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
