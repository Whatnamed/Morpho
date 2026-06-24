import { describe, expect, it } from "vitest";

import { loadAiConfig } from "./config";

describe("MiMo AI config", () => {
  it("prefers comma-separated plural API keys over the legacy singular key", () => {
    const result = loadAiConfig({
      MORPHO_MIMO_API_KEYS: " primary-key , backup-key ",
      MORPHO_MIMO_API_KEY: "legacy-key",
      MORPHO_MIMO_BASE_URL: "https://mimo.example/v1",
      MORPHO_MIMO_TEXT_MODEL: "mimo-text",
      MORPHO_MIMO_MULTIMODAL_MODEL: "mimo-vision",
      MORPHO_MIMO_WEB_SEARCH_ENABLED: "true"
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.config.apiKeys).toEqual(["primary-key", "backup-key"]);
      expect(result.config.textModel).toBe("mimo-text");
      expect(result.config.multimodalModel).toBe("mimo-vision");
      expect(result.config.webSearchEnabled).toBe(true);
    }
  });

  it("falls back to the legacy singular key only when plural keys are empty", () => {
    const result = loadAiConfig({
      MORPHO_MIMO_API_KEY: "legacy-key",
      MORPHO_MIMO_API_KEY_2: "second-legacy-key",
      MORPHO_MIMO_BASE_URL: "https://mimo.example/v1",
      MORPHO_MIMO_TEXT_MODEL: "mimo-text",
      MORPHO_MIMO_MULTIMODAL_MODEL: "mimo-vision"
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.config.apiKeys).toEqual(["legacy-key", "second-legacy-key"]);
    }
  });

  it("uses the old MORPHO_MIMO_MODEL only as multimodal model fallback", () => {
    const result = loadAiConfig({
      MORPHO_MIMO_API_KEY: "legacy-key",
      MORPHO_MIMO_BASE_URL: "https://mimo.example/v1",
      MORPHO_MIMO_TEXT_MODEL: "mimo-text",
      MORPHO_MIMO_MODEL: "old-vision-model"
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.config.textModel).toBe("mimo-text");
      expect(result.config.multimodalModel).toBe("old-vision-model");
    }
  });

  it("does not leak key material in missing config errors", () => {
    const result = loadAiConfig({
      MORPHO_MIMO_API_KEYS: "secret-key"
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain("MORPHO_MIMO_BASE_URL");
      expect(result.reason).not.toContain("secret-key");
    }
  });
});
