import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../morpho/workspace";
import type { VisualIntentItem } from "./types";
import {
  inferImageRole,
  parseVisualGenerationPlanPayload,
  validateVisualGenerationPlan
} from "./visualGenerationPlan";
import { resolveVisualReferences } from "./visualReferenceResolver";

describe("visual generation plan parsing and validation", () => {
  it("parses fenced AiJWS visual generation plans", () => {
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
      reason: expect.stringContaining("每方向精确生成")
    });
  });

  it("allows controlled multi-preview counts per selected direction", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "directionPreview",
        items: [
          {
            id: "soft-1",
            targetDirectionId: "direction-soft-rail",
            title: "柔轨 A",
            purpose: "首轮比较",
            prompt: "方向预览 A",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage"
          },
          {
            id: "soft-2",
            targetDirectionId: "direction-soft-rail",
            title: "柔轨 B",
            purpose: "首轮比较",
            prompt: "方向预览 B",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage"
          },
          {
            id: "island-1",
            targetDirectionId: "direction-support-island",
            title: "支撑岛 A",
            purpose: "首轮比较",
            prompt: "方向预览 A",
            referenceObjectIds: ["direction-support-island"],
            role: "conceptImage"
          },
          {
            id: "island-2",
            targetDirectionId: "direction-support-island",
            title: "支撑岛 B",
            purpose: "首轮比较",
            prompt: "方向预览 B",
            referenceObjectIds: ["direction-support-island"],
            role: "conceptImage"
          }
        ]
      },
      allowedObjectIds: ["direction-soft-rail", "direction-support-island"],
      selectedDirectionIds: ["direction-soft-rail", "direction-support-island"],
      selectedImageIds: [],
      requestedPreviewCount: 2
    });

    expect(result).toMatchObject({
      status: "ok"
    });
  });

  it("blocks wrong direction preview plans while allowing arbitrary positive counts", () => {
    const workspace = createInitialWorkspace();

    expect(
      validateVisualGenerationPlan(workspace, {
        plan: {
          kind: "directionPreview",
          items: [
            {
              id: "soft-1",
              targetDirectionId: "direction-soft-rail",
              title: "柔轨 A",
              purpose: "首轮比较",
              prompt: "方向预览 A",
              referenceObjectIds: ["direction-soft-rail"],
              role: "conceptImage"
            },
            {
              id: "soft-2",
              targetDirectionId: "direction-soft-rail",
              title: "柔轨 B",
              purpose: "首轮比较",
              prompt: "方向预览 B",
              referenceObjectIds: ["direction-soft-rail"],
              role: "sceneVisual"
            }
          ]
        },
        allowedObjectIds: ["direction-soft-rail"],
        selectedDirectionIds: ["direction-soft-rail"],
        selectedImageIds: [],
        requestedPreviewCount: 2
      })
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("conceptImage")
    });

    expect(
      validateVisualGenerationPlan(workspace, {
        plan: {
          kind: "directionPreview",
          items: Array.from({ length: 9 }, (_, index) => ({
            id: `item-${index + 1}`,
            targetDirectionId: "direction-soft-rail",
            title: `预览 ${index + 1}`,
            purpose: "超量",
            prompt: "方向预览",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage" as const
          }))
        },
        allowedObjectIds: ["direction-soft-rail"],
        selectedDirectionIds: ["direction-soft-rail"],
        selectedImageIds: [],
        requestedPreviewCount: 9
      })
    ).toMatchObject({ status: "ok" });

    expect(
      validateVisualGenerationPlan(workspace, {
        plan: {
          kind: "directionPreview",
          items: []
        },
        allowedObjectIds: ["direction-soft-rail", "direction-support-island"],
        selectedDirectionIds: ["direction-soft-rail", "direction-support-island"],
        selectedImageIds: [],
        requestedPreviewCount: 6
      })
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("每方向精确生成 6 张")
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

  it("rejects an incomplete visual development count instead of silently slicing the plan", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "visualDevelopment",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            title: "Integrated version A",
            purpose: "Continue the selected image",
            prompt: "Keep the proportions and make the connection more integrated.",
            referenceObjectIds: ["image-soft-rail-v2"],
            role: "conceptImage"
          },
          {
            id: "item-b",
            targetDirectionId: "direction-soft-rail",
            title: "Integrated version B",
            purpose: "Unexpected extra variation",
            prompt: "Keep the proportions and make another integrated variation.",
            referenceObjectIds: ["image-soft-rail-v2"],
            role: "conceptImage"
          }
        ]
      },
      allowedObjectIds: ["image-soft-rail-v2", "direction-soft-rail"],
      selectedDirectionIds: ["direction-soft-rail"],
      selectedImageIds: ["image-soft-rail-v2"]
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("精确生成 1 张")
    });
  });

  it("preserves every requested visual development item in a validated Agent batch", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "visualDevelopment",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            title: "Integrated version A",
            purpose: "Continue the selected image",
            prompt: "Keep the proportions and make the connection more integrated.",
            referenceObjectIds: ["image-soft-rail-v2"],
            role: "conceptImage"
          },
          {
            id: "item-b",
            targetDirectionId: "direction-soft-rail",
            title: "Integrated version B",
            purpose: "Compare a second controlled variation",
            prompt: "Keep the proportions and make a second integrated variation.",
            referenceObjectIds: ["image-soft-rail-v2"],
            role: "conceptImage"
          }
        ]
      },
      allowedObjectIds: ["image-soft-rail-v2", "direction-soft-rail"],
      selectedDirectionIds: ["direction-soft-rail"],
      selectedImageIds: ["image-soft-rail-v2"],
      requestedPreviewCount: 2
    });

    expect(result).toMatchObject({
      status: "ok",
      plan: {
        items: [{ id: "item-a" }, { id: "item-b" }]
      }
    });
  });

  it("drops fabricated visual branch ids from visual development plans", () => {
    const workspace = createInitialWorkspace();
    const result = validateVisualGenerationPlan(workspace, {
      plan: {
        kind: "visualDevelopment",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-soft-rail",
            visualBranchId: "branch-invented-by-model",
            title: "Integrated version",
            purpose: "Continue the selected image",
            prompt: "Keep the proportions and make the connection more integrated.",
            referenceObjectIds: ["image-soft-rail-v2"],
            role: "conceptImage"
          }
        ]
      },
      allowedObjectIds: ["image-soft-rail-v2", "direction-soft-rail"],
      selectedDirectionIds: ["direction-soft-rail"],
      selectedImageIds: ["image-soft-rail-v2"]
    });

    expect(result).toMatchObject({
      status: "ok",
      plan: {
        items: [
          {
            id: "item-a",
            visualBranchId: undefined
          }
        ]
      }
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

  it("keeps an explicitly selected image when it crosses into another direction", () => {
    const workspace = withAvailableImages(createInitialWorkspace());
    const intent = visualIntent({
      targetDirectionId: "direction-support-island",
      requestedReferenceObjectIds: ["image-soft-rail-v2"]
    });
    const resolution = resolveVisualReferences({
      workspace,
      intent,
      selectedSourceObjectIds: [],
      providerLimit: 4
    });
    const selected = resolution.candidates.find((candidate) => candidate.objectId === "image-soft-rail-v2");

    expect(selected).toMatchObject({
      reason: "userExplicit",
      included: true,
      sourceDirectionId: "direction-soft-rail",
      targetDirectionId: "direction-support-island",
      crossDirection: true,
      retentionReason: expect.stringContaining("明确")
    });
    expect(resolution.resolvedObjectIds).toContain("image-soft-rail-v2");
  });

  it("does not inject an automatic reference from another direction, while retaining or excluding the default explicitly", () => {
    const workspace = withAvailableImages(createInitialWorkspace());
    const automatic = resolveVisualReferences({
      workspace,
      intent: visualIntent({ targetDirectionId: "direction-support-island" }),
      selectedSourceObjectIds: [],
      projectReferenceObjectIds: ["image-soft-rail-v2"],
      providerLimit: 8
    });
    expect(automatic.candidates.find((candidate) => candidate.objectId === "image-soft-rail-v2" && candidate.reason === "projectReference")).toMatchObject({
      included: false,
      omissionReason: "directionMismatch",
      crossDirection: true
    });

    const defaultReference = automatic.candidates.find((candidate) => candidate.reason === "defaultReference");
    expect(defaultReference).toMatchObject({ included: true, crossDirection: true });

    const excluded = resolveVisualReferences({
      workspace,
      intent: visualIntent({ targetDirectionId: "direction-support-island", excludeDefaultReference: true }),
      selectedSourceObjectIds: [],
      providerLimit: 8
    });
    expect(excluded.defaultReferenceExcluded).toBe(true);
    expect(excluded.candidates.find((candidate) => candidate.reason === "defaultReference")).toMatchObject({
      included: false,
      omissionReason: "defaultExcluded"
    });
  });
});

function visualIntent(overrides: Partial<VisualIntentItem> = {}): VisualIntentItem {
  return {
    id: "visual-item-test",
    title: "跨方向视觉发展",
    purpose: "借用结构发展新方向",
    requestedReferenceObjectIds: [],
    changeGoals: ["发展结构关系"],
    preserve: ["保留主体比例"],
    allowToChange: ["允许表面细节变化"],
    productForm: [],
    materialsAndCmf: [],
    environmentAndLighting: [],
    avoid: [],
    role: "conceptImage",
    ...overrides
  };
}

function withAvailableImages(workspace: ReturnType<typeof createInitialWorkspace>) {
  const objects = { ...workspace.objects };
  for (const object of Object.values(objects)) {
    if (object.type === "image") {
      objects[object.id] = { ...object, assetId: `asset-${object.id}` };
    }
  }
  return { ...workspace, objects };
}
