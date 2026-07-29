import { createHash } from "node:crypto";

import type {
  OpenAiCompatibleConfig,
  PromptCacheProviderCapability
} from "./openaiCompatibleConfig";
import type { OpenAiCompatibleResponseRequest } from "./openaiCompatibleProvider";

type PromptCacheHintConfig = Pick<OpenAiCompatibleConfig, "model" | "promptCache">;

export type ServerPromptCacheHintInput = Readonly<{
  config: PromptCacheHintConfig;
  request: OpenAiCompatibleResponseRequest;
  namespace: "agent" | "chat" | "compaction";
  userId: string;
  localProjectId?: string;
  promptContractVersion: string;
  toolProfile: string;
  stableSystemPrefix: string;
}>;

/**
 * Adds an optional Provider routing hint derived only from server-owned facts.
 * The opaque key is not an authorization, ownership, replay, or cache-hit proof;
 * correctness and idempotency remain independent from Provider cache behavior.
 */
export function withServerPromptCacheHint(
  input: ServerPromptCacheHintInput
): OpenAiCompatibleResponseRequest {
  const capability = input.config.promptCache;
  const promptCacheKey = shouldAttachPromptCacheKey(capability)
    ? buildOpaquePromptCacheKey(input)
    : undefined;
  const promptCacheRetention = shouldAttachPromptCacheRetention(capability)
    ? capability.promptCacheRetention
    : undefined;

  if (!promptCacheKey && !promptCacheRetention) {
    return input.request;
  }

  return {
    ...input.request,
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(promptCacheRetention ? { promptCacheRetention } : {})
  };
}

function shouldAttachPromptCacheKey(
  capability: PromptCacheProviderCapability | undefined
): capability is PromptCacheProviderCapability {
  return capability?.supportsPromptCacheKey === true && capability.promptCacheKeyEnabled;
}

function shouldAttachPromptCacheRetention(
  capability: PromptCacheProviderCapability | undefined
): capability is PromptCacheProviderCapability & { promptCacheRetention: "24h" } {
  return capability?.supportsPromptCacheRetention === true && capability.promptCacheRetention === "24h";
}

function buildOpaquePromptCacheKey(input: ServerPromptCacheHintInput): string {
  const canonical = canonicalJson({
    domain: "morpho-provider-prompt-cache-hint-v1",
    namespace: input.namespace,
    model: input.config.model,
    userId: input.userId,
    localProjectId: input.localProjectId ?? null,
    promptContractVersion: input.promptContractVersion,
    toolProfile: input.toolProfile,
    stableSystemPrefix: input.stableSystemPrefix
  });
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `morpho-pc-v1-${digest.slice(0, 48)}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    );
  }
  throw new TypeError("Prompt Cache Hint 包含不可规范化的值。");
}
