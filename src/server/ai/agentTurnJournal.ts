import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import {
  isServerExternalExecutionStatus,
  type AgentTurnJournalSnapshot,
  type ServerExternalExecutionStatus
} from "@/shared/agentTurnJournalProtocol";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type AgentTurnJournalClient = {
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

export type AgentTurnJournalDenial = Readonly<{
  status: "denied";
  httpStatus: 401 | 404 | 409 | 429 | 503;
  code: string;
  error: string;
  recoverable: false;
}>;

export type CreateAgentTurnJournalResult =
  | Readonly<{
      status: "ok";
      replayed: boolean;
      snapshot: AgentTurnJournalSnapshot;
    }>
  | AgentTurnJournalDenial;

export type ReadAgentTurnJournalResult =
  | Readonly<{ status: "ok"; snapshot: AgentTurnJournalSnapshot }>
  | AgentTurnJournalDenial;

export type AcquireAgentTurnRequestResult =
  | Readonly<{
      status: "ok";
      executionGranted: boolean;
      replayed: boolean;
      snapshot: AgentTurnJournalSnapshot;
    }>
  | AgentTurnJournalDenial;

export type SettleAgentTurnRequestResult =
  | Readonly<{
      status: "ok";
      replayed: boolean;
      snapshot: AgentTurnJournalSnapshot;
    }>
  | AgentTurnJournalDenial;

type JournalSnapshotRow = {
  server_turn_id: string;
  local_project_id: string;
  status_name: string;
  latest_request_id: string | null;
  latest_step_sequence: number;
  provider_call_count: number;
  web_search_call_count: number;
  image_call_count: number;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
  failure_code: string | null;
};

type CreateJournalRow = JournalSnapshotRow & {
  decision: "created" | "replayed" | "denied";
  denial_reason: string | null;
};

type ReadJournalRow = Partial<JournalSnapshotRow> & {
  visible: boolean;
};

type RequestJournalRow = JournalSnapshotRow & {
  decision: "acquired" | "replayed" | "updated" | "denied";
  denial_reason: string | null;
};

export async function createAgentTurnJournal(input: {
  localProjectId: string;
  creationIdempotencyKey: string;
}): Promise<CreateAgentTurnJournalResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : createAgentTurnJournalForClient(client.client, input);
}

export async function readAgentTurnJournal(input: {
  serverTurnId: string;
  localProjectId: string;
}): Promise<ReadAgentTurnJournalResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : readAgentTurnJournalForClient(client.client, input);
}

export async function acquireAgentTurnRequest(input: {
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  requestHash: string;
}): Promise<AcquireAgentTurnRequestResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : acquireAgentTurnRequestForClient(client.client, input);
}

export async function settleAgentTurnRequest(input: {
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  status: Exclude<ServerExternalExecutionStatus, "created" | "providerRunning">;
  failureCode?: string;
}): Promise<SettleAgentTurnRequestResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : settleAgentTurnRequestForClient(client.client, input);
}

export async function createAgentTurnJournalForClient(
  client: AgentTurnJournalClient,
  input: { localProjectId: string; creationIdempotencyKey: string }
): Promise<CreateAgentTurnJournalResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (!isIdentifier(input.localProjectId) || !isIdentifier(input.creationIdempotencyKey)) {
    return conflict("invalid_identifier", "Server Turn 创建标识无效。");
  }
  const result = await client.rpc("create_agent_turn_journal", {
    p_local_project_id: input.localProjectId,
    p_creation_idempotency_key: input.creationIdempotencyKey
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("journal_contract_missing", "数据库尚未升级到 A+ Server Turn Journal 契约。");
  }
  if (result.error || !isCreateJournalRow(result.data)) {
    return unavailable("journal_unavailable", "Server Turn Journal 暂时不可用，请稍后重试。");
  }
  if (result.data.decision === "denied") {
    return denialFromReason(result.data.denial_reason);
  }
  return {
    status: "ok",
    replayed: result.data.decision === "replayed",
    snapshot: snapshotFromRow(result.data)
  };
}

export async function readAgentTurnJournalForClient(
  client: AgentTurnJournalClient,
  input: { serverTurnId: string; localProjectId: string }
): Promise<ReadAgentTurnJournalResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (!isUuid(input.serverTurnId) || !isIdentifier(input.localProjectId)) {
    return notFound();
  }
  const result = await client.rpc("read_agent_turn_journal", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("journal_contract_missing", "数据库尚未升级到 A+ Server Turn Journal 契约。");
  }
  if (result.error || !isReadJournalRow(result.data)) {
    return unavailable("journal_unavailable", "Server Turn Journal 暂时不可用，请稍后重试。");
  }
  if (!result.data.visible || !isJournalSnapshotRow(result.data)) {
    return notFound();
  }
  return { status: "ok", snapshot: snapshotFromRow(result.data) };
}

export async function acquireAgentTurnRequestForClient(
  client: AgentTurnJournalClient,
  input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    requestHash: string;
  }
): Promise<AcquireAgentTurnRequestResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (
    !isUuid(input.serverTurnId) ||
    !isIdentifier(input.localProjectId) ||
    !isIdentifier(input.requestId) ||
    !Number.isSafeInteger(input.stepSequence) ||
    input.stepSequence < 1 ||
    input.stepSequence > 10_000 ||
    !SHA256_PATTERN.test(input.requestHash)
  ) {
    return conflict("invalid_request_identity", "A+ Provider Request 标识无效。");
  }
  const result = await client.rpc("acquire_agent_turn_request", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId,
    p_request_id: input.requestId,
    p_step_sequence: input.stepSequence,
    p_request_hash: input.requestHash
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("journal_contract_missing", "数据库尚未升级到 A+ Request Journal 契约。");
  }
  if (result.error || !isRequestJournalRow(result.data)) {
    return unavailable("journal_unavailable", "A+ Request Journal 暂时不可用，请稍后重试。");
  }
  if (result.data.decision === "denied") {
    return denialFromReason(result.data.denial_reason);
  }
  return {
    status: "ok",
    executionGranted: result.data.decision === "acquired",
    replayed: result.data.decision === "replayed",
    snapshot: snapshotFromRow(result.data)
  };
}

export async function settleAgentTurnRequestForClient(
  client: AgentTurnJournalClient,
  input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    status: Exclude<ServerExternalExecutionStatus, "created" | "providerRunning">;
    failureCode?: string;
  }
): Promise<SettleAgentTurnRequestResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (
    !isUuid(input.serverTurnId) ||
    !isIdentifier(input.localProjectId) ||
    !isIdentifier(input.requestId) ||
    !Number.isSafeInteger(input.stepSequence) ||
    input.stepSequence < 1 ||
    !isSettleStatus(input.status) ||
    (input.failureCode !== undefined && !isBoundedFailureCode(input.failureCode))
  ) {
    return conflict("invalid_settlement", "A+ Provider Request 终态参数无效。");
  }
  const result = await client.rpc("settle_agent_turn_request", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId,
    p_request_id: input.requestId,
    p_step_sequence: input.stepSequence,
    p_status: toDatabaseStatus(input.status),
    p_failure_code: input.failureCode ?? null
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("journal_contract_missing", "数据库尚未升级到 A+ Request Journal 契约。");
  }
  if (result.error || !isRequestJournalRow(result.data)) {
    return unavailable("journal_unavailable", "A+ Request Journal 暂时不可用，请稍后重试。");
  }
  if (result.data.decision === "denied") {
    return denialFromReason(result.data.denial_reason);
  }
  return {
    status: "ok",
    replayed: result.data.decision === "replayed",
    snapshot: snapshotFromRow(result.data)
  };
}

function snapshotFromRow(row: JournalSnapshotRow): AgentTurnJournalSnapshot {
  const status = fromDatabaseStatus(row.status_name);
  if (!status) {
    throw new Error(`Unexpected Journal status: ${row.status_name}`);
  }
  return {
    serverTurnId: row.server_turn_id,
    localProjectId: row.local_project_id,
    status,
    latestRequestId: row.latest_request_id,
    latestStepSequence: row.latest_step_sequence,
    counters: {
      provider: row.provider_call_count,
      webSearch: row.web_search_call_count,
      image: row.image_call_count
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at,
    ...(row.failure_code ? { failureCode: row.failure_code } : {})
  };
}

export function toDatabaseStatus(status: ServerExternalExecutionStatus): string {
  const values: Record<ServerExternalExecutionStatus, string> = {
    created: "created",
    providerRunning: "provider_running",
    awaitingNextRequest: "awaiting_next_request",
    externallyCompleted: "externally_completed",
    externallyCancelled: "externally_cancelled",
    externallyFailed: "externally_failed"
  };
  return values[status];
}

export function fromDatabaseStatus(value: string): ServerExternalExecutionStatus | undefined {
  const values: Record<string, ServerExternalExecutionStatus> = {
    created: "created",
    provider_running: "providerRunning",
    awaiting_next_request: "awaitingNextRequest",
    externally_completed: "externallyCompleted",
    externally_cancelled: "externallyCancelled",
    externally_failed: "externallyFailed"
  };
  const status = values[value];
  return status && isServerExternalExecutionStatus(status) ? status : undefined;
}

async function createJournalClient(): Promise<
  | { status: "ok"; client: AgentTurnJournalClient }
  | AgentTurnJournalDenial
> {
  const created = await createServerSupabaseClient();
  return created.status === "failed"
    ? unavailable("supabase_unavailable", created.reason)
    : { status: "ok", client: created.client as unknown as AgentTurnJournalClient };
}

async function requireUser(client: AgentTurnJournalClient): Promise<AgentTurnJournalDenial | undefined> {
  const user = await client.auth.getUser();
  return user.error || !user.data.user
    ? {
        status: "denied",
        httpStatus: 401,
        code: "unauthenticated",
        error: "请先登录 Morpho。",
        recoverable: false
      }
    : undefined;
}

function denialFromReason(reason: string | null): AgentTurnJournalDenial {
  switch (reason) {
    case "invalid_turn":
    case "not_found":
      return notFound();
    case "quota_exceeded":
      return {
        status: "denied",
        httpStatus: 429,
        code: reason,
        error: "今日文本 AI 额度已用完，请明天再试。",
        recoverable: false
      };
    case "provider_limit":
      return {
        status: "denied",
        httpStatus: 429,
        code: reason,
        error: "本轮 Agent Provider 调用次数已达到安全上限。",
        recoverable: false
      };
    case "pending":
    case "blocked":
      return notFound();
    case "creation_key_conflict":
    case "request_id_conflict":
    case "sequence_conflict":
    case "sequence_replay":
    case "sequence_skip":
    case "terminal_turn":
    case "status_conflict":
    case "request_not_latest":
      return conflict(reason, "A+ Server Turn Journal 请求发生确定性冲突。");
    default:
      return unavailable("journal_unavailable", "Server Turn Journal 暂时不可用，请稍后重试。");
  }
}

function notFound(): AgentTurnJournalDenial {
  return {
    status: "denied",
    httpStatus: 404,
    code: "not_found",
    error: "Server Turn 不存在或不可见。",
    recoverable: false
  };
}

function conflict(code: string, error: string): AgentTurnJournalDenial {
  return { status: "denied", httpStatus: 409, code, error, recoverable: false };
}

function unavailable(code: string, error: string): AgentTurnJournalDenial {
  return { status: "denied", httpStatus: 503, code, error, recoverable: false };
}

function isCreateJournalRow(value: unknown): value is CreateJournalRow {
  if (!isJournalSnapshotRow(value)) return false;
  const candidate = value as JournalSnapshotRow & Record<string, unknown>;
  return (candidate.decision === "created" || candidate.decision === "replayed" || candidate.decision === "denied") &&
    (candidate.denial_reason === null || typeof candidate.denial_reason === "string");
}

function isReadJournalRow(value: unknown): value is ReadJournalRow {
  return isRecord(value) && typeof value.visible === "boolean";
}

function isRequestJournalRow(value: unknown): value is RequestJournalRow {
  if (!isJournalSnapshotRow(value)) return false;
  const candidate = value as JournalSnapshotRow & Record<string, unknown>;
  return (
    (
      candidate.decision === "acquired" ||
      candidate.decision === "replayed" ||
      candidate.decision === "updated" ||
      candidate.decision === "denied"
    ) &&
    (candidate.denial_reason === null || typeof candidate.denial_reason === "string")
  );
}

function isJournalSnapshotRow(value: unknown): value is JournalSnapshotRow {
  return isRecord(value) &&
    typeof value.server_turn_id === "string" &&
    typeof value.local_project_id === "string" &&
    typeof value.status_name === "string" &&
    (value.latest_request_id === null || typeof value.latest_request_id === "string") &&
    typeof value.latest_step_sequence === "number" &&
    typeof value.provider_call_count === "number" &&
    typeof value.web_search_call_count === "number" &&
    typeof value.image_call_count === "number" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    (value.terminal_at === null || typeof value.terminal_at === "string") &&
    (value.failure_code === null || typeof value.failure_code === "string");
}

function isMissingRpcError(error: unknown): boolean {
  return isRecord(error) && (
    error.code === "PGRST202" ||
    (typeof error.message === "string" && /Could not find the function/i.test(error.message))
  );
}

function isIdentifier(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && IDENTIFIER_PATTERN.test(value);
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isBoundedFailureCode(value: string): boolean {
  return value.length >= 1 && value.length <= 80 && IDENTIFIER_PATTERN.test(value);
}

function isSettleStatus(
  value: ServerExternalExecutionStatus
): value is Exclude<ServerExternalExecutionStatus, "created" | "providerRunning"> {
  return value === "awaitingNextRequest" ||
    value === "externallyCompleted" ||
    value === "externallyCancelled" ||
    value === "externallyFailed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
