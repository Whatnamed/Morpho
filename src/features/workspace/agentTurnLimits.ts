import type { ProviderCitation } from "@/server/ai/types";
import type { WebSearchSource } from "@/server/ai/webSearch";
import {
  getAgentToolEffect,
  type MorphoAgentToolArguments
} from "./morphoAgent";
import { buildToolResultOutput } from "./morphoAgent";
import type { ResponseFunctionToolOutput } from "@/server/ai/openaiCompatibleProvider";
import { assertAgentFunctionCallCount } from "@/shared/agentFunctionCallLimits";
import { normalizeSafeExternalNavigationUrl } from "@/shared/externalNavigationPolicy";

export const AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL = 5;
export const AGENT_TURN_EMERGENCY_MODEL_TURN_CEILING = 28;
export const AGENT_TURN_EMERGENCY_DURATION_MS = 18 * 60 * 1000;
export const AGENT_TURN_REPEAT_TOOL_CALL_LIMIT = 3;

export function assertAgentTurnActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function normalizeAgentTurnErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  const looksLikeAuthError =
    normalized.includes("sign in") ||
    normalized.includes("login") ||
    normalized.includes("unauthenticated") ||
    message.includes("请先登录");

  if (!looksLikeAuthError) {
    return message;
  }

  return "登录状态失效，本轮已完成步骤已保留。请重新登录后重试。";
}

export type AgentFunctionCallTerminalStatus =
  | "executed"
  | "failed"
  | "blocked"
  | "skippedDueToEarlierGuard"
  | "pendingConfirmation"
  | "cancelled";

export function completeUnresolvedAgentFunctionCalls(input: {
  calls: readonly { callId: string }[];
  outputs: readonly ResponseFunctionToolOutput[];
  status: Exclude<AgentFunctionCallTerminalStatus, "executed">;
  reason: string;
}): ResponseFunctionToolOutput[] {
  assertAgentFunctionCallCount(input.calls.length);
  const completed = new Set(input.outputs.map((output) => output.call_id));
  return [
    ...input.outputs,
    ...input.calls
      .filter((call) => !completed.has(call.callId))
      .map((call) => buildToolResultOutput(call.callId, { status: input.status, reason: input.reason }))
  ];
}

export function isAgentMutatingTool(tool: MorphoAgentToolArguments["name"]): boolean {
  const effect = getAgentToolEffect(tool);
  return effect.reversibleWorkspaceWrite || effect.externalCost;
}

export function isRepeatedAgentToolCall(
  previousSignature: string | undefined,
  repeatCount: number,
  tool: MorphoAgentToolArguments
): { signature: string; repeatCount: number; exceeded: boolean } {
  const signature = buildAgentToolCallSignature(tool);
  const nextRepeatCount = previousSignature === signature ? repeatCount + 1 : 1;
  return {
    signature,
    repeatCount: nextRepeatCount,
    exceeded: nextRepeatCount > AGENT_TURN_REPEAT_TOOL_CALL_LIMIT
  };
}

export function shouldFinalizeAgentTurn(input: {
  emergencyGuardTriggered: boolean;
  modelTurnCount: number;
  elapsedMs: number;
}): boolean {
  return (
    input.emergencyGuardTriggered ||
    input.modelTurnCount >= AGENT_TURN_EMERGENCY_MODEL_TURN_CEILING ||
    input.elapsedMs >= AGENT_TURN_EMERGENCY_DURATION_MS
  );
}

export function buildAgentEmergencyFinalizationRequest(conversationInput: readonly unknown[]): {
  input: unknown[];
  tools: [];
  continuation: true;
} {
  return {
    input: [
      ...conversationInput,
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "停止继续调用工具。请仅基于已经取得的结果，简要说明当前结论、已完成内容和仍未完成部分。"
          }
        ]
      }
    ],
    tools: [],
    continuation: true
  };
}

export function mergeAgentSearchCitations(
  existing: readonly ProviderCitation[],
  incoming: readonly ProviderCitation[]
): ProviderCitation[] {
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const merged: ProviderCitation[] = [];

  for (const citation of [...existing, ...incoming]) {
    const urlKey = normalizeCitationUrl(citation.url);
    const contentKey = normalizeCitationContent(citation);
    if ((urlKey && seenUrls.has(urlKey)) || (contentKey && seenContent.has(contentKey))) {
      continue;
    }
    if (urlKey) {
      seenUrls.add(urlKey);
    }
    if (contentKey) {
      seenContent.add(contentKey);
    }
    merged.push(citation);
  }

  return merged;
}

export function webSearchSourcesToCitations(sources: WebSearchSource[]): ProviderCitation[] {
  return sources.flatMap((source) => {
    const destination = normalizeSafeExternalNavigationUrl(source.url);
    return destination ? [{
      title: source.title,
      url: destination.url,
      domain: destination.hostname,
      snippet: source.snippet ?? source.excerpt
    }] : [];
  });
}

function buildAgentToolCallSignature(tool: MorphoAgentToolArguments): string {
  if (tool.name === "search_web_evidence") {
    const queries = [...new Set(tool.args.queries.map(normalizeSearchQuery))].sort();
    return `${tool.name}:${stableSerialize({ queries })}`;
  }
  return `${tool.name}:${stableSerialize(tool.args)}`;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeCitationUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").toLocaleLowerCase();
  } catch {
    return url.trim().replace(/\/$/, "").toLocaleLowerCase() || undefined;
  }
}

function normalizeCitationContent(citation: ProviderCitation): string | undefined {
  const title = citation.title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const snippet = citation.snippet?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
  return snippet ? `snippet:${snippet}` : title ? `title:${title}` : undefined;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
