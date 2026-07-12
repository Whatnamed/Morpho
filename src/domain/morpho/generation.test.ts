import { describe, expect, it } from "vitest";

import { reconcileWorkspaceDerivedState } from "./derivedState";
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

  it("keeps multiple selected images as direct sources instead of treating every reference as a parent version", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-multi-reference",
        fileName: "multi-reference-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-07-10T00:00:00.000Z",
        storageKey: "blob:asset-generated-multi-reference",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-2-lite",
        modelLabel: "nano-banana-2-lite",
        aspectRatio: "1:1",
        prompt: "结合主图和细节图生成一张新的说明图",
        referenceObjectIds: ["image-soft-rail-v2", "image-rail-detail"],
        createdAt: "2026-07-10T00:00:00.000Z"
      },
      sourceObjectIds: ["image-soft-rail-v2", "image-rail-detail"]
    });

    const createdRelations = result.workspace.relations.filter(
      (relation) => relation.toObjectId === result.createdObjectId
    );

    expect(createdRelations.filter((relation) => relation.kind === "source").map((relation) => relation.fromObjectId)).toEqual([
      "image-soft-rail-v2",
      "image-rail-detail"
    ]);
    expect(createdRelations.some((relation) => relation.kind === "version")).toBe(false);
  });

  it("removes legacy version relations from generated images that record multiple image references", () => {
    const workspace = createInitialWorkspace();
    const generated = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-legacy-multi-reference",
        fileName: "legacy-multi-reference.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-07-10T00:00:00.000Z",
        storageKey: "blob:asset-generated-legacy-multi-reference",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-2-lite",
        modelLabel: "nano-banana-2-lite",
        aspectRatio: "1:1",
        prompt: "结合两张图生成说明预览",
        referenceObjectIds: ["image-soft-rail-v2", "image-rail-detail"],
        createdAt: "2026-07-10T00:00:00.000Z"
      },
      sourceObjectIds: ["image-soft-rail-v2", "image-rail-detail"]
    });
    const legacyWorkspace = {
      ...generated.workspace,
      relations: [
        ...generated.workspace.relations,
        {
          id: "legacy-version-a",
          kind: "version" as const,
          fromObjectId: "image-soft-rail-v2",
          toObjectId: generated.createdObjectId,
          note: "旧实现错误地把多参考图写为父版本。"
        },
        {
          id: "legacy-version-b",
          kind: "version" as const,
          fromObjectId: "image-rail-detail",
          toObjectId: generated.createdObjectId,
          note: "旧实现错误地把多参考图写为父版本。"
        }
      ]
    };

    const reconciled = reconcileWorkspaceDerivedState(legacyWorkspace);

    expect(
      reconciled.relations.some(
        (relation) => relation.toObjectId === generated.createdObjectId && relation.kind === "version"
      )
    ).toBe(false);
    expect(
      reconciled.relations.filter(
        (relation) => relation.toObjectId === generated.createdObjectId && relation.kind === "source"
      )
    ).toHaveLength(2);
  });

  it("inherits direction and visual branch when continuing from a branched source image", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-branch",
        fileName: "branch-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-06-24T00:00:00.000Z",
        storageKey: "blob:asset-generated-branch",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "4:3",
        prompt: "沿着这条细节分支继续发展",
        referenceObjectIds: ["image-rail-detail"],
        createdAt: "2026-06-24T00:00:00.000Z"
      },
      sourceObjectIds: ["image-rail-detail"]
    });

    const createdObject = result.workspace.objects[result.createdObjectId];
    expect(createdObject?.type).toBe("image");
    if (createdObject?.type === "image") {
      expect(createdObject.directionId).toBe("direction-soft-rail");
      expect(createdObject.visualBranchId).toBe("visual-branch-soft-rail-detail");
      expect(createdObject.generation?.directionId).toBe("direction-soft-rail");
      expect(createdObject.generation?.visualBranchId).toBe("visual-branch-soft-rail-detail");
    }
  });

  it("uses an explicit visual branch only when it belongs to the target direction", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-explicit-branch",
        fileName: "explicit-branch-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-06-24T00:00:00.000Z",
        storageKey: "blob:asset-generated-explicit-branch",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "1:1",
        prompt: "在 CMF 分支探索",
        referenceObjectIds: [],
        directionId: "direction-soft-rail",
        visualBranchId: "visual-branch-soft-rail-detail",
        createdAt: "2026-06-24T00:00:00.000Z"
      },
      sourceObjectIds: [],
      directionObjectId: "direction-soft-rail",
      visualBranchId: "visual-branch-soft-rail-detail"
    });

    const createdObject = result.workspace.objects[result.createdObjectId];
    expect(createdObject?.type).toBe("image");
    if (createdObject?.type === "image") {
      expect(createdObject.visualBranchId).toBe("visual-branch-soft-rail-detail");
      expect(createdObject.generation?.visualBranchId).toBe("visual-branch-soft-rail-detail");
    }
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

  it("keeps a planned generation frame when the returned asset uses a different aspect ratio", () => {
    const workspace = createInitialWorkspace();
    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-planned-frame",
        fileName: "returned-square.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-07-12T08:00:00.000Z",
        storageKey: "blob:asset-generated-planned-frame",
        sourceType: "aiGeneratedImage",
        width: 1024,
        height: 1024,
        aspectRatio: 1
      },
      generation: {
        modelId: "nano-banana-fast",
        modelLabel: "nano-banana-fast",
        aspectRatio: "16:9",
        prompt: "生成横向场景图",
        referenceObjectIds: [],
        createdAt: "2026-07-12T08:00:00.000Z"
      },
      sourceObjectIds: [],
      canvasSize: { w: 320, h: 180 }
    });

    const instance = result.workspace.canvas.instances.find((item) => item.objectId === result.createdObjectId);
    expect(instance?.size).toEqual({ w: 320, h: 180 });
  });

  it("treats an explicit generated-image position as a preferred position and avoids visible objects", () => {
    const workspace = createInitialWorkspace();
    const occupied = workspace.canvas.instances[0];
    expect(occupied).toBeDefined();

    const result = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-generated-collision",
        fileName: "collision-result.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-07-10T00:00:00.000Z",
        storageKey: "blob:asset-generated-collision",
        sourceType: "aiGeneratedImage",
        width: 1024,
        height: 1024
      },
      generation: {
        modelId: "nano-banana-2-lite",
        modelLabel: "nano-banana-2-lite",
        aspectRatio: "1:1",
        prompt: "collision test",
        referenceObjectIds: [],
        createdAt: "2026-07-10T00:00:00.000Z"
      },
      sourceObjectIds: [],
      position: occupied!.position
    });

    const instance = result.workspace.canvas.instances.find((item) => item.objectId === result.createdObjectId);
    expect(instance?.position).not.toEqual(occupied!.position);
  });
});
