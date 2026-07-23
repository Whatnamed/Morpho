import type {
  AgentCacheItemManifest,
  AgentProviderRequestState
} from "@/shared/agentStreamProtocol";
import { estimateProviderSerializedTokens } from "@/shared/providerInputBudget";
import type { OpenAiCompatibleResponseRequest, ResponseTool } from "./openaiCompatibleProvider";
import { hashStablePrefix } from "./promptCache";

export function buildAgentCacheItemManifest(
  input: OpenAiCompatibleResponseRequest["input"]
): AgentCacheItemManifest[] {
  return input.map((item, index) => {
    const record: Record<string, unknown> = isRecord(item) ? item : {};
    const role = typeof record.role === "string" ? record.role : undefined;
    return {
      type: typeof record.type === "string" ? record.type : "message",
      ...(role === "system" || role === "user" || role === "assistant" ? { role } : {}),
      semanticKind: resolveSemanticKind(record, index),
      contentHash: hashStablePrefix(JSON.stringify(item)),
      estimatedTokens: estimateProviderSerializedTokens(sanitizeManifestValue(item))
    };
  });
}

export function hashAgentTools(tools: readonly ResponseTool[] | undefined): string {
  return hashStablePrefix(JSON.stringify(tools ?? []));
}

export function compareAgentCacheManifests(input: {
  previous?: AgentProviderRequestState;
  current: AgentProviderRequestState;
}): {
  commonPrefixItemCount: number;
  commonPrefixEstimatedTokens: number;
  firstMismatchKind?: string;
  previousToolsHash?: string;
  currentToolsHash?: string;
  previousSummaryRevisionId?: string;
  currentSummaryRevisionId?: string;
  budgetGeneration?: number;
  runtimeItemHash?: string;
} {
  const previousManifest = input.previous?.cacheItemManifest ?? [];
  const currentManifest = input.current.cacheItemManifest ?? [];
  let commonPrefixItemCount = 0;
  let commonPrefixEstimatedTokens = 0;
  while (
    commonPrefixItemCount < previousManifest.length &&
    commonPrefixItemCount < currentManifest.length &&
    manifestItemsEqual(previousManifest[commonPrefixItemCount]!, currentManifest[commonPrefixItemCount]!)
  ) {
    commonPrefixEstimatedTokens += currentManifest[commonPrefixItemCount]!.estimatedTokens;
    commonPrefixItemCount += 1;
  }
  const mismatch = currentManifest[commonPrefixItemCount] ?? previousManifest[commonPrefixItemCount];
  return {
    commonPrefixItemCount,
    commonPrefixEstimatedTokens,
    ...(mismatch ? { firstMismatchKind: mismatch.semanticKind } : {}),
    ...(input.previous?.toolsHash ? { previousToolsHash: input.previous.toolsHash } : {}),
    ...(input.current.toolsHash ? { currentToolsHash: input.current.toolsHash } : {}),
    ...(input.previous?.summaryRevisionId
      ? { previousSummaryRevisionId: input.previous.summaryRevisionId }
      : {}),
    ...(input.current.summaryRevisionId
      ? { currentSummaryRevisionId: input.current.summaryRevisionId }
      : {}),
    ...(input.current.budgetGeneration !== undefined
      ? { budgetGeneration: input.current.budgetGeneration }
      : {}),
    ...(input.current.runtimeItem
      ? { runtimeItemHash: input.current.runtimeItem.contentHash }
      : {})
  };
}

function resolveSemanticKind(item: Record<string, unknown>, index: number): string {
  if (item.role === "system") {
    return index === 0 ? "stableSystem" : "runtimeOrDirective";
  }
  if (item.type === "function_call") {
    return "functionCall";
  }
  if (item.type === "function_call_output") {
    return "functionOutput";
  }
  if (item.type === "reasoning") {
    return "reasoningReplay";
  }
  const text = messageText(item);
  const frameKind = text.match(/"semanticKind":"([A-Za-z]+)"/)?.[1];
  if (text.startsWith("[Morpho Untrusted Project Data") && frameKind) {
    return frameKind;
  }
  if (hasImage(item)) {
    return "imageMessage";
  }
  return item.role === "assistant" ? "assistantMessage" : "userMessage";
}

function sanitizeManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeManifestValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "image_url" && typeof item === "string"
        ? `[image:${item.match(/^data:([^;,]+)/)?.[1] ?? "reference"}]`
        : sanitizeManifestValue(item)
    ])
  );
}

function manifestItemsEqual(left: AgentCacheItemManifest, right: AgentCacheItemManifest): boolean {
  return left.type === right.type &&
    left.role === right.role &&
    left.semanticKind === right.semanticKind &&
    left.contentHash === right.contentHash;
}

function messageText(item: Record<string, unknown>): string {
  return Array.isArray(item.content)
    ? item.content.filter(isRecord).map((part) => typeof part.text === "string" ? part.text : "").join("\n")
    : "";
}

function hasImage(item: Record<string, unknown>): boolean {
  return Array.isArray(item.content) && item.content.some((part) => isRecord(part) && part.type === "input_image");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
