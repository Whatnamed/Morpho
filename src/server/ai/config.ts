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

export function loadAiConfig(env: NodeJS.ProcessEnv): AiConfigResult {
  const provider = env.MORPHO_AI_PROVIDER ?? "mimo";
  if (provider !== "mimo") {
    return {
      status: "failed",
      reason: "当前仅实现 MiMo 文本 Provider。"
    };
  }

  const apiKey = env.MORPHO_MIMO_API_KEY;
  const model = env.MORPHO_MIMO_MODEL;
  const baseUrl = env.MORPHO_MIMO_BASE_URL;

  if (!apiKey || !model || !baseUrl) {
    return {
      status: "failed",
      reason: "MiMo 配置缺失：请在 .env.local 设置 MORPHO_MIMO_API_KEY、MORPHO_MIMO_MODEL 和 MORPHO_MIMO_BASE_URL。"
    };
  }

  return {
    status: "ok",
    provider: "mimo",
    config: {
      apiKey,
      model,
      baseUrl
    }
  };
}
