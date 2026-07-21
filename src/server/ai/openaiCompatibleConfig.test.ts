import { describe, expect, it } from "vitest";

import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import { loadOpenAiCompatibleConfig } from "./openaiCompatibleConfig";

describe("openai-compatible config", () => {
  it("accepts the existing AIJWS env shape", () => {
    const result = loadOpenAiCompatibleConfig({
      AIJWS_API_KEY: "key",
      MORPHO_AI_MODEL: "gpt-5.6-terra",
      MORPHO_AI_REASONING_EFFORT: "high"
    });

    expect(result).toEqual({
      status: "ok",
      config: {
        apiKey: "key",
        baseUrl: "https://api.aijws.com/v1",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        webSearchEnabled: true,
        contextPolicy: MORPHO_AGENT_CONTEXT_POLICY,
        promptCache: {
          supportsPromptCacheKey: false,
          supportsPromptCacheRetention: false,
          promptCacheKeyEnabled: false
        }
      }
    });
  });

  it("ignores unsupported reasoning effort values", () => {
    const result = loadOpenAiCompatibleConfig({
      AIJWS_API_KEY: "key",
      MORPHO_AI_REASONING_EFFORT: "maximum"
    });

    expect(result).toEqual({
      status: "ok",
      config: {
        apiKey: "key",
        baseUrl: "https://api.aijws.com/v1",
        model: "gpt-5.6-terra",
        reasoningEffort: undefined,
        webSearchEnabled: true,
        contextPolicy: MORPHO_AGENT_CONTEXT_POLICY,
        promptCache: {
          supportsPromptCacheKey: false,
          supportsPromptCacheRetention: false,
          promptCacheKeyEnabled: false
        }
      }
    });
  });

  it("does not let legacy context env vars change the production policy", () => {
    const result = loadOpenAiCompatibleConfig({
      AIJWS_API_KEY: "key",
      MORPHO_AI_CONTEXT_WINDOW_TOKENS: "500000",
      MORPHO_AI_CONTEXT_PREPARE_TOKENS: "220000",
      MORPHO_AI_CONTEXT_COMPACT_TOKENS: "360000",
      MORPHO_AI_CONTEXT_TARGET_TOKENS: "12000"
    });

    expect(result).toMatchObject({
      status: "ok",
      config: {
        contextPolicy: MORPHO_AGENT_CONTEXT_POLICY
      }
    });
  });

  it("does not fall back to legacy MiMo env keys for text AI", () => {
    const result = loadOpenAiCompatibleConfig({
      MORPHO_MIMO_API_KEYS: "primary, fallback",
      MORPHO_MIMO_BASE_URL: "https://api.xiaomimimo.com/v1/",
      MORPHO_MIMO_TEXT_MODEL: "mimo-v2.5-pro",
      MORPHO_MIMO_WEB_SEARCH_ENABLED: "false"
    });

    expect(result.status).toBe("failed");
  });
});
