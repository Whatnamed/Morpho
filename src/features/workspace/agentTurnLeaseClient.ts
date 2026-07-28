import {
  parseConversationSummaryPayload,
  type ConversationCompactionPlan
} from "@/domain/morpho/conversationCompaction";
import type { WebSearchSource } from "@/server/ai/webSearch";
import {
  buildAgentTranscriptManifest,
  parseAgentTranscriptMessageItem,
  parseAgentTurnOutcomeItem,
  AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION,
  type AgentCompactionReceipt,
  type AgentTranscriptManifest
} from "@/shared/agentCompactionProtocol";
import {
  buildConversationSummaryAgentRequest
} from "./conversationSummaryAgentRequest";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { consumeAgentTurnStream } from "./agentStreamClient";
import { AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL } from "./agentTurnLimits";
import type { MorphoAgentTurnMode } from "./morphoAgent";
import type { AgentTurnState } from "./agentTurnState";
import type { ProviderRequestBoundaryState } from "./providerContextFrames";
import { isRecord, readJsonPayload } from "./httpPayload";

export type AgentTurnLeaseOutcome =
  | "success"
  | "cancelledBeforeExecution"
  | "failedBeforeExecution"
  | "cancelledDuringProvider"
  | "failedDuringProvider"
  | "partialSuccess"
  | "pendingConfirmation";

export class AgentWebSearchRecoverableError extends Error {
  constructor(message = "网页检索连接中断，本次检索未重放；将把失败结果交给 Agent 选择新的检索角度。") {
    super(message);
    this.name = "AgentWebSearchRecoverableError";
  }
}

export class AgentWebSearchLeaseRecoveryError extends Error {
  constructor(message = "网页检索连接中断且 Lease 状态恢复失败，本轮已安全终止。") {
    super(message);
    this.name = "AgentWebSearchLeaseRecoveryError";
  }
}

export async function prepareAgentDurableCheckpoint(input: {
  projectId: string;
  requestState?: ProviderRequestBoundaryState;
  legacyTranscriptManifest?: AgentTranscriptManifest;
  signal: AbortSignal;
  fetch?: typeof fetch;
  now?: number;
}): Promise<ProviderRequestBoundaryState | undefined> {
  const state = input.requestState;
  const token = state?.transcriptSnapshotToken;
  if (!state || !token) {
    return state;
  }
  const requirement = readSnapshotRefreshRequirement(token, input.now ?? Date.now());
  if (requirement === "none") {
    return state;
  }
  const refreshed = await refreshTranscriptSnapshot({
    projectId: input.projectId,
    token,
    ...(requirement === "legacy" && input.legacyTranscriptManifest
      ? { transcriptManifest: input.legacyTranscriptManifest }
      : {}),
    signal: input.signal,
    fetch: input.fetch ?? fetch
  });
  return {
    ...state,
    transcriptSnapshotToken: refreshed.token,
    transcriptManifestHash: refreshed.manifestHash,
    transcriptSnapshotExpiresAt: refreshed.expiresAt
  };
}

export async function requestConversationSummary(
  plan: ConversationCompactionPlan,
  signal: AbortSignal,
  input: {
    projectId: string;
    agentTurnId: string;
    mode: MorphoAgentTurnMode;
    leaseId?: string;
    leaseSequence?: number;
    continuationToken?: string;
    retainedTailItems?: readonly unknown[];
    contextMarkers?: readonly import("@/shared/agentCompactionProtocol").AgentContextStateMarker[];
    previousTranscriptManifestHash?: string;
    previousTranscriptSnapshotToken?: string;
    freshUserMessageId?: string;
    onTranscriptSnapshotRefreshed?: (token: string, manifestHash: string) => void;
    onLeaseStarted?: (leaseId: string) => void;
    onLeaseSequence?: (sequence: number) => void;
    onContinuationToken?: (token: string) => void;
    onCompactionReceipt?: (receipt: AgentCompactionReceipt) => void;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{
  parsed: ReturnType<typeof parseConversationSummaryPayload>;
  leaseId?: string;
  leaseSequence?: number;
  continuationToken?: string;
  compactionReceipt?: AgentCompactionReceipt;
}> {
  let previousTranscriptSnapshotToken = input.previousTranscriptSnapshotToken;
  let summaryRequest = buildConversationSummaryAgentRequest({
    plan,
    projectId: input.projectId,
    agentTurnId: input.agentTurnId,
    mode: input.mode,
    leaseId: input.leaseId,
    leaseSequence: input.leaseSequence,
    continuationToken: input.continuationToken,
    retainedTailItems: input.retainedTailItems,
    contextMarkers: input.contextMarkers,
    previousTranscriptManifestHash: input.previousTranscriptManifestHash,
    previousTranscriptSnapshotToken,
    currentUserMessageId: input.freshUserMessageId
  });
  if (previousTranscriptSnapshotToken && !input.continuationToken) {
    const refreshRequirement = readSnapshotRefreshRequirement(previousTranscriptSnapshotToken, Date.now());
    const legacyManifest = refreshRequirement === "legacy"
      ? buildAgentTranscriptManifest([
          ...summaryRequest.input,
          ...(summaryRequest.compactionRetainedTail ?? []).filter((item) =>
            parseAgentTranscriptMessageItem(item)?.messageId !== input.freshUserMessageId
          )
        ])
      : undefined;
    const prepared = await prepareAgentDurableCheckpoint({
      projectId: input.projectId,
      requestState: {
        promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
        transcriptSnapshotToken: previousTranscriptSnapshotToken,
        ...(input.previousTranscriptManifestHash
          ? { transcriptManifestHash: input.previousTranscriptManifestHash }
          : {})
      },
      ...(legacyManifest ? { legacyTranscriptManifest: legacyManifest } : {}),
      signal,
      fetch: fetchImpl
    });
    if (prepared?.transcriptSnapshotToken !== previousTranscriptSnapshotToken) {
      previousTranscriptSnapshotToken = prepared?.transcriptSnapshotToken;
      if (previousTranscriptSnapshotToken && prepared?.transcriptManifestHash) {
        input.onTranscriptSnapshotRefreshed?.(
          previousTranscriptSnapshotToken,
          prepared.transcriptManifestHash
        );
        summaryRequest = { ...summaryRequest, previousTranscriptSnapshotToken };
      }
    }
  }
  const response = await fetchImpl("/api/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summaryRequest),
    signal
  });
  let leaseId = input.leaseId;
  let leaseSequence = input.leaseSequence;
  let summaryContinuationToken = input.continuationToken;
  let compactionReceipt: AgentCompactionReceipt | undefined;
  const result = await consumeAgentTurnStream(response, {
    signal,
    onEvent: (event) => {
      if (event.type === "turn-start" && event.leaseId) {
        leaseId = event.leaseId;
        input.onLeaseStarted?.(event.leaseId);
      }
      if (event.type === "turn-start" && event.nextProviderSequence !== undefined) {
        leaseSequence = event.nextProviderSequence;
        input.onLeaseSequence?.(event.nextProviderSequence);
      }
      if (event.type === "turn-complete" && event.continuationToken) {
        summaryContinuationToken = event.continuationToken;
        input.onContinuationToken?.(event.continuationToken);
      }
      if (event.type === "turn-complete" && event.compactionReceipt) {
        compactionReceipt = event.compactionReceipt;
        input.onCompactionReceipt?.(event.compactionReceipt);
      }
    }
  });
  return {
    parsed: parseConversationSummaryPayload(result.outputText),
    ...(compactionReceipt ? { compactionReceipt } : {}),
    ...(leaseSequence !== undefined ? { leaseSequence } : {}),
    ...(summaryContinuationToken ? { continuationToken: summaryContinuationToken } : {}),
    ...(leaseId ? { leaseId } : {})
  };
}

export async function closeAgentConversationSummaryLeaseRequest(input: {
  leaseId: string;
  agentTurnId: string;
  leaseSequence: number;
  continuationToken: string;
  closureRequestId: string;
  fetch?: typeof fetch;
}): Promise<void> {
  const requestBody = JSON.stringify({
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    leaseSequence: input.leaseSequence,
    continuationToken: input.continuationToken,
    closureRequestId: input.closureRequestId
  });
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await (input.fetch ?? fetch)("/api/ai/agent/lease/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) {
    throw lastError instanceof Error ? lastError : new Error("Summary Closure 网络恢复失败。");
  }
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload) || payload.status !== "success") {
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      "Summary Closure 未被服务端确认。"
    );
  }
}

async function refreshTranscriptSnapshot(input: {
  projectId: string;
  token: string;
  transcriptManifest?: AgentTranscriptManifest;
  signal: AbortSignal;
  fetch: typeof fetch;
}): Promise<{ token: string; manifestHash: string; expiresAt: number }> {
  const response = await input.fetch("/api/ai/agent/snapshot/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      token: input.token,
      ...(input.transcriptManifest ? { transcriptManifest: input.transcriptManifest } : {})
    }),
    signal: input.signal
  });
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload) ||
    typeof payload.transcriptSnapshotToken !== "string" ||
    typeof payload.transcriptManifestHash !== "string" ||
    typeof payload.expiresAt !== "number") {
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      "Transcript Snapshot 刷新失败，未消耗 Agent Lease。"
    );
  }
  return {
    token: payload.transcriptSnapshotToken,
    manifestHash: payload.transcriptManifestHash,
    expiresAt: payload.expiresAt
  };
}

function readSnapshotRefreshRequirement(
  token: string,
  now: number
): "none" | "current" | "legacy" {
  try {
    const payload = token.split(".")[0];
    if (!payload) {
      return "legacy";
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(globalThis.atob(padded));
    if (!isRecord(parsed) || parsed.v !== AGENT_TRANSCRIPT_SNAPSHOT_PROTOCOL_VERSION ||
      typeof parsed.exp !== "number") {
      return "legacy";
    }
    return parsed.exp > now ? "none" : "current";
  } catch {
    return "legacy";
  }
}

export async function requestAgentWebSearch(input: {
  queries: string[];
  agentTurnId: string;
  signal: AbortSignal;
  state: AgentTurnState;
  fetch?: typeof fetch;
}): Promise<{
  sources: WebSearchSource[];
  failedSourceCount?: number;
  timedOutSourceCount?: number;
}> {
  const fetchImpl = input.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl("/api/ai/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: input.queries,
          maxSources: AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL,
          agentTurnId: input.agentTurnId,
          agentContinuation: true,
          leaseId: input.state.agentTurnLeaseId,
          leaseSequence: input.state.nextAgentLeaseSequence
        }),
        signal: input.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (input.state.webSearchLeaseStateRecoveryUsed) {
        throw new AgentWebSearchLeaseRecoveryError();
      }
      input.state.webSearchLeaseStateRecoveryUsed = true;
      try {
        await recoverAgentWebSearchLeaseState({
          agentTurnId: input.agentTurnId,
          state: input.state,
          signal: input.signal,
          fetch: fetchImpl
        });
      } catch {
        throw new AgentWebSearchLeaseRecoveryError();
      }
      throw new AgentWebSearchRecoverableError();
    }
    const payload = await readJsonPayload(response);
    // A lease sequence is consumed before search starts, including failed searches.
    if (isRecord(payload) && typeof payload.nextProviderSequence === "number") {
      input.state.nextAgentLeaseSequence = payload.nextProviderSequence;
    }
    if (response.ok && isRecord(payload) && Array.isArray(payload.sources)) {
      return payload as unknown as {
        sources: WebSearchSource[];
        failedSourceCount?: number;
        timedOutSourceCount?: number;
      };
    }
    const canResync =
      !input.state.webSearchSequenceResyncUsed &&
      isRecord(payload) &&
      payload.reason === "sequence_replay" &&
      typeof payload.nextProviderSequence === "number";
    if (attempt === 0 && canResync) {
      input.state.webSearchSequenceResyncUsed = true;
      continue;
    }
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
        response.statusText ||
        "网页检索失败。"
    );
  }
  throw new Error("网页检索未能完成。");
}

async function recoverAgentWebSearchLeaseState(input: {
  agentTurnId: string;
  state: AgentTurnState;
  signal: AbortSignal;
  fetch: typeof fetch;
}): Promise<void> {
  if (!input.state.agentTurnLeaseId) {
    throw new Error("missing lease");
  }
  const response = await input.fetch("/api/ai/agent/lease/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaseId: input.state.agentTurnLeaseId,
      agentTurnId: input.agentTurnId
    }),
    signal: input.signal
  });
  const payload = await readJsonPayload(response);
  if (
    !response.ok ||
    !isRecord(payload) ||
    payload.active !== true ||
    typeof payload.nextProviderSequence !== "number" ||
    !Number.isSafeInteger(payload.nextProviderSequence) ||
    payload.nextProviderSequence < 1
  ) {
    throw new Error("lease state unavailable");
  }
  input.state.nextAgentLeaseSequence = payload.nextProviderSequence;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function closeAgentTurnLease(input: {
  state: AgentTurnState;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  snapshot?: {
    projectId: string;
    userMessageId: string;
    assistantMessageId: string;
    transcriptSnapshotToken: string;
    transcriptManifestHash: string;
    closureToken: string;
    providerOutputSnapshot: import("@/domain/morpho/types").ProviderOutputSnapshot;
  };
  fetch?: typeof fetch;
}): Promise<AgentTurnOutcomeSnapshotResult | undefined> {
  if (!input.state.agentTurnLeaseId) {
    return;
  }
  const leaseId = input.state.agentTurnLeaseId;
  const proofRequired = input.outcome === "success" ||
    input.outcome === "partialSuccess" ||
    input.outcome === "pendingConfirmation";
  if (proofRequired && (!input.snapshot || !input.state.turnClosureToken)) {
    throw new Error("Agent Turn Closure 缺少服务端签名 Proof，Lease 保持待恢复状态。");
  }
  const providerFailure = input.outcome === "cancelledDuringProvider" ||
    input.outcome === "failedDuringProvider";
  if (providerFailure && input.state.nextAgentLeaseSequence === undefined) {
    throw new Error("Provider 失败终态缺少 Lease sequence，Lease 保持待恢复状态。");
  }
  const closureRequestId = input.state.closureRequestId ?? createClosureRequestId(input.agentTurnId);
  input.state.closureRequestId = closureRequestId;
  const requestInput = {
    leaseId,
    agentTurnId: input.agentTurnId,
    outcome: input.outcome,
    closureRequestId,
    ...(providerFailure ? { leaseSequence: input.state.nextAgentLeaseSequence } : {}),
    snapshot: input.snapshot,
    fetch: input.fetch
  };
  const requestBody = serializeAgentTurnClosureRequest(requestInput);
  input.state.closureRequestBody = requestBody;
  const result = await closeAgentTurnLeaseRequest({ ...requestInput, requestBody });
  input.state.agentTurnLeaseId = undefined;
  input.state.turnClosureToken = undefined;
  input.state.closureRequestId = undefined;
  input.state.closureRequestBody = undefined;
  return result;
}

export async function finalizePendingAgentTurnClosureProof(input: {
  state: AgentTurnState;
  agentTurnId: string;
  projectId: string;
  userMessageId: string;
  assistantMessageId: string;
  continuationInput: readonly unknown[];
  fetch?: typeof fetch;
}): Promise<void> {
  const leaseId = input.state.agentTurnLeaseId;
  const leaseSequence = input.state.nextAgentLeaseSequence;
  const closureToken = input.state.turnClosureToken;
  const continuationToken = input.state.agentContinuationToken;
  const requestState = input.state.latestProviderRequestState;
  const providerOutputSnapshot = input.state.latestAssistantProviderOutputSnapshot;
  if (!leaseId || leaseSequence === undefined || !closureToken || !continuationToken ||
    !requestState?.transcriptSnapshotToken || !requestState.transcriptManifestHash ||
    !providerOutputSnapshot) {
    throw new Error("Pending Closure 缺少服务端签名的 Provider/Transcript 证明，Lease 保持待恢复状态。");
  }
  const response = await (input.fetch ?? fetch)("/api/ai/agent/lease/finalize-function-calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaseId,
      agentTurnId: input.agentTurnId,
      leaseSequence,
      closureToken,
      continuationToken,
      continuationInput: input.continuationInput,
      projectId: input.projectId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      transcriptSnapshotToken: requestState.transcriptSnapshotToken,
      transcriptManifestHash: requestState.transcriptManifestHash,
      providerOutputSnapshot
    })
  });
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload) || payload.status !== "pendingConfirmation" ||
    typeof payload.closureToken !== "string") {
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      "Pending Closure Proof 无法建立，Lease 保持待恢复状态。"
    );
  }
  input.state.turnClosureToken = payload.closureToken;
}

export async function markAgentTurnToolExecutionStarted(input: {
  state: AgentTurnState;
  agentTurnId: string;
  fetch?: typeof fetch;
}): Promise<void> {
  if (!input.state.agentTurnLeaseId) {
    throw new Error("Agent Tool 执行缺少活动 Lease，已停止执行。");
  }
  const response = await (input.fetch ?? fetch)("/api/ai/agent/lease/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaseId: input.state.agentTurnLeaseId,
      agentTurnId: input.agentTurnId
    })
  });
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload) || payload.status !== "marked") {
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      "Agent Tool 执行状态无法建立，已停止执行。"
    );
  }
}

export type AgentTurnOutcomeSnapshotResult = {
  outcomeItem: import("@/shared/agentCompactionProtocol").AgentTurnOutcomeItem;
  transcriptSnapshotToken: string;
  transcriptManifestHash: string;
  expiresAt: number;
};

export async function closeAgentTurnLeaseRequest(input: {
  leaseId?: string;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  closureRequestId?: string;
  leaseSequence?: number;
  snapshot?: {
    projectId: string;
    userMessageId: string;
    assistantMessageId: string;
    transcriptSnapshotToken: string;
    transcriptManifestHash: string;
    closureToken: string;
    providerOutputSnapshot: import("@/domain/morpho/types").ProviderOutputSnapshot;
  };
  /** Internal exact-replay override used only by persisted Closure recovery. */
  requestBody?: string;
  expectsOutcomeSnapshot?: boolean;
  fetch?: typeof fetch;
}): Promise<AgentTurnOutcomeSnapshotResult | undefined> {
  if (!input.leaseId) {
    return;
  }
  const fetchImpl = input.fetch ?? fetch;
  const closureRequestId = input.closureRequestId ?? createClosureRequestId(input.agentTurnId);
  const requestBody = input.requestBody ?? serializeAgentTurnClosureRequest({
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    outcome: input.outcome,
    closureRequestId,
    ...(input.leaseSequence !== undefined ? { leaseSequence: input.leaseSequence } : {}),
    ...(input.snapshot ?? {})
  });
  let response: Response | undefined;
  let networkError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl("/api/ai/agent/lease", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody
      });
      break;
    } catch (error) {
      networkError = error;
    }
  }
  if (!response) {
    throw networkError instanceof Error
      ? networkError
      : new Error("Agent Turn Closure 网络恢复失败，Lease 保持待恢复状态。");
  }
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload)) {
    throw new Error(
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      "Agent Turn Closure 失败，Lease 保持待恢复状态。"
    );
  }
  if (!(input.expectsOutcomeSnapshot ?? Boolean(input.snapshot))) {
    return undefined;
  }
  const outcomeItem = parseAgentTurnOutcomeItem(payload.outcomeItem);
  if (!outcomeItem || typeof payload.transcriptSnapshotToken !== "string" ||
    typeof payload.transcriptManifestHash !== "string" ||
    typeof payload.expiresAt !== "number") {
    throw new Error("Agent Turn Closure 响应缺少签名 Outcome，Lease 保持待恢复状态。");
  }
  return {
    outcomeItem,
    transcriptSnapshotToken: payload.transcriptSnapshotToken,
    transcriptManifestHash: payload.transcriptManifestHash,
    expiresAt: payload.expiresAt
  };
}

export async function recoverAgentTurnClosureRequest(input: {
  requestBody: string;
  fetch?: typeof fetch;
}): Promise<AgentTurnOutcomeSnapshotResult | undefined> {
  if (input.requestBody.length < 2 || input.requestBody.length > 2_000_000) {
    throw new Error("Agent Turn Closure 恢复请求无效。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.requestBody);
  } catch {
    throw new Error("Agent Turn Closure 恢复请求无效。");
  }
  if (!isRecord(parsed) || typeof parsed.leaseId !== "string" ||
    typeof parsed.agentTurnId !== "string" || typeof parsed.closureRequestId !== "string" ||
    !isAgentTurnLeaseOutcome(parsed.outcome)) {
    throw new Error("Agent Turn Closure 恢复请求无效。");
  }
  const proofOutcome = parsed.outcome === "success" || parsed.outcome === "partialSuccess" ||
    parsed.outcome === "pendingConfirmation";
  return closeAgentTurnLeaseRequest({
    leaseId: parsed.leaseId,
    agentTurnId: parsed.agentTurnId,
    outcome: parsed.outcome,
    closureRequestId: parsed.closureRequestId,
    requestBody: input.requestBody,
    expectsOutcomeSnapshot: proofOutcome,
    fetch: input.fetch
  });
}

function serializeAgentTurnClosureRequest(input: {
  leaseId: string;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  closureRequestId: string;
  leaseSequence?: number;
  snapshot?: {
    projectId: string;
    userMessageId: string;
    assistantMessageId: string;
    transcriptSnapshotToken: string;
    transcriptManifestHash: string;
    closureToken: string;
    providerOutputSnapshot: import("@/domain/morpho/types").ProviderOutputSnapshot;
  };
}): string {
  return JSON.stringify({
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    outcome: input.outcome,
    closureRequestId: input.closureRequestId,
    ...(input.leaseSequence !== undefined ? { leaseSequence: input.leaseSequence } : {}),
    ...(input.snapshot ?? {})
  });
}

function isAgentTurnLeaseOutcome(value: unknown): value is AgentTurnLeaseOutcome {
  return value === "success" || value === "cancelledBeforeExecution" ||
    value === "failedBeforeExecution" || value === "cancelledDuringProvider" ||
    value === "failedDuringProvider" || value === "partialSuccess" ||
    value === "pendingConfirmation";
}

function createClosureRequestId(agentTurnId: string): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    Math.random().toString(36).slice(2);
  return `closure-${agentTurnId}-${random}`.slice(0, 160);
}
