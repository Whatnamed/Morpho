import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";
import { classifyVisualGenerationIntent, resolveVisualGenerationTarget } from "./visualGenerationRouting";

describe("visual generation routing", () => {
  it("classifies selected concept directions plus preview wording as direction preview generation", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"];
    if (!direction) {
      throw new Error("Expected seed direction.");
    }

    expect(classifyVisualGenerationIntent("给每个方向生成一张概念预览图", [direction])).toBe("directionPreview");
  });

  it("classifies selected images plus iteration wording as visual development", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (!image) {
      throw new Error("Expected seed image.");
    }

    expect(classifyVisualGenerationIntent("保留这张图的气质，继续生成夜间场景图", [image])).toBe("visualDevelopment");
  });

  it("inherits direction and visual branch from a selected source image", () => {
    const workspace = createInitialWorkspace();
    const source = workspace.objects["image-rail-detail"];
    if (!source) {
      throw new Error("Expected seed image.");
    }

    const target = resolveVisualGenerationTarget(workspace, [source], ["image-rail-detail"]);

    expect(target).toEqual({
      status: "ready",
      directionId: "direction-soft-rail",
      visualBranchId: "visual-branch-soft-rail-detail"
    });
  });

  it("blocks multiple source images from different directions instead of guessing primary direction", () => {
    const workspace = createInitialWorkspace();
    const imageA = workspace.objects["image-soft-rail-v2"];
    const imageB = workspace.objects["image-support-island-preview"];
    if (!imageA || !imageB) {
      throw new Error("Expected seed images.");
    }

    const target = resolveVisualGenerationTarget(workspace, [imageA, imageB], [
      "image-soft-rail-v2",
      "image-support-island-preview"
    ]);

    expect(target).toMatchObject({
      status: "blocked"
    });
    if (target.status === "blocked") {
      expect(target.reason).toContain("不同方向");
    }
  });

  it("does not inject the primary direction when no visual target is explicit", () => {
    const workspace = createInitialWorkspace();

    const target = resolveVisualGenerationTarget(workspace, [], []);

    expect(target).toEqual({
      status: "ready",
      directionId: undefined,
      visualBranchId: undefined
    });
  });
});
