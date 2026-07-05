import { describe, expect, it } from "vitest";

import { loadOpenAiCompatibleConfig } from "./openaiCompatibleConfig";

describe("openai-compatible config", () => {
  it("accepts the existing AIJWS env shape", () => {
    const result = loadOpenAiCompatibleConfig({
      AIJWS_API_KEY: "key",
      MORPHO_AI_MODEL: "gpt-5.4"
    });

    expect(result).toEqual({
      status: "ok",
      config: {
        apiKey: "key",
        baseUrl: "https://api.aijws.com/v1",
        model: "gpt-5.4",
        webSearchEnabled: true
      }
    });
  });

  it("accepts legacy MiMo env keys", () => {
    const result = loadOpenAiCompatibleConfig({
      MORPHO_MIMO_API_KEYS: "primary, fallback",
      MORPHO_MIMO_BASE_URL: "https://api.xiaomimimo.com/v1/",
      MORPHO_MIMO_TEXT_MODEL: "mimo-v2.5-pro",
      MORPHO_MIMO_WEB_SEARCH_ENABLED: "false"
    });

    expect(result).toEqual({
      status: "ok",
      config: {
        apiKey: "primary",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2.5-pro",
        webSearchEnabled: false
      }
    });
  });
});
