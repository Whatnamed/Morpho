import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../morpho/workspace";
import {
  inferImageRole,
  parseVisualGenerationPlanPayload,
  validateVisualGenerationPlan
} from "./visualGenerationPlan";

describe("visual generation plan parsing and validation", () => {
  it("parses fenced MiMo visual generation plans", () => {
    const parsed = parseVisualGenerationPlanPayload(`
回答摘要

\`\`\`json
{
  "morphoVisualGenerationPlan": {
    "kind": "directionPreview",
    "items": [
      {
        "id": "item-a",
        "targetDirectionId": "direction-soft-rail",
        "title": "方向 A 首图",
        "purpose": "生成可比较的首版概念图",
        "prompt": "生成方向预览概念图",
        "referenceObjectIds": ["direction-soft-rail"],
        "role": "conceptImage"
      }
    ]
  }
}
\`\`\`
`);

    expect(parsed).toMatchObject({
      status: "ok",
      plan: {
        kind: "directionPreview",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            role: "conceptImage"
          }
        ]
      }
    });
  });

  it("requires direction preview plans to match selected directions exactly", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "directionPreview",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            title: "方向 A",
            purpose: "首版预览",
            prompt: "方向预览",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage"
          }
        ]
      },
      allowedObjectIds: ["direction-soft-rail", "direction-support-island"],
      selectedDirectionIds: ["direction-soft-rail", "direction-support-island"],
      selectedImageIds: []
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("一一对应")
    });
  });

  it("blocks plan items that cite objects outside the allowed scope", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "visualDevelopment",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            title: "细节迭代",
            purpose: "继续发展",
            prompt: "保留结构，做细节图",
            referenceObjectIds: ["image-not-selected"],
            role: "detailStudy"
          }
        ]
      },
      allowedObjectIds: ["direction-soft-rail", "image-soft-rail-v2"],
      selectedDirectionIds: [],
      selectedImageIds: ["image-soft-rail-v2"]
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("未授权")
    });
  });

  it("blocks visual development across directions without a matching target", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "visualDevelopment",
        items: [
          {
            id: "item-a",
            title: "跨方向混合",
            purpose: "不明确的混合",
            prompt: "融合两张图",
            referenceObjectIds: ["image-soft-rail-v2", "image-support-island-preview"],
            role: "preview"
          }
        ]
      },
      allowedObjectIds: ["image-soft-rail-v2", "image-support-island-preview"],
      selectedDirectionIds: [],
      selectedImageIds: ["image-soft-rail-v2", "image-support-island-preview"]
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("跨多个方向")
    });
  });

  it("infers visual role from prompt content", () => {
    expect(inferImageRole("生成真实使用场景图")).toBe("sceneVisual");
    expect(inferImageRole("探索 CMF 材质颜色")).toBe("cmfStudy");
    expect(inferImageRole("继续细节连接结构")).toBe("detailStudy");
  });
});
