import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE,
  AGENT_CONTEXT_STATE_MARKER_TYPE,
  AGENT_COMPACTION_RECEIPT_VERSION,
  buildAgentContextMarkerManifest,
  buildAgentTranscriptManifest,
  hashAgentContextStateMarker,
  hashAgentContextStateMarkerCausalBinding,
  hashAgentProviderItems,
  hashAgentProtocolValue,
  hashAgentTranscriptRange,
  hashCompactionTail,
  hashConversationSummaryForReceipt,
  parseAgentCompactionSourceEnvelope,
  type AgentTranscriptManifest,
  type AgentContextStateMarker,
  type AgentCompactionReceipt,
  type AgentCompactionTranscriptMarker
} from "@/shared/agentCompactionProtocol";
import { MAX_AGENT_FUNCTION_CALLS } from "@/shared/agentFunctionCallLimits";

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

const CONTINUATION_TOKEN_VERSION = 4;
const TRANSCRIPT_SNAPSHOT_TOKEN_VERSION = 2;
export const AGENT_CONTINUATION_TOKEN_TTL_MS = 20 * 60 * 1000;
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
  | "context_marker_forged";

export type AgentTranscriptSnapshotClaims = {
  v: number;
  projectId: string;
  transcriptManifest: AgentTranscriptManifest;
  contextMarkerHashes: string[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  issuedAt?: number;
  exp: number;
  refreshUntil?: number;
};

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
  const prefixContextMarkerHashes = [...new Set(input.prefixContextMarkerHashes ?? [])];
  const appendableContextMarkerHashes = [...new Set(input.appendableContextMarkerHashes ?? [])];
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
    compactionContextMarkerHashes: [...new Set(input.compactionContextMarkerHashes ?? [])],
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
  transcriptManifest: AgentTranscriptManifest;
  contextMarkerHashes?: readonly string[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  now: number;
}): string {
  const claims: AgentTranscriptSnapshotClaims = {
    v: TRANSCRIPT_SNAPSHOT_TOKEN_VERSION,
    projectId: input.projectId,
    transcriptManifest: input.transcriptManifest,
    contextMarkerHashes: [...new Set(input.contextMarkerHashes ?? [])],
    ...(input.previousSummaryHash ? { previousSummaryHash: input.previousSummaryHash } : {}),
    ...(input.previousSummaryRevisionId ? { previousSummaryRevisionId: input.previousSummaryRevisionId } : {}),
    issuedAt: input.now,
    exp: input.now + AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS,
    refreshUntil: input.now + AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS
  };
  const payload = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyAgentTranscriptSnapshotToken(input: {
  token: string | undefined;
  secret: string | undefined;
  projectId: string;
  now: number;
}): { status: "ok"; claims: AgentTranscriptSnapshotClaims } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const decoded = decodeAgentTranscriptSnapshotToken(input);
  if (decoded.status === "failed") {
    return decoded;
  }
  const parsed = decoded.claims;
  if (parsed.projectId !== input.projectId) {
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
  now: number;
  transcriptManifest?: AgentTranscriptManifest;
}): { status: "ok"; token: string; claims: AgentTranscriptSnapshotClaims } |
  { status: "failed"; reason: AgentContinuationFailureReason } {
  const decoded = decodeAgentTranscriptSnapshotToken(input);
  if (decoded.status === "failed") {
    return decoded;
  }
  const claims = decoded.claims;
  if (claims.projectId !== input.projectId) {
    return failed("compaction_source_forged");
  }
  const refreshUntil = claims.refreshUntil ?? claims.exp + AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS;
  if (refreshUntil <= input.now || !input.secret) {
    return failed("compaction_source_unverified");
  }
  const transcriptManifest = input.transcriptManifest ?? claims.transcriptManifest;
  if (input.transcriptManifest && (
    !isAgentTranscriptManifest(input.transcriptManifest) ||
    !isCurrentAgentTranscriptManifest(input.transcriptManifest) ||
    !sameUpgradeableManifest(claims.transcriptManifest, input.transcriptManifest)
  )) {
    return failed("compaction_source_forged");
  }
  const refreshedClaims: AgentTranscriptSnapshotClaims = {
    v: TRANSCRIPT_SNAPSHOT_TOKEN_VERSION,
    projectId: claims.projectId,
    transcriptManifest,
    contextMarkerHashes: claims.contextMarkerHashes,
    ...(claims.previousSummaryHash && claims.previousSummaryRevisionId
      ? {
          previousSummaryHash: claims.previousSummaryHash,
          previousSummaryRevisionId: claims.previousSummaryRevisionId
        }
      : {}),
    issuedAt: input.now,
    exp: input.now + AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS,
    refreshUntil: input.now + AGENT_TRANSCRIPT_SNAPSHOT_REFRESH_TTL_MS
  };
  return {
    status: "ok",
    token: issueAgentTranscriptSnapshotToken({
      secret: input.secret,
      projectId: claims.projectId,
      transcriptManifest,
      contextMarkerHashes: claims.contextMarkerHashes,
      ...(claims.previousSummaryHash && claims.previousSummaryRevisionId
        ? {
            previousSummaryHash: claims.previousSummaryHash,
            previousSummaryRevisionId: claims.previousSummaryRevisionId
          }
        : {}),
      now: input.now
    }),
    claims: refreshedClaims
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
    .map((marker) => marker.contentHash);
  if (
    prefixMarkerHashes.length !== claims.prefixContextMarkerHashes.length ||
    prefixMarkerHashes.some((hash) => !claims.prefixContextMarkerHashes.includes(hash))
  ) {
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
  for (const item of tail.slice(outputEnd)) {
    if (isProviderOutputItem(item)) {
      return failed("output_forged");
    }
    if (isContextStateMarker(item)) {
      const replayedPrefixMarker = claims.prefixContextMarkerHashes.includes(item.contentHash);
      const appendable = claims.appendableContextMarkerHashes.includes(item.contentHash);
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
        (!causallyBound && (item.causalBindingHash !== undefined || !appendable)) ||
        seenContextMarkerHashes.has(item.contentHash)
      ) {
        return failed("context_marker_forged");
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
  if (
    markerIndex < 0 ||
    markerIndex !== input.parsedInput.length - 1 ||
    input.parsedInput.some((item, index) => index !== markerIndex && !isContextStateMarker(item))
  ) {
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
    parsedContextMarkers.some((contextMarker) => contextMarker.causalBindingHash !== undefined) ||
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
  const allowedMarkerHashes = new Set([
    ...input.claims.compactionContextMarkerHashes
  ]);
  for (const marker of input.contextMarkers) {
    if (allowedMarkerHashes.has(marker.contentHash)) {
      continue;
    }
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
    (value.previousSummaryHash === undefined || isProtocolHash(value.previousSummaryHash)) &&
    (value.previousSummaryRevisionId === undefined || typeof value.previousSummaryRevisionId === "string") &&
    (value.previousSummaryHash === undefined) === (value.previousSummaryRevisionId === undefined) &&
    typeof value.exp === "number" &&
    (value.summary
      ? isCompactionReceipt(value.compactionReceipt)
      : value.compactionReceipt === undefined);
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
      "transcriptManifest",
      "contextMarkerHashes",
      "previousSummaryHash",
      "previousSummaryRevisionId",
      "issuedAt",
      "exp",
      "refreshUntil"
    ]).length === 0 &&
    (value.v === TRANSCRIPT_SNAPSHOT_TOKEN_VERSION || value.v === CONTINUATION_TOKEN_VERSION) &&
    typeof value.projectId === "string" &&
    isAgentTranscriptManifest(value.transcriptManifest) &&
    Array.isArray(value.contextMarkerHashes) &&
    value.contextMarkerHashes.every(isProtocolHash) &&
    new Set(value.contextMarkerHashes).size === value.contextMarkerHashes.length &&
    (value.previousSummaryHash === undefined || isProtocolHash(value.previousSummaryHash)) &&
    (value.previousSummaryRevisionId === undefined || typeof value.previousSummaryRevisionId === "string") &&
    (value.previousSummaryHash === undefined) === (value.previousSummaryRevisionId === undefined) &&
    (value.issuedAt === undefined || (typeof value.issuedAt === "number" && Number.isSafeInteger(value.issuedAt))) &&
    typeof value.exp === "number" &&
    Number.isSafeInteger(value.exp) &&
    (value.refreshUntil === undefined ||
      (typeof value.refreshUntil === "number" && Number.isSafeInteger(value.refreshUntil) && value.refreshUntil > value.exp)) &&
    (value.v === TRANSCRIPT_SNAPSHOT_TOKEN_VERSION
      ? value.issuedAt !== undefined && value.refreshUntil !== undefined
      : value.issuedAt === undefined && value.refreshUntil === undefined);
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
    (value.kind === "message" || value.kind === "strategy" || value.kind === "providerOutput" || value.kind === "functionCallOutput") &&
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

function sameContextMarkerManifest(
  left: readonly import("@/shared/agentCompactionProtocol").AgentContextMarkerManifestItem[],
  right: readonly import("@/shared/agentCompactionProtocol").AgentContextMarkerManifestItem[]
): boolean {
  return left.length === right.length && left.every((item, index) =>
    hashAgentProtocolValue(item, "morpho-agent-context-marker-manifest-v1") ===
      hashAgentProtocolValue(right[index], "morpho-agent-context-marker-manifest-v1")
  );
}
