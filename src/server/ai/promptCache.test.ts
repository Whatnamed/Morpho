import { describe, expect, it } from "vitest";

import { buildPromptCacheKey, hashStablePrefix, resolveProviderToolProfile } from "./promptCache";

describe("prompt cache helpers", () => {
  it("uses only stable project/model/contract/profile identifiers in cache keys", () => {
    const key = buildPromptCacheKey({
      projectId: "project-ocean-buoy",
      model: "gpt-5.6-terra",
      promptContractVersion: "morpho-agent-v3.2-2026-07-13",
      toolProfile: "standard"
    });
    expect(key).toMatch(/^morpho:[0-9a-f]{64}:gpt-5\.6-terra:morpho-agent-v3\.2-2026-07-13:standard$/);
    expect(key).not.toContain("ocean-buoy");
    expect(key).not.toContain("用户");
  });

  it("keeps stable-prefix hashing byte-sensitive and tool profiles deterministic", () => {
    expect(hashStablePrefix("stable\npolicy")).toBe(hashStablePrefix("stable\npolicy"));
    expect(hashStablePrefix("stable\npolicy")).not.toBe(hashStablePrefix("stable\r\npolicy"));
    expect(resolveProviderToolProfile([])).toBe("standard");
    expect(
      resolveProviderToolProfile([
        {
          type: "function",
          name: "search_web_evidence",
          description: "search",
          parameters: {}
        }
      ])
    ).toBe("standardWithWebSearch");
  });
});
