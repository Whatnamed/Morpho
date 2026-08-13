import { describe, expect, it } from "vitest";

import { isUserActionExplicitlyDisallowed } from "./userInstructionAuthority";

describe("user instruction authority conflict resolution", () => {
  it.each([
    ["不要联网，只分析现有联网资料", "webSearch"],
    ["不要创建概念方向，只分析现有概念方向", "conceptDirection"],
    ["不要修改设计定义，只解释设计原则", "designDefinition"],
    ["不要修改这个草案，只分析这个修改记录", "reviseSelectedProposalDraft"]
  ] as const)("does not let topic mentions override a negation: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it("lets the last explicit request win over an earlier request", () => {
    expect(isUserActionExplicitlyDisallowed("请联网查一下，但不要联网", "webSearch")).toBe(true);
    expect(isUserActionExplicitlyDisallowed("不要联网，但改为联网查最新标准", "webSearch")).toBe(false);
  });

  it.each([
    ["联网查一下最新标准", "webSearch"],
    ["创建一个概念方向草案", "conceptDirection"],
    ["修改选中的草案标题", "reviseSelectedProposalDraft"],
    ["生成预览图，并先问我确认", "batchGenerateVisuals"]
  ] as const)("keeps request-form actions explicit: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(false);
  });

  it.each([
    ["不要联网，只分析现有联网资料", "webSearch"],
    ["不要创建概念方向，只分析现有概念方向", "conceptDirection"],
    ["不要修改设计定义，只解释设计原则", "designDefinition"],
    ["不要修改这个草案，只分析这个修改记录", "reviseSelectedProposalDraft"],
    ["不要创建研究分析，只分析当前创建研究分析", "createResearchAnalysis"],
    ["不要生成预览图，只分析生成记录", "batchGenerateVisuals"]
  ] as const)("ignores topic references after a prohibition: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });
});
