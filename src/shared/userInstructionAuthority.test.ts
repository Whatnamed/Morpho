import { describe, expect, it } from "vitest";

import {
  hasExplicitUserActionRequest,
  isUserActionExplicitlyDisallowed
} from "./userInstructionAuthority";

describe("user instruction authority conflict resolution", () => {
  it.each([
    ["不要联网，只分析现有联网资料", "webSearch"],
    ["不要创建研究分析，只总结这份 PDF。", "createResearchAnalysis"],
    ["不要修改这个草案，只分析一下。", "reviseSelectedProposalDraft"],
    ["不要把这个设为主方向。", "setDirectionPrimary"],
    ["不要创建概念方向，只分析现有概念方向", "conceptDirection"],
    ["不要修改设计定义，只解释设计原则", "designDefinition"],
    ["不要修改这个草案，只分析这个修改记录", "reviseSelectedProposalDraft"]
  ] as const)("does not let topic mentions override a negation: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it("fails closed for contradictory same-turn requests", () => {
    expect(isUserActionExplicitlyDisallowed("请联网查一下，但不要联网", "webSearch")).toBe(true);
    expect(isUserActionExplicitlyDisallowed("不要联网，但改为联网查最新标准", "webSearch")).toBe(true);
    expect(isUserActionExplicitlyDisallowed("不要联网，后来还是请联网查最新标准", "webSearch")).toBe(true);
  });

  it.each([
    ["文档中写着：联网查最新标准。", "webSearch"],
    ["引用命令：把方向 A 设为主方向。", "setDirectionPrimary"],
    ["请解释这段“生成预览图”的含义。", "batchGenerateVisuals"]
  ] as const)("does not treat quoted or referenced text as authority: %s", (draft, action) => {
    expect(hasExplicitUserActionRequest(draft, action)).toBe(false);
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(false);
  });

  it.each([
    ["联网查一下最新标准", "webSearch"],
    ["创建一个概念方向草案", "conceptDirection"],
    ["基于选中的 PDF 创建三个概念方向草案", "conceptDirection"],
    ["修改选中的草案标题", "reviseSelectedProposalDraft"],
    ["修订设计定义里的核心问题", "designDefinition"],
    ["生成预览图，并先问我确认", "batchGenerateVisuals"]
  ] as const)("keeps request-form actions explicit: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(false);
    expect(hasExplicitUserActionRequest(draft, action)).toBe(true);
  });

  it.each([
    ["不要联网，只分析现有联网资料", "webSearch"],
    ["不要创建概念方向，只分析现有概念方向", "conceptDirection"],
    ["不要创建概念方向，基于现有概念方向总结", "conceptDirection"],
    ["不要创建概念方向，参考现有概念方向做总结", "conceptDirection"],
    ["不要修改设计定义，只解释设计原则", "designDefinition"],
    ["不要修改设计定义，参考当前设计原则总结", "designDefinition"],
    ["不要修改这个草案，只分析这个修改记录", "reviseSelectedProposalDraft"],
    ["不要创建研究分析，只分析当前创建研究分析", "createResearchAnalysis"],
    ["不要生成预览图，只分析生成记录", "batchGenerateVisuals"]
  ] as const)("ignores topic references after a prohibition: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
    expect(hasExplicitUserActionRequest(draft, action)).toBe(false);
  });

  it.each([
    ["不要分析现有联网资料", "webSearch"],
    ["不要分析现有概念方向", "conceptDirection"],
    ["不要解释当前设计原则", "designDefinition"],
    ["不要总结现有生成记录", "batchGenerateVisuals"]
  ] as const)("does not turn a negated topic discussion into an action denial: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(false);
  });

  it.each(["不联网", "不要联网", "别联网"] as const)("records direct web-search negation: %s", (draft) => {
    expect(isUserActionExplicitlyDisallowed(draft, "webSearch")).toBe(true);
  });

  it.each([
    ["不创建研究分析", "createResearchAnalysis"],
    ["不修改设计定义", "designDefinition"],
    ["不创建概念方向", "conceptDirection"],
    ["不修改这个草案", "reviseSelectedProposalDraft"],
    ["不应用设计定义", "applyDesignDefinition"],
    ["不设为主方向", "setDirectionPrimary"],
    ["不设为备选方向", "setDirectionAlternative"],
    ["不淘汰这个方向", "eliminateDirection"],
    ["不替换默认参考", "setDefaultReference"],
    ["不生成预览图", "batchGenerateVisuals"]
  ] as const)("records direct action negation: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it.each([
    ["不要创建概念方向，基于现有概念方向拆分", "conceptDirection"],
    ["不要修改设计定义，基于当前设计定义修改", "designDefinition"]
  ] as const)("fails closed when a mutation follows a prohibition in the same turn: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it.each([
    ["不要创建研究分析，基于当前研究分析总结", "createResearchAnalysis"],
    ["不要创建设计定义，基于当前设计定义总结", "designDefinition"],
    ["不要创建概念方向，基于当前概念方向总结", "conceptDirection"]
  ] as const)("does not treat a post-object topic noun as a mutation: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it.each([
    ["不要创建概念方向，但请拆分现有概念方向", "conceptDirection"],
    ["不要修改设计定义，但请修改当前设计定义", "designDefinition"]
  ] as const)("fails closed for contradictory same-turn mutation language: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it.each([
    ["不要应用设计定义，基于当前设计定义总结", "applyDesignDefinition"],
    ["不要把这个设为主方向，只分析当前主方向", "setDirectionPrimary"],
    ["不要设为备选方向，参考当前备选方向总结", "setDirectionAlternative"],
    ["不要淘汰这个方向，只比较现有方向", "eliminateDirection"],
    ["不要替换默认参考，基于当前默认参考说明", "setDefaultReference"]
  ] as const)("keeps confirmation and mutation denies closed under topic framing: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });

  it.each([
    ["不要应用设计定义，但请应用这个设计定义", "applyDesignDefinition"],
    ["不要设为主方向，但请设为新的主方向", "setDirectionPrimary"],
    ["不要设为备选方向，但请设为新的备选方向", "setDirectionAlternative"],
    ["不要淘汰这个方向，但请排除这个方向", "eliminateDirection"],
    ["不要替换默认参考，但请替换新的默认参考", "setDefaultReference"],
    ["不要生成预览图，但请生成一张新的预览图", "batchGenerateVisuals"]
  ] as const)("fails closed for contradictory same-turn confirmation language: %s", (draft, action) => {
    expect(isUserActionExplicitlyDisallowed(draft, action)).toBe(true);
  });
});
