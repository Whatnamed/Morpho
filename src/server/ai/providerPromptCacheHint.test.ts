import { describe, expect, it } from "vitest";

import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";
import type { OpenAiCompatibleResponseRequest } from "./openaiCompatibleProvider";
import { withServerPromptCacheHint } from "./providerPromptCacheHint";

const request: OpenAiCompatibleResponseRequest = {
  input: [{
    role: "system",
    content: [{ type: "input_text", text: "stable prefix\ndynamic context" }]
  }]
};

describe("server Provider Prompt Cache Hint", () => {
  it("leaves the request byte-compatible when cache capabilities are disabled", () => {
    const result = withServerPromptCacheHint(baseInput(disabledConfig()));

    expect(result).toBe(request);
    expect(result).not.toHaveProperty("promptCacheKey");
    expect(result).not.toHaveProperty("promptCacheRetention");
  });

  it("builds an opaque deterministic partition hint from server-owned contract facts", () => {
    const input = baseInput(enabledConfig());
    const first = withServerPromptCacheHint(input);
    const second = withServerPromptCacheHint(input);

    expect(first.promptCacheKey).toMatch(/^morpho-pc-v1-[0-9a-f]{48}$/);
    expect(second.promptCacheKey).toBe(first.promptCacheKey);
    expect(first.promptCacheRetention).toBe("24h");
    expect(first.promptCacheKey).not.toContain(input.userId);
    expect(first.promptCacheKey).not.toContain(input.localProjectId!);
  });

  it.each([
    ["model", { config: { ...enabledConfig(), model: "different-model" } }],
    ["user", { userId: "user-b" }],
    ["project", { localProjectId: "project-b" }],
    ["contract", { promptContractVersion: "contract-v2" }],
    ["tool profile", { toolProfile: "standardWithWebSearch" }],
    ["stable prefix", { stableSystemPrefix: "different stable prefix" }]
  ])("changes the partition when %s changes", (_label, override) => {
    const baseline = withServerPromptCacheHint(baseInput(enabledConfig())).promptCacheKey;
    const changed = withServerPromptCacheHint({
      ...baseInput(enabledConfig()),
      ...override
    }).promptCacheKey;

    expect(changed).not.toBe(baseline);
  });

  it("does not attach retention unless the Provider explicitly supports it", () => {
    const config = enabledConfig();
    const result = withServerPromptCacheHint(baseInput({
      ...config,
      promptCache: {
        ...config.promptCache!,
        supportsPromptCacheRetention: false
      }
    }));

    expect(result.promptCacheKey).toBeDefined();
    expect(result).not.toHaveProperty("promptCacheRetention");
  });
});

function baseInput(config: Pick<OpenAiCompatibleConfig, "model" | "promptCache">) {
  return {
    config,
    request,
    namespace: "agent" as const,
    userId: "user-a",
    localProjectId: "project-a",
    promptContractVersion: "contract-v1",
    toolProfile: "standard",
    stableSystemPrefix: "stable prefix"
  };
}

function disabledConfig(): Pick<OpenAiCompatibleConfig, "model" | "promptCache"> {
  return {
    model: "test-model",
    promptCache: {
      supportsPromptCacheKey: false,
      supportsPromptCacheRetention: false,
      promptCacheKeyEnabled: false
    }
  };
}

function enabledConfig(): Pick<OpenAiCompatibleConfig, "model" | "promptCache"> {
  return {
    model: "test-model",
    promptCache: {
      supportsPromptCacheKey: true,
      supportsPromptCacheRetention: true,
      promptCacheKeyEnabled: true,
      promptCacheRetention: "24h"
    }
  };
}
