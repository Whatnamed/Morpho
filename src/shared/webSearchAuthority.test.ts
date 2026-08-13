import { describe, expect, it } from "vitest";

import { hasCurrentTurnWebSearchAuthority } from "./webSearchAuthority";

describe("current-turn web search authority", () => {
  it("allows explicit current-user search and research mode", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "请联网核实这些材料的最新标准。",
      taskMode: "chatAnalysis"
    })).toBe(true);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "研究这个市场的约束。",
      taskMode: "researchOperation"
    })).toBe(true);
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

  it("lets an explicit negation override research-mode capability", () => {
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "研究这份 PDF，但不要联网，只总结本地内容。",
      taskMode: "researchOperation"
    })).toBe(false);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "不要联网，但请搜索官方来源核实这一点。",
      taskMode: "chatAnalysis"
    })).toBe(true);
    expect(hasCurrentTurnWebSearchAuthority({
      draft: "不联网，只总结本地材料。",
      taskMode: "researchOperation"
    })).toBe(false);
  });
});
