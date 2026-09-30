import { describe, expect, it } from "vitest";

import { validateCurrentMorphoWorkspace } from "@/domain/morpho/currentWorkspaceValidation";
import { reconcileWorkspaceDerivedState } from "@/domain/morpho/derivedState";
import {
  addObjectsToDeliverySection, createDeliveryPreparation, createDeliverySectionDraft,
  resolveDeliveryReferenceState, updateDeliverySection
} from "@/domain/morpho/deliveryPreparation";
import { createEditableProjectBackupManifest, validateEditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import { reconcileProjectMemory } from "@/domain/morpho/projectMemory";
import { searchWorkspace } from "@/domain/morpho/queries";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace, deleteObject, migrateWorkspaceToCurrentSchema } from "@/domain/morpho/workspace";
import { applyConceptDirectionProposal, recordConceptDirectionProposal } from "@/domain/operations/operations";
import { createDocumentFragmentWithContinuity, resolveDocumentFragmentSourceAvailability } from "./documentFragments";

/** Legal cross-module trajectories, including restore gates rather than only local mutation results. */
describe("P1A state and reference integrity acceptance", () => {
  it("keeps pending Proposal snapshots restorable but blocks applying to a deleted target", () => {
    const before = createInitialWorkspace();
    const direction = before.objects["direction-soft-rail"];
    if (direction.type !== "conceptDirection") throw new Error("Expected direction.");
    const revision = before.directionRevisions[direction.currentRevisionId];
    const pending = recordConceptDirectionProposal(before, {
      proposalId: "p1a-pending-revise", workIntent: "reviseConceptDirection", applicationMode: "revise",
      targetDirectionId: direction.id, title: "修订", summary: "待应用", sourceObjectIds: [direction.id], citations: [],
      directions: [{ title: "候选修订", summary: "待应用", conceptStatement: revision.conceptStatement,
        strategy: revision.strategy, keywords: [], differentiators: [], visualSignals: [], risks: [], openQuestions: [] }]
    });
    const after = deleted(pending.workspace, direction.id);
    expect(after.artifactProposals[pending.proposal.id]).toEqual(pending.proposal);
    const application = applyConceptDirectionProposal(after, pending.proposal.id, { position: { x: 0, y: 0 }, allowSourceChanged: true });
    expect(application.status).toBe("blocked");
    const restored = assertRestorable(after);
    expect(restored.artifactProposals[pending.proposal.id].sourceSnapshots).toEqual(pending.proposal.sourceSnapshots);
  });
  it("deletes a direction root without deleting its images, generation metadata, child lineage or historical revisions", () => {
    const seeded = createInitialWorkspace();
    const generatedImage = seeded.objects["image-soft-rail-v2"];
    if (generatedImage.type !== "image") throw new Error("Expected generated image.");
    const generation = {
      operationId: "p1a-image-operation", modelId: "gpt-image-2", modelLabel: "GPT Image 2", aspectRatio: "1:1",
      prompt: "保留方向来源", referenceObjectIds: ["direction-soft-rail"], directionId: "direction-soft-rail",
      visualBranchId: generatedImage.visualBranchId, createdAt: "2026-09-30T00:00:00.000Z"
    };
    const base: MorphoWorkspace = { ...seeded, objects: { ...seeded.objects, [generatedImage.id]: { ...generatedImage, generation } } };
    const direction = base.objects["direction-soft-rail"];
    if (direction.type !== "conceptDirection") throw new Error("Expected direction.");
    const proposal = recordConceptDirectionProposal(base, {
      proposalId: "p1a-split", workIntent: "splitConceptDirection", applicationMode: "split",
      parentDirectionIds: [direction.id], title: "拆分", summary: "保留来源", sourceObjectIds: [direction.id], citations: [],
      directions: ["子方向 A", "子方向 B"].map((title) => ({
        title, summary: title, conceptStatement: title, strategy: title,
        keywords: [], differentiators: [], visualSignals: [], risks: [], openQuestions: [], lineageKind: "splitFromDirection" as const
      }))
    });
    const applied = applyConceptDirectionProposal(proposal.workspace, proposal.proposal.id, { position: { x: 1500, y: 1100 } });
    if (applied.status !== "updated") throw new Error("Expected split.");
    const before = applied.workspace;
    const images = Object.values(before.objects).filter((object) => object.type === "image" && object.directionId === direction.id);
    expect(images.length).toBeGreaterThan(0);
    const inputJson = JSON.stringify(before);
    const after = deleted(before, direction.id);
    expect(JSON.stringify(before)).toBe(inputJson);
    for (const image of images) {
      const survivor = after.objects[image.id];
      if (survivor.type !== "image" || image.type !== "image") throw new Error("Expected retained image.");
      expect(survivor.directionId).toBeUndefined();
      expect(survivor.visualBranchId).toBeUndefined();
      expect(survivor.generation).toEqual(image.generation);
      expect(survivor.assetId).toBe(image.assetId);
    }
    expect(Object.values(after.visualBranches).some((branch) => branch.directionId === direction.id)).toBe(false);
    expect(after.relations.some((relation) => relation.fromObjectId === direction.id || relation.toObjectId === direction.id)).toBe(false);
    expect(after.directionLineage).toEqual(before.directionLineage);
    expect(after.directionRevisions).toEqual(before.directionRevisions);
    expect(after.decisionRecords).toEqual(before.decisionRecords);
    expect(after.projectContinuity.recordEntries.map((entry) => entry.id)).toEqual(before.projectContinuity.recordEntries.map((entry) => entry.id));
    for (const child of applied.directions) expect(after.objects[child.id]).toMatchObject({ lineageRootId: direction.id });
    const restored = assertRestorable(after);
    expect(restored.objects[generatedImage.id]).toMatchObject({ generation });
    expect(restored.directionLineage).toEqual(before.directionLineage);
    expect(restored.directionRevisions).toEqual(before.directionRevisions);
    expect(restored.artifactProposals[proposal.proposal.id]).toEqual(after.artifactProposals[proposal.proposal.id]);
  });

  it("removes owned Delivery references and drafts while preserving upstream sources and history", () => {
    const { workspace: before, deliveryId, draftId, referenceId, sourceId } = deliveryFixture();
    const after = deleted(before, deliveryId);
    expect(after.deliveryReferences[referenceId]).toBeUndefined();
    expect(after.deliverySectionDrafts[draftId]).toBeUndefined();
    expect(after.objects[sourceId]).toEqual(before.objects[sourceId]);
    expect(after.decisionRecords).toEqual(before.decisionRecords);
    expect(after.projectContinuity.recordEntries.map((entry) => entry.id)).toEqual(before.projectContinuity.recordEntries.map((entry) => entry.id));
    const restored = assertRestorable(after);
    expect(restored.objects[sourceId]).toEqual(before.objects[sourceId]);
    expect(restored.deliveryReferences[referenceId]).toBeUndefined();
    expect(restored.deliverySectionDrafts[draftId]).toBeUndefined();
  });

  it("retains a stable Delivery snapshot and pending draft when the upstream source disappears", () => {
    const { workspace: before, referenceId, sourceId, draftId } = deliveryFixture();
    const after = deleted(before, sourceId);
    expect(after.deliveryReferences[referenceId]).toEqual(before.deliveryReferences[referenceId]);
    expect(resolveDeliveryReferenceState(after, referenceId).status).toBe("sourceMissing");
    expect(after.deliverySectionDrafts[draftId]).toEqual(before.deliverySectionDrafts[draftId]);
    const restored = assertRestorable(after);
    expect(restored.deliveryReferences[referenceId].snapshot).toEqual(before.deliveryReferences[referenceId].snapshot);
  });

  it("keeps extracted Fragment content readable but reports its deleted source File as missing", () => {
    const base = createInitialWorkspace();
    const file = base.objects["file-course-brief"];
    if (file.type !== "file") throw new Error("Expected source file.");
    const assetId = "p1a-document-extract";
    const source: MorphoWorkspace = {
      ...base,
      objects: { ...base.objects, [file.id]: { ...file, extractedAssetId: assetId, parseStatus: "parsed" } },
      assets: { ...base.assets, [assetId]: {
        id: assetId, fileName: "extract.txt", mimeType: "text/plain", size: 20,
        createdAt: "2026-09-30T00:00:00.000Z", storageKey: assetId, sourceType: "documentExtract"
      } }
    };
    const created = createDocumentFragmentWithContinuity(source, {
      type: "documentFragment", title: "保留摘录", summary: "提取文本", body: "照明阈值是保留的历史摘录。",
      createdBy: "user", visibility: "active", source: {
        fileObjectId: file.id, fileTitle: file.title, sourceExtractAssetId: assetId,
        startOffset: 0, endOffset: 20, blockIds: ["block-1"]
      }
    });
    const after = deleted(created.workspace, file.id);
    expect(after.objects[created.fragment.id]).toEqual(created.fragment);
    expect(resolveDocumentFragmentSourceAvailability(after, created.fragment).status).toBe("missing");
    expect(searchWorkspace(after, "照明阈值")).toContainEqual(expect.objectContaining({
      objectId: created.fragment.id, source: expect.objectContaining({ status: "missing", fileTitle: file.title })
    }));
    const restored = assertRestorable(after);
    expect(restored.objects[created.fragment.id]).toEqual(created.fragment);
    // Missing historical endpoints are legal; a live endpoint with the wrong type remains invalid.
    const wrongType: MorphoWorkspace = { ...after, objects: { ...after.objects, [file.id]: {
      id: file.id, type: "text", title: "wrong", summary: "", body: "", visibility: "active", createdBy: "user"
    } } };
    expect(validateCurrentMorphoWorkspace(wrongType).status).toBe("failed");
  });

  it("clears deleted images from collections, Stage Regions, selection and live branch roots", () => {
    const base = createInitialWorkspace();
    const branch = Object.values(base.visualBranches).find((item) => item.rootObjectId)!;
    expect(branch).toBeDefined();
    const imageId = branch.rootObjectId!;
    const before: MorphoWorkspace = {
      ...base, objects: { ...base.objects, "p1a-collection": {
        id: "p1a-collection", type: "imageCollection", title: "合集", summary: "", visibility: "active", createdBy: "user",
        memberObjectIds: [imageId], expanded: true
      } },
      canvas: { ...base.canvas, stageRegions: [{
        id: "p1a-region", key: "visual", title: "视觉", x: 0, y: 0, w: 800, h: 600, memberObjectIds: [imageId]
      }] },
      ui: { ...base.ui, lastSelectionIds: [imageId] }
    };
    const after = deleted(before, imageId);
    expect(after.visualBranches[branch.id].rootObjectId).toBeUndefined();
    expect(after.objects["p1a-collection"]).toMatchObject({ memberObjectIds: [] });
    expect(after.canvas.stageRegions?.[0].memberObjectIds).toEqual([]);
    expect(after.ui.lastSelectionIds).toEqual([]);
    const restored = assertRestorable(after);
    expect(restored.visualBranches[branch.id].rootObjectId).toBeUndefined();
  });

  it("retains distinct later section changes even when target/action and timestamp repeat", () => {
    const fixture = deliveryFixture();
    const delivery = fixture.workspace.objects[fixture.deliveryId];
    if (delivery.type !== "delivery") throw new Error("Expected delivery.");
    let workspace = fixture.workspace;
    const initialCount = workspace.projectContinuity.recordEntries.length;
    for (const title of ["A", "B", "A"]) {
      const changed = updateDeliverySection(workspace, {
        deliveryObjectId: delivery.id, sectionId: delivery.sections[0].id, title, now: "2026-09-30T00:00:00.000Z"
      });
      if (changed.status !== "updated") throw new Error(changed.reason);
      workspace = changed.workspace;
    }
    const events = workspace.projectContinuity.recordEntries.slice(initialCount);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.dedupeKey)).size).toBe(3);
    assertRestorable(workspace);
  });
});

function deleted(workspace: MorphoWorkspace, id: string): MorphoWorkspace {
  const result = deleteObject(workspace, id, { confirmed: true });
  if (result.status !== "updated") throw new Error("Expected confirmed deletion.");
  return result.workspace;
}

function assertRestorable(workspace: MorphoWorkspace): MorphoWorkspace {
  expect(validateCurrentMorphoWorkspace(workspace)).toMatchObject({ status: "ok" });
  const projected = reconcileProjectMemory(reconcileWorkspaceDerivedState(workspace));
  expect(validateCurrentMorphoWorkspace(projected)).toMatchObject({ status: "ok" });
  const roundTrip = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(projected)));
  if (roundTrip.status !== "ok") throw new Error(roundTrip.reason);
  expect(roundTrip.didMigrate).toBe(false);
  expect(roundTrip.workspace.schemaVersion).toBe(18);
  expect(validateCurrentMorphoWorkspace(roundTrip.workspace)).toMatchObject({ status: "ok" });
  for (const value of [workspace, roundTrip.workspace]) {
    const backup = createEditableProjectBackupManifest(value);
    expect(backup.status).toBe("ok");
    if (backup.status !== "ok") throw new Error("Editable Backup blocked.");
    expect(validateEditableProjectBackupManifest(JSON.parse(JSON.stringify(backup.manifest))).status).toBe("ok");
  }
  return roundTrip.workspace;
}

function deliveryFixture() {
  const created = createDeliveryPreparation(createInitialWorkspace(), { title: "P1A Delivery", format: "board", position: { x: 0, y: 0 } });
  if (created.status !== "updated") throw new Error(created.reason);
  const delivery = created.workspace.objects[created.deliveryObjectId];
  if (delivery.type !== "delivery") throw new Error("Expected delivery.");
  const sourceId = "image-soft-rail-v2";
  const added = addObjectsToDeliverySection(created.workspace, { deliveryObjectId: delivery.id, sectionId: delivery.sections[0].id, sourceObjectIds: [sourceId] });
  if (added.status !== "updated") throw new Error(added.reason);
  const referenceId = added.createdReferenceIds[0];
  const draft = createDeliverySectionDraft(added.workspace, {
    deliveryObjectId: delivery.id, sectionId: delivery.sections[0].id,
    userMessageId: "p1a-user", assistantMessageId: "p1a-assistant", narrative: "稳定叙述",
    captions: [{ referenceId, caption: "稳定图注" }], suggestedGaps: []
  });
  if (draft.status !== "updated") throw new Error(draft.reason);
  return { workspace: draft.workspace, deliveryId: delivery.id, draftId: draft.draftId, referenceId, sourceId };
}
