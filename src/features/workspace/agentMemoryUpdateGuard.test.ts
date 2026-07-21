import { describe, expect, it } from "vitest";

import {
  resolveRequiredAgentMemoryUpdate,
  shouldApplyAgentMemoryUpdate,
  shouldPromptForMemoryUpdate
} from "./agentMemoryUpdateGuard";

describe("Agent memory update guard", () => {
  it("accepts only non-empty evidence quoted verbatim from the current user message", () => {
    const candidate = resolveRequiredAgentMemoryUpdate("以后项目都保持低反光，并记住这个偏好。");

    expect(candidate).toMatchObject({ kind: "preference" });
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft: "以后项目都保持低反光，并记住这个偏好。",
        items: [{ kind: "preference", evidenceQuote: "以后项目都保持低反光" }]
      })
    ).toBe(true);
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft: "以后项目都保持低反光，并记住这个偏好。",
        items: [{ kind: "preference", evidenceQuote: "以后项目都使用高反光镜面" }]
      })
    ).toBe(false);
  });

  it("keeps mismatched or empty submissions retryable", () => {
    const candidate = resolveRequiredAgentMemoryUpdate("后续不要使用高反光镜面，整个项目都避免。");

    expect(candidate).toMatchObject({ kind: "avoidance" });
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft: "后续不要使用高反光镜面，整个项目都避免。",
        items: [{ kind: "preference", evidenceQuote: "后续不要使用高反光镜面" }]
      })
    ).toBe(false);
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft: "后续不要使用高反光镜面，整个项目都避免。",
        items: []
      })
    ).toBe(false);
    expect(shouldPromptForMemoryUpdate({ candidate, reminderInserted: false, handled: false })).toBe(true);
  });

  it("does not require a memory tool call for one-off wording", () => {
    const candidate = resolveRequiredAgentMemoryUpdate("这次先把浮标外壳改成橙色，先试一下。");

    expect(candidate).toBeUndefined();
    expect(shouldPromptForMemoryUpdate({ candidate, reminderInserted: false, handled: false })).toBe(false);
  });
});
