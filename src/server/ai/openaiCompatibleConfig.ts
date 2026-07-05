export type OpenAiCompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  webSearchEnabled: boolean;
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
      reason: "当前 Agent 路径仅支持 openai-compatible、aijws 或 mimo provider。"
    };
  }

  const apiKey =
    firstNonEmpty(
      env.MORPHO_AI_API_KEY,
      env.AIJWS_API_KEY,
      env.MORPHO_MIMO_API_KEY,
      firstCsvEntry(env.MORPHO_MIMO_API_KEYS)
    ) ?? "";
  const baseUrlCandidate = trimTrailingSlash(
    firstNonEmpty(env.MORPHO_AI_BASE_URL, env.AIJWS_BASE_URL, env.MORPHO_MIMO_BASE_URL)
  );
  const baseUrl = baseUrlCandidate || defaultBaseUrlForProvider(provider);
  const model =
    firstNonEmpty(env.MORPHO_AI_MODEL, env.AIJWS_MODEL, env.MORPHO_MIMO_TEXT_MODEL, env.MORPHO_MIMO_MODEL) ??
    "gpt-5.4";
  const webSearchEnabled = parseBoolean(
    firstNonEmpty(env.MORPHO_AI_WEB_SEARCH_ENABLED, env.MORPHO_MIMO_WEB_SEARCH_ENABLED),
    true
  );

  if (!apiKey || !baseUrl) {
    return {
      status: "failed",
      reason:
        "OpenAI-compatible 配置缺失：请在 .env.local 设置 MORPHO_AI_BASE_URL 和 MORPHO_AI_API_KEY，或提供 AIJWS_API_KEY / MORPHO_MIMO_API_*。"
    };
  }

  return {
    status: "ok",
    config: {
      apiKey,
      baseUrl,
      model,
      webSearchEnabled
    }
  };
}

function inferProvider(env: Partial<NodeJS.ProcessEnv>): "openai-compatible" | "aijws" | "mimo" {
  if (firstNonEmpty(env.MORPHO_AI_API_KEY, env.AIJWS_API_KEY)) {
    return "aijws";
  }

  if (firstNonEmpty(env.MORPHO_MIMO_API_KEYS, env.MORPHO_MIMO_API_KEY, env.MORPHO_MIMO_BASE_URL)) {
    return "mimo";
  }

  return "openai-compatible";
}

function normalizeProvider(value: string | undefined): "openai-compatible" | "aijws" | "mimo" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "openai-compatible" || normalized === "aijws" || normalized === "mimo") {
    return normalized;
  }

  return undefined;
}

function defaultBaseUrlForProvider(provider: "openai-compatible" | "aijws" | "mimo"): string {
  switch (provider) {
    case "aijws":
      return "https://api.aijws.com/v1";
    case "mimo":
      return "https://api.xiaomimimo.com/v1";
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

function firstCsvEntry(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
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

function trimTrailingSlash(value: string | undefined): string {
  return value ? value.replace(/\/+$/, "") : "";
}
