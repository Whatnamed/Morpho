import {
  parseConversationSummaryPayload,
  type ConversationCompactionPlan
} from "@/domain/morpho/conversationCompaction";
import type { WebSearchSource } from "@/server/ai/webSearch";
import { buildConversationSummaryAgentRequest } from "./conversationSummaryAgentRequest";
import { consumeAgentTurnStream } from "./agentStreamClient";
import { AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL } from "./agentTurnLimits";
import type { MorphoAgentTurnMode } from "./morphoAgent";
import type { AgentTurnState } from "./agentTurnState";
import { isRecord, readJsonPayload } from "./httpPayload";

export type AgentTurnLeaseOutcome =
  | "success"
  | "cancelledBeforeExecution"
  | "failedBeforeExecution"
  | "partialSuccess"
  | "pendingConfirmation";

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
    onLeaseStarted?: (leaseId: string) => void;
    onLeaseSequence?: (sequence: number) => void;
    onContinuationToken?: (token: string) => void;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{
  parsed: ReturnType<typeof parseConversationSummaryPayload>;
  leaseId?: string;
}> {
  const response = await fetchImpl("/api/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      buildConversationSummaryAgentRequest({
        plan,
        projectId: input.projectId,
        agentTurnId: input.agentTurnId,
        mode: input.mode,
        leaseId: input.leaseId,
        leaseSequence: input.leaseSequence,
        continuationToken: input.continuationToken
      })
    ),
    signal
  });
  let leaseId = input.leaseId;
  const result = await consumeAgentTurnStream(response, {
    signal,
    onEvent: (event) => {
      if (event.type === "turn-start" && event.leaseId) {
        leaseId = event.leaseId;
        input.onLeaseStarted?.(event.leaseId);
      }
      if (event.type === "turn-start" && event.nextProviderSequence !== undefined) {
        input.onLeaseSequence?.(event.nextProviderSequence);
      }
      if (event.type === "turn-complete" && event.continuationToken) {
        input.onContinuationToken?.(event.continuationToken);
      }
    }
  });
  return {
    parsed: parseConversationSummaryPayload(result.outputText),
    ...(leaseId ? { leaseId } : {})
  };
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
    const response = await fetchImpl("/api/ai/web-search", {
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

export async function closeAgentTurnLease(input: {
  state: AgentTurnState;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  fetch?: typeof fetch;
}): Promise<void> {
  if (!input.state.agentTurnLeaseId) {
    return;
  }
  const leaseId = input.state.agentTurnLeaseId;
  input.state.agentTurnLeaseId = undefined;
  await closeAgentTurnLeaseRequest({
    leaseId,
    agentTurnId: input.agentTurnId,
    outcome: input.outcome,
    fetch: input.fetch
  });
}

export async function closeAgentTurnLeaseRequest(input: {
  leaseId?: string;
  agentTurnId: string;
  outcome: AgentTurnLeaseOutcome;
  fetch?: typeof fetch;
}): Promise<void> {
  if (!input.leaseId) {
    return;
  }
  const fetchImpl = input.fetch ?? fetch;
  await fetchImpl("/api/ai/agent/lease", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaseId: input.leaseId,
      agentTurnId: input.agentTurnId,
      outcome: input.outcome
    })
  }).catch(() => undefined);
}
