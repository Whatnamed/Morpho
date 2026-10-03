import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveVisualBranch, createBlankWorkspace, createInitialWorkspace, createVisualBranch, restoreVisualBranch, setConceptDirectionStatus, setDefaultReference } from "@/domain/morpho/workspace";
import { importTextObject } from "@/domain/morpho/imports";
import { addObjectsToDeliverySection, createDeliveryPreparation, createDeliverySection, updateDeliveryReferenceEditorial } from "@/domain/morpho/deliveryPreparation";
import { classifyDecisionRecords } from "@/domain/morpho/decisionRecords";
import { getContinuityEntryEligibility, resolveContinuityValidity } from "@/domain/morpho/continuityAuthority";
import { buildProjectContinuityContext } from "@/domain/morpho/projectContinuity";
import { getCurrentProjectMemoryRevision, getCurrentStageRecordRevision } from "@/domain/morpho/projectMemory";
import { validateCurrentMorphoWorkspace } from "@/domain/morpho/currentWorkspaceValidation";
import type { ContinuityRecordEntry, MorphoWorkspace } from "@/domain/morpho/types";
import { captureManualHistory, createManualHistory, pushManualHistory, redoManualHistory, undoManualHistory, type ManualHistoryResult } from "./workspaceUndo";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-03T02:00:00Z"); });
afterEach(() => vi.useRealTimers());
const tick = () => vi.setSystemTime(Date.now() + 1000);
function history(before: MorphoWorkspace, after: MorphoWorkspace) { return pushManualHistory(createManualHistory(), captureManualHistory("manual continuity", before, after)); }
function restored(result: ManualHistoryResult) {
  expect(result.status, result.status === "blocked" ? result.conflicts.join(",") : undefined).toBe("restored");
  if (result.status !== "restored") throw new Error(result.status);
  expect(validateCurrentMorphoWorkspace(result.workspace).status).toBe("ok");
  expect(validateCurrentMorphoWorkspace(JSON.parse(JSON.stringify(result.workspace))).status).toBe("ok");
  return result;
}
function added(before: MorphoWorkspace, after: MorphoWorkspace) {
  return after.projectContinuity.recordEntries.filter((entry) => !before.projectContinuity.recordEntries.some((old) => old.id === entry.id));
}
function currentProjectionText(workspace: MorphoWorkspace) {
  return JSON.stringify({
    memory: Object.values(workspace.projectMemory.documents).map((document) => getCurrentProjectMemoryRevision(workspace.projectMemory, document.key)?.sections),
    stages: Object.values(workspace.projectMemory.stageRecords).map((record) => getCurrentStageRecordRevision(workspace.projectMemory, record.stage)?.sections)
  });
}
function withdrawn(workspace: MorphoWorkspace, original: ContinuityRecordEntry) {
  const entry = resolveContinuityValidity(workspace).projectContinuity.recordEntries.find((entry) => entry.id === original.id)!;
  expect(entry).toMatchObject({ id: original.id, dedupeKey: original.dedupeKey, origin: "deterministicEvent", summary: original.summary, createdAt: original.createdAt, manualState: "withdrawn" });
  expect(entry.lifecycleEvidence).toBeUndefined();
  expect(getContinuityEntryEligibility(entry)).toMatchObject({ canEnterMemory: false, canEnterDefaultContext: false, canEnterReviewList: false });
  expect(currentProjectionText(workspace)).not.toContain(original.id);
  expect(currentProjectionText(workspace)).not.toContain(original.summary);
  const context = buildProjectContinuityContext(workspace, { taskKind: "visualDevelopment", selectedObjectIds: [] });
  expect(context.relevantStageRecords.map((entry) => entry.id)).not.toContain(original.id);
}
function branchFixture() {
  const created = createVisualBranch(createInitialWorkspace(), { branchId: "manual-branch-a", directionId: "direction-soft-rail", label: "manual branch A" });
  if (created.status !== "updated") throw new Error(created.reason);
  tick(); return created.workspace;
}

describe("manual deterministic Continuity and Focus compensation", () => {
  it.each(["archive", "restore"] as const)("Branch %s -> Undo/Redo retains occurrence and compensates current projections/Focus", (action) => {
    let before = branchFixture();
    if (action === "restore") { const archived = archiveVisualBranch(before, "manual-branch-a"); before = archived.workspace; tick(); }
    const result = action === "archive" ? archiveVisualBranch(before, "manual-branch-a") : restoreVisualBranch(before, "manual-branch-a");
    if (result.status !== "updated") throw new Error(result.reason);
    const after = result.workspace, [entry] = added(before, after);
    const undo = restored(undoManualHistory(history(before, after), after));
    expect(Boolean(undo.workspace.visualBranches["manual-branch-a"].archivedAt)).toBe(action === "restore");
    withdrawn(undo.workspace, entry);
    expect(undo.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    const redo = restored(redoManualHistory(undo.history, undo.workspace));
    expect(Boolean(redo.workspace.visualBranches["manual-branch-a"].archivedAt)).toBe(action === "archive");
    expect(redo.workspace.projectContinuity.recordEntries.find((record) => record.id === entry.id)?.manualState).toBe("active");
    expect(redo.workspace.projectContinuity.currentFocus).toEqual(after.projectContinuity.currentFocus);
    expect(currentProjectionText(redo.workspace)).toContain(entry.summary);
    expect(getContinuityEntryEligibility(resolveContinuityValidity(redo.workspace).projectContinuity.recordEntries.find((record) => record.id === entry.id)!)).toEqual(getContinuityEntryEligibility(resolveContinuityValidity(after).projectContinuity.recordEntries.find((record) => record.id === entry.id)!));
  });

  it("later independent input event/Focus survives earlier Branch Undo and repeated Redo/Undo", () => {
    const before = branchFixture(), after = archiveVisualBranch(before, "manual-branch-a").workspace; tick();
    const later = importTextObject(after, { text: "independent B", position: { x: 900, y: 0 } }).workspace, [b] = added(after, later);
    const undo = restored(undoManualHistory(history(before, after), later));
    const redo = restored(redoManualHistory(undo.history, undo.workspace));
    const again = restored(undoManualHistory(redo.history, redo.workspace));
    for (const result of [undo, redo, again]) {
      expect(result.workspace.projectContinuity.recordEntries.find((record) => record.id === b.id)).toEqual(b);
      expect(result.workspace.projectContinuity.currentFocus).toEqual(later.projectContinuity.currentFocus);
      expect(currentProjectionText(result.workspace)).toContain(b.summary);
    }
    expect(undo.workspace.visualBranches["manual-branch-a"].archivedAt).toBeUndefined();
  });

  it("chronological Branch actions retain Focus ownership across lifecycle timestamp compensation", () => {
    const before = branchFixture(), archived = archiveVisualBranch(before, "manual-branch-a").workspace; tick();
    const active = restoreVisualBranch(archived, "manual-branch-a").workspace;
    const stack = pushManualHistory(history(before, archived), captureManualHistory("restore", archived, active));
    const undoRestore = restored(undoManualHistory(stack, active)), undoArchive = restored(undoManualHistory(undoRestore.history, undoRestore.workspace));
    expect(undoRestore.workspace.projectContinuity.currentFocus).toEqual(archived.projectContinuity.currentFocus);
    expect(undoArchive.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    const redoArchive = restored(redoManualHistory(undoArchive.history, undoArchive.workspace)), redoRestore = restored(redoManualHistory(redoArchive.history, redoArchive.workspace));
    expect(redoArchive.workspace.projectContinuity.currentFocus).toEqual(archived.projectContinuity.currentFocus);
    expect(redoRestore.workspace.projectContinuity.currentFocus).toEqual(active.projectContinuity.currentFocus);
  });

  it("an independently edited owned occurrence blocks atomically without consuming entity/history state", () => {
    const before = branchFixture(), after = archiveVisualBranch(before, "manual-branch-a").workspace, [a] = added(before, after);
    const stack = history(before, after), current = { ...after, projectContinuity: { ...after.projectContinuity,
      recordEntries: after.projectContinuity.recordEntries.map((record) => record.id === a.id ? { ...record, manualState: "notApplicable" as const } : record)
    } }, json = JSON.stringify(current);
    expect(undoManualHistory(stack, current)).toMatchObject({ status: "blocked", history: stack });
    expect(JSON.stringify(current)).toBe(json);
    const undo = restored(undoManualHistory(stack, after));
    const changedUndo = { ...undo.workspace, projectContinuity: { ...undo.workspace.projectContinuity,
      recordEntries: undo.workspace.projectContinuity.recordEntries.map((record) => record.id === a.id ? { ...record, summary: "independent correction" } : record)
    } };
    expect(redoManualHistory(undo.history, changedUndo)).toMatchObject({ status: "blocked", history: undo.history });
    expect(changedUndo.visualBranches["manual-branch-a"].archivedAt).toBeUndefined();
  });

  it("Delivery section creation owns its event and Focus, preserving a same-value later Focus occurrence", () => {
    const delivery = createDeliveryPreparation(createBlankWorkspace("delivery-continuity"), { title: "Delivery A", format: "board", position: { x: 0, y: 0 } });
    if (delivery.status !== "updated") throw new Error(delivery.reason);
    tick(); const before = delivery.workspace;
    const created = createDeliverySection(before, { deliveryObjectId: delivery.deliveryObjectId, title: "manual section A" });
    if (created.status !== "updated") throw new Error(created.reason);
    const after = created.workspace, [a] = added(before, after);
    const undo = restored(undoManualHistory(history(before, after), after)); withdrawn(undo.workspace, a);
    expect(undo.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    const redo = restored(redoManualHistory(undo.history, undo.workspace));
    expect(redo.workspace.projectContinuity.currentFocus).toEqual(after.projectContinuity.currentFocus);
    expect(currentProjectionText(redo.workspace)).toContain(a.summary);
    const later = createDeliverySection(after, { deliveryObjectId: delivery.deliveryObjectId, title: "independent section B" }).workspace, [b] = added(after, later);
    // Same note, timestamp and sources; distinct deterministic occurrence still owns the later Focus.
    expect(later.projectContinuity.currentFocus).toEqual(after.projectContinuity.currentFocus);
    const independentUndo = restored(undoManualHistory(history(before, after), later));
    const independentRedo = restored(redoManualHistory(independentUndo.history, independentUndo.workspace));
    for (const result of [independentUndo, independentRedo]) {
      expect(result.workspace.projectContinuity.currentFocus).toEqual(later.projectContinuity.currentFocus);
      expect(result.workspace.projectContinuity.recordEntries.find((record) => record.id === b.id)).toEqual(b);
    }
    const object = independentUndo.workspace.objects[delivery.deliveryObjectId];
    expect(object.type === "delivery" && object.sections.map((section) => section.title)).toContain("independent section B");
    expect(object.type === "delivery" && object.sections.map((section) => section.title)).not.toContain("manual section A");
  });

  it("consecutive same-value Delivery Focus occurrences return ownership when the later manual action is undone", () => {
    const delivery = createDeliveryPreparation(createBlankWorkspace("delivery-focus-order"), { title: "Delivery A", format: "board", position: { x: 0, y: 0 } });
    if (delivery.status !== "updated") throw new Error(delivery.reason);
    tick(); const before = delivery.workspace;
    const a = createDeliverySection(before, { deliveryObjectId: delivery.deliveryObjectId, title: "manual section A" }).workspace;
    const b = createDeliverySection(a, { deliveryObjectId: delivery.deliveryObjectId, title: "manual section B" }).workspace;
    expect(a.projectContinuity.currentFocus).toEqual(b.projectContinuity.currentFocus);
    const stack = pushManualHistory(history(before, a), captureManualHistory("section B", a, b));
    const undoB = restored(undoManualHistory(stack, b)), undoA = restored(undoManualHistory(undoB.history, undoB.workspace));
    expect(undoA.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    const redoA = restored(redoManualHistory(undoA.history, undoA.workspace)), redoB = restored(redoManualHistory(redoA.history, redoA.workspace));
    expect(redoA.workspace.projectContinuity.currentFocus).toEqual(a.projectContinuity.currentFocus);
    expect(redoB.workspace.projectContinuity.currentFocus).toEqual(b.projectContinuity.currentFocus);
  });

  it("manual input creation withdraws its occurrence and restores Focus without deleting historical records", () => {
    const before = createBlankWorkspace("import-continuity"); tick();
    const created = importTextObject(before, { text: "manual input A", position: { x: 0, y: 0 } }), after = created.workspace, [entry] = added(before, after);
    const undo = restored(undoManualHistory(history(before, after), after)); withdrawn(undo.workspace, entry);
    expect(undo.workspace.objects[created.objectIds[0]]).toBeUndefined();
    expect(undo.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    const redo = restored(redoManualHistory(undo.history, undo.workspace));
    expect(redo.workspace.objects[created.objectIds[0]]).toEqual(after.objects[created.objectIds[0]]);
    expect(redo.workspace.projectContinuity.currentFocus).toEqual(after.projectContinuity.currentFocus);
    expect(currentProjectionText(redo.workspace)).toContain(entry.summary);
    expect(getContinuityEntryEligibility(redo.workspace.projectContinuity.recordEntries.find((record) => record.id === entry.id)!)).toMatchObject({ canEnterMemory: true, canEnterDefaultContext: true });
  });

  it("manual input creation preserves a later input event and Focus with identical visible wording", () => {
    const before = createBlankWorkspace("later-import"); tick();
    const created = importTextObject(before, { text: "manual A", position: { x: 0, y: 0 } }); tick();
    const later = importTextObject(created.workspace, { text: "independent B", position: { x: 500, y: 0 } }), [b] = added(created.workspace, later.workspace);
    const undo = restored(undoManualHistory(history(before, created.workspace), later.workspace)), redo = restored(redoManualHistory(undo.history, undo.workspace));
    for (const result of [undo, redo]) {
      expect(result.workspace.projectContinuity.currentFocus).toEqual(later.workspace.projectContinuity.currentFocus);
      expect(result.workspace.projectContinuity.recordEntries.find((record) => record.id === b.id)).toEqual(b);
      expect(result.workspace.objects[later.objectIds[0]]).toEqual(later.workspace.objects[later.objectIds[0]]);
    }
    expect(undo.workspace.objects[created.objectIds[0]]).toBeUndefined();
  });

  it("Direction Decision compensation preserves independent Focus and withdraws its own inverse event on the next flip", () => {
    const before = createInitialWorkspace(); tick();
    const after = setConceptDirectionStatus(before, "direction-soft-rail", "alternative", "manual status"); tick();
    const later = importTextObject(after, { text: "independent B", position: { x: 900, y: 0 } }).workspace, [b] = added(after, later);
    const undo = restored(undoManualHistory(history(before, after), later)), inverseEntries = added(later, undo.workspace);
    expect(inverseEntries.length).toBeGreaterThan(0);
    const redo = restored(redoManualHistory(undo.history, undo.workspace));
    for (const entry of inverseEntries) expect(redo.workspace.projectContinuity.recordEntries.find((record) => record.id === entry.id)?.manualState).toBe("withdrawn");
    for (const result of [undo, redo]) {
      expect(result.workspace.projectContinuity.currentFocus).toEqual(later.projectContinuity.currentFocus);
      expect(result.workspace.projectContinuity.recordEntries.find((record) => record.id === b.id)).toEqual(b);
    }
  });

  it("Default Reference compensation retains identity-bound current Decisions and owned Focus", () => {
    const base = createInitialWorkspace();
    // Demo visuals lack assetId; P1B's current reference Decision requires an
    // asset-backed image. Supply local metadata, without any Provider execution.
    const before = { ...base, assets: { ...base.assets }, objects: { ...base.objects } };
    for (const id of ["image-soft-rail-v2", "image-night-scenario"]) {
      const image = before.objects[id]; if (image.type !== "image") throw new Error("image");
      const assetId = `asset-${id}`;
      before.assets[assetId] = { id: assetId, fileName: "reference.png", mimeType: "image/png", size: 1, storageKey: assetId, sourceType: "originalImage", createdAt: new Date().toISOString() };
      before.objects[id] = { ...image, assetId };
    }
    tick();
    const after = setDefaultReference(before, "image-night-scenario", { reason: "manual reference" });
    const undo = restored(undoManualHistory(history(before, after), after)), redo = restored(redoManualHistory(undo.history, undo.workspace));
    for (const [result, expected] of [[undo, before], [redo, after]] as const) {
      const id = expected.workingState.currentDefaultReferenceId;
      expect(result.workspace.workingState.currentDefaultReferenceId).toBe(id);
      expect(result.workspace.projectContinuity.currentFocus).toEqual(expected.projectContinuity.currentFocus);
      expect(classifyDecisionRecords(result.workspace).some(({ state, record }) => state === "current" && record.effect?.kind === "setDefaultReference" && record.effect.referenceObjectId === id)).toBe(true);
    }
  });

  it("editorial-only edits add no Continuity event or Focus effect", () => {
    const delivery = createDeliveryPreparation(createInitialWorkspace(), { title: "editorial", format: "board", position: { x: 0, y: 0 } });
    if (delivery.status !== "updated") throw new Error(delivery.reason);
    const object = delivery.workspace.objects[delivery.deliveryObjectId]; if (object.type !== "delivery") throw new Error("delivery");
    const reference = addObjectsToDeliverySection(delivery.workspace, { deliveryObjectId: object.id, sectionId: object.sections[0].id, sourceObjectIds: ["image-soft-rail-v2"] });
    if (reference.status !== "updated") throw new Error(reference.reason);
    const before = reference.workspace, after = updateDeliveryReferenceEditorial(before, { deliveryObjectId: object.id, referenceId: reference.createdReferenceIds[0], caption: "manual caption" }).workspace;
    const entry = captureManualHistory("editorial", before, after)!;
    expect(entry.deterministicContinuity).toEqual({}); expect(entry.focus).toBeUndefined();
    const undo = restored(undoManualHistory(pushManualHistory(createManualHistory(), entry), after)), redo = restored(redoManualHistory(undo.history, undo.workspace));
    for (const result of [undo, redo]) {
      expect(result.workspace.projectContinuity.recordEntries).toEqual(before.projectContinuity.recordEntries);
      expect(result.workspace.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
    }
  });
});
