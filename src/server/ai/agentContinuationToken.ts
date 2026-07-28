import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE,
  AGENT_CONTEXT_STATE_MARKER_TYPE,
  AGENT_COMPACTION_RECEIPT_VERSION,
  AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION,
  buildAgentContextMarkerManifest,
  buildAgentDurableTranscriptManifest,
  buildAgentTranscriptManifest,
  buildAgentTranscriptManifestFromItems,
  createAgentTranscriptMessageItem,
  createAgentTurnOutcomeItem,
  hashAgentContextStateMarker,
  hashAgentContextStateMarkerCausalBinding,
  hashAgentProviderItems,
  hashAgentProtocolValue,
  hashAgentTranscriptRange,
  hashCompactionTail,
  hashConversationSummaryForReceipt,
  parseAgentCompactionSourceEnvelope,
  type AgentTranscriptManifest,
  type AgentContextMarkerManifestItem,
  type AgentTurnOutcomeItem,
  type AgentContextStateMarker,
  type AgentCompactionReceipt,
  type AgentCompactionTranscriptMarker
} from "@/shared/agentCompactionProtocol";
import { MAX_AGENT_FUNCTION_CALLS } from "@/shared/agentFunctionCallLimits";
import { normalizeProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import type { AgentTurnOutcome } from "@/domain/morpho/types";

/**
 * A Provider continuation claims that the submitted transcript is exactly the
 * previous request plus the model's own output plus the tool results for the calls
 * the model actually made. Sequence checks alone cannot prove that: an
 * authenticated client holding a valid lease could rewrite history or invent
 * `function_call` / `function_call_output` pairs and have the model treat the
 * forged tool results as real reads.
 *
 * The server therefore signs a short-lived binding for every Provider response and
 * requires it back on the next request. The token carries only identifiers, counts
 * and digests: no prompt, transcript, workspace or tool content.
 */

const CONTINUATION_TOKEN_VERSION = 5;
const TURN_CLOSURE_TOKEN_VERSION = 1;
const LEGACY_TRANSCRIPT_SNAPSHOT_TOKEN_VERSION = 2;
const LEGACY_CONTINUATION_SNAPSHOT_VERSION = 4;
export const AGENT_CONTINUATION_TOKEN_TTL_MS = 20 * 60 * 1000;
export const AGENT_TURN_CLOSURE_TOKEN_TTL_MS = AGENT_CONTINUATION_TOKEN_TTL_MS;
export const AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type AgentContinuationClaims = {
  v: number;
  leaseId: string;
  agentTurnId: string;
  /** The lease sequence the next request must present. */
  sequence: number;
  /** True when the issuing request was a conversation summary transcript. */
  summary: boolean;
  inputItemCount: number;
  inputHash: string;
  outputHash: string;
  callIds: string[];
  transcriptManifest: AgentTranscriptManifest;
  prefixContextMarkerHashes: string[];
  appendableContextMarkerHashes: string[];
  compactionContextMarkerHashes: string[];
  prefixContextMarkerManifest: AgentContextMarkerManifestItem[];
  appendableContextMarkerManifest: AgentContextMarkerManifestItem[];
  compactionContextMarkerManifest: AgentContextMarkerManifestItem[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  exp: number;
  compactionReceipt?: AgentCompactionReceipt;
};

export type AgentContinuationVerification =
  | { status: "ok"; claims: AgentContinuationClaims }
  | { status: "failed"; reason: AgentContinuationFailureReason };

export type AgentContinuationFailureReason =
  | "secret_missing"
  | "token_missing"
  | "token_malformed"
  | "token_signature"
  | "token_expired"
  | "token_scope"
  | "prefix_truncated"
  | "prefix_rewritten"
  | "output_forged"
  | "tool_result_forged"
  | "tool_result_missing"
  | "exact_tail_rejected"
  | "transcript_not_summary"
  | "compaction_receipt_missing"
  | "compaction_receipt_forged"
  | "compaction_receipt_expired"
  | "compaction_source_unverified"
  | "compaction_source_forged"
  | "durable_replay_unverified"
  | "live_input_invalid"
  | "context_marker_forged";

export type AgentTranscriptSnapshotClaims = {
  v: number;
  projectId: string;
  userId?: string;
  transcriptManifest: AgentTranscriptManifest;
  contextMarkerHashes: string[];
  contextMarkerManifest?: AgentContextMarkerManifestItem[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  issuedAt?: number;
  exp: number;
  refreshUntil?: number;
};

export type AgentTurnClosureClaims = {
  v: number;
  userId: string;
  projectId: string;
  leaseId: string;
  agentTurnId: string;
  leaseSequence: number;
  currentUserMessageId: string;
  assistantMessageId: string;
  transcriptManifestHash: string;
  providerOutputSnapshotHash: string;
  terminalFunctionCalls: boolean;
  issuedAt: number;
  exp: number;
};

export type AgentTurnClosureVerification =
  | { status: "ok"; claims: AgentTurnClosureClaims }
  | { status: "failed"; reason: AgentContinuationFailureReason };

/**
 * Prefer an explicit secret. Otherwise derive a stable server-only key from the
 * Provider API key, which every deployment already has and no client can read.
 * Deriving keeps the rollout free of a new required variable while remaining
 * unforgeable; the derivation is domain-separated so the API key is never exposed.
 */
export function resolveAgentContinuationSecret(
  env: Record<string, string | undefined>
): string | undefined {
  const explicit = env.MORPHO_AGENT_CONTINUATION_SECRET?.trim();
  if (explicit) {
    return explicit;
  }
  const providerKey = env.MORPHO_AI_API_KEY?.trim();
  return providerKey
    ? createHash("sha256").update(`morpho-agent-continuation-v1:${providerKey}`).digest("hex")
    : undefined;
}

/**
 * Items are hashed on the way out from the Provider result and on the way back in
 * after request parsing. Those two paths build equivalent objects but must not be
 * required to build them in the same key order, so the digest is taken over a
 * canonical key-sorted form.
 */
export function hashAgentContinuationItems(items: readonly unknown[]): string {
  return hashAgentProviderItems(items);
}

export function issueAgentTurnClosureToken(input: {
  secret: string;
  userId: string;
  projectId: string;
  leaseId: string;
  agentTurnId: string;
  leaseSequence: number;
  currentUserMessageId: string;
  assistantMessageId: string;
  transcriptManifestHash: string;
  providerOutputSnapshotHash: string;
  terminalFunctionCalls: boolean;
  now: number;
}): string {
  const claims: AgentTurnClosureClaims = {
    v: TURN_CLOSURE_TOKEN_VERSION,
    userId: input.userId,
    projectId: input.projectId,
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    leaseSequence: input.leaseSequence,
    currentUserMessageId: input.currentUserMessageId,
    assistantMessageId: input.assistantMessageId,
    transcriptManifestHash: input.transcriptManifestHash,
    providerOutputSnapshotHash: input.providerOutputSnapshotHash,
    terminalFunctionCalls: input.terminalFunctionCalls,
    issuedAt: input.now,
    exp: input.now + AGENT_TURN_CLOSURE_TOKEN_TTL_MS
  };
  const payload = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyAgentTurnClosureToken(input: {
  token: string | undefined;
  secret: string | undefined;
  userId: string;
  projectId: string;
  leaseId: string;
  agentTurnId: string;
  currentUserMessageId: string;
  assistantMessageId: string;
  transcriptManifestHash: string;
  providerOutputSnapshotHash?: string;
  now: number;
  allowExpired?: boolean;
}): AgentTurnClosureVerification {
  if (!input.secret) {
    return failed("secret_missing");
  }
  if (!input.token) {
    return failed("token_missing");
  }
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0) {
    return failed("token_malformed");
  }
  const payload = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);
  if (!matchesSignature(payload, signature, input.secret)) {
    return failed("token_signature");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return failed("token_malformed");
  }
  if (!isTurnClosureClaims(claims)) {
    return failed("token_malformed");
  }
  if (!input.allowExpired && claims.exp <= input.now) {
    return failed("token_expired");
  }
  if (
    claims.userId !== input.userId ||
    claims.projectId !== input.projectId ||
    claims.leaseId !== input.leaseId ||
    claims.agentTurnId !== input.agentTurnId ||
    claims.currentUserMessageId !== input.currentUserMessageId ||
    claims.assistantMessageId !== input.assistantMessageId ||
    claims.transcriptManifestHash !== input.transcriptManifestHash ||
    (input.providerOutputSnapshotHash !== undefined &&
      claims.providerOutputSnapshotHash !== input.providerOutputSnapshotHash)
  ) {
    return failed("token_scope");
  }
  if (!claims.terminalFunctionCalls) {
    return failed("tool_result_missing");
  }
  return { status: "ok", claims };
}

export function issueAgentContinuationToken(
  input: {
    secret: string;
    leaseId: string;
    agentTurnId: string;
    sequence: number;
    summary: boolean;
    inputItemCount: number;
    inputHash: string;
    outputHash: string;
    callIds: readonly string[];
    transcriptManifest?: AgentTranscriptManifest;
    prefixContextMarkerHashes?: readonly string[];
    appendableContextMarkerHashes?: readonly string[];
    compactionContextMarkerHashes?: readonly string[];
    prefixContextMarkerManifest?: readonly AgentContextMarkerManifestItem[];
    appendableContextMarkerManifest?: readonly AgentContextMarkerManifestItem[];
    compactionContextMarkerManifest?: readonly AgentContextMarkerManifestItem[];
    previousSummaryHash?: string;
    previousSummaryRevisionId?: string;
    compactionReceipt?: AgentCompactionReceipt;
    now: number;
  }
): string {
  if (input.callIds.length > MAX_AGENT_FUNCTION_CALLS) {
    throw new Error(`超过 ${MAX_AGENT_FUNCTION_CALLS} 个工具调用，未签发 continuation。`);
  }
  const uniqueCallIds = new Set(input.callIds);
  if (uniqueCallIds.size !== input.callIds.length) {
    throw new Error("存在重复的工具调用 ID，未签发 continuation。");
  }
  if (input.summary && !input.compactionReceipt) {
    throw new Error("Conversation Summary 缺少签名压缩收据，未签发 continuation。");
  }
  const prefixContextMarkerManifest = normalizeMarkerManifestForIssue(
    input.prefixContextMarkerManifest,
    input.prefixContextMarkerHashes,
    "prefix"
  );
  const appendableContextMarkerManifest = normalizeMarkerManifestForIssue(
    input.appendableContextMarkerManifest,
    input.appendableContextMarkerHashes,
    "appendable"
  );
  const compactionContextMarkerManifest = normalizeMarkerManifestForIssue(
    input.compactionContextMarkerManifest,
    input.compactionContextMarkerHashes,
    "compaction"
  );
  const prefixContextMarkerHashes = prefixContextMarkerManifest.map((marker) => marker.contentHash);
  const appendableContextMarkerHashes = appendableContextMarkerManifest.map((marker) => marker.contentHash);
  if (appendableContextMarkerHashes.some((hash) => prefixContextMarkerHashes.includes(hash))) {
    throw new Error("Context marker 不能同时属于 prefix 与 appendable 集合。");
  }
  const claims: AgentContinuationClaims = {
    v: CONTINUATION_TOKEN_VERSION,
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    sequence: input.sequence,
    summary: input.summary,
    inputItemCount: input.inputItemCount,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    callIds: [...input.callIds],
    transcriptManifest: input.transcriptManifest ?? buildAgentTranscriptManifest([]),
    prefixContextMarkerHashes,
    appendableContextMarkerHashes,
    compactionContextMarkerHashes: compactionContextMarkerManifest.map((marker) => marker.contentHash),
    prefixContextMarkerManifest,
    appendableContextMarkerManifest,
    compactionContextMarkerManifest,
    ...(input.previousSummaryHash ? { previousSummaryHash: input.previousSummaryHash } : {}),
    ...(input.previousSummaryRevisionId ? { previousSummaryRevisionId: input.previousSummaryRevisionId } : {}),
    exp: input.compactionReceipt?.expiresAt ?? input.now + AGENT_CONTINUATION_TOKEN_TTL_MS,
    ...(input.compactionReceipt ? { compactionReceipt: input.compactionReceipt } : {})
  };
  const payload = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, input.secret)}`;
}

export function issueAgentTranscriptSnapshotToken(input: {
  secret: string;
  projectId: string;
  userId: string;
  transcriptManifest: AgentTranscriptManifest;
  contextMarkerHashes?: readonly string[];
  contextMarkerManifest?: readonly AgentContextMarkerManifestItem[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  now: number;
  issuedAt?: number;
  expiresAt?: number;
  refreshUntil?: number;
}): string {
  const contextMarkerManifest = normalizeMarkerManifestForIssue(
    input.contextMarkerManifest,
    input.contextMarkerHashes,
    "snapshot"
  );
  const issuedAt = input.issuedAt ?? input.now;
  const refreshUntil = input.refreshUntil ?? issuedAt + AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS;
  const claims: AgentTranscriptSnapshotClaims = {
    v: AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION,
    projectId: input.projectId,
    userId: input.userId,
    transcriptManifest: input.transcriptManifest,
    contextMarkerHashes: contextMarkerManifest.map((marker) => marker.contentHash),
    contextMarkerManifest,
    ...(input.previousSummaryHash ? { previousSummaryHash: input.previousSummaryHash } : {}),
    ...(input.previousSummaryRevisionId ? { previousSummaryRevisionId: input.previousSummaryRevisionId } : {}),
    issuedAt,
    exp: input.expiresAt ?? Math.min(input.now + AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS, refreshUntil),
    refreshUntil
  };
  const payload = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyAgentTranscriptSnapshotToken(input: {
  token: string | undefined;
  secret: string | undefined;
  projectId: string;
  userId: string;
  now: number;
}): { status: "ok"; claims: AgentTranscriptSnapshotClaims } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const decoded = decodeAgentTranscriptSnapshotToken(input);
  if (decoded.status === "failed") {
    return decoded;
  }
  const parsed = decoded.claims;
  if (parsed.projectId !== input.projectId || parsed.userId !== input.userId ||
    parsed.v !== AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION) {
    return failed("compaction_source_forged");
  }
  if (parsed.exp <= input.now) {
    return failed("compaction_source_unverified");
  }
  return { status: "ok", claims: parsed };
}

export function refreshAgentTranscriptSnapshotToken(input: {
  token: string | undefined;
  secret: string | undefined;
  projectId: string;
  userId: string;
  now: number;
  transcriptManifest?: AgentTranscriptManifest;
}): { status: "ok"; token: string; claims: AgentTranscriptSnapshotClaims } |
  { status: "failed"; reason: AgentContinuationFailureReason } {
  const decoded = decodeAgentTranscriptSnapshotToken(input);
  if (decoded.status === "failed") {
    return decoded;
  }
  const claims = decoded.claims;
  if (claims.projectId !== input.projectId || (claims.userId !== undefined && claims.userId !== input.userId)) {
    return failed("compaction_source_forged");
  }
  const issuedAt = claims.issuedAt ?? claims.exp - AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS;
  const refreshUntil = claims.refreshUntil ?? issuedAt + AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS;
  if (refreshUntil <= input.now || !input.secret) {
    return failed("compaction_source_unverified");
  }
  const currentVersion = claims.v === AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION;
  const transcriptManifest = input.transcriptManifest ?? claims.transcriptManifest;
  if ((currentVersion && input.transcriptManifest) || (!currentVersion && !input.transcriptManifest) ||
    (input.transcriptManifest && (
      !isAgentTranscriptManifest(input.transcriptManifest) ||
      !isCurrentAgentTranscriptManifest(input.transcriptManifest) ||
      !sameUpgradeableManifest(claims.transcriptManifest, input.transcriptManifest)
    ))) {
    return failed("compaction_source_forged");
  }
  const expiresAt = Math.min(input.now + AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS, refreshUntil);
  const contextMarkerManifest = claims.contextMarkerManifest ?? [];
  if (!claims.contextMarkerManifest && claims.contextMarkerHashes.length > 0) {
    return failed("context_marker_forged");
  }
  const refreshedClaims: AgentTranscriptSnapshotClaims = {
    v: AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION,
    projectId: claims.projectId,
    userId: input.userId,
    transcriptManifest,
    contextMarkerHashes: contextMarkerManifest.map((marker) => marker.contentHash),
    contextMarkerManifest,
    ...(claims.previousSummaryHash && claims.previousSummaryRevisionId
      ? {
          previousSummaryHash: claims.previousSummaryHash,
          previousSummaryRevisionId: claims.previousSummaryRevisionId
        }
      : {}),
    issuedAt,
    exp: expiresAt,
    refreshUntil
  };
  return {
    status: "ok",
    token: issueAgentTranscriptSnapshotToken({
      secret: input.secret,
      projectId: claims.projectId,
      userId: input.userId,
      transcriptManifest,
      contextMarkerManifest,
      ...(claims.previousSummaryHash && claims.previousSummaryRevisionId
        ? {
            previousSummaryHash: claims.previousSummaryHash,
            previousSummaryRevisionId: claims.previousSummaryRevisionId
          }
        : {}),
      now: input.now,
      issuedAt,
      expiresAt,
      refreshUntil
    }),
    claims: refreshedClaims
  };
}

export function finalizeAgentTranscriptSnapshotOutcomeToken(input: {
  token: string | undefined;
  secret: string | undefined;
  projectId: string;
  userId: string;
  agentTurnId: string;
  userMessageId: string;
  assistantMessageId: string;
  outcome: AgentTurnOutcome;
  successProviderOutputSnapshot?: unknown;
  now: number;
}): { status: "ok"; token: string; claims: AgentTranscriptSnapshotClaims; outcomeItem: AgentTurnOutcomeItem } |
  { status: "failed"; reason: AgentContinuationFailureReason } {
  const verified = verifyAgentTranscriptSnapshotToken({
    token: input.token,
    secret: input.secret,
    projectId: input.projectId,
    userId: input.userId,
    now: input.now
  });
  if (verified.status === "failed") {
    return verified;
  }
  const claims = verified.claims;
  const userItems = claims.transcriptManifest.items.filter((item) =>
    item.messageId === input.userMessageId && item.role === "user"
  );
  const assistantItems = claims.transcriptManifest.items.filter((item) =>
    item.messageId === input.assistantMessageId
  );
  const latestUserMessageId = [...claims.transcriptManifest.items].reverse().find((item) =>
    item.kind === "message" && item.role === "user"
  )?.messageId;
  const lastUserIndex = claims.transcriptManifest.items.reduce((last, item, index) =>
    item.messageId === input.userMessageId ? index : last
  , -1);
  const firstAssistantIndex = claims.transcriptManifest.items.findIndex((item) =>
    item.messageId === input.assistantMessageId
  );
  if (userItems.length === 0 || assistantItems.length === 0 ||
    latestUserMessageId !== input.userMessageId || firstAssistantIndex <= lastUserIndex ||
    assistantItems.some((item) =>
    item.role !== "assistant" || (item.kind !== "message" && item.kind !== "outcome")
  )) {
    return failed("compaction_source_forged");
  }
  const successSnapshot = input.outcome === "success"
    ? normalizeProviderOutputSnapshot(input.successProviderOutputSnapshot)
    : undefined;
  if (input.outcome === "success" && !successSnapshot) {
    return failed("compaction_source_unverified");
  }
  const outcomeItem = createAgentTurnOutcomeItem({
    agentTurnId: input.agentTurnId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    outcome: input.outcome,
    ...(successSnapshot ? { successText: successSnapshot.text } : {})
  });
  const outcomeManifest = buildAgentDurableTranscriptManifest([
    createAgentTranscriptMessageItem({
      messageId: input.assistantMessageId,
      role: "assistant",
      replayMode: "durableReplay",
      providerItems: [outcomeItem]
    })
  ]);
  if (outcomeManifest.items.length !== 1) {
    return failed("compaction_source_forged");
  }
  if (input.outcome === "success" && assistantItems.some((item) => item.kind === "message")) {
    const signedSuccessManifest = buildAgentDurableTranscriptManifest([
      createAgentTranscriptMessageItem({
        messageId: input.assistantMessageId,
        role: "assistant",
        replayMode: "durableReplay",
        providerItems: [{
          role: "assistant",
          content: [{ type: "output_text", text: successSnapshot!.text }]
        }]
      })
    ]);
    if (!sameManifestItems(assistantItems, signedSuccessManifest.items)) {
      return failed("compaction_source_forged");
    }
  } else if (input.outcome === "success" && !sameManifestItems(assistantItems, outcomeManifest.items)) {
    return failed("compaction_source_forged");
  }
  const insertionIndex = firstAssistantIndex >= 0 ? firstAssistantIndex : lastUserIndex + 1;
  const withoutAssistant = claims.transcriptManifest.items.filter((item) =>
    item.messageId !== input.assistantMessageId
  );
  const precedingAssistantItems = claims.transcriptManifest.items
    .slice(0, insertionIndex)
    .filter((item) => item.messageId === input.assistantMessageId).length;
  const normalizedInsertionIndex = Math.max(0, insertionIndex - precedingAssistantItems);
  const transcriptManifest = buildAgentTranscriptManifestFromItems([
    ...withoutAssistant.slice(0, normalizedInsertionIndex),
    ...outcomeManifest.items,
    ...withoutAssistant.slice(normalizedInsertionIndex)
  ]);
  const token = issueAgentTranscriptSnapshotToken({
    secret: input.secret!,
    projectId: input.projectId,
    userId: input.userId,
    transcriptManifest,
    contextMarkerManifest: claims.contextMarkerManifest ?? [],
    ...(claims.previousSummaryHash && claims.previousSummaryRevisionId
      ? {
          previousSummaryHash: claims.previousSummaryHash,
          previousSummaryRevisionId: claims.previousSummaryRevisionId
        }
      : {}),
    now: input.now,
    issuedAt: claims.issuedAt,
    expiresAt: claims.exp,
    refreshUntil: claims.refreshUntil
  });
  return {
    status: "ok",
    token,
    claims: { ...claims, transcriptManifest },
    outcomeItem
  };
}

function decodeAgentTranscriptSnapshotToken(input: {
  token: string | undefined;
  secret: string | undefined;
}): { status: "ok"; claims: AgentTranscriptSnapshotClaims } |
  { status: "failed"; reason: AgentContinuationFailureReason } {
  if (!input.secret) {
    return failed("secret_missing");
  }
  if (!input.token) {
    return failed("compaction_source_unverified");
  }
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0) {
    return failed("compaction_source_forged");
  }
  const payload = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);
  if (!matchesSignature(payload, signature, input.secret)) {
    return failed("compaction_source_forged");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return failed("compaction_source_forged");
  }
  if (!isTranscriptSnapshotClaims(parsed)) {
    return failed("compaction_source_forged");
  }
  return { status: "ok", claims: parsed };
}

export function verifyAgentContinuationToken(input: {
  token: string | undefined;
  secret: string | undefined;
  leaseId: string;
  agentTurnId: string;
  expectedSequence: number;
  now: number;
}): AgentContinuationVerification {
  if (!input.secret) {
    return failed("secret_missing");
  }
  if (!input.token) {
    return failed("token_missing");
  }
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0) {
    return failed("token_malformed");
  }
  const payload = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);
  if (!matchesSignature(payload, signature, input.secret)) {
    return failed("token_signature");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return failed("token_malformed");
  }
  if (!isContinuationClaims(claims)) {
    return failed("token_malformed");
  }
  if (claims.exp <= input.now) {
    return failed("token_expired");
  }
  if (
    claims.leaseId !== input.leaseId ||
    claims.agentTurnId !== input.agentTurnId ||
    claims.sequence !== input.expectedSequence
  ) {
    return failed("token_scope");
  }
  if (claims.summary && (!claims.compactionReceipt || claims.compactionReceipt.expiresAt <= input.now)) {
    return failed(claims.compactionReceipt ? "compaction_receipt_expired" : "compaction_receipt_missing");
  }
  return { status: "ok", claims };
}

/**
 * Verify that the submitted dynamic input is the bound transcript: an unchanged
 * prefix, the exact Provider output that followed it, and tool results only for
 * calls the Provider actually made.
 */
export function verifyAgentContinuationBinding(input: {
  claims: AgentContinuationClaims;
  parsedInput: readonly unknown[];
}): { status: "ok" } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const { claims, parsedInput } = input;
  if (parsedInput.length < claims.inputItemCount) {
    return failed("prefix_truncated");
  }
  if (hashAgentContinuationItems(parsedInput.slice(0, claims.inputItemCount)) !== claims.inputHash) {
    return failed("prefix_rewritten");
  }
  const prefixMarkerHashes = parsedInput
    .slice(0, claims.inputItemCount)
    .filter(isContextStateMarker)
  if (!sameContextMarkerManifest(
    buildAgentContextMarkerManifest(prefixMarkerHashes),
    claims.prefixContextMarkerManifest
  )) {
    return failed("context_marker_forged");
  }
  const tail = parsedInput.slice(claims.inputItemCount);
  let outputEnd = 0;
  while (outputEnd < tail.length && isProviderOutputItem(tail[outputEnd])) {
    outputEnd += 1;
  }
  if (outputEnd === 0 || hashAgentContinuationItems(tail.slice(0, outputEnd)) !== claims.outputHash) {
    return failed("output_forged");
  }
  const allowedCallIds = new Set(claims.callIds);
  const answeredCallIds = new Set<string>();
  const seenContextMarkerHashes = new Set<string>();
  let appendableMarkerIndex = 0;
  for (const item of tail.slice(outputEnd)) {
    if (isProviderOutputItem(item)) {
      return failed("output_forged");
    }
    if (isContextStateMarker(item)) {
      const replayedPrefixMarker = claims.prefixContextMarkerHashes.includes(item.contentHash);
      const appendable = claims.appendableContextMarkerManifest[appendableMarkerIndex];
      const matchesAppendable = Boolean(appendable) && sameContextMarkerManifest(
        buildAgentContextMarkerManifest([item]),
        [appendable!]
      );
      const causallyBound = item.causalBindingHash !== undefined &&
        allowedCallIds.size > 0 &&
        answeredCallIds.size === allowedCallIds.size &&
        item.causalBindingHash === hashAgentContextStateMarkerCausalBinding({
          marker: item,
          outputHash: claims.outputHash,
          callIds: claims.callIds,
          terminalOutputHash: hashAgentProviderItems(
            tail.slice(outputEnd).filter(isFunctionCallOutput)
          )
        });
      if (
        replayedPrefixMarker ||
        (!causallyBound && (item.causalBindingHash !== undefined || !matchesAppendable)) ||
        seenContextMarkerHashes.has(item.contentHash)
      ) {
        return failed("context_marker_forged");
      }
      if (matchesAppendable) {
        appendableMarkerIndex += 1;
      }
      seenContextMarkerHashes.add(item.contentHash);
      continue;
    }
    if (!isFunctionCallOutput(item)) {
      return failed("exact_tail_rejected");
    }
    if (!allowedCallIds.has(item.call_id) || answeredCallIds.has(item.call_id)) {
      return failed("tool_result_forged");
    }
    answeredCallIds.add(item.call_id);
  }
  if (answeredCallIds.size !== allowedCallIds.size) {
    return failed("tool_result_missing");
  }
  return { status: "ok" };
}

export function verifyAgentCompactionBinding(input: {
  claims: AgentContinuationClaims;
  parsedInput: readonly unknown[];
  now: number;
}): { status: "ok" } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const receipt = input.claims.compactionReceipt;
  if (!input.claims.summary) {
    return failed("transcript_not_summary");
  }
  if (!receipt) {
    return failed("compaction_receipt_missing");
  }
  if (receipt.expiresAt <= input.now || receipt.expiresAt !== input.claims.exp) {
    return failed("compaction_receipt_expired");
  }
  const markers = input.parsedInput.filter(isCompactionTranscriptMarker);
  if (markers.length !== 1) {
    return failed("compaction_receipt_forged");
  }
  const marker = markers[0]!;
  const markerIndex = input.parsedInput.indexOf(marker);
  const expectedBefore = receipt.contextMarkerManifest.filter((contextMarker) =>
    !contextMarkerFollowsCompactedTail(contextMarker)
  );
  const expectedAfter = receipt.contextMarkerManifest.filter(contextMarkerFollowsCompactedTail);
  const before = input.parsedInput.slice(0, markerIndex);
  const after = input.parsedInput.slice(markerIndex + 1);
  if (markerIndex !== expectedBefore.length ||
    before.some((item) => !isContextStateMarker(item)) ||
    after.some((item) => !isContextStateMarker(item)) ||
    !sameContextMarkerManifest(
      buildAgentContextMarkerManifest(before.filter(isContextStateMarker)),
      expectedBefore
    ) ||
    !sameContextMarkerManifest(
      buildAgentContextMarkerManifest(after.filter(isContextStateMarker)),
      expectedAfter
    )) {
    return failed("compaction_receipt_forged");
  }
  if (
    marker.promptContractVersion !== receipt.promptContractVersion ||
    receipt.leaseId !== input.claims.leaseId ||
    receipt.agentTurnId !== input.claims.agentTurnId ||
    receipt.sequence !== input.claims.sequence ||
    marker.summaryHash !== receipt.summaryHash ||
    marker.summaryRevisionId !== receipt.summaryRevisionId ||
    marker.sourceStartMessageId !== receipt.sourceStartMessageId ||
    marker.sourceEndMessageId !== receipt.sourceEndMessageId ||
    marker.sourceMessageCount !== receipt.sourceMessageCount ||
    marker.sourceMessageIdsHash !== receipt.sourceMessageIdsHash ||
    marker.retainedTailCount !== receipt.retainedTailCount ||
    marker.retainedTailHash !== receipt.retainedTailHash ||
    marker.sourceInputHash !== receipt.sourceInputHash ||
    marker.sourceManifest.manifestHash !== receipt.sourceManifest.manifestHash ||
    marker.retainedTailManifest.manifestHash !== receipt.retainedTailManifest.manifestHash ||
    marker.transcriptRangeHash !== receipt.transcriptRangeHash ||
    !sameContextMarkerManifest(marker.contextMarkerManifest, receipt.contextMarkerManifest) ||
    marker.receiptVersion !== receipt.receiptVersion ||
    marker.previousSummaryHash !== receipt.previousSummaryHash ||
    marker.previousSummaryRevisionId !== receipt.previousSummaryRevisionId ||
    marker.previousTranscriptManifestHash !== receipt.previousTranscriptManifestHash ||
    hashConversationSummaryForReceipt(marker.summary) !== receipt.summaryHash ||
    hashCompactionTail(marker.retainedTail) !== receipt.retainedTailHash
  ) {
    return failed("compaction_receipt_forged");
  }
  const retainedTailManifest = buildAgentTranscriptManifest(marker.retainedTail);
  const parsedContextMarkers = input.parsedInput.filter(isContextStateMarker);
  if (
    retainedTailManifest.manifestHash !== marker.retainedTailManifest.manifestHash ||
    marker.transcriptRangeHash !== hashAgentTranscriptRange(marker.sourceManifest, retainedTailManifest) ||
    parsedContextMarkers.length !== receipt.contextMarkerManifest.length ||
    !sameContextMarkerManifest(
      buildAgentContextMarkerManifest(parsedContextMarkers),
      receipt.contextMarkerManifest
    )
  ) {
    return failed("compaction_receipt_forged");
  }
  return { status: "ok" };
}

export function verifyAgentCompactionSourceBinding(input: {
  claims: AgentContinuationClaims;
  parsedInput: readonly unknown[];
  descriptor: AgentCompactionDescriptorLike;
  transcriptManifest: AgentTranscriptManifest;
  contextMarkers: readonly AgentContextStateMarker[];
  retainedTail: readonly unknown[];
  allowFreshUserTail?: boolean;
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
}): { status: "ok" } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const descriptor = input.descriptor;
  const sourceEnvelope = parseAgentCompactionSourceEnvelope(input.parsedInput[0]);
  const retainedTailManifest = buildAgentTranscriptManifest(input.retainedTail);
  const trustedPreviousSummaryHash =
    input.claims.compactionReceipt?.summaryHash ?? input.claims.previousSummaryHash ?? input.previousSummaryHash;
  const trustedPreviousSummaryRevisionId =
    input.claims.compactionReceipt?.summaryRevisionId ??
    input.claims.previousSummaryRevisionId ??
    input.previousSummaryRevisionId;
  const envelopePreviousSummaryHash = sourceEnvelope?.previousSummary
    ? hashConversationSummaryForReceipt(sourceEnvelope.previousSummary)
    : undefined;
  if (
    !sourceEnvelope ||
    sourceEnvelope.sourceStartMessageId !== descriptor.sourceStartMessageId ||
    sourceEnvelope.sourceEndMessageId !== descriptor.sourceEndMessageId ||
    sourceEnvelope.sourceMessageCount !== descriptor.sourceMessageCount ||
    sourceEnvelope.sourceMessageIdsHash !== descriptor.sourceMessageIdsHash ||
    sourceEnvelope.sourceMessageIds.length !== descriptor.sourceMessageCount ||
    descriptor.retainedTailCount !== input.retainedTail.length ||
    hashCompactionTail(input.retainedTail) !== descriptor.retainedTailHash ||
    retainedTailManifest.manifestHash !== descriptor.retainedTailManifest.manifestHash
  ) {
    return failed("compaction_source_forged");
  }
  const parsedSourceManifest = buildAgentTranscriptManifest(
    sourceEnvelope.sourceMessages.flatMap((message) => message.providerItems)
  );
  const sourceManifestWithMessageIds = buildAgentTranscriptManifest([input.parsedInput[0]]);
  const signedSourceMessageIds = sourceManifestWithMessageIds.items
    .filter((item) => item.kind === "message")
    .map((item) => item.messageId);
  if (
    sourceManifestWithMessageIds.manifestHash !== descriptor.sourceManifest.manifestHash ||
    sourceManifestWithMessageIds.itemCount !== descriptor.sourceManifest.itemCount ||
    sourceManifestWithMessageIds.items.some((item, index) => !sameManifestItem(item, descriptor.sourceManifest.items[index]!)) ||
    signedSourceMessageIds.length !== sourceEnvelope.sourceMessageIds.length ||
    signedSourceMessageIds.some((messageId, index) => messageId !== sourceEnvelope.sourceMessageIds[index]) ||
    parsedSourceManifest.items.some((item, index) => item.hash !== sourceManifestWithMessageIds.items[index]?.hash)
  ) {
    return failed("compaction_source_forged");
  }
  if (hashAgentContinuationItems(input.parsedInput) !== descriptor.sourceInputHash) {
    return failed("compaction_source_forged");
  }
  if (
    descriptor.sourceManifest.manifestHash !== hashManifest(descriptor.sourceManifest) ||
    descriptor.retainedTailManifest.manifestHash !== hashManifest(descriptor.retainedTailManifest) ||
    descriptor.transcriptRangeHash !== hashAgentTranscriptRange(
      descriptor.sourceManifest,
      descriptor.retainedTailManifest
    )
  ) {
    return failed("compaction_source_forged");
  }
  if (
    descriptor.previousSummaryHash !== trustedPreviousSummaryHash ||
    descriptor.previousSummaryRevisionId !== trustedPreviousSummaryRevisionId ||
    envelopePreviousSummaryHash !== trustedPreviousSummaryHash ||
    Boolean(sourceEnvelope.previousSummary) !== Boolean(trustedPreviousSummaryHash)
  ) {
    return failed("compaction_source_forged");
  }
  if (
    !sameContextMarkerManifest(
      descriptor.contextMarkerManifest,
      buildAgentContextMarkerManifest(input.contextMarkers)
    )
  ) {
    return failed("compaction_source_forged");
  }
  const signedCallIds = new Set(input.claims.callIds);
  const terminalOutputs = input.retainedTail.filter(
    (item) => isFunctionCallOutput(item) && signedCallIds.has(item.call_id)
  );
  const terminalOutputHash = hashAgentProviderItems(terminalOutputs);
  const priorMarkerManifest = input.claims.compactionContextMarkerManifest;
  const actualMarkerManifest = buildAgentContextMarkerManifest(input.contextMarkers);
  if (!sameContextMarkerManifest(
    actualMarkerManifest.slice(0, priorMarkerManifest.length),
    priorMarkerManifest
  )) {
    return failed("context_marker_forged");
  }
  for (const marker of input.contextMarkers.slice(priorMarkerManifest.length)) {
    if (
      !marker.causalBindingHash ||
      input.claims.callIds.length === 0 ||
      marker.causalBindingHash !== hashAgentContextStateMarkerCausalBinding({
        marker,
        outputHash: input.claims.outputHash,
        callIds: input.claims.callIds,
        terminalOutputHash
      })
    ) {
      return failed("context_marker_forged");
    }
  }
  if (
    descriptor.previousTranscriptManifestHash !== input.transcriptManifest.manifestHash ||
    descriptor.sourceMessageCount < 2 ||
    descriptor.sourceMessageIdsHash.length !== 64
  ) {
    return failed("compaction_source_unverified");
  }

  const actualItems = [...descriptor.sourceManifest.items, ...descriptor.retainedTailManifest.items];
  const expectedItems = input.transcriptManifest.items;
  const commonLength = Math.min(actualItems.length, expectedItems.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (!sameManifestItem(actualItems[index]!, expectedItems[index]!)) {
      return failed("compaction_source_forged");
    }
  }
  const extras = actualItems.slice(expectedItems.length);
  if (extras.length > 0) {
    if (input.allowFreshUserTail && isFreshUserManifestTail(extras)) {
      return { status: "ok" };
    }
    const allowedCallIds = new Set(input.claims.callIds);
    const extraCallIds = extras.map((item) => item.callId);
    if (
      extras.some((item) => item.kind !== "functionCallOutput" || !item.callId || !allowedCallIds.has(item.callId)) ||
      new Set(extraCallIds).size !== extraCallIds.length
    ) {
      return failed("compaction_source_forged");
    }
    if (
      extraCallIds.length !== allowedCallIds.size ||
      [...allowedCallIds].some((callId) => !extraCallIds.includes(callId))
    ) {
      return failed("tool_result_missing");
    }
  }
  if (input.claims.callIds.length > 0 && extras.length === 0) {
    return failed("tool_result_missing");
  }
  if (actualItems.length < expectedItems.length) {
    return failed("compaction_source_forged");
  }
  return { status: "ok" };
}

function isFreshUserManifestTail(items: readonly AgentTranscriptManifest["items"][number][]): boolean {
  return (items.length === 1 && items[0]?.kind === "message" && items[0].role === "user") ||
    (items.length === 2 && items[0]?.kind === "strategy" && items[1]?.kind === "message" && items[1].role === "user");
}

export type AgentCompactionDescriptorLike = {
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  retainedTailCount: number;
  retainedTailHash: string;
  sourceInputHash: string;
  sourceManifest: AgentTranscriptManifest;
  retainedTailManifest: AgentTranscriptManifest;
  transcriptRangeHash: string;
  contextMarkerHashes: string[];
  contextMarkerManifest: AgentCompactionReceipt["contextMarkerManifest"];
  previousTranscriptManifestHash?: string;
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
};

export function agentContinuationFailureMessage(reason: AgentContinuationFailureReason): string {
  if (reason === "secret_missing") {
    return "服务端缺少 Agent continuation 密钥，无法验证回合延续。";
  }
  if (reason === "transcript_not_summary") {
    return "压缩后的 Provider 请求必须紧接在服务端摘要之后。";
  }
  if (reason === "prefix_rewritten" || reason === "prefix_truncated") {
    return "Agent continuation 的历史前缀与服务端记录不一致。";
  }
  if (reason === "output_forged" || reason === "tool_result_forged") {
    return "Agent continuation 包含并非来自服务端上一次响应的模型输出或工具结果。";
  }
  if (reason === "tool_result_missing" || reason === "exact_tail_rejected") {
    return "Agent continuation 的尾部不是服务端输出、唯一 terminal tool output 或严格 Morpho 状态 marker。";
  }
  if (reason === "context_marker_forged") {
    return "Agent continuation 包含未被上一份服务端 Transcript 授权的 Context/State marker。";
  }
  if (reason === "durable_replay_unverified") {
    return "完整历史 Transcript 未被上一份用户绑定的服务端 Snapshot 授权。";
  }
  if (reason === "live_input_invalid") {
    return "当前用户消息没有通过唯一 liveInput 合同校验。";
  }
  if (reason === "compaction_source_unverified") {
    return "Conversation Summary 的来源没有上一份服务端签名 Transcript 快照，原始历史未被删除。";
  }
  if (reason === "compaction_source_forged") {
    return "Conversation Summary 的 source、retained tail 或 Transcript manifest 与上一份服务端记录不一致。";
  }
  if (reason === "compaction_receipt_missing" || reason === "compaction_receipt_forged" || reason === "compaction_receipt_expired") {
    return "压缩后的 Provider 请求缺少有效的签名压缩收据，原始历史未被删除。";
  }
  return "Agent continuation 凭据无效或已过期，请重新发起本轮。";
}

function sign(payload: string, secret: string): string {
  return base64Url(createHmac("sha256", secret).update(payload).digest());
}

function matchesSignature(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(payload, secret), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isProviderOutputItem(value: unknown): boolean {
  return isRecord(value) &&
    (value.type === "message" || value.type === "reasoning" || value.type === "function_call");
}

function isContextStateMarker(value: unknown): value is AgentContextStateMarker {
  return isRecord(value) &&
    value.type === AGENT_CONTEXT_STATE_MARKER_TYPE &&
    typeof value.id === "string" &&
    isProtocolHash(value.contentHash) &&
    (value.causalBindingHash === undefined || isProtocolHash(value.causalBindingHash)) &&
    typeof value.dataText === "string" &&
    !("renderedText" in value) &&
    hashAgentContextStateMarker(value as unknown as AgentContextStateMarker) === value.contentHash;
}

function isCompactionTranscriptMarker(value: unknown): value is AgentCompactionTranscriptMarker {
  return isRecord(value) &&
    value.type === AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE &&
    typeof value.summaryHash === "string" &&
    Array.isArray(value.retainedTail) &&
    !("renderedText" in value);
}

function isFunctionCallOutput(value: unknown): value is { call_id: string } {
  return isRecord(value) && value.type === "function_call_output" && typeof value.call_id === "string";
}

function isContinuationClaims(value: unknown): value is AgentContinuationClaims {
  return isRecord(value) &&
    unknownKeys(value, [
      "v",
      "leaseId",
      "agentTurnId",
      "sequence",
      "summary",
      "inputItemCount",
      "inputHash",
      "outputHash",
      "callIds",
      "transcriptManifest",
      "prefixContextMarkerHashes",
      "appendableContextMarkerHashes",
      "compactionContextMarkerHashes",
      "prefixContextMarkerManifest",
      "appendableContextMarkerManifest",
      "compactionContextMarkerManifest",
      "previousSummaryHash",
      "previousSummaryRevisionId",
      "exp",
      "compactionReceipt"
    ]).length === 0 &&
    value.v === CONTINUATION_TOKEN_VERSION &&
    typeof value.leaseId === "string" &&
    typeof value.agentTurnId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.summary === "boolean" &&
    typeof value.inputItemCount === "number" &&
    Number.isSafeInteger(value.inputItemCount) &&
    value.inputItemCount >= 0 &&
    typeof value.inputHash === "string" &&
    typeof value.outputHash === "string" &&
    isProtocolHash(value.inputHash) &&
    isProtocolHash(value.outputHash) &&
    Array.isArray(value.callIds) &&
    value.callIds.length <= MAX_AGENT_FUNCTION_CALLS &&
    value.callIds.every((callId) => typeof callId === "string") &&
    new Set(value.callIds).size === value.callIds.length &&
    isAgentTranscriptManifest(value.transcriptManifest) &&
    Array.isArray(value.prefixContextMarkerHashes) &&
    value.prefixContextMarkerHashes.every(isProtocolHash) &&
    new Set(value.prefixContextMarkerHashes).size === value.prefixContextMarkerHashes.length &&
    Array.isArray(value.appendableContextMarkerHashes) &&
    value.appendableContextMarkerHashes.every(isProtocolHash) &&
    new Set(value.appendableContextMarkerHashes).size === value.appendableContextMarkerHashes.length &&
    value.appendableContextMarkerHashes.every((hash) =>
      !(value.prefixContextMarkerHashes as unknown[]).includes(hash)
    ) &&
    Array.isArray(value.compactionContextMarkerHashes) &&
    value.compactionContextMarkerHashes.every(isProtocolHash) &&
    new Set(value.compactionContextMarkerHashes).size === value.compactionContextMarkerHashes.length &&
    Array.isArray(value.prefixContextMarkerManifest) &&
    value.prefixContextMarkerManifest.every(isContextMarkerManifestItem) &&
    markerManifestHashesMatch(value.prefixContextMarkerManifest, value.prefixContextMarkerHashes) &&
    Array.isArray(value.appendableContextMarkerManifest) &&
    value.appendableContextMarkerManifest.every(isContextMarkerManifestItem) &&
    markerManifestHashesMatch(value.appendableContextMarkerManifest, value.appendableContextMarkerHashes) &&
    Array.isArray(value.compactionContextMarkerManifest) &&
    value.compactionContextMarkerManifest.every(isContextMarkerManifestItem) &&
    markerManifestHashesMatch(value.compactionContextMarkerManifest, value.compactionContextMarkerHashes) &&
    (value.previousSummaryHash === undefined || isProtocolHash(value.previousSummaryHash)) &&
    (value.previousSummaryRevisionId === undefined || typeof value.previousSummaryRevisionId === "string") &&
    (value.previousSummaryHash === undefined) === (value.previousSummaryRevisionId === undefined) &&
    typeof value.exp === "number" &&
    (value.summary
      ? isCompactionReceipt(value.compactionReceipt)
      : value.compactionReceipt === undefined);
}

function isTurnClosureClaims(value: unknown): value is AgentTurnClosureClaims {
  return isRecord(value) &&
    unknownKeys(value, [
      "v",
      "userId",
      "projectId",
      "leaseId",
      "agentTurnId",
      "leaseSequence",
      "currentUserMessageId",
      "assistantMessageId",
      "transcriptManifestHash",
      "providerOutputSnapshotHash",
      "terminalFunctionCalls",
      "issuedAt",
      "exp"
    ]).length === 0 &&
    value.v === TURN_CLOSURE_TOKEN_VERSION &&
    typeof value.userId === "string" && value.userId.length > 0 &&
    typeof value.projectId === "string" && value.projectId.length > 0 &&
    typeof value.leaseId === "string" && value.leaseId.length > 0 &&
    typeof value.agentTurnId === "string" && value.agentTurnId.length > 0 &&
    typeof value.leaseSequence === "number" && Number.isSafeInteger(value.leaseSequence) && value.leaseSequence > 0 &&
    typeof value.currentUserMessageId === "string" && value.currentUserMessageId.length > 0 &&
    typeof value.assistantMessageId === "string" && value.assistantMessageId.length > 0 &&
    isProtocolHash(value.transcriptManifestHash) &&
    isProtocolHash(value.providerOutputSnapshotHash) &&
    typeof value.terminalFunctionCalls === "boolean" &&
    typeof value.issuedAt === "number" && Number.isSafeInteger(value.issuedAt) &&
    typeof value.exp === "number" && Number.isSafeInteger(value.exp) &&
    value.exp > value.issuedAt;
}

function isCompactionReceipt(value: unknown): value is AgentCompactionReceipt {
  return isRecord(value) &&
    unknownKeys(value, [
      "sourceStartMessageId",
      "sourceEndMessageId",
      "sourceMessageCount",
      "sourceMessageIdsHash",
      "retainedTailCount",
      "retainedTailHash",
      "sourceInputHash",
      "sourceManifest",
      "retainedTailManifest",
      "transcriptRangeHash",
      "contextMarkerHashes",
      "contextMarkerManifest",
      "previousTranscriptManifestHash",
      "previousSummaryHash",
      "previousSummaryRevisionId",
      "promptContractVersion",
      "receiptVersion",
      "summaryHash",
      "summaryRevisionId",
      "leaseId",
      "agentTurnId",
      "sequence",
      "expiresAt"
    ]).length === 0 &&
    typeof value.sourceStartMessageId === "string" &&
    typeof value.sourceEndMessageId === "string" &&
    typeof value.sourceMessageCount === "number" &&
    Number.isSafeInteger(value.sourceMessageCount) &&
    value.sourceMessageCount >= 2 &&
    isProtocolHash(value.sourceMessageIdsHash) &&
    typeof value.retainedTailCount === "number" &&
    Number.isSafeInteger(value.retainedTailCount) &&
    value.retainedTailCount >= 0 &&
    isProtocolHash(value.retainedTailHash) &&
    isProtocolHash(value.sourceInputHash) &&
    isAgentTranscriptManifest(value.sourceManifest) &&
    isAgentTranscriptManifest(value.retainedTailManifest) &&
    isProtocolHash(value.transcriptRangeHash) &&
    Array.isArray(value.contextMarkerHashes) &&
    value.contextMarkerHashes.every(isProtocolHash) &&
    new Set(value.contextMarkerHashes).size === value.contextMarkerHashes.length &&
    Array.isArray(value.contextMarkerManifest) &&
    value.contextMarkerManifest.every(isContextMarkerManifestItem) &&
    (value.previousTranscriptManifestHash === undefined || isProtocolHash(value.previousTranscriptManifestHash)) &&
    (value.previousSummaryHash === undefined || isProtocolHash(value.previousSummaryHash)) &&
    (value.previousSummaryRevisionId === undefined || typeof value.previousSummaryRevisionId === "string") &&
    typeof value.promptContractVersion === "string" &&
    isProtocolHash(value.summaryHash) &&
    typeof value.summaryRevisionId === "string" &&
    typeof value.leaseId === "string" &&
    typeof value.agentTurnId === "string" &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.expiresAt === "number" &&
    Number.isSafeInteger(value.expiresAt) &&
    value.receiptVersion === AGENT_COMPACTION_RECEIPT_VERSION;
}

function isTranscriptSnapshotClaims(value: unknown): value is AgentTranscriptSnapshotClaims {
  return isRecord(value) &&
    unknownKeys(value, [
      "v",
      "projectId",
      "userId",
      "transcriptManifest",
      "contextMarkerHashes",
      "contextMarkerManifest",
      "previousSummaryHash",
      "previousSummaryRevisionId",
      "issuedAt",
      "exp",
      "refreshUntil"
    ]).length === 0 &&
    (value.v === AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION ||
      value.v === LEGACY_TRANSCRIPT_SNAPSHOT_TOKEN_VERSION ||
      value.v === LEGACY_CONTINUATION_SNAPSHOT_VERSION) &&
    typeof value.projectId === "string" &&
    (value.userId === undefined || (typeof value.userId === "string" && value.userId.length > 0)) &&
    isAgentTranscriptManifest(value.transcriptManifest) &&
    Array.isArray(value.contextMarkerHashes) &&
    value.contextMarkerHashes.every(isProtocolHash) &&
    new Set(value.contextMarkerHashes).size === value.contextMarkerHashes.length &&
    (value.contextMarkerManifest === undefined || (
      Array.isArray(value.contextMarkerManifest) &&
      value.contextMarkerManifest.every(isContextMarkerManifestItem) &&
      markerManifestHashesMatch(value.contextMarkerManifest, value.contextMarkerHashes)
    )) &&
    (value.previousSummaryHash === undefined || isProtocolHash(value.previousSummaryHash)) &&
    (value.previousSummaryRevisionId === undefined || typeof value.previousSummaryRevisionId === "string") &&
    (value.previousSummaryHash === undefined) === (value.previousSummaryRevisionId === undefined) &&
    (value.issuedAt === undefined || (typeof value.issuedAt === "number" && Number.isSafeInteger(value.issuedAt))) &&
    typeof value.exp === "number" &&
    Number.isSafeInteger(value.exp) &&
    (value.refreshUntil === undefined ||
      (typeof value.refreshUntil === "number" && Number.isSafeInteger(value.refreshUntil) && value.refreshUntil >= value.exp)) &&
    (value.v === AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION
      ? value.userId !== undefined && value.contextMarkerManifest !== undefined &&
        value.issuedAt !== undefined && value.refreshUntil !== undefined
      : value.userId === undefined && value.contextMarkerManifest === undefined &&
        (value.v === LEGACY_TRANSCRIPT_SNAPSHOT_TOKEN_VERSION
          ? value.issuedAt !== undefined && value.refreshUntil !== undefined
          : value.issuedAt === undefined && value.refreshUntil === undefined));
}

function isAgentTranscriptManifest(value: unknown): value is AgentTranscriptManifest {
  return isRecord(value) &&
    unknownKeys(value, ["itemCount", "items", "manifestHash"]).length === 0 &&
    typeof value.itemCount === "number" &&
    Number.isSafeInteger(value.itemCount) &&
    value.itemCount >= 0 &&
    Array.isArray(value.items) &&
    value.items.length === value.itemCount &&
    value.items.every(isAgentTranscriptManifestItem) &&
    isProtocolHash(value.manifestHash) && (
      hashManifest(value as unknown as AgentTranscriptManifest) === value.manifestHash ||
      hashLegacyManifest(value as unknown as AgentTranscriptManifest) === value.manifestHash
    );
}

function isCurrentAgentTranscriptManifest(value: AgentTranscriptManifest): boolean {
  return hashManifest(value) === value.manifestHash;
}

function isAgentTranscriptManifestItem(value: unknown): value is AgentTranscriptManifest["items"][number] {
  return isRecord(value) &&
    unknownKeys(value, ["kind", "hash", "role", "callId", "messageId", "anchorMessageId"]).length === 0 &&
    (value.kind === "message" || value.kind === "strategy" || value.kind === "providerOutput" ||
      value.kind === "functionCallOutput" || value.kind === "outcome") &&
    isProtocolHash(value.hash) &&
    (value.role === undefined || value.role === "user" || value.role === "assistant") &&
    (value.callId === undefined || (typeof value.callId === "string" && value.callId.length > 0)) &&
    (value.messageId === undefined || (typeof value.messageId === "string" && value.messageId.length > 0)) &&
    (value.anchorMessageId === undefined || (typeof value.anchorMessageId === "string" && value.anchorMessageId.length > 0));
}

function isContextMarkerManifestItem(value: unknown): boolean {
  return isRecord(value) &&
    unknownKeys(value, [
      "contentHash",
      "markerId",
      "sequence",
      "placement",
      "anchorMessageId",
      "causalBindingHash"
    ]).length === 0 &&
    isProtocolHash(value.contentHash) &&
    typeof value.markerId === "string" && value.markerId.length > 0 &&
    typeof value.sequence === "number" && Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
    (value.placement === "conversationBaseline" || value.placement === "beforeUser" ||
      value.placement === "afterUser" || value.placement === "beforeAssistant" ||
      value.placement === "afterAssistant") &&
    (value.anchorMessageId === undefined || (typeof value.anchorMessageId === "string" && value.anchorMessageId.length > 0)) &&
    (value.causalBindingHash === undefined || isProtocolHash(value.causalBindingHash));
}

function isProtocolHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function normalizeMarkerManifestForIssue(
  manifest: readonly AgentContextMarkerManifestItem[] | undefined,
  hashes: readonly string[] | undefined,
  label: string
): AgentContextMarkerManifestItem[] {
  const normalized = manifest ? manifest.map((item) => ({ ...item })) : [];
  if (normalized.some((item) => !isContextMarkerManifestItem(item)) ||
    new Set(normalized.map((item) => item.contentHash)).size !== normalized.length) {
    throw new Error(`${label} Context marker manifest 无效。`);
  }
  const normalizedHashes = normalized.map((item) => item.contentHash);
  if (hashes && (
    hashes.length !== normalizedHashes.length ||
    hashes.some((hash, index) => hash !== normalizedHashes[index])
  )) {
    throw new Error(`${label} Context marker hash 与有序 manifest 不一致。`);
  }
  return normalized;
}

function markerManifestHashesMatch(manifest: unknown[], hashes: unknown[]): boolean {
  return manifest.length === hashes.length && manifest.every((item, index) =>
    isRecord(item) && item.contentHash === hashes[index]
  );
}

function contextMarkerFollowsCompactedTail(marker: AgentContextMarkerManifestItem): boolean {
  return marker.causalBindingHash !== undefined ||
    marker.placement === "afterUser" ||
    marker.placement === "afterAssistant";
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

function failed(reason: AgentContinuationFailureReason): { status: "failed"; reason: AgentContinuationFailureReason } {
  return { status: "failed", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashManifest(manifest: AgentTranscriptManifest): string {
  return hashAgentProtocolValue(manifest.items, "morpho-agent-transcript-manifest-v3");
}

function hashLegacyManifest(manifest: AgentTranscriptManifest): string {
  return hashAgentProtocolValue(manifest.items, "morpho-agent-transcript-manifest-v2");
}

function sameUpgradeableManifest(
  previous: AgentTranscriptManifest,
  candidate: AgentTranscriptManifest
): boolean {
  return previous.items.length === candidate.items.length && previous.items.every((item, index) => {
    const next = candidate.items[index];
    return Boolean(next) && item.kind === next.kind && item.hash === next.hash &&
      item.role === next.role && item.callId === next.callId &&
      (item.messageId === undefined || item.messageId === next.messageId) &&
      (item.anchorMessageId === undefined || item.anchorMessageId === next.anchorMessageId);
  });
}

function sameManifestItem(
  left: AgentTranscriptManifest["items"][number],
  right: AgentTranscriptManifest["items"][number]
): boolean {
  return left.kind === right.kind &&
    left.hash === right.hash &&
    left.role === right.role &&
    left.callId === right.callId &&
    left.messageId === right.messageId &&
    left.anchorMessageId === right.anchorMessageId;
}

function sameManifestItems(
  left: readonly AgentTranscriptManifest["items"][number][],
  right: readonly AgentTranscriptManifest["items"][number][]
): boolean {
  return left.length === right.length && left.every((item, index) =>
    Boolean(right[index]) && sameManifestItem(item, right[index]!)
  );
}

function sameContextMarkerManifest(
  left: readonly import("@/shared/agentCompactionProtocol").AgentContextMarkerManifestItem[],
  right: readonly import("@/shared/agentCompactionProtocol").AgentContextMarkerManifestItem[]
): boolean {
  return left.length === right.length && left.every((item, index) =>
    hashAgentProtocolValue(item, "morpho-agent-context-marker-manifest-v1") ===
      hashAgentProtocolValue(right[index], "morpho-agent-context-marker-manifest-v1")
  );
}
