import { describe, expect, it } from "vitest";

import {
  clearVisualReviewMark,
  collectDefaultReferenceReviewTargets,
  createInitialWorkspace,
  setDefaultReference
} from "./workspace";
import type { ImageCollectionObject, ImageObject, ImageRole, MorphoWorkspace } from "./types";

const ANCHOR_ID = "image-soft-rail-v2";
const NEXT_ANCHOR_ID = "image-night-scenario";

function makeImage(
  id: string,
  role: ImageRole,
  options: { generationRefs?: string[]; visibility?: "active" | "hidden" } = {}
): ImageObject {
  return {
    id,
    type: "image",
    title: `测试图 ${id}`,
    summary: "",
    createdBy: "ai",
    visibility: options.visibility ?? "active",
    role,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...(options.generationRefs
      ? {
          generation: {
            modelId: "grs-test",
            modelLabel: "GRS Test",
            aspectRatio: "1:1",
            prompt: "测试生成",
            referenceObjectIds: options.generationRefs,
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        }
      : {})
  };
}

function makeCollection(id: string, memberObjectIds: string[]): ImageCollectionObject {
  return {
    id,
    type: "imageCollection",
    title: `合集 ${id}`,
    summary: "",
    createdBy: "user",
    visibility: "active",
    memberObjectIds,
    expanded: false,
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

/** 旧锚点 + 一批延展/非延展素材的固定测试场景。 */
function createReplacementScenario(): MorphoWorkspace {
  const base = setDefaultReference(createInitialWorkspace(), ANCHOR_ID, {
    reason: "测试：先设定旧默认参考。"
  });

  const sceneFromAnchor = makeImage("image-derived-scene", "sceneVisual", { generationRefs: [ANCHOR_ID] });
  const detailFromAnchor = makeImage("image-derived-detail", "detailStudy");
  const cmfGroupedFromAnchor = makeImage("image-derived-cmf", "cmfStudy", { generationRefs: [ANCHOR_ID] });
  const previewFromAnchor = makeImage("image-derived-preview", "preview", { generationRefs: [ANCHOR_ID] });
  const referenceMaterial = makeImage("image-research-material", "reference", { generationRefs: [ANCHOR_ID] });
  const unrelatedScene = makeImage("image-unrelated-scene", "sceneVisual");
  const hiddenDerived = makeImage("image-derived-hidden", "sceneVisual", {
    generationRefs: [ANCHOR_ID],
    visibility: "hidden"
  });
  const collection = makeCollection("collection-derived", ["image-derived-cmf", "image-unrelated-scene"]);

  return {
    ...base,
    objects: {
      ...base.objects,
      [sceneFromAnchor.id]: sceneFromAnchor,
      [detailFromAnchor.id]: detailFromAnchor,
      [cmfGroupedFromAnchor.id]: cmfGroupedFromAnchor,
      [previewFromAnchor.id]: previewFromAnchor,
      [referenceMaterial.id]: referenceMaterial,
      [unrelatedScene.id]: unrelatedScene,
      [hiddenDerived.id]: hiddenDerived,
      [collection.id]: collection
    },
    relations: [
      ...base.relations,
      {
        id: "rel-anchor-derived-detail",
        kind: "version",
        fromObjectId: ANCHOR_ID,
        toObjectId: "image-derived-detail",
        note: "细节图由旧锚点直接延展。"
      }
    ]
  };
}

describe("default reference replacement review marks", () => {
  it("collects only direct derivatives of the previous anchor, grouping collection members", () => {
    const workspace = createReplacementScenario();
    const targets = collectDefaultReferenceReviewTargets(workspace, ANCHOR_ID, NEXT_ANCHOR_ID);

    // image-rail-detail 是种子项目中旧锚点的真实细节延展图，同样应进入待复核范围。
    expect(targets.imageIds.sort()).toEqual(["image-derived-detail", "image-derived-scene", "image-rail-detail"]);
    expect(targets.collectionIds).toEqual(["collection-derived"]);
  });

  it("marks direct derivatives for review when the user chooses the second replacement option", () => {
    const workspace = createReplacementScenario();
    const replaced = setDefaultReference(workspace, NEXT_ANCHOR_ID, {
      reason: "测试：替换默认参考并标记直接延展素材待复核。",
      markReplacedDerivativesForReview: true
    });

    const scene = replaced.objects["image-derived-scene"];
    const detail = replaced.objects["image-derived-detail"];
    const collection = replaced.objects["collection-derived"];
    expect(scene?.type === "image" ? scene.pendingReview : undefined).toMatchObject({
      reason: "defaultReferenceReplaced",
      previousDefaultReferenceId: ANCHOR_ID,
      newDefaultReferenceId: NEXT_ANCHOR_ID
    });
    expect(detail?.type === "image" ? detail.pendingReview : undefined).toBeDefined();
    expect(collection?.type === "imageCollection" ? collection.pendingReview : undefined).toBeDefined();

    // 成组素材标记合集：合集成员不再单独标记。
    const groupedCmf = replaced.objects["image-derived-cmf"];
    expect(groupedCmf?.type === "image" ? groupedCmf.pendingReview : undefined).toBeUndefined();

    // 不标记：方向预览、研究资料、普通候选 / 无关图片、隐藏对象。
    for (const excludedId of [
      "image-derived-preview",
      "image-research-material",
      "image-unrelated-scene",
      "image-derived-hidden"
    ]) {
      const object = replaced.objects[excludedId];
      expect(object?.type === "image" ? object.pendingReview : undefined).toBeUndefined();
    }

    expect(replaced.decisionRecords.at(-1)?.summary).toContain("待复核");
  });

  it("does not mark anything when only the default reference is replaced", () => {
    const workspace = createReplacementScenario();
    const replaced = setDefaultReference(workspace, NEXT_ANCHOR_ID, {
      reason: "测试：只替换默认参考。"
    });

    const markedObjects = Object.values(replaced.objects).filter(
      (object) => (object.type === "image" || object.type === "imageCollection") && object.pendingReview
    );
    expect(markedObjects).toEqual([]);
  });

  it("never deletes, regenerates, or reorders content when marking for review", () => {
    const workspace = createReplacementScenario();
    const replaced = setDefaultReference(workspace, NEXT_ANCHOR_ID, {
      reason: "测试：替换默认参考并标记直接延展素材待复核。",
      markReplacedDerivativesForReview: true
    });

    expect(Object.keys(replaced.objects).sort()).toEqual(Object.keys(workspace.objects).sort());
    expect(replaced.canvas.instances.map((instance) => instance.id)).toEqual(
      workspace.canvas.instances.map((instance) => instance.id)
    );
    expect(replaced.deliveryReferences).toEqual(workspace.deliveryReferences);
    const collection = replaced.objects["collection-derived"];
    expect(collection?.type === "imageCollection" ? collection.memberObjectIds : []).toEqual([
      "image-derived-cmf",
      "image-unrelated-scene"
    ]);
  });

  it("only refreshes updatedAt for images whose state actually changed", () => {
    const workspace = createReplacementScenario();
    const untouchedBefore = workspace.objects["image-unrelated-scene"];
    const replaced = setDefaultReference(workspace, NEXT_ANCHOR_ID, {
      reason: "测试：只替换默认参考。"
    });

    expect(replaced.objects["image-unrelated-scene"]).toBe(untouchedBefore);

    const previousAnchor = replaced.objects[ANCHOR_ID];
    const nextAnchor = replaced.objects[NEXT_ANCHOR_ID];
    expect(previousAnchor?.type === "image" ? previousAnchor.isDefaultReference : undefined).toBe(false);
    expect(nextAnchor?.type === "image" ? nextAnchor.isDefaultReference : undefined).toBe(true);
    expect(previousAnchor?.updatedAt).not.toBe(untouchedBefore?.updatedAt);
  });

  it("clears a review mark when the user keeps the material", () => {
    const workspace = createReplacementScenario();
    const replaced = setDefaultReference(workspace, NEXT_ANCHOR_ID, {
      reason: "测试：替换默认参考并标记直接延展素材待复核。",
      markReplacedDerivativesForReview: true
    });

    const kept = clearVisualReviewMark(replaced, "image-derived-scene");
    const scene = kept.objects["image-derived-scene"];
    expect(scene?.type === "image" ? scene.pendingReview : undefined).toBeUndefined();
    expect(scene?.type === "image" ? scene.role : undefined).toBe("sceneVisual");

    // 未标记对象上的“保留”不产生变化。
    expect(clearVisualReviewMark(kept, "image-unrelated-scene")).toBe(kept);
  });
});
