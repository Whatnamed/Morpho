import { describe, expect, it } from "vitest";

import { recommendAiTaskMode, resolveTaskModeForSend } from "./aiTaskRouting";

describe("workspace AI task routing", () => {
  it("recommends image generation for explicit generation prompts without making selection mandatory", () => {
    expect(recommendAiTaskMode("基于这个方向生成一张夜间使用场景图", [])).toBe("imageGeneration");
  });

  it("keeps non-generative image discussion on chat analysis", () => {
    expect(recommendAiTaskMode("分析这张图有哪些问题", ["image"])).toBe("chatAnalysis");
  });

  it("does not treat generic text generation as image generation", () => {
    expect(recommendAiTaskMode("生成一段交付说明文字", ["image"])).toBe("chatAnalysis");
  });

  it("recommends research only for explicit research intent", () => {
    expect(recommendAiTaskMode("基于已选资料做调研，整理机会点", ["file", "link"])).toBe("researchOperation");
    expect(recommendAiTaskMode("解释一下这个文件标题是什么意思", ["file"])).toBe("chatAnalysis");
  });

  it("uses current task mode as the only execution authority", () => {
    expect(
      resolveTaskModeForSend({
        currentTaskMode: "chatAnalysis",
        recommendedTaskMode: "imageGeneration"
      })
    ).toBe("chatAnalysis");

    expect(
      resolveTaskModeForSend({
        currentTaskMode: "imageGeneration",
        recommendedTaskMode: "chatAnalysis"
      })
    ).toBe("imageGeneration");
  });
});
