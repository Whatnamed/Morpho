import { describe, expect, it } from "vitest";

import { hasCurrentTurnWebSearchAuthority } from "./webSearchAuthority";

describe("current-turn web search authority", () => {
  it("allows explicit current-user search and a user-selected research mode", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "请联网核实这些材料的最新标准。",
      taskMode: "chatAnalysis"
    })).toBe(true);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "研究这个市场的约束。",
      taskMode: "researchOperation",
      executionModeSource: "userSelected"
    })).toBe(true);
  });

  it("fails closed when a research caller omits execution provenance", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "研究这个市场的约束。",
      taskMode: "researchOperation"
    })).toBe(false);
  });

  it("does not treat a summary request or image mode as network authority", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "总结这份文档，只回答要点。",
      taskMode: "chatAnalysis"
    })).toBe(false);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "请联网搜索后生成图片。",
      taskMode: "imageGeneration"
    })).toBe(false);
  });

  it.each([
    "总结这份 PDF 里关于最新标准的内容。",
    "验证这个方案是否符合当前约束。",
    "核实这个方案是否满足当前约束。",
    "查一下这个约束。",
    "最新资料"
  ])("does not treat local-only wording as a network cue: %s", (draft) => {
    expect(hasCurrentTurnWebSearchAuthority({ draft, taskMode: "chatAnalysis" })).toBe(false);
  });

  it.each([
    "联网核实最新标准。",
    "查最新标准。",
    "核实来源。",
    "验证事实。",
    "补充外部来源。",
    "search for supporting sources"
  ])("keeps explicit network combinations as cues: %s", (draft) => {
    expect(hasCurrentTurnWebSearchAuthority({ draft, taskMode: "chatAnalysis" })).toBe(true);
  });

  it("lets an explicit negation override research-mode capability", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "研究这份 PDF，但不要联网，只总结本地内容。",
      taskMode: "researchOperation"
    })).toBe(false);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "不要联网，但请搜索官方来源核实这一点。",
      taskMode: "chatAnalysis"
    })).toBe(false);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "不联网，只总结本地材料。",
      taskMode: "researchOperation"
    })).toBe(false);
  });
});
