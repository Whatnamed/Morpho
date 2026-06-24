import type { GrsImageConfig } from "./grsProvider";

export type GrsImageConfigResult =
  | {
      status: "ok";
      config: GrsImageConfig;
    }
  | {
      status: "failed";
      reason: string;
    };

export function loadGrsImageConfig(env: Partial<NodeJS.ProcessEnv>): GrsImageConfigResult {
  const apiKey = env.MORPHO_GRS_API_KEY;
  const baseUrl = env.MORPHO_GRS_BASE_URL;
  const model = env.MORPHO_GRS_IMAGE_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return {
      status: "failed",
      reason:
        "GrsAI 配置缺失：请在 .env.local 设置 MORPHO_GRS_API_KEY、MORPHO_GRS_BASE_URL 和 MORPHO_GRS_IMAGE_MODEL。"
    };
  }

  return {
    status: "ok",
    config: {
      apiKey,
      baseUrl,
      model
    }
  };
}
