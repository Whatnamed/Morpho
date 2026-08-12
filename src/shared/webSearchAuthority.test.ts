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
});
