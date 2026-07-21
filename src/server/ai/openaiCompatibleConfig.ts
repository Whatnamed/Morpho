import {
  createMorphoAgentContextPolicy,
  type MorphoAgentContextPolicy
} from "@/domain/morpho/agentContextPolicy";

export type OpenAiCompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  webSearchEnabled: boolean;
  contextPolicy: MorphoAgentContextPolicy;
};

export type OpenAiCompatibleConfigResult =
  | {
      status: "ok";
      config: OpenAiCompatibleConfig;
    }
  | {
      status: "failed";
      reason: string;
    };

export function loadOpenAiCompatibleConfig(env: Partial<NodeJS.ProcessEnv>): OpenAiCompatibleConfigResult {
  const provider = normalizeProvider(env.MORPHO_AI_PROVIDER) ?? inferProvider(env);
  if (provider === undefined) {
    return {
      status: "failed",
      reason: "当前文本 AI 路径仅支持 openai-compatible 或 aijws provider。"
    };
  }

  const apiKey = firstNonEmpty(env.MORPHO_AI_API_KEY, env.AIJWS_API_KEY) ?? "";
  const baseUrlCandidate = trimTrailingSlash(firstNonEmpty(env.MORPHO_AI_BASE_URL, env.AIJWS_BASE_URL));
  const baseUrl = baseUrlCandidate || defaultBaseUrlForProvider(provider);
  const model = firstNonEmpty(env.MORPHO_AI_MODEL, env.AIJWS_MODEL) ?? "gpt-5.6-terra";
  const reasoningEffort = parseReasoningEffort(env.MORPHO_AI_REASONING_EFFORT);
  const webSearchEnabled = parseBoolean(env.MORPHO_AI_WEB_SEARCH_ENABLED, true);

  if (!apiKey || !baseUrl) {
    return {
      status: "failed",
      reason: "AiJWS 配置缺失：请在 .env.local 设置 MORPHO_AI_BASE_URL 和 MORPHO_AI_API_KEY，或提供 AIJWS_API_KEY。"
    };
  }

  return {
    status: "ok",
    config: {
      apiKey,
      baseUrl,
      model,
      reasoningEffort,
      webSearchEnabled,
      contextPolicy: createMorphoAgentContextPolicy()
    }
  };
}

function inferProvider(env: Partial<NodeJS.ProcessEnv>): "openai-compatible" | "aijws" {
  if (firstNonEmpty(env.MORPHO_AI_API_KEY, env.AIJWS_API_KEY)) {
    return "aijws";
  }

  return "openai-compatible";
}

function normalizeProvider(value: string | undefined): "openai-compatible" | "aijws" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "openai-compatible" || normalized === "aijws") {
    return normalized;
  }

  return undefined;
}

function defaultBaseUrlForProvider(provider: "openai-compatible" | "aijws"): string {
  switch (provider) {
    case "aijws":
      return "https://api.aijws.com/v1";
    case "openai-compatible":
      return "";
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
    return false;
  }

  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
    return true;
  }

  return defaultValue;
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  return undefined;
}

function trimTrailingSlash(value: string | undefined): string {
  return value ? value.replace(/\/+$/, "") : "";
}
