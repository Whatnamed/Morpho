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
  const fallbackBaseUrls = (env.MORPHO_GRS_FALLBACK_BASE_URLS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter((value) => value && value !== baseUrl?.replace(/\/$/, ""));
  const imageHostAllowlist = (env.MORPHO_GRS_IMAGE_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/\.+$/, ""))
    .filter(Boolean);
  const model = env.MORPHO_GRS_DEFAULT_MODEL || env.MORPHO_GRS_IMAGE_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return {
      status: "failed",
      reason:
        "GrsAI 配置缺失：请在 .env.local 设置 MORPHO_GRS_API_KEY、MORPHO_GRS_BASE_URL 和 MORPHO_GRS_DEFAULT_MODEL。"
    };
  }

  return {
    status: "ok",
    config: {
      apiKey,
      baseUrl,
      ...(fallbackBaseUrls.length > 0 ? { fallbackBaseUrls: [...new Set(fallbackBaseUrls)] } : {}),
      ...(imageHostAllowlist.length > 0
        ? { imageHostAllowlist: [...new Set(imageHostAllowlist)] }
        : {}),
      model
    }
  };
}
