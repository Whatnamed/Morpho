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
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "4:3",
        prompt: "继续发展转角连接细节",
        referenceObjectIds: ["image-soft-rail-v2"],
        createdAt: "2026-06-24T00:00:00.000Z"
      },
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
      expect(createdObject.generation).toMatchObject({
        modelId: "nano-banana-fast",
        aspectRatio: "4:3",
        prompt: "继续发展转角连接细节",
        referenceObjectIds: ["image-soft-rail-v2"]
      });
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

  it("attaches a generated image to the selected direction without fabricating a version source", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-direction",
        fileName: "direction-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-06-24T00:00:00.000Z",
        storageKey: "blob:asset-generated-direction",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "1:1",
        prompt: "基于方向 A 生成新的场景预览",
        referenceObjectIds: [],
        directionId: "direction-soft-rail",
        createdAt: "2026-06-24T00:00:00.000Z"
      },
      sourceObjectIds: [],
      directionObjectId: "direction-soft-rail"
    });

    const createdObject = result.workspace.objects[result.createdObjectId];
    expect(createdObject?.type).toBe("image");
    if (createdObject?.type === "image") {
      expect(createdObject.directionId).toBe("direction-soft-rail");
      expect(createdObject.generation?.directionId).toBe("direction-soft-rail");
    }
    expect(
      result.workspace.relations.some(
        (relation) => relation.kind === "belongsToDirection" && relation.toObjectId === "direction-soft-rail"
      )
    ).toBe(true);
    expect(result.workspace.relations.filter((relation) => relation.kind === "version")).toEqual(
      workspace.relations.filter((relation) => relation.kind === "version")
    );
  });

  it("sizes generated image instances from intrinsic asset dimensions", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-wide",
        fileName: "wide-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-06-24T00:00:00.000Z",
        storageKey: "blob:asset-generated-wide",
        sourceType: "aiGeneratedImage",
        width: 1920,
        height: 1080,
        aspectRatio: 16 / 9
      },
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "16:9",
        prompt: "生成宽幅场景图",
        referenceObjectIds: [],
        createdAt: "2026-06-24T00:00:00.000Z"
      },
      sourceObjectIds: []
    });

    const instance = result.workspace.canvas.instances.find((item) => item.objectId === result.createdObjectId);

    expect(instance?.size).toEqual({ w: 320, h: 180 });
  });
});
