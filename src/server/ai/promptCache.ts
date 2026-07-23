import type { AgentProviderDiagnostics } from "@/shared/agentStreamProtocol";
import type { AgentToolProfile } from "@/shared/agentRuntimeItem";
import type { ResponseTool } from "./openaiCompatibleProvider";
import { classifyProviderCacheStatus } from "./providerTokenUsage";

export type ProviderToolProfile = AgentToolProfile;

export function resolveProviderToolProfile(tools: readonly ResponseTool[] | undefined): ProviderToolProfile {
  return tools?.some((tool) => tool.type === "function" && tool.name === "search_web_evidence")
    ? "standardWithWebSearch"
    : "standard";
}

export function hashStablePrefix(value: string): string {
  return stableHash(value);
}

export function buildPromptCacheKey(input: {
  projectId: string;
  model: string;
  promptContractVersion: string;
  toolProfile: ProviderToolProfile;
}): string {
  return `morpho:${stableHash(input.projectId)}:${input.model}:${input.promptContractVersion}:${input.toolProfile}`;
}

export function normalizeCacheDiagnostics(input: {
  diagnostics?: AgentProviderDiagnostics;
  usage?: {
    inputTokens: number;
    cachedInputTokens?: number;
    uncachedInputTokens?: number;
    cacheHitRatio?: number;
  };
  providerCacheKeyEnabled: boolean;
  providerCacheRetention?: "24h";
}): AgentProviderDiagnostics {
  const cachedInputTokens = input.usage?.cachedInputTokens;
  const totalInputTokens = input.usage?.inputTokens;
  return {
    ...input.diagnostics,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(input.usage?.uncachedInputTokens !== undefined
      ? { uncachedInputTokens: input.usage.uncachedInputTokens }
      : {}),
    ...(cachedInputTokens !== undefined && totalInputTokens !== undefined
      ? { cacheHitRatio: totalInputTokens === 0 ? 0 : cachedInputTokens / totalInputTokens }
      : {}),
    providerCacheKeyEnabled: input.providerCacheKeyEnabled,
    ...(input.providerCacheRetention ? { providerCacheRetention: input.providerCacheRetention } : {}),
    cacheStatus: classifyProviderCacheStatus(totalInputTokens ?? 0, cachedInputTokens)
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
