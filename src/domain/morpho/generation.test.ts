import { describe, expect, it } from "vitest";

import { createGeneratedImageFromAsset } from "./generation";
import { createInitialWorkspace } from "./workspace";

describe("Morpho image generation domain helpers", () => {
  it("creates a new image object and asset without overwriting the source image", () => {
    const workspace = createInitialWorkspace();
    const sourceBefore = workspace.objects["image-soft-rail-v2"];

    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-a",
        fileName: "grs-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-06-24T00:00:00.000Z",
        storageKey: "blob:asset-generated-a",
        sourceType: "aiGeneratedImage"
      },
      prompt: "继续发展转角连接细节",
      sourceObjectIds: ["image-soft-rail-v2"]
    });

    expect(result.workspace.objects["image-soft-rail-v2"]).toEqual(sourceBefore);
    expect(result.workspace.assets["asset-generated-a"]).toBeDefined();
    expect(result.createdObjectId).not.toBe("image-soft-rail-v2");
    const createdObject = result.workspace.objects[result.createdObjectId];
    expect(createdObject?.type).toBe("image");
    if (createdObject?.type === "image") {
      expect(createdObject.assetId).toBe("asset-generated-a");
      expect(createdObject.directionId).toBe("direction-soft-rail");
    }
    expect(
      result.workspace.relations.some(
        (relation) =>
          relation.kind === "version" &&
          relation.fromObjectId === "image-soft-rail-v2" &&
          relation.toObjectId === result.createdObjectId
      )
    ).toBe(true);
    expect(
      result.workspace.relations.some(
        (relation) =>
          relation.kind === "source" &&
          relation.fromObjectId === "image-soft-rail-v2" &&
          relation.toObjectId === result.createdObjectId
      )
    ).toBe(true);
  });
});
