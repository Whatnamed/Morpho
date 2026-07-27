import {
  parseConversationSummaryPayload,
  type ConversationCompactionPlan
} from "@/domain/morpho/conversationCompaction";
import type { WebSearchSource } from "@/server/ai/webSearch";
import {
  buildConversationSummaryAgentRequest
} from "./conversationSummaryAgentRequest";
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
        continuationToken: input.continuationToken,
        retainedTailItems: input.retainedTailItems
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
