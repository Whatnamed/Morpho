import { describe, expect, it } from "vitest";

import {
  addDeliveryGap,
  addObjectsToDeliverySection,
  applyDeliverySectionDraft,
  createDeliveryPreparation,
  createDeliverySection,
  createDeliverySectionDraft,
  deriveDeliveryPreparationSignals,
  discardDeliverySectionDraft,
  refreshDeliveryReferenceSnapshot,
  removeDeliveryReference,
  removeDeliverySection,
  resolveDeliveryReferenceState,
  setDeliveryGapStatus,
  updateDeliveryReferenceEditorial,
  updateDeliverySection
} from "./deliveryPreparation";
import { createBlankWorkspace, createInitialWorkspace, hideObject, migrateWorkspaceToCurrentSchema } from "./workspace";
import type { DeliveryObject, MorphoWorkspace } from "./types";

describe("delivery preparation domain operations", () => {
  it("creates board and presentation delivery packages with editable default sections without pulling canvas objects", () => {
    const workspace = createBlankWorkspace("project-delivery-create");
    const board = createDeliveryPreparation(workspace, {
      title: "课程阶段展示",
      format: "board",
      position: { x: 120, y: 160 },
      now: "2026-07-02T08:00:00.000Z"
    });

    expect(board.status).toBe("updated");
    if (board.status !== "updated") {
      throw new Error(board.reason);
    }
    const boardObject = board.workspace.objects[board.deliveryObjectId];
    expect(boardObject?.type).toBe("delivery");
    if (boardObject?.type !== "delivery") {
      throw new Error("Expected delivery object.");
    }
    expect(boardObject.sections.map((section) => section.title)).toEqual([
      "项目背景与问题",
      "调研与关键洞察",
      "设计定义",
      "方向发展",
      "方案展示",
      "关键细节与说明",
      "待补内容"
    ]);
    expect(boardObject.references).toEqual([]);
    expect(board.workspace.canvas.instances.some((instance) => instance.objectId === boardObject.id)).toBe(true);
    expect(board.workspace.projectContinuity.currentFocus.area).toBe("deliveryPreparation");

    const presentation = createDeliveryPreparation(workspace, {
      title: "6 页汇报",
      format: "presentation",
      position: { x: 240, y: 160 },
      now: "2026-07-02T08:00:00.000Z"
    });
    expect(presentation.status).toBe("updated");
    if (presentation.status !== "updated") {
      throw new Error(presentation.reason);
    }
    const presentationObject = presentation.workspace.objects[presentation.deliveryObjectId];
    expect(presentationObject?.type).toBe("delivery");
    if (presentationObject?.type !== "delivery") {
      throw new Error("Expected delivery object.");
    }
    expect(presentationObject.sections.map((section) => section.title)).toEqual([
      "项目起点",
      "调研与洞察",
      "设计定义",
      "方向发展",
      "方案展示",
      "结论与下一步"
    ]);
  });

  it("manages sections and blocks removing sections that still contain references or open gaps", () => {
    const created = mustCreateDelivery(createBlankWorkspace("project-delivery-sections"));
    const delivery = created.workspace.objects[created.deliveryObjectId] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";

    const added = createDeliverySection(created.workspace, {
      deliveryObjectId: delivery.id,
      title: "补充章节",
      purpose: "整理额外说明",
      now: "2026-07-02T08:05:00.000Z"
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }

    const updated = updateDeliverySection(added.workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      title: "项目起点与约束",
      purpose: "交代课程背景",
      now: "2026-07-02T08:06:00.000Z"
    });
    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") {
      throw new Error(updated.reason);
    }
    expect((updated.workspace.objects[delivery.id] as DeliveryObject).sections[0]).toMatchObject({
      title: "项目起点与约束",
      purpose: "交代课程背景"
    });

    const gap = addDeliveryGap(updated.workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      label: "补一张路径图",
      origin: "manual",
      now: "2026-07-02T08:07:00.000Z"
    });
    expect(gap.status).toBe("updated");
    if (gap.status !== "updated") {
      throw new Error(gap.reason);
    }

    const blocked = removeDeliverySection(gap.workspace, {
      deliveryObjectId: delivery.id,
      sectionId
    });
    expect(blocked.status).toBe("blocked");

    const resolved = setDeliveryGapStatus(gap.workspace, {
      deliveryObjectId: delivery.id,
      gapId: gap.gapId,
      status: "resolved",
      now: "2026-07-02T08:08:00.000Z"
    });
    expect(resolved.status).toBe("updated");
    if (resolved.status !== "updated") {
      throw new Error(resolved.reason);
    }
    const removed = removeDeliverySection(resolved.workspace, {
      deliveryObjectId: delivery.id,
      sectionId
    });
    expect(removed.status).toBe("updated");
  });

  it("adds stable references to one section, blocks duplicates there, and allows the same source in another section", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const firstSectionId = delivery.sections[0]?.id ?? "";
    const secondSectionId = delivery.sections[1]?.id ?? "";

    const added = addObjectsToDeliverySection(base, {
      deliveryObjectId: delivery.id,
      sectionId: firstSectionId,
      sourceObjectIds: ["research-night-path", "fragment-course-goal", "direction-soft-rail"],
      now: "2026-07-02T08:10:00.000Z"
    });

    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    expect(added.createdReferenceIds).toHaveLength(3);
    const reference = added.workspace.deliveryReferences[added.createdReferenceIds[1] ?? ""];
    expect(reference.deliveryObjectId).toBe(delivery.id);
    expect(reference.sectionId).toBe(firstSectionId);
    expect(reference.snapshot.sourceType).toBe("documentFragment");
    expect(reference.snapshot.body).toContain("低施工");
    expect(reference.snapshot.sourceFile).toMatchObject({
      fileObjectId: "file-course-brief",
      title: "课程要求.pdf"
    });
    expect(reference.snapshot.bodyKind).toBe("complete");
    expect(reference.snapshot.previewAsset?.assetId).toBeUndefined();
    expect(reference.sourceFingerprint).toBeTruthy();
    expect(
      added.workspace.relations.some(
        (relation) =>
          relation.kind === "deliveryReference" &&
          relation.fromObjectId === "fragment-course-goal" &&
          relation.toObjectId === delivery.id
      )
    ).toBe(true);

    const duplicate = addObjectsToDeliverySection(added.workspace, {
      deliveryObjectId: delivery.id,
      sectionId: firstSectionId,
      sourceObjectIds: ["research-night-path"],
      now: "2026-07-02T08:11:00.000Z"
    });
    expect(duplicate.status).toBe("blocked");
    if (duplicate.status === "blocked") {
      expect(duplicate.reason).toContain("已在本章节中");
    }

    const anotherSection = addObjectsToDeliverySection(added.workspace, {
      deliveryObjectId: delivery.id,
      sectionId: secondSectionId,
      sourceObjectIds: ["research-night-path"],
      now: "2026-07-02T08:12:00.000Z"
    });
    expect(anotherSection.status).toBe("updated");
    if (anotherSection.status !== "updated") {
      throw new Error(anotherSection.reason);
    }
    expect(anotherSection.createdReferenceIds).toHaveLength(1);
  });

  it("blocks hidden, missing, and delivery objects as new reference sources", () => {
    const hidden = hideObject(createInitialWorkspace(), "research-night-path");
    const delivery = hidden.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";

    expect(
      addObjectsToDeliverySection(hidden, {
        deliveryObjectId: delivery.id,
        sectionId,
        sourceObjectIds: ["research-night-path"]
      }).status
    ).toBe("blocked");

    expect(
      addObjectsToDeliverySection(hidden, {
        deliveryObjectId: delivery.id,
        sectionId,
        sourceObjectIds: ["missing-object"]
      }).status
    ).toBe("blocked");

    expect(
      addObjectsToDeliverySection(hidden, {
        deliveryObjectId: delivery.id,
        sectionId,
        sourceObjectIds: ["delivery-ppt-six"]
      }).status
    ).toBe("blocked");
  });

  it("detects updated, hidden, missing, and asset-missing source states while preserving old snapshots", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(base, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-soft-rail-v2", "fragment-course-goal"],
      now: "2026-07-02T08:20:00.000Z"
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const imageReferenceId = added.createdReferenceIds[0] ?? "";
    const fragmentReferenceId = added.createdReferenceIds[1] ?? "";
    const originalTitle = added.workspace.deliveryReferences[imageReferenceId]?.snapshot.title;

    const image = added.workspace.objects["image-soft-rail-v2"];
    if (!image || image.type !== "image") {
      throw new Error("Expected image.");
    }
    const changed: MorphoWorkspace = {
      ...added.workspace,
      objects: {
        ...added.workspace.objects,
        [image.id]: {
          ...image,
          title: "柔光轨道 v3",
          summary: "更新后的主图摘要。"
        }
      }
    };
    expect(resolveDeliveryReferenceState(changed, imageReferenceId).status).toBe("sourceUpdated");
    expect(changed.deliveryReferences[imageReferenceId]?.snapshot.title).toBe(originalTitle);

    const hiddenFile = hideObject(changed, "file-course-brief");
    expect(resolveDeliveryReferenceState(hiddenFile, fragmentReferenceId).status).toBe("sourceHidden");

    const missingSource: MorphoWorkspace = {
      ...changed,
      objects: Object.fromEntries(Object.entries(changed.objects).filter(([id]) => id !== "image-soft-rail-v2"))
    };
    expect(resolveDeliveryReferenceState(missingSource, imageReferenceId).status).toBe("sourceMissing");

    const missingAsset: MorphoWorkspace = {
      ...changed,
      assets: {},
      objects: {
        ...changed.objects,
        "image-soft-rail-v2": {
          ...image,
          assetId: "asset-missing"
        }
      }
    };
    expect(resolveDeliveryReferenceState(missingAsset, imageReferenceId).status).toBe("assetMissing");
  });

  it("prioritizes missing stable preview assets over source updates for image delivery references", () => {
    const base = createBlankWorkspace("project-delivery-image-preview");
    const now = "2026-07-02T08:24:00.000Z";
    const workspace: MorphoWorkspace = {
      ...base,
      assets: {
        "asset-image-old": {
          id: "asset-image-old",
          fileName: "old.png",
          mimeType: "image/png",
          size: 100,
          createdAt: now,
          storageKey: "local/images/old.png",
          sourceType: "aiGeneratedImage"
        },
        "asset-image-new": {
          id: "asset-image-new",
          fileName: "new.png",
          mimeType: "image/png",
          size: 120,
          createdAt: now,
          storageKey: "local/images/new.png",
          sourceType: "aiGeneratedImage"
        }
      },
      objects: {
        ...base.objects,
        "image-delivery-source": {
          id: "image-delivery-source",
          type: "image",
          title: "旧快照图",
          summary: "加入交付时的图像。",
          createdBy: "ai",
          visibility: "active",
          role: "primaryVisual",
          imageVariant: "rail",
          assetId: "asset-image-old",
          createdAt: now,
          updatedAt: now
        }
      }
    };
    const created = createDeliveryPreparation(workspace, {
      title: "图片交付",
      format: "board",
      position: { x: 0, y: 0 },
      now
    });
    expect(created.status).toBe("updated");
    if (created.status !== "updated") {
      throw new Error(created.reason);
    }
    const delivery = created.workspace.objects[created.deliveryObjectId] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(created.workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-delivery-source"],
      now
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0] ?? "";
    expect(added.workspace.deliveryReferences[referenceId]?.snapshot.previewAsset?.assetId).toBe("asset-image-old");

    const source = added.workspace.objects["image-delivery-source"];
    if (!source || source.type !== "image") {
      throw new Error("Expected image source.");
    }
    const sourceUpdatedOldSnapshotAssetAvailable: MorphoWorkspace = {
      ...added.workspace,
      objects: {
        ...added.workspace.objects,
        [source.id]: {
          ...source,
          title: "新来源图",
          assetId: "asset-image-new"
        }
      }
    };
    expect(resolveDeliveryReferenceState(sourceUpdatedOldSnapshotAssetAvailable, referenceId).status).toBe("sourceUpdated");

    const oldSnapshotAssetMissing: MorphoWorkspace = {
      ...sourceUpdatedOldSnapshotAssetAvailable,
      assets: {
        "asset-image-new": sourceUpdatedOldSnapshotAssetAvailable.assets["asset-image-new"]!
      }
    };
    expect(resolveDeliveryReferenceState(oldSnapshotAssetMissing, referenceId).status).toBe("assetMissing");
  });

  it("tracks document fragment source file deletion, extract changes, and missing extract assets", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(base, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["fragment-course-goal"],
      now: "2026-07-02T08:25:00.000Z"
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0] ?? "";
    const fragment = added.workspace.objects["fragment-course-goal"];
    const file = added.workspace.objects["file-course-brief"];
    if (!fragment || fragment.type !== "documentFragment" || !file || file.type !== "file") {
      throw new Error("Expected document fragment and source file.");
    }

    const deletedFile: MorphoWorkspace = {
      ...added.workspace,
      objects: Object.fromEntries(Object.entries(added.workspace.objects).filter(([id]) => id !== file.id))
    };
    expect(resolveDeliveryReferenceState(deletedFile, referenceId).status).toBe("sourceMissing");

    const changedExtract: MorphoWorkspace = {
      ...added.workspace,
      assets: {
        ...added.workspace.assets,
        "asset-course-brief-extract-v2": {
          id: "asset-course-brief-extract-v2",
          fileName: "course-brief-extract-v2.json",
          mimeType: "application/json",
          size: 128,
          createdAt: "2026-07-02T08:26:00.000Z",
          storageKey: "local/document-extract/course-brief-v2.json",
          sourceType: "documentExtract"
        }
      },
      objects: {
        ...added.workspace.objects,
        [file.id]: {
          ...file,
          extractedAssetId: "asset-course-brief-extract-v2"
        }
      }
    };
    expect(resolveDeliveryReferenceState(changedExtract, referenceId).status).toBe("sourceUpdated");

    const missingExtractAsset: MorphoWorkspace = {
      ...added.workspace,
      assets: Object.fromEntries(
        Object.entries(added.workspace.assets).filter(([id]) => id !== fragment.source.sourceExtractAssetId)
      )
    };
    expect(resolveDeliveryReferenceState(missingExtractAsset, referenceId).status).toBe("assetMissing");
  });

  it("blocks overlong stable snapshots without throwing or writing partial delivery state", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const fragment = base.objects["fragment-course-goal"];
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment.");
    }
    const workspace: MorphoWorkspace = {
      ...base,
      objects: {
        ...base.objects,
        [fragment.id]: {
          ...fragment,
          body: "x".repeat(4_001)
        }
      }
    };

    const result = addObjectsToDeliverySection(workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: [fragment.id],
      now: "2026-07-02T08:27:00.000Z"
    });

    expect(result.status).toBe("blocked");
    expect(result.workspace.deliveryReferences).toEqual(workspace.deliveryReferences);
    expect((result.workspace.objects[delivery.id] as DeliveryObject).sections[0]?.referenceIds).toEqual(
      delivery.sections[0]?.referenceIds
    );
    expect(result.workspace.relations).toEqual(workspace.relations);
    expect(result.workspace.decisionRecords).toEqual(workspace.decisionRecords);
  });

  it("explicitly refreshes one reference snapshot without changing the source or editorial notes", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(base, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-soft-rail-v2"],
      now: "2026-07-02T08:30:00.000Z"
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0] ?? "";
    const edited = updateDeliveryReferenceEditorial(added.workspace, {
      deliveryObjectId: delivery.id,
      referenceId,
      caption: "保留的图注",
      note: "内部说明"
    });
    expect(edited.status).toBe("updated");
    if (edited.status !== "updated") {
      throw new Error(edited.reason);
    }

    const image = edited.workspace.objects["image-soft-rail-v2"];
    if (!image || image.type !== "image") {
      throw new Error("Expected image.");
    }
    const changed: MorphoWorkspace = {
      ...edited.workspace,
      objects: {
        ...edited.workspace.objects,
        [image.id]: {
          ...image,
          title: "柔光轨道 v3"
        }
      }
    };
    const refreshed = refreshDeliveryReferenceSnapshot(changed, {
      deliveryObjectId: delivery.id,
      referenceId,
      reason: "用户确认更新到当前版本。",
      now: "2026-07-02T08:31:00.000Z"
    });
    expect(refreshed.status).toBe("updated");
    if (refreshed.status !== "updated") {
      throw new Error(refreshed.reason);
    }
    expect(refreshed.workspace.deliveryReferences[referenceId]?.snapshot.title).toBe("柔光轨道 v3");
    expect(refreshed.workspace.deliveryReferences[referenceId]?.editorial).toEqual({
      caption: "保留的图注",
      note: "内部说明"
    });
    expect(refreshed.workspace.objects["image-soft-rail-v2"]?.title).toBe("柔光轨道 v3");
    expect(refreshed.workspace.decisionRecords.at(-1)?.kind).toBe("refreshDeliveryReference");
    expect(refreshed.workspace.projectContinuity.recordEntries.at(-1)?.stage).toBe("deliveryPreparation");
  });

  it("derives structural signals without writing permanent gaps", () => {
    const workspace = createInitialWorkspace();
    const delivery = workspace.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections.find((section) => section.referenceIds.length === 0)?.id ?? "";

    const beforeGapCount = delivery.gaps.length;
    const signals = deriveDeliveryPreparationSignals(workspace, delivery.id);

    expect(signals.emptySectionIds).toContain(sectionId);
    expect((workspace.objects[delivery.id] as DeliveryObject).gaps).toHaveLength(beforeGapCount);
  });

  it("creates, applies, discards, and prevents duplicate application of delivery section drafts", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(base, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-soft-rail-v2", "image-rail-detail"],
      now: "2026-07-02T08:40:00.000Z"
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const draft = createDeliverySectionDraft(added.workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      userMessageId: "user-draft-1",
      assistantMessageId: "assistant-draft-1",
      narrative: "本节说明柔光轨道的核心方案与触感细节。",
      captions: [{ referenceId: added.createdReferenceIds[0] ?? "", caption: "核心方案主图" }],
      suggestedGaps: [{ label: "补充夜间安装示意" }],
      now: "2026-07-02T08:41:00.000Z"
    });
    expect(draft.status).toBe("updated");
    if (draft.status !== "updated") {
      throw new Error(draft.reason);
    }
    expect((draft.workspace.objects[delivery.id] as DeliveryObject).gaps.some((gap) => gap.label === "补充夜间安装示意")).toBe(false);

    const applied = applyDeliverySectionDraft(draft.workspace, {
      deliveryObjectId: delivery.id,
      draftId: draft.draftId,
      now: "2026-07-02T08:42:00.000Z"
    });
    expect(applied.status).toBe("updated");
    if (applied.status !== "updated") {
      throw new Error(applied.reason);
    }
    const appliedDelivery = applied.workspace.objects[delivery.id] as DeliveryObject;
    expect(appliedDelivery.sections.find((section) => section.id === sectionId)?.narrative).toBe(
      "本节说明柔光轨道的核心方案与触感细节。"
    );
    expect(appliedDelivery.gaps.some((gap) => gap.label === "补充夜间安装示意" && gap.origin === "deliveryDraft")).toBe(true);
    expect(applied.workspace.deliveryReferences[added.createdReferenceIds[0] ?? ""]?.editorial?.caption).toBe("核心方案主图");
    expect(applied.workspace.deliverySectionDrafts[draft.draftId]?.status).toBe("applied");
    expect(applyDeliverySectionDraft(applied.workspace, { deliveryObjectId: delivery.id, draftId: draft.draftId }).status).toBe(
      "blocked"
    );

    const secondDraft = createDeliverySectionDraft(applied.workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      userMessageId: "user-draft-2",
      assistantMessageId: "assistant-draft-2",
      narrative: "不会应用的说明。",
      captions: [],
      suggestedGaps: [{ label: "不会写入的 gap" }],
      now: "2026-07-02T08:43:00.000Z"
    });
    expect(secondDraft.status).toBe("updated");
    if (secondDraft.status !== "updated") {
      throw new Error(secondDraft.reason);
    }
    const discarded = discardDeliverySectionDraft(secondDraft.workspace, {
      deliveryObjectId: delivery.id,
      draftId: secondDraft.draftId,
      now: "2026-07-02T08:44:00.000Z"
    });
    expect(discarded.status).toBe("updated");
    if (discarded.status !== "updated") {
      throw new Error(discarded.reason);
    }
    expect(discarded.workspace.deliverySectionDrafts[secondDraft.draftId]?.status).toBe("discarded");
    expect((discarded.workspace.objects[delivery.id] as DeliveryObject).gaps.some((gap) => gap.label === "不会写入的 gap")).toBe(
      false
    );
  });

  it("removes references without deleting source objects", () => {
    const base = createInitialWorkspace();
    const delivery = base.objects["delivery-board-a1"] as DeliveryObject;
    const referenceId = delivery.references[0] ?? "";
    const sourceId = base.deliveryReferences[referenceId]?.sourceObjectId ?? "";

    const removed = removeDeliveryReference(base, {
      deliveryObjectId: delivery.id,
      referenceId,
      now: "2026-07-02T08:50:00.000Z"
    });

    expect(removed.status).toBe("updated");
    if (removed.status !== "updated") {
      throw new Error(removed.reason);
    }
    expect(removed.workspace.deliveryReferences[referenceId]).toBeUndefined();
    expect(removed.workspace.objects[sourceId]).toBeDefined();
  });
});

describe("delivery preparation schema migration", () => {
  it("migrates v12 workspaces to v14 without inventing delivery packages", () => {
    const workspace = createBlankWorkspace("project-no-delivery");
    const v12 = { ...workspace, schemaVersion: 12 };

    const result = migrateWorkspaceToCurrentSchema(v12);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.workspace.schemaVersion).toBe(15);
    expect(Object.values(result.workspace.objects).some((object) => object.type === "delivery")).toBe(false);
    expect(result.workspace.deliverySectionDrafts).toEqual({});
  });

  it("adds a deterministic migration section to legacy delivery objects and keeps existing references", () => {
    const workspace = createInitialWorkspace();
    const legacyDelivery = workspace.objects["delivery-board-a1"] as DeliveryObject;
    const legacy: MorphoWorkspace = {
      ...workspace,
      schemaVersion: 12 as 15,
      objects: {
        ...workspace.objects,
        [legacyDelivery.id]: {
          ...legacyDelivery,
          sections: [],
          references: ["delivery-ref-board-main", "delivery-ref-board-detail"]
        }
      },
      deliveryReferences: {
        ...workspace.deliveryReferences,
        "delivery-ref-board-main": {
          ...workspace.deliveryReferences["delivery-ref-board-main"],
          deliveryObjectId: undefined,
          sectionId: undefined,
          order: undefined
        },
        "delivery-ref-board-detail": {
          ...workspace.deliveryReferences["delivery-ref-board-detail"],
          deliveryObjectId: undefined,
          sectionId: undefined,
          order: undefined
        }
      }
    };

    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    const migratedDelivery = result.workspace.objects[legacyDelivery.id] as DeliveryObject;
    expect(migratedDelivery.sections).toHaveLength(1);
    expect(migratedDelivery.sections[0]).toMatchObject({
      id: "section-delivery-board-a1-migrated-content",
      title: "交付内容",
      referenceIds: ["delivery-ref-board-main", "delivery-ref-board-detail"]
    });
    expect(result.workspace.deliveryReferences["delivery-ref-board-main"]).toMatchObject({
      deliveryObjectId: legacyDelivery.id,
      sectionId: "section-delivery-board-a1-migrated-content",
      order: 0
    });

    const second = migrateWorkspaceToCurrentSchema(result.workspace);
    expect(second.status).toBe("ok");
    if (second.status !== "ok") {
      throw new Error(second.reason);
    }
    expect(second.didMigrate).toBe(false);
    expect((second.workspace.objects[legacyDelivery.id] as DeliveryObject).sections).toEqual(migratedDelivery.sections);
  });
});

function mustCreateDelivery(workspace: MorphoWorkspace): Extract<ReturnType<typeof createDeliveryPreparation>, { status: "updated" }> {
  const created = createDeliveryPreparation(workspace, {
    title: "课程阶段展示",
    format: "presentation",
    position: { x: 120, y: 160 },
    now: "2026-07-02T08:00:00.000Z"
  });
  if (created.status !== "updated") {
    throw new Error(created.reason);
  }
  return created;
}
