import { describe, expect, it } from "vitest";
import { createBlankWorkspace, createInitialWorkspace, hideObjects, restoreObject, deleteObjects, setConceptDirectionStatus, setKeyConclusionCategory, createKeyConclusion } from "@/domain/morpho/workspace";
import { ensureStageRegions } from "@/domain/morpho/stageRegions";
import { importTextObject } from "@/domain/morpho/imports";
import { addObjectsToDeliverySection, createDeliveryPreparation, moveDeliveryReference, removeDeliveryReference, updateDeliveryReferenceEditorial, updateDeliverySection } from "@/domain/morpho/deliveryPreparation";
import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import { buildSemanticPatchAuthorization } from "@/domain/morpho/conversationSemanticPatch";
import { applyConversationSemanticPatch, setConversationSemanticEntryManualState } from "@/domain/morpho/projectContinuity";
import { classifyDecisionRecords } from "@/domain/morpho/decisionRecords";
import { validateCurrentMorphoWorkspace } from "@/domain/morpho/currentWorkspaceValidation";
import { createEditableProjectBackupManifest, validateEditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import { migrateWorkspaceToCurrentSchema } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { captureManualHistory, absorbCanvasMeasurements, createManualHistory, pushManualHistory, undoManualHistory, redoManualHistory, type ManualHistory, type ManualHistoryResult } from "./workspaceUndo";

function history(before: MorphoWorkspace, after: MorphoWorkspace, label = "test"): ManualHistory {
  return pushManualHistory(createManualHistory(), captureManualHistory(label, before, after));
}
function restored(result: ManualHistoryResult) {
  expect(result.status, result.status === "blocked" ? result.conflicts.join(", ") : undefined).toBe("restored");
  if (result.status !== "restored") throw new Error(JSON.stringify(result));
  return result;
}
function safe(workspace: MorphoWorkspace) {
  expect(validateCurrentMorphoWorkspace(workspace)).toMatchObject({ status: "ok" });
  const migrated = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(workspace)));
  expect(migrated.status).toBe("ok");
  if (migrated.status !== "ok") throw new Error(migrated.reason);
  expect(migrated.didMigrate).toBe(false);
  expect(validateCurrentMorphoWorkspace(migrated.workspace).status).toBe("ok");
  const backup = createEditableProjectBackupManifest(workspace);
  expect(backup.status).toBe("ok");
  if (backup.status === "ok") expect(validateEditableProjectBackupManifest(JSON.parse(JSON.stringify(backup.manifest))).status).toBe("ok");
}
function independent(workspace: MorphoWorkspace) {
  const ai = importTextObject(workspace, { text: "B independent AI result", position: { x: 900, y: 100 } });
  const id = ai.objectIds[0];
  return { ...ai.workspace, objects: { ...ai.workspace.objects, [id]: { ...ai.workspace.objects[id], createdBy: "ai" as const } }, ai: { ...ai.workspace.ai, messages: [...ai.workspace.ai.messages, { id: "ai-later", role: "assistant" as const, body: "independent result", status: "done" as const }] } };
}
function roundTrip(before: MorphoWorkspace, after: MorphoWorkspace, current = after) {
  const undo = restored(undoManualHistory(history(before, after), current)); safe(undo.workspace);
  const redo = restored(redoManualHistory(undo.history, undo.workspace)); safe(redo.workspace);
  return { undo, redo };
}

describe("operation-owned manual history", () => {
  it("records no workspace snapshots or navigation/runtime-only changes", () => {
    const w = createBlankWorkspace("history");
    expect(captureManualHistory("navigation", w, { ...w, canvas: { ...w.canvas, view: { x: 100, y: 200, zoom: 2 } }, ui: { ...w.ui, lastSelectionIds: [] }, ai: { ...w.ai, messages: [{ id: "ai", role: "assistant", body: "later" }] } })).toBeNull();
    const entry = captureManualHistory("rename", w, { ...w, project: { ...w.project, title: "Y" } });
    expect(entry).not.toHaveProperty("workspace");
    expect(JSON.stringify(entry)).not.toContain("conversationCompaction");
  });
  it.each(["image-soft-rail-v2", "research-night-travel", "direction-soft-rail"])("hide/restore %s preserves later AI object, messages, assets and authority history", (id) => {
    const before = createInitialWorkspace();
    // Seed names are explicit domain fixtures, not browser mock state.
    const target = before.objects[id] ? id : Object.values(before.objects).find((o) => o.type === "research")!.id;
    const after = hideObjects(before, [target]); const current = independent(after);
    const aiIds = Object.keys(current.objects).filter((objectId) => !before.objects[objectId]);
    const { undo, redo } = roundTrip(before, after, current);
    expect(undo.workspace.objects[target].visibility).toBe("active"); expect(redo.workspace.objects[target].visibility).toBe("hidden");
    for (const w of [undo.workspace, redo.workspace]) {
      expect(w.ai).toEqual(current.ai); expect(w.assets).toEqual(current.assets);
      for (const aiId of aiIds) expect(w.objects[aiId]).toEqual(current.objects[aiId]);
      expect(w.decisionRecords.slice(0, current.decisionRecords.length)).toEqual(current.decisionRecords);
    }
    const restoredObject = restoreObject(redo.workspace, target);
    const second = roundTrip(redo.workspace, restoredObject);
    expect(second.undo.workspace.objects[target].visibility).toBe("hidden"); expect(second.redo.workspace.objects[target].visibility).toBe("active");
  });
  it("preserves a later generated image, bytes identity, metadata, messages and same-ID runtime changes", () => {
    const before = createInitialWorkspace(), after = hideObjects(before, ["direction-soft-rail"]);
    const generated = createGeneratedImageFromAsset(after, {
      asset: { id: "p6h-ai-asset", fileName: "B.png", mimeType: "image/png", size: 42, createdAt: "2026-10-03T00:00:00Z", storageKey: "B-bytes", sourceType: "aiGeneratedImage" },
      generation: { modelId: "gpt-image-2", modelLabel: "GPT Image 2", prompt: "independent B", aspectRatio: "1:1", createdAt: "2026-10-03T00:00:00Z", referenceObjectIds: [] }, sourceObjectIds: [], position: { x: 1000, y: 100 }
    });
    const current = independent(generated.workspace), { undo, redo } = roundTrip(before, after, current);
    for (const w of [undo.workspace, redo.workspace]) {
      expect(w.objects[generated.createdObjectId]).toEqual(current.objects[generated.createdObjectId]);
      expect(w.assets).toEqual(current.assets); expect(w.ai).toEqual(current.ai); expect(w.operations).toEqual(current.operations);
    }
  });
  it("semantic manual lifecycle uses P1B user-action evidence and retains guards through chronological undo/redo", () => {
    const quote = "我偏好简洁的结构";
    const blank = createBlankWorkspace("semantic-history"), withMessage = { ...blank, ai: { ...blank.ai, messages: [{ id: "user", role: "user" as const, body: quote, createdAt: "2026-10-03T00:00:00Z" }] } };
    const authorization = buildSemanticPatchAuthorization({ taskMode: "chatAnalysis", draft: quote, userMessageId: "user", userMessageCreatedAt: "2026-10-03T00:00:00Z", currentFocusArea: "research", objectIds: [], revisionIds: [], decisionIds: [] });
    const created = applyConversationSemanticPatch(withMessage, authorization, [{ kind: "preference", scope: "project", evidenceQuote: quote, relatedObjectIds: [], relatedRevisionIds: [], relatedDecisionIds: [] }]);
    const before = created.workspace, id = created.entries[0].id, after = setConversationSemanticEntryManualState(before, id, "withdrawn");
    const { undo, redo } = roundTrip(before, after, after);
    expect(undo.workspace.projectContinuity.recordEntries.find((r) => r.id === id)).toMatchObject({ manualState: "active", lifecycleEvidence: { action: "restore", origin: "userAction" } });
    expect(redo.workspace.projectContinuity.recordEntries.find((r) => r.id === id)).toMatchObject({ manualState: "withdrawn", lifecycleEvidence: { action: "retract", origin: "userAction" } });
    const third = { ...after, projectContinuity: { ...after.projectContinuity, recordEntries: after.projectContinuity.recordEntries.map((r) => r.id === id ? { ...r, supersededByEntryId: "later-authority" } : r) } };
    expect(undoManualHistory(history(before, after), third).status).toBe("blocked");
  });
  it("allows unrelated edits on the same object, but detects owned field and incarnation conflicts atomically", () => {
    const before = createInitialWorkspace(); const id = "direction-soft-rail"; const after = hideObjects(before, [id]);
    const renamed = { ...after, objects: { ...after.objects, [id]: { ...after.objects[id], title: "independent rename" } } };
    const undone = restored(undoManualHistory(history(before, after), renamed)); expect(undone.workspace.objects[id].title).toBe("independent rename");
    for (const current of [restoreObject(after, id), { ...after, objects: { ...after.objects, [id]: { ...after.objects[id], incarnationId: "recreated" } } }]) {
      const stack = history(before, after), json = JSON.stringify(current);
      const blocked = undoManualHistory(stack, current); expect(blocked).toMatchObject({ status: "blocked", history: stack });
      expect(JSON.stringify(current)).toBe(json); expect(undoManualHistory(stack, current)).toEqual(blocked);
    }
  });
  it("blocks redo after an independent same-field edit and keeps its entry", () => {
    const before = createInitialWorkspace(), after = hideObjects(before, ["direction-soft-rail"]);
    const undo = restored(undoManualHistory(history(before, after), after));
    const third = hideObjects(undo.workspace, ["direction-soft-rail"]);
    expect(redoManualHistory(undo.history, third)).toMatchObject({ status: "blocked", history: undo.history });
  });
  it("creates/removes only the manual result, preserving logical identity across repeat undo/redo and independent objects", () => {
    const before = createBlankWorkspace("create"), created = importTextObject(before, { text: "manual A", position: { x: 10, y: 20 } });
    const id = created.objectIds[0], current = independent(created.workspace);
    const { undo, redo } = roundTrip(before, created.workspace, current);
    expect(undo.workspace.objects[id]).toBeUndefined(); expect(redo.workspace.objects[id]).toEqual(created.workspace.objects[id]);
    expect(redo.workspace.canvas.instances.find((i) => i.objectId === id)).toEqual(created.workspace.canvas.instances.find((i) => i.objectId === id));
    expect(redo.workspace.ai).toEqual(current.ai);
    const again = restored(undoManualHistory(redo.history, redo.workspace)); expect(again.workspace.objects[id]).toBeUndefined();
  });
  it.each(["direction-soft-rail", "image-soft-rail-v2"])("delete/restore %s preserves relationships, old revisions and later history", (id) => {
    const before = createInitialWorkspace(), after = deleteObjects(before, [id], { confirmed: true, reason: "manual delete" }).workspace;
    const current = independent(after), json = JSON.stringify(current);
    const { undo, redo } = roundTrip(before, after, current);
    expect(undo.workspace.objects[id]).toEqual(before.objects[id]); expect(redo.workspace.objects[id]).toBeUndefined();
    for (const relation of before.relations.filter((r) => r.fromObjectId === id || r.toObjectId === id)) expect(undo.workspace.relations).toContainEqual(relation);
    expect(Object.keys(undo.workspace.directionRevisions)).toEqual(Object.keys(current.directionRevisions));
    expect(undo.workspace.ai).toEqual(current.ai); expect(redo.workspace.ai).toEqual(current.ai);
    expect(JSON.stringify(current)).toBe(json);
  });
  it("renderer auto-grow completes owned creation size; manual resize and changed object content still conflict", () => {
    const before = ensureStageRegions(createBlankWorkspace("measurement")), created = importTextObject(before, { text: "A", position: { x: 0, y: 0 } }), after = ensureStageRegions(created.workspace);
    const id = created.objectIds[0], measured = { ...after, canvas: { ...after.canvas, instances: after.canvas.instances.map((i) => i.objectId === id ? { ...i, size: { ...i.size, h: i.size.h + 100 } } : i) } };
    const stack = history(before, after);
    expect(undoManualHistory(stack, measured).status).toBe("blocked");
    const completed = absorbCanvasMeasurements(stack, after, measured), undo = restored(undoManualHistory(completed, measured)), redo = restored(redoManualHistory(undo.history, undo.workspace));
    expect(redo.workspace.canvas.instances).toEqual(measured.canvas.instances);
    const changedObject = { ...after, objects: { ...after.objects, [id]: { ...after.objects[id], title: "independently changed" } } };
    expect(undoManualHistory(absorbCanvasMeasurements(stack, changedObject, { ...measured, objects: changedObject.objects }), { ...measured, objects: changedObject.objects }).status).toBe("blocked");
  });
  it("layout history binds the instance to its original object and incarnation", () => {
    const before = createInitialWorkspace(), instance = before.canvas.instances[0], after = { ...before, canvas: { ...before.canvas, instances: before.canvas.instances.map((i) => i.id === instance.id ? { ...i, position: { ...i.position, x: i.position.x + 50 } } : i) } };
    const stack = history(before, after);
    const other = Object.keys(before.objects).find((id) => id !== instance.objectId)!;
    const retargeted = { ...after, canvas: { ...after.canvas, instances: after.canvas.instances.map((i) => i.id === instance.id ? { ...i, objectId: other } : i) } };
    expect(undoManualHistory(stack, retargeted).status).toBe("blocked");
    const recreated = { ...after, objects: { ...after.objects, [instance.objectId]: { ...after.objects[instance.objectId], incarnationId: "new-instance-owner" } } };
    expect(undoManualHistory(stack, recreated).status).toBe("blocked");
  });
  it("a Region/member layout commit is one atomic delta and retains both parts on conflict", () => {
    const before = ensureStageRegions(createInitialWorkspace()), instance = before.canvas.instances[0], region = before.canvas.stageRegions![0];
    const after = { ...before, canvas: { ...before.canvas,
      instances: before.canvas.instances.map((i) => i.id === instance.id ? { ...i, position: { ...i.position, x: i.position.x + 30 } } : i),
      stageRegions: before.canvas.stageRegions!.map((r) => r.id === region.id ? { ...r, x: r.x + 30 } : r)
    } };
    const { undo, redo } = roundTrip(before, after);
    expect(undo.workspace.canvas.instances).toEqual(before.canvas.instances);
    expect(undo.workspace.canvas.stageRegions).toEqual(before.canvas.stageRegions);
    expect(redo.workspace.canvas.instances).toEqual(after.canvas.instances);
    const current = { ...after, canvas: { ...after.canvas, stageRegions: after.canvas.stageRegions.map((r) => r.id === region.id ? { ...r, x: r.x + 1 } : r) } }, stack = history(before, after);
    expect(undoManualHistory(stack, current)).toMatchObject({ status: "blocked", history: stack });
    expect(current.canvas.instances).toEqual(after.canvas.instances);
  });
  it("Undo creation prunes its live selection ref while preserving current navigation", () => {
    const before = ensureStageRegions(createBlankWorkspace("created-selection"));
    const created = importTextObject(before, { text: "A", position: { x: 0, y: 0 } }), after = ensureStageRegions(created.workspace);
    const current = { ...after, canvas: { ...after.canvas, view: { x: 90, y: 70, zoom: 2 } } };
    const { undo, redo } = roundTrip(before, after, current);
    expect(undo.workspace.ui.lastSelectionIds).toEqual([]); expect(redo.workspace.canvas.view).toEqual(current.canvas.view);
    expect(redo.workspace.objects[created.objectIds[0]]).toEqual(after.objects[created.objectIds[0]]);
  });
  it("creation owns required Stage membership and retains an independently populated region", () => {
    const before = ensureStageRegions(createBlankWorkspace("stage-members")), created = importTextObject(before, { text: "manual A", position: { x: 0, y: 0 } });
    const after = ensureStageRegions(created.workspace), later = importTextObject(after, { text: "independent B", position: { x: 600, y: 0 } }), current = ensureStageRegions(later.workspace);
    const { undo, redo } = roundTrip(before, after, current);
    expect(undo.workspace.canvas.stageRegions?.some((r) => r.memberObjectIds.includes(created.objectIds[0]))).toBe(false);
    expect(redo.workspace.canvas.stageRegions?.some((r) => r.memberObjectIds.includes(created.objectIds[0]))).toBe(true);
    for (const w of [undo.workspace, redo.workspace]) expect(w.canvas.stageRegions?.find((r) => r.memberObjectIds.includes(later.objectIds[0]))?.isActivated).toBe(true);
  });
  it("does not remove an independent dependent instance when undoing creation", () => {
    const before = createBlankWorkspace("create"), created = importTextObject(before, { text: "A", position: { x: 0, y: 0 } });
    const current = { ...created.workspace, canvas: { ...created.workspace.canvas, instances: [...created.workspace.canvas.instances, { ...created.workspace.canvas.instances[0], id: "independent-instance" }] } };
    expect(undoManualHistory(history(before, created.workspace), current).status).toBe("blocked");
  });
  it("status Undo/Redo preserves Decision history with compensating identity-bound effects and projections", () => {
    const before = createInitialWorkspace(), id = "direction-soft-rail";
    const after = setConceptDirectionStatus(before, id, "eliminated", "manual eliminate");
    const { undo, redo } = roundTrip(before, after, independent(after));
    expect(undo.workspace.objects[id]).toMatchObject({ status: "primary" }); expect(redo.workspace.objects[id]).toMatchObject({ status: "eliminated" });
    expect(undo.workspace.workingState.primaryDirectionId).toBe(id);
    expect(undo.workspace.directionRevisions).toEqual(after.directionRevisions);
    expect(undo.workspace.decisionRecords.slice(0, after.decisionRecords.length)).toEqual(after.decisionRecords);
    expect(classifyDecisionRecords(undo.workspace).filter((r) => r.state === "current" && r.record.effect?.kind === "setDirectionStatus").at(-1)?.record.effect).toMatchObject({ status: "primary", targetIncarnationId: before.objects[id].incarnationId });
    expect(classifyDecisionRecords(redo.workspace).filter((r) => r.state === "current" && r.record.effect?.kind === "setDirectionStatus").at(-1)?.record.effect).toMatchObject({ status: "eliminated" });
  });
  it("detects an independent primary slot owner and changed immutable revision payload before reconciliation", () => {
    const before = createInitialWorkspace(), after = setConceptDirectionStatus(before, "direction-soft-rail", "eliminated", "manual");
    const other = Object.values(after.objects).find((o) => o.type === "conceptDirection" && o.id !== "direction-soft-rail")!;
    const current = setConceptDirectionStatus(after, other.id, "primary", "independent");
    expect(undoManualHistory(history(before, after), current)).toMatchObject({ status: "blocked", conflicts: ["primaryDirection"] });
    const direction = after.objects["direction-soft-rail"]; if (direction.type !== "conceptDirection") throw new Error("direction");
    const revision = after.directionRevisions[direction.currentRevisionId];
    const changed = { ...after, directionRevisions: { ...after.directionRevisions, [revision.id]: { ...revision, summary: "independent edit" } } };
    expect(undoManualHistory(history(before, after), changed).status).toBe("blocked");
  });
  it("Research-owned key conclusion creation/category edits are symmetric without rerunning the source", () => {
    const before = createInitialWorkspace(), sourceId = Object.values(before.objects).find((o) => o.type === "research")!.id;
    const created = createKeyConclusion(before, { title: "manual retained", body: "candidate claim", sourceObjectIds: [sourceId], category: "finding", confidence: "needsVerification", position: { x: 0, y: 0 } });
    const id = created.keyConclusion.id, { undo, redo } = roundTrip(before, created.workspace, independent(created.workspace));
    expect(undo.workspace.objects[id]).toBeUndefined(); expect(redo.workspace.objects[id]).toEqual(created.workspace.objects[id]);
    const changed = setKeyConclusionCategory(redo.workspace, id, "constraint");
    if (changed.status !== "updated") throw new Error(changed.reason);
    const category = roundTrip(redo.workspace, changed.workspace);
    expect(category.undo.workspace.objects[id]).toMatchObject({ category: "finding" }); expect(category.redo.workspace.objects[id]).toMatchObject({ category: "constraint" });
  });
  it("multiple manual mutations undo and redo in chronological order across independent AI writes", () => {
    const a = createBlankWorkspace("order"), b = { ...a, project: { ...a.project, title: "B" } }, c = { ...b, project: { ...b.project, title: "C" } };
    const stack = pushManualHistory(history(a, b), captureManualHistory("second", b, c));
    const u1 = restored(undoManualHistory(stack, independent(c))), u2 = restored(undoManualHistory(u1.history, u1.workspace));
    expect(u2.workspace.project.title).toBe(a.project.title);
    const r1 = restored(redoManualHistory(u2.history, u2.workspace)), r2 = restored(redoManualHistory(r1.history, r1.workspace));
    expect(r2.workspace.project.title).toBe("C"); expect(r2.workspace.ai).toEqual(u2.workspace.ai);
  });
});

describe("Delivery manual history", () => {
  function deliveryFixture() {
    const result = createDeliveryPreparation(createInitialWorkspace(), { title: "manual delivery", format: "board", position: { x: 0, y: 0 } });
    if (result.status !== "updated") throw new Error(result.reason);
    const delivery = result.workspace.objects[result.deliveryObjectId]; if (delivery.type !== "delivery") throw new Error("delivery");
    return { before: result.workspace, deliveryObjectId: delivery.id, sectionId: delivery.sections[0].id, secondSectionId: delivery.sections[1].id };
  }
  it("section edits preserve later caption changes and messages", () => {
    const f = deliveryFixture(), input = { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId };
    const changed = updateDeliverySection(f.before, { ...input, title: "manual section", narrative: "manual narrative" }); if (changed.status !== "updated") throw new Error(changed.reason);
    const { undo, redo } = roundTrip(f.before, changed.workspace, independent(changed.workspace));
    expect(redo.workspace.objects[f.deliveryObjectId]).toEqual(changed.workspace.objects[f.deliveryObjectId]);
    expect(undo.workspace.objects[f.deliveryObjectId]).toMatchObject({ sections: expect.arrayContaining([expect.objectContaining({ id: f.sectionId, title: "项目背景与问题" })]) });
  });
  it("Undo a reference addition preserves a later independent reference in the same section", () => {
    const f = deliveryFixture();
    const manual = addObjectsToDeliverySection(f.before, { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId, sourceObjectIds: ["image-soft-rail-v2"] }); if (manual.status !== "updated") throw new Error(manual.reason);
    const later = addObjectsToDeliverySection(manual.workspace, { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId, sourceObjectIds: ["direction-soft-rail"] }); if (later.status !== "updated") throw new Error(later.reason);
    const { undo, redo } = roundTrip(f.before, manual.workspace, later.workspace);
    const id = later.createdReferenceIds[0]; expect(undo.workspace.deliveryReferences[id]).toEqual(later.workspace.deliveryReferences[id]); expect(redo.workspace.deliveryReferences[id]).toEqual(later.workspace.deliveryReferences[id]);
  });
  it("editorial ownership rejects a recreated Delivery owner", () => {
    const f = deliveryFixture(), added = addObjectsToDeliverySection(f.before, { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId, sourceObjectIds: ["image-soft-rail-v2"] }); if (added.status !== "updated") throw new Error(added.reason);
    const edited = updateDeliveryReferenceEditorial(added.workspace, { deliveryObjectId: f.deliveryObjectId, referenceId: added.createdReferenceIds[0], caption: "manual" }); if (edited.status !== "updated") throw new Error(edited.reason);
    const current = { ...edited.workspace, objects: { ...edited.workspace.objects, [f.deliveryObjectId]: { ...edited.workspace.objects[f.deliveryObjectId], incarnationId: "new-delivery-owner" } } };
    expect(undoManualHistory(history(added.workspace, edited.workspace), current).status).toBe("blocked");
  });
  it("first caption edit owns only caption and preserves an independent later note", () => {
    const f = deliveryFixture(), added = addObjectsToDeliverySection(f.before, { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId, sourceObjectIds: ["image-soft-rail-v2"] }); if (added.status !== "updated") throw new Error(added.reason);
    const referenceId = added.createdReferenceIds[0], input = { deliveryObjectId: f.deliveryObjectId, referenceId };
    const caption = updateDeliveryReferenceEditorial(added.workspace, { ...input, caption: "manual caption" }); if (caption.status !== "updated") throw new Error(caption.reason);
    const note = updateDeliveryReferenceEditorial(caption.workspace, { ...input, note: "independent note" }); if (note.status !== "updated") throw new Error(note.reason);
    const { undo, redo } = roundTrip(added.workspace, caption.workspace, note.workspace);
    expect(undo.workspace.deliveryReferences[referenceId].editorial).toEqual({ note: "independent note" });
    expect(redo.workspace.deliveryReferences[referenceId].editorial).toEqual({ caption: "manual caption", note: "independent note" });
    const clean = roundTrip(added.workspace, caption.workspace);
    expect(clean.undo.workspace.deliveryReferences[referenceId].editorial).toBeUndefined();
    expect(restored(undoManualHistory(history(f.before, added.workspace), clean.undo.workspace)).workspace.deliveryReferences[referenceId]).toBeUndefined();
  });
  it("reference add/remove/move/editorial edits remain symmetric and keep stable snapshot identity", () => {
    const f = deliveryFixture();
    const add = addObjectsToDeliverySection(f.before, { deliveryObjectId: f.deliveryObjectId, sectionId: f.sectionId, sourceObjectIds: ["image-soft-rail-v2"] }); if (add.status !== "updated") throw new Error(add.reason);
    const id = add.createdReferenceIds[0];
    const added = roundTrip(f.before, add.workspace, independent(add.workspace)); expect(added.undo.workspace.deliveryReferences[id]).toBeUndefined(); expect(added.redo.workspace.deliveryReferences[id]).toEqual(add.workspace.deliveryReferences[id]);
    const edit = updateDeliveryReferenceEditorial(add.workspace, { deliveryObjectId: f.deliveryObjectId, referenceId: id, caption: "manual caption", note: "manual note" }); if (edit.status !== "updated") throw new Error(edit.reason);
    const edited = roundTrip(add.workspace, edit.workspace, independent(edit.workspace)); expect(edited.redo.workspace.deliveryReferences[id]).toMatchObject({ editorial: { caption: "manual caption", note: "manual note" } });
    const move = moveDeliveryReference(edit.workspace, { deliveryObjectId: f.deliveryObjectId, referenceId: id, toSectionId: f.secondSectionId, toIndex: 0 }); if (move.status !== "updated") throw new Error(move.reason);
    const moved = roundTrip(edit.workspace, move.workspace, independent(move.workspace)); expect(moved.redo.workspace.deliveryReferences[id].snapshot).toEqual(add.workspace.deliveryReferences[id].snapshot);
    const remove = removeDeliveryReference(move.workspace, { deliveryObjectId: f.deliveryObjectId, referenceId: id }); if (remove.status !== "updated") throw new Error(remove.reason);
    const removed = roundTrip(move.workspace, remove.workspace, independent(remove.workspace)); expect(removed.undo.workspace.deliveryReferences[id]).toEqual(move.workspace.deliveryReferences[id]); expect(removed.redo.workspace.deliveryReferences[id]).toBeUndefined();
  });
});
