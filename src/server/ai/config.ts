import type { MiMoConfig } from "./types";

export type AiConfigResult =
  | {
      status: "ok";
      provider: "mimo";
      config: MiMoConfig;
    }
  | {
      status: "failed";
      reason: string;
    };

export function loadAiConfig(env: Partial<NodeJS.ProcessEnv>): AiConfigResult {
  const provider = env.MORPHO_AI_PROVIDER ?? "mimo";
  if (provider !== "mimo") {
    return {
      status: "failed",
      reason: "当前仅实现 MiMo 文本 Provider。"
    };
  }

  const baseUrl = env.MORPHO_MIMO_BASE_URL;
  const apiKeys = getMiMoApiKeys(env);
  const textModel = env.MORPHO_MIMO_TEXT_MODEL || "mimo-v2.5-pro";
  const multimodalModel = env.MORPHO_MIMO_MULTIMODAL_MODEL || env.MORPHO_MIMO_MODEL || "mimo-v2.5";
  const webSearchEnabled = env.MORPHO_MIMO_WEB_SEARCH_ENABLED === "true";

  if (apiKeys.length === 0 || !baseUrl) {
    return {
      status: "failed",
      reason:
        "MiMo 配置缺失：请在 .env.local 设置 MORPHO_MIMO_API_KEYS（或 MORPHO_MIMO_API_KEY）和 MORPHO_MIMO_BASE_URL。"
    };
  }

  return {
    status: "ok",
    provider: "mimo",
    config: {
      apiKeys,
      textModel,
      multimodalModel,
      baseUrl,
      webSearchEnabled
    }
  };
}

function getMiMoApiKeys(env: Partial<NodeJS.ProcessEnv>): string[] {
  const plural = splitKeys(env.MORPHO_MIMO_API_KEYS);
  if (plural.length > 0) {
    return plural;
  }

  return [...splitKeys(env.MORPHO_MIMO_API_KEY), ...splitKeys(env.MORPHO_MIMO_API_KEY_2)];
}

function splitKeys(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
