import { describe, expect, it } from "vitest";

import {
  expectsConceptDirectionProposal,
  expectsDesignDefinitionProposal,
  getAvailableAiWorkIntents,
  recommendAiTaskMode,
  recommendAiWorkIntent,
  resolveAiContextTask,
  resolveTaskModeForSend,
  resolveWorkIntentForSend
} from "./aiTaskRouting";

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

  it("auto-routes from the default chat mode while respecting explicit manual modes", () => {
    expect(
      resolveTaskModeForSend({
        currentTaskMode: "chatAnalysis",
        recommendedTaskMode: "imageGeneration"
      })
    ).toBe("imageGeneration");

    expect(
      resolveTaskModeForSend({
        currentTaskMode: "imageGeneration",
        recommendedTaskMode: "chatAnalysis"
      })
    ).toBe("imageGeneration");
  });

  it("auto-routes work intent from default discussion while respecting manual intent", () => {
    expect(
      recommendAiWorkIntent({
        draft: "基于当前结论形成一版设计定义草案",
        selectedObjects: [{ type: "keyConclusion" }],
        hasCurrentDesignDefinition: false
      })
    ).toBe("createDesignDefinition");

    expect(
      recommendAiWorkIntent({
        draft: "基于当前结论形成一版设计定义草案",
        selectedObjects: [{ type: "keyConclusion" }],
        hasCurrentDesignDefinition: true
      })
    ).toBe("reviseDesignDefinition");

    expect(
      recommendAiWorkIntent({
        draft: "比较这两个方向",
        selectedObjects: [{ type: "conceptDirection" }, { type: "conceptDirection" }],
        hasCurrentDesignDefinition: true
      })
    ).toBe("comparison");

    expect(
      resolveWorkIntentForSend({
        currentWorkIntent: "discussion",
        recommendedWorkIntent: "createDesignDefinition"
      })
    ).toBe("createDesignDefinition");

    expect(
      resolveWorkIntentForSend({
        currentWorkIntent: "comparison",
        recommendedWorkIntent: "createDesignDefinition"
      })
    ).toBe("comparison");
  });

  it("returns only applicable work intents for chat analysis", () => {
    expect(
      getAvailableAiWorkIntents({
        taskMode: "chatAnalysis",
        selectedObjects: [{ type: "conceptDirection" }],
        hasCurrentDesignDefinition: true
      })
    ).toEqual(
      expect.arrayContaining([
        "discussion",
        "reviseDesignDefinition",
        "createConceptDirections",
        "reviseConceptDirection",
        "splitConceptDirection"
      ])
    );

    expect(
      getAvailableAiWorkIntents({
        taskMode: "imageGeneration",
        selectedObjects: [{ type: "conceptDirection" }],
        hasCurrentDesignDefinition: true
      })
    ).toEqual(["discussion"]);
  });

  it("maps explicit work intent to context task and proposal expectations", () => {
    expect(resolveAiContextTask("chatAnalysis", "createDesignDefinition")).toBe("designDefinition");
    expect(resolveAiContextTask("chatAnalysis", "mergeConceptDirections")).toBe("conceptDirection");
    expect(resolveAiContextTask("imageGeneration", "discussion")).toBe("visualDevelopment");
    expect(expectsDesignDefinitionProposal("reviseDesignDefinition")).toBe(true);
    expect(expectsConceptDirectionProposal("splitConceptDirection")).toBe(true);
    expect(expectsConceptDirectionProposal("discussion")).toBe(false);
  });
});
