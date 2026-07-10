export type OpenAiCompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  webSearchEnabled: boolean;
  contextWindowTokens: number;
  contextPrepareTokens: number;
  contextCompactTokens: number;
  contextTargetTokens: number;
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
  const contextWindowTokens = parsePositiveInteger(env.MORPHO_AI_CONTEXT_WINDOW_TOKENS, 372_000);
  const contextPrepareTokens = parsePositiveInteger(env.MORPHO_AI_CONTEXT_PREPARE_TOKENS, 200_000);
  const contextCompactTokens = parsePositiveInteger(env.MORPHO_AI_CONTEXT_COMPACT_TOKENS, 300_000);
  const contextTargetTokens = parsePositiveInteger(env.MORPHO_AI_CONTEXT_TARGET_TOKENS, 16_000);

  if (
    contextWindowTokens === undefined ||
    contextPrepareTokens === undefined ||
    contextCompactTokens === undefined ||
    contextTargetTokens === undefined ||
    !(
      contextTargetTokens < contextPrepareTokens &&
      contextPrepareTokens < contextCompactTokens &&
      contextCompactTokens < contextWindowTokens
    )
  ) {
    return {
      status: "failed",
      reason:
        "AI 上下文配置无效：请确保 target、prepare、compact、window 为正整数，且 target < prepare < compact < window。"
    };
  }

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
      contextWindowTokens,
      contextPrepareTokens,
      contextCompactTokens,
      contextTargetTokens
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

function parsePositiveInteger(value: string | undefined, defaultValue: number): number | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return defaultValue;
  }

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function trimTrailingSlash(value: string | undefined): string {
  return value ? value.replace(/\/+$/, "") : "";
}
