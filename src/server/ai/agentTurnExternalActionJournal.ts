import { createHash } from "node:crypto";

import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import type {
  AgentTurnExternalActionKind,
  AgentTurnExternalActionSnapshot,
  AgentTurnExternalActionStatus
} from "@/shared/agentTurnExternalActionProtocol";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type AgentTurnExternalActionJournalClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
  };
  rpc(name: string, args: Record<string, unknown>): {
    single(): Promise<{ data: unknown; error: unknown }>;
  };
};

export type AgentTurnExternalActionDenial = Readonly<{
  status: "denied";
  httpStatus: 401 | 404 | 409 | 429 | 503;
  code: string;
  error: string;
  recoverable: false;
}>;

export type AcquireAgentTurnExternalActionResult =
  | Readonly<{
      status: "ok";
      executionGranted: boolean;
      replayed: boolean;
      snapshot: AgentTurnExternalActionSnapshot;
    }>
  | AgentTurnExternalActionDenial;

export type ReadAgentTurnExternalActionResult =
  | Readonly<{ status: "ok"; snapshot: AgentTurnExternalActionSnapshot }>
  | AgentTurnExternalActionDenial;

export type SettleAgentTurnExternalActionResult =
  | Readonly<{
      status: "ok";
      replayed: boolean;
      snapshot: AgentTurnExternalActionSnapshot;
    }>
  | AgentTurnExternalActionDenial;

type ActionRow = {
  decision: "acquired" | "replayed" | "updated" | "denied";
  denial_reason: string | null;
  server_turn_id: string;
  request_id: string;
  step_sequence: number;
  action_id: string;
  action_kind: string;
  status_name: string;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
  failure_code: string | null;
  result_receipt: unknown | null;
};

type ReadActionRow = Partial<ActionRow> & { visible: boolean };

export async function acquireAgentTurnExternalAction(input: {
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  actionId: string;
  actionKind: AgentTurnExternalActionKind;
  actionHash: string;
  claimCallId?: string;
  claimHash?: string;
}): Promise<AcquireAgentTurnExternalActionResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : acquireAgentTurnExternalActionForClient(client.client, input);
}

export async function readAgentTurnExternalAction(input: {
  serverTurnId: string;
  localProjectId: string;
  actionId: string;
}): Promise<ReadAgentTurnExternalActionResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : readAgentTurnExternalActionForClient(client.client, input);
}

export async function settleAgentTurnExternalAction(input: {
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  actionId: string;
  actionKind: AgentTurnExternalActionKind;
  actionHash: string;
  status: Exclude<AgentTurnExternalActionStatus, "running">;
  failureCode?: string;
  resultReceipt?: unknown;
}): Promise<SettleAgentTurnExternalActionResult> {
  const client = await createJournalClient();
  return client.status === "denied"
    ? client
    : settleAgentTurnExternalActionForClient(client.client, input);
}

export async function acquireAgentTurnExternalActionForClient(
  client: AgentTurnExternalActionJournalClient,
  input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    actionId: string;
    actionKind: AgentTurnExternalActionKind;
    actionHash: string;
    claimCallId?: string;
    claimHash?: string;
  }
): Promise<AcquireAgentTurnExternalActionResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  const requiresClaim = input.actionKind !== "compaction";
  if (
    !validIdentity(input) ||
    !SHA256_PATTERN.test(input.actionHash) ||
    (requiresClaim && (
      !isIdentifier(input.claimCallId) ||
      !isSha256(input.claimHash)
    )) ||
    (!requiresClaim && (input.claimCallId !== undefined || input.claimHash !== undefined))
  ) {
    return conflict("invalid_external_action", "A+ External Action 身份无效。");
  }
  const result = await client.rpc("acquire_agent_turn_external_action", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId,
    p_request_id: input.requestId,
    p_step_sequence: input.stepSequence,
    p_action_id: input.actionId,
    p_action_kind: toDatabaseKind(input.actionKind),
    p_action_hash: input.actionHash,
    p_claim_call_id: input.claimCallId ?? null,
    p_claim_hash: input.claimHash ?? null
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("external_action_contract_missing", "数据库尚未升级到 A+ External Action Journal 契约。");
  }
  if (result.error || !isActionRow(result.data)) {
    return unavailable("external_action_unavailable", "A+ External Action Journal 暂时不可用。");
  }
  if (result.data.decision === "denied") return denialFromReason(result.data.denial_reason);
  return {
    status: "ok",
    executionGranted: result.data.decision === "acquired",
    replayed: result.data.decision === "replayed",
    snapshot: snapshotFromRow(result.data)
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export async function readAgentTurnExternalActionForClient(
  client: AgentTurnExternalActionJournalClient,
  input: { serverTurnId: string; localProjectId: string; actionId: string }
): Promise<ReadAgentTurnExternalActionResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (!isUuid(input.serverTurnId) || !isIdentifier(input.localProjectId) || !isIdentifier(input.actionId)) {
    return notFound();
  }
  const result = await client.rpc("read_agent_turn_external_action", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId,
    p_action_id: input.actionId
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("external_action_contract_missing", "数据库尚未升级到 A+ External Action Journal 契约。");
  }
  if (result.error || !isReadActionRow(result.data)) {
    return unavailable("external_action_unavailable", "A+ External Action Journal 暂时不可用。");
  }
  if (!result.data.visible || !isActionRow({ ...result.data, decision: "replayed", denial_reason: null })) {
    return notFound();
  }
  return { status: "ok", snapshot: snapshotFromRow(result.data as ActionRow) };
}

export async function settleAgentTurnExternalActionForClient(
  client: AgentTurnExternalActionJournalClient,
  input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    actionId: string;
    actionKind: AgentTurnExternalActionKind;
    actionHash: string;
    status: Exclude<AgentTurnExternalActionStatus, "running">;
    failureCode?: string;
    resultReceipt?: unknown;
  }
): Promise<SettleAgentTurnExternalActionResult> {
  const auth = await requireUser(client);
  if (auth) return auth;
  if (
    !validIdentity(input) ||
    !SHA256_PATTERN.test(input.actionHash) ||
    !["externallyCompleted", "externallyCancelled", "externallyFailed"].includes(input.status) ||
    (input.failureCode !== undefined && !isFailureCode(input.failureCode))
  ) return conflict("invalid_external_action_settlement", "A+ External Action 终态参数无效。");
  const result = await client.rpc("settle_agent_turn_external_action", {
    p_server_turn_id: input.serverTurnId,
    p_local_project_id: input.localProjectId,
    p_request_id: input.requestId,
    p_step_sequence: input.stepSequence,
    p_action_id: input.actionId,
    p_action_kind: toDatabaseKind(input.actionKind),
    p_action_hash: input.actionHash,
    p_status: toDatabaseStatus(input.status),
    p_failure_code: input.failureCode ?? null,
    p_result_receipt: input.resultReceipt ?? null
  }).single();
  if (isMissingRpcError(result.error)) {
    return unavailable("external_action_contract_missing", "数据库尚未升级到 A+ External Action Journal 契约。");
  }
  if (result.error || !isActionRow(result.data)) {
    return unavailable("external_action_unavailable", "A+ External Action Journal 暂时不可用。");
  }
  if (result.data.decision === "denied") return denialFromReason(result.data.denial_reason);
  return {
    status: "ok",
    replayed: result.data.decision === "replayed",
    snapshot: snapshotFromRow(result.data)
  };
}

export function hashAgentTurnExternalActionContract(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function snapshotFromRow(row: ActionRow): AgentTurnExternalActionSnapshot {
  const kind = fromDatabaseKind(row.action_kind);
  const status = fromDatabaseStatus(row.status_name);
  if (!kind || !status) throw new Error("Unexpected External Action row contract.");
  return {
    serverTurnId: row.server_turn_id,
    requestId: row.request_id,
    stepSequence: row.step_sequence,
    actionId: row.action_id,
    actionKind: kind,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at,
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.result_receipt !== null ? { resultReceipt: row.result_receipt } : {})
  };
}

async function createJournalClient(): Promise<
  | { status: "ok"; client: AgentTurnExternalActionJournalClient }
  | AgentTurnExternalActionDenial
> {
  const created = await createServerSupabaseClient();
  return created.status === "failed"
    ? unavailable("supabase_unavailable", created.reason)
    : { status: "ok", client: created.client as unknown as AgentTurnExternalActionJournalClient };
}

async function requireUser(
  client: AgentTurnExternalActionJournalClient
): Promise<AgentTurnExternalActionDenial | undefined> {
  const user = await client.auth.getUser();
  return user.error || !user.data.user
    ? { status: "denied", httpStatus: 401, code: "unauthenticated", error: "请先登录 Morpho。", recoverable: false }
    : undefined;
}

function denialFromReason(reason: string | null): AgentTurnExternalActionDenial {
  if (reason === "invalid_turn" || reason === "not_found") return notFound();
  if (reason === "quota_exceeded" || reason === "action_limit") {
    return { status: "denied", httpStatus: 429, code: reason, error: "本轮外部动作或今日额度已达上限。", recoverable: false };
  }
  if ([
    "external_action_hash_conflict",
    "external_action_identity_conflict",
    "tool_action_not_claimed",
    "tool_action_claim_conflict",
    "request_not_latest",
    "terminal_turn",
    "status_conflict"
  ].includes(reason ?? "")) {
    return conflict(reason!, "A+ External Action 发生确定性冲突。");
  }
  return unavailable("external_action_unavailable", "A+ External Action Journal 暂时不可用。");
}

function notFound(): AgentTurnExternalActionDenial {
  return { status: "denied", httpStatus: 404, code: "not_found", error: "External Action 不存在或不可见。", recoverable: false };
}

function conflict(code: string, error: string): AgentTurnExternalActionDenial {
  return { status: "denied", httpStatus: 409, code, error, recoverable: false };
}

function unavailable(code: string, error: string): AgentTurnExternalActionDenial {
  return { status: "denied", httpStatus: 503, code, error, recoverable: false };
}

function validIdentity(value: {
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  actionId: string;
  actionKind: AgentTurnExternalActionKind;
}): boolean {
  return isUuid(value.serverTurnId) && isIdentifier(value.localProjectId) &&
    isIdentifier(value.requestId) && Number.isSafeInteger(value.stepSequence) &&
    value.stepSequence >= 1 && value.stepSequence <= 10_000 &&
    isIdentifier(value.actionId) && ["webSearch", "image", "compaction"].includes(value.actionKind);
}

function isActionRow(value: unknown): value is ActionRow {
  if (!isRecord(value)) return false;
  return ["acquired", "replayed", "updated", "denied"].includes(String(value.decision)) &&
    (value.denial_reason === null || typeof value.denial_reason === "string") &&
    typeof value.server_turn_id === "string" && typeof value.request_id === "string" &&
    typeof value.step_sequence === "number" && typeof value.action_id === "string" &&
    typeof value.action_kind === "string" && typeof value.status_name === "string" &&
    typeof value.created_at === "string" && typeof value.updated_at === "string" &&
    (value.terminal_at === null || typeof value.terminal_at === "string") &&
    (value.failure_code === null || typeof value.failure_code === "string") &&
    "result_receipt" in value;
}

function isReadActionRow(value: unknown): value is ReadActionRow {
  return isRecord(value) && typeof value.visible === "boolean";
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("External Action hash input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("External Action hash input is not canonical JSON.");
}

function toDatabaseKind(kind: AgentTurnExternalActionKind): string {
  return kind === "webSearch" ? "web_search" : kind;
}

function fromDatabaseKind(value: string): AgentTurnExternalActionKind | undefined {
  return value === "web_search" ? "webSearch" : value === "image" || value === "compaction" ? value : undefined;
}

function toDatabaseStatus(status: AgentTurnExternalActionStatus): string {
  const values: Record<AgentTurnExternalActionStatus, string> = {
    running: "running",
    externallyCompleted: "externally_completed",
    externallyCancelled: "externally_cancelled",
    externallyFailed: "externally_failed"
  };
  return values[status];
}

function fromDatabaseStatus(value: string): AgentTurnExternalActionStatus | undefined {
  const values: Record<string, AgentTurnExternalActionStatus> = {
    running: "running",
    externally_completed: "externallyCompleted",
    externally_cancelled: "externallyCancelled",
    externally_failed: "externallyFailed"
  };
  return values[value];
}

function isMissingRpcError(error: unknown): boolean {
  return isRecord(error) && (error.code === "PGRST202" ||
    (typeof error.message === "string" && /Could not find the function/i.test(error.message)));
}

function isUuid(value: string): boolean { return UUID_PATTERN.test(value); }
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 && value.length <= 160 && IDENTIFIER_PATTERN.test(value);
}
function isFailureCode(value: string): boolean {
  return value.length >= 1 && value.length <= 80 && IDENTIFIER_PATTERN.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
