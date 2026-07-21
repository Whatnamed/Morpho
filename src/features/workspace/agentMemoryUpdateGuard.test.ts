import { describe, expect, it } from "vitest";

import {
  buildRequiredAgentMemoryUpdateReminder,
  resolveRequiredAgentMemoryUpdate,
  shouldApplyAgentMemoryUpdate,
  shouldPromptForMemoryUpdate
} from "./agentMemoryUpdateGuard";

describe("agent memory update guard", () => {
  it("requires an explicit memory tool call for stable project preferences and avoids", () => {
    expect(resolveRequiredAgentMemoryUpdate("后续所有浮标视觉方案都不要做成玩具化的注塑塑料叠层。")).toMatchObject({
      kind: "avoidance"
    });
    expect(resolveRequiredAgentMemoryUpdate("以后默认保持海上公共设施感、结构干净专业。")).toMatchObject({
      kind: "preference"
    });
  });

  it("does not promote a one-off visual request into project memory", () => {
    expect(resolveRequiredAgentMemoryUpdate("这次先把这一张浮标图的结构收干净。")).toBeUndefined();
    expect(resolveRequiredAgentMemoryUpdate("临时试一下更简洁的海上设备外轮廓。")).toBeUndefined();
  });

  it("keeps a genuine long-term rule when the same message also contains a one-off request", () => {
    expect(resolveRequiredAgentMemoryUpdate("这一张浮标图先收干净，以后整个项目都不要做成玩具化注塑叠层。"))
      .toMatchObject({ kind: "avoidance" });
  });

  it("prompts at most once and explains the empty-write acknowledgement path", () => {
    const candidate = resolveRequiredAgentMemoryUpdate("记住这个项目后续都要保持海上公共设施感和轻量结构。");
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Expected a memory candidate.");
    }
    expect(buildRequiredAgentMemoryUpdateReminder(candidate)).toContain("items: []");
    expect(shouldPromptForMemoryUpdate({ candidate, reminderInserted: false, handled: false })).toBe(true);
    expect(shouldPromptForMemoryUpdate({ candidate, reminderInserted: true, handled: false })).toBe(false);
    expect(shouldPromptForMemoryUpdate({ candidate, reminderInserted: false, handled: true })).toBe(false);
  });

  it("rejects memory writes for one-off requests or fabricated evidence quotes", () => {
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate: undefined,
        draft: "这一张浮标图先不要做成玩具化的注塑塑料叠层，其他方向暂时不用改。",
        items: [{ evidenceQuote: "这一张浮标图先不要做成玩具化的注塑塑料叠层" }]
      })
    ).toBe(false);

    const draft = "以后这个项目的所有浮标视觉方案都不要做成玩具化的注塑塑料叠层，保持海上公共设施感和结构干净专业。";
    const candidate = resolveRequiredAgentMemoryUpdate(draft);
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Expected a memory candidate.");
    }
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft,
        items: [{ evidenceQuote: draft }]
      })
    ).toBe(true);
    expect(
      shouldApplyAgentMemoryUpdate({
        candidate,
        draft,
        items: [{ evidenceQuote: "用户没有说过这条规则" }]
      })
    ).toBe(false);
  });
});
