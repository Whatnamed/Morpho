import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";
import { resolveVisualGenerationTarget } from "./visualGenerationRouting";

describe("visual generation routing", () => {
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
