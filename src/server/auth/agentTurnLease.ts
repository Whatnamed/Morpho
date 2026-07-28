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

export type AgentTurnLeaseState = {
  expiresAt: string;
  providerCallCount: number;
  webSearchCallCount: number;
  nextProviderSequence: number;
};

export type AgentTurnLeaseContinuationKind =
  | "providerContinuation"
  | "conversationSummary"
  | "webSearch"
  | "postCompaction";

export type AgentTurnLeaseResult =
  | { status: "allowed"; lease: AgentTurnLease }
  | {
      status: "denied";
      httpStatus: 401 | 403 | 409 | 429 | 503;
      error: string;
      reason?: string;
      /**
       * The lease sequence the server expects next. A caller that lost a response
       * mid-flight needs this to resynchronize instead of retrying forever.
       */
      nextProviderSequence?: number;
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

type LeaseStateRpcRow = {
  active: boolean;
  expires_at: string | null;
  provider_call_count: number;
  web_search_call_count: number;
  next_provider_sequence: number;
};

type LeaseClosureRpcRow = {
  completed: boolean;
  status_name: string;
  replayed: boolean;
  denial_reason: string | null;
};

type LeaseClosureStateRpcRow = {
  state_name: "none" | "match" | "conflict" | "invalid_lease";
  status_name: string | null;
  closure_outcome: string | null;
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
  continuationKind: AgentTurnLeaseContinuationKind;
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

export async function readAgentTurnLeaseState(input: {
  leaseId: string;
  agentTurnId: string;
}): Promise<
  | { status: "allowed"; state: AgentTurnLeaseState }
  | Extract<AgentTurnLeaseResult, { status: "denied" }>
> {
  const client = await createLeaseClient();
  return client.status === "denied"
    ? client
    : readAgentTurnLeaseStateForClient(client.client, input);
}

export async function completeAgentTurnLease(input: {
  leaseId: string;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  closureRequestId: string;
  closureRequestHash: string;
}): Promise<
  | { status: "completed"; statusName: string; replayed: boolean }
  | { status: "denied"; httpStatus: 401 | 403 | 409 | 429 | 503; error: string; reason?: string }
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
    p_outcome: input.outcome,
    p_closure_request_id: input.closureRequestId,
    p_closure_request_hash: input.closureRequestHash
  }).single();
  if (isMissingRpcError(result.error)) {
    return {
      status: "denied",
      httpStatus: 503,
      error: "数据库尚未升级到当前 Agent Closure 契约。",
      reason: "closure_contract_missing"
    };
  }
  if (result.error || !isLeaseClosureRpcRow(result.data)) {
    return { status: "denied", httpStatus: 503, error: "Agent 回合状态服务暂时不可用，请稍后重试。" };
  }
  if (result.data.completed) {
    return {
      status: "completed",
      statusName: result.data.status_name,
      replayed: result.data.replayed
    };
  }
  const reason = result.data.denial_reason ?? "invalid_lease";
  return {
    status: "denied",
    httpStatus: reason === "closure_conflict" ? 409 : 403,
    error: reason === "closure_conflict"
      ? "Agent Turn Closure 请求与已保存终态冲突。"
      : reason === "execution_already_started"
        ? "Agent Turn 已开始执行，不能声明为执行前终止。"
        : "Agent Turn Lease 无效或不能关闭。",
    reason
  };
}

export async function readAgentTurnClosureState(input: {
  leaseId: string;
  agentTurnId: string;
  closureRequestId: string;
  closureRequestHash: string;
}): Promise<
  | { status: "read"; stateName: LeaseClosureStateRpcRow["state_name"]; statusName?: string; outcome?: string }
  | { status: "denied"; httpStatus: 401 | 403 | 409 | 429 | 503; error: string; reason?: string }
> {
  const client = await createLeaseClient();
  if (client.status === "denied") {
    return client;
  }
  const auth = await requireUser(client.client);
  if (auth) {
    return auth;
  }
  const result = await client.client.rpc("read_agent_turn_closure_state", {
    p_lease_id: input.leaseId,
    p_agent_turn_id: input.agentTurnId,
    p_closure_request_id: input.closureRequestId,
    p_closure_request_hash: input.closureRequestHash
  }).single();
  if (isMissingRpcError(result.error)) {
    return {
      status: "denied",
      httpStatus: 503,
      error: "数据库尚未升级到当前 Agent Closure 恢复契约。",
      reason: "closure_state_contract_missing"
    };
  }
  if (result.error || !isLeaseClosureStateRpcRow(result.data)) {
    return { status: "denied", httpStatus: 503, error: "Agent Closure 状态服务暂时不可用，请稍后重试。" };
  }
  return {
    status: "read",
    stateName: result.data.state_name,
    ...(result.data.status_name ? { statusName: result.data.status_name } : {}),
    ...(result.data.closure_outcome ? { outcome: result.data.closure_outcome } : {})
  };
}

export async function markAgentTurnToolExecutionStarted(input: {
  leaseId: string;
  agentTurnId: string;
}): Promise<{ status: "marked" } | { status: "denied"; httpStatus: 401 | 403 | 409 | 429 | 503; error: string }> {
  const client = await createLeaseClient();
  if (client.status === "denied") {
    return client;
  }
  const auth = await requireUser(client.client);
  if (auth) {
    return auth;
  }
  const result = await client.client.rpc("mark_agent_turn_tool_execution_started", {
    p_lease_id: input.leaseId,
    p_agent_turn_id: input.agentTurnId
  }).single();
  if (result.error || !isRecord(result.data) || result.data.marked !== true) {
    return { status: "denied", httpStatus: 403, error: "Agent Tool 执行状态无法建立，已停止执行。" };
  }
  return { status: "marked" };
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

export async function readAgentTurnLeaseStateForClient(
  client: AgentTurnLeaseClient,
  input: { leaseId: string; agentTurnId: string }
): Promise<
  | { status: "allowed"; state: AgentTurnLeaseState }
  | Extract<AgentTurnLeaseResult, { status: "denied" }>
> {
  const auth = await requireUser(client);
  if (auth) {
    return auth;
  }
  const result = await client.rpc("read_agent_turn_lease_state", {
    p_lease_id: input.leaseId,
    p_agent_turn_id: input.agentTurnId
  }).single();
  if (isMissingRpcError(result.error)) {
    return {
      status: "denied",
      httpStatus: 503,
      error: "数据库尚未升级到当前 Agent Lease 状态读取契约。",
      reason: "lease_state_contract_missing"
    };
  }
  if (result.error || !isLeaseStateRpcRow(result.data)) {
    return { status: "denied", httpStatus: 503, error: "Agent Turn Lease 状态服务暂时不可用，请稍后重试。" };
  }
  if (!result.data.active || !result.data.expires_at) {
    return {
      status: "denied",
      httpStatus: 403,
      error: "Agent Turn Lease 无效、已结束或已过期。",
      reason: "inactive"
    };
  }
  return {
    status: "allowed",
    state: {
      expiresAt: result.data.expires_at,
      providerCallCount: result.data.provider_call_count,
      webSearchCallCount: result.data.web_search_call_count,
      nextProviderSequence: result.data.next_provider_sequence
    }
  };
}

export function agentTurnLeaseDeniedResponse(
  result: Extract<AgentTurnLeaseResult, { status: "denied" }>
): NextResponse {
  return NextResponse.json(
    {
      error: result.error,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.nextProviderSequence !== undefined
        ? { nextProviderSequence: result.nextProviderSequence }
        : {})
    },
    { status: result.httpStatus }
  );
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
  if (isMissingRpcError(result.error)) {
    return {
      status: "denied",
      httpStatus: 503,
      error: "数据库尚未升级到当前 Agent Lease 契约，请先应用最新的 Supabase migration。",
      reason: "lease_contract_missing"
    };
  }
  if (result.error || !isLeaseRpcRow(result.data)) {
    return { status: "denied", httpStatus: 503, error: "Agent Turn Lease 服务暂时不可用，请稍后重试。" };
  }
  const nextProviderSequence = result.data.next_provider_sequence > 0
    ? { nextProviderSequence: result.data.next_provider_sequence }
    : {};
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
    return {
      status: "denied",
      httpStatus: 429,
      error: "今日文本 AI 额度已用完，请明天再试。",
      reason,
      ...nextProviderSequence
    };
  }
  if (reason === "provider_limit" || reason === "web_search_limit") {
    return {
      status: "denied",
      httpStatus: 429,
      error: "本轮 Agent 调用次数已达到安全上限。",
      reason,
      ...nextProviderSequence
    };
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
    return {
      status: "denied",
      httpStatus: 409,
      error: "Agent 回合请求与当前 Lease 顺序冲突。",
      reason,
      ...nextProviderSequence
    };
  }
  return {
    status: "denied",
    httpStatus: operation === "continue" ? 403 : 409,
    error: reason === "expired"
      ? "Agent Turn Lease 已过期，请重新发起本轮。"
      : reason === "closed"
        ? "Agent Turn Lease 已结束，不能继续调用。"
        : "Agent Turn Lease 无效或不属于当前用户。",
    reason,
    ...nextProviderSequence
  };
}

/**
 * PostgREST reports a missing or signature-changed RPC as PGRST202. That is a
 * deployment gap, not a transient outage, so it must not be reported as a
 * generic "service unavailable".
 */
function isMissingRpcError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return error.code === "PGRST202" ||
    (typeof error.message === "string" && /Could not find the function/i.test(error.message));
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

function isLeaseStateRpcRow(value: unknown): value is LeaseStateRpcRow {
  return isRecord(value) &&
    typeof value.active === "boolean" &&
    (value.expires_at === null || typeof value.expires_at === "string") &&
    typeof value.provider_call_count === "number" &&
    typeof value.web_search_call_count === "number" &&
    typeof value.next_provider_sequence === "number";
}

function isLeaseClosureRpcRow(value: unknown): value is LeaseClosureRpcRow {
  return isRecord(value) &&
    typeof value.completed === "boolean" &&
    typeof value.status_name === "string" &&
    typeof value.replayed === "boolean" &&
    (value.denial_reason === null || typeof value.denial_reason === "string");
}

function isLeaseClosureStateRpcRow(value: unknown): value is LeaseClosureStateRpcRow {
  return isRecord(value) &&
    (value.state_name === "none" || value.state_name === "match" ||
      value.state_name === "conflict" || value.state_name === "invalid_lease") &&
    (value.status_name === null || typeof value.status_name === "string") &&
    (value.closure_outcome === null || typeof value.closure_outcome === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
