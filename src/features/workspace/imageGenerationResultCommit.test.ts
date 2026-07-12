import { describe, expect, it } from "vitest";

import { completeImageGenerationOperation, createImageGenerationOperation } from "@/domain/operations/operations";
import { hideObject, createInitialWorkspace } from "@/domain/morpho/workspace";
import type { AssetRecord, ImageGenerationMetadata } from "@/domain/morpho/types";
import { applyImageGenerationResultCommit } from "./imageGenerationResultCommit";

function generatedAsset(id: string): AssetRecord {
  return {
    id,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 4096,
    createdAt: "2026-07-12T09:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType: "aiGeneratedImage",
    width: 1024,
    height: 1024,
    aspectRatio: 1
  };
}

function generation(operationId: string, title: string): ImageGenerationMetadata {
  return {
    operationId,
    modelId: "nano-banana-fast",
    modelLabel: "nano-banana-fast",
    aspectRatio: "16:9",
    prompt: title,
    referenceObjectIds: ["image-soft-rail-v2"],
    title,
    role: "conceptImage",
    createdAt: "2026-07-12T09:00:00.000Z"
  };
}

describe("image generation result commits", () => {
  it("keeps external workspace changes while reverse-settled images retain their planned frames", () => {
    const operationId = "operation-image-commit-race";
    const created = createImageGenerationOperation(createInitialWorkspace(), {
      operationId,
      clientRequestId: "client-image-commit-race",
      prompt: "生成两张概念图",
      selectedObjectIds: ["image-soft-rail-v2"],
      imagePixels: true,
      modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast",
      aspectRatio: "16:9",
      referenceObjectIds: ["image-soft-rail-v2"]
    });
    const externallyUpdated = hideObject(created.workspace, "image-soft-rail-v2");

    const secondFirst = applyImageGenerationResultCommit(externallyUpdated, {
      status: "succeeded",
      operationId,
      asset: generatedAsset("asset-generated-second"),
      generation: generation(operationId, "第二张"),
      sourceObjectIds: ["image-soft-rail-v2"],
      title: "第二张",
      summary: "第二张先返回。",
      role: "conceptImage",
      position: { x: 4600, y: 4200 },
      canvasSize: { w: 320, h: 180 }
    });
    const firstSecond = applyImageGenerationResultCommit(secondFirst.workspace, {
      status: "succeeded",
      operationId,
      asset: generatedAsset("asset-generated-first"),
      generation: generation(operationId, "第一张"),
      sourceObjectIds: ["image-soft-rail-v2"],
      title: "第一张",
      summary: "第一张后返回。",
      role: "conceptImage",
      position: { x: 4200, y: 4200 },
      canvasSize: { w: 320, h: 180 }
    });
    const completed = completeImageGenerationOperation(firstSecond.workspace, {
      operationId,
      resultObjectId: firstSecond.createdObjectId!
    });

    expect(completed.objects["image-soft-rail-v2"]?.visibility).toBe("hidden");
    expect(secondFirst.createdObjectId).toBeDefined();
    expect(firstSecond.createdObjectId).toBeDefined();
    expect(completed.operations[operationId]?.imageGeneration?.resultObjectIds).toEqual([
      secondFirst.createdObjectId,
      firstSecond.createdObjectId
    ]);
    expect(completed.operations[operationId]?.status).toBe("succeeded");
    expect(completed.canvas.instances.find((item) => item.objectId === secondFirst.createdObjectId)).toMatchObject({
      position: { x: 4600, y: 4200 },
      size: { w: 320, h: 180 }
    });
    expect(completed.canvas.instances.find((item) => item.objectId === firstSecond.createdObjectId)).toMatchObject({
      position: { x: 4200, y: 4200 },
      size: { w: 320, h: 180 }
    });
  });

  it("records an item failure without rolling back an earlier successful result", () => {
    const operationId = "operation-image-commit-failure";
    const created = createImageGenerationOperation(createInitialWorkspace(), {
      operationId,
      clientRequestId: "client-image-commit-failure",
      prompt: "生成两张概念图",
      selectedObjectIds: ["image-soft-rail-v2"],
      imagePixels: true,
      modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast",
      aspectRatio: "1:1",
      referenceObjectIds: ["image-soft-rail-v2"]
    });
    const succeeded = applyImageGenerationResultCommit(created.workspace, {
      status: "succeeded",
      operationId,
      asset: generatedAsset("asset-generated-survives"),
      generation: generation(operationId, "保留的成功结果"),
      sourceObjectIds: ["image-soft-rail-v2"],
      title: "保留的成功结果",
      summary: "先保存。",
      role: "conceptImage",
      position: { x: 240, y: 120 },
      canvasSize: { w: 220, h: 220 }
    });
    const failed = applyImageGenerationResultCommit(succeeded.workspace, {
      status: "failed",
      operationId,
      planItemId: "failed-item",
      reason: "provider unavailable"
    });

    expect(failed.workspace.objects[succeeded.createdObjectId!]).toBeDefined();
    expect(failed.workspace.operations[operationId]?.imageGeneration?.resultObjectIds).toEqual([succeeded.createdObjectId]);
    expect(failed.workspace.operations[operationId]?.imageGeneration?.failedItems).toEqual([
      { planItemId: "failed-item", reason: "provider unavailable" }
    ]);
  });
});
