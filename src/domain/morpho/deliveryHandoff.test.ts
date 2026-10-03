import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createBlankWorkspace, createInitialWorkspace, migrateWorkspaceToCurrentSchema, setConceptDirectionStatus } from "./workspace";
import { addObjectsToDeliverySection, applyDeliverySectionDraft, confirmDeliveryCopyReview, createDeliveryPreparation, createDeliverySectionDraft, moveDeliveryReference, refreshDeliveryReferenceSnapshot, removeDeliveryReference, removeDeliverySection, updateDeliveryReferenceEditorial, updateDeliverySection } from "./deliveryPreparation";
import { captureDeliveryGenerationBaseline, inspectDelivery, inspectDeliveryDraft, inspectDeliveryReference } from "./deliveryInspection";
import { createEditableProjectBackupManifest } from "./projectArchive";
import { createHumanReadableArchiveManifest } from "./projectArchive";
import { createHumanReadableArchiveBundle } from "./projectBundles";
import { buildDeliverySectionContext, getDeliverySectionReferences } from "@/features/workspace/deliveryPreparationUi";
import { createDeliveryOutputManifest } from "./deliveryOutput";
import { exportDeliveryOutputPackage } from "@/features/delivery-output/deliveryOutputClient";
import { captureManualHistory, createManualHistory, pushManualHistory, redoManualHistory, undoManualHistory } from "@/features/workspace/workspaceManualHistory";
import type { DeliveryObject, MorphoWorkspace } from "./types";

const NOW = "2026-10-03T03:00:00.000Z";
function updated<T extends { status: string; workspace: MorphoWorkspace }>(result: T): T {
  expect(result.status).toBe("updated"); return result;
}
function fixture() {
  const base = createBlankWorkspace("p5-handoff");
  for (const id of ["a", "b", "c", "d", "e"]) base.objects[id] = { id, incarnationId: `incarnation-${id}`, type: "text", title: id, summary: `summary-${id}`, body: `body-${id}`, visibility: "active", createdBy: "user", createdAt: NOW };
  const created = createDeliveryPreparation(base, { title: "P5", format: "presentation", position: { x: 0, y: 0 }, now: NOW });
  if (created.status !== "updated") throw new Error(created.reason);
  const deliveryId = created.deliveryObjectId;
  const sectionId = (created.workspace.objects[deliveryId] as DeliveryObject).sections[0].id;
  const added = addObjectsToDeliverySection(created.workspace, { deliveryObjectId: deliveryId, sectionId, sourceObjectIds: ["a", "b", "c"], now: NOW });
  if (added.status !== "updated") throw new Error(added.reason);
  return { workspace: added.workspace, deliveryId, sectionId, ids: added.createdReferenceIds };
}
function draft(workspace: MorphoWorkspace, deliveryId: string, sectionId: string) {
  const result = createDeliverySectionDraft(workspace, { deliveryObjectId: deliveryId, sectionId, generationBaseline: captureDeliveryGenerationBaseline(workspace, deliveryId, sectionId), userMessageId: "u", assistantMessageId: "a", narrative: "model-copy", captions: [], suggestedGaps: [], now: NOW });
  if (result.status !== "updated") throw new Error(result.reason);
  return { workspace: result.workspace, draft: result.workspace.deliverySectionDrafts[result.draftId] };
}

describe("P5 generation baseline and applicability", () => {
  it("preserves baseline A when committing generated copy to B, and blocks newer narrative overwrite", () => {
    const f = fixture(), baselineA = captureDeliveryGenerationBaseline(f.workspace, f.deliveryId, f.sectionId)!;
    const b = updated(updateDeliverySection(f.workspace, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId, narrative: "user-copy-B" })).workspace;
    const landed = updated(createDeliverySectionDraft(b, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId, generationBaseline: baselineA, userMessageId: "u", assistantMessageId: "a", narrative: "model-copy-A", captions: [], suggestedGaps: [] }));
    if (landed.status !== "updated") throw new Error("draft");
    const stored = landed.workspace.deliverySectionDrafts[landed.draftId];
    expect(stored.generationBaseline).toEqual(baselineA);
    expect(stored.generationBaseline?.sectionFingerprint).not.toBe(captureDeliveryGenerationBaseline(b, f.deliveryId, f.sectionId)?.sectionFingerprint);
    expect(inspectDeliveryDraft(landed.workspace, stored).status).toBe("stale");
    expect(applyDeliverySectionDraft(landed.workspace, { deliveryObjectId: f.deliveryId, draftId: stored.id, acknowledgeReview: true }).status).toBe("blocked");
    expect((landed.workspace.objects[f.deliveryId] as DeliveryObject).sections[0].narrative).toBe("user-copy-B");
  });

  it.each(["narrative", "purpose", "title", "caption", "note", "add", "remove", "reorder", "move", "refresh"])("invalidates the exact dependency after %s changes", (change) => {
    const f = fixture(), d = draft(f.workspace, f.deliveryId, f.sectionId);
    expect(inspectDeliveryDraft(d.workspace, d.draft).status).toBe("current");
    let next = d.workspace;
    const input = { deliveryObjectId: f.deliveryId, sectionId: f.sectionId };
    if (["narrative", "purpose", "title"].includes(change)) next = updated(updateDeliverySection(next, { ...input, [change]: "later-user-edit" })).workspace;
    if (["caption", "note"].includes(change)) next = updated(updateDeliveryReferenceEditorial(next, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0], [change]: "later-user-edit" })).workspace;
    if (change === "add") next = updated(addObjectsToDeliverySection(next, { ...input, sourceObjectIds: ["d"] })).workspace;
    if (change === "remove") next = updated(removeDeliveryReference(next, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0] })).workspace;
    if (change === "reorder" || change === "move") next = updated(moveDeliveryReference(next, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0], toIndex: 2, toSectionId: change === "move" ? (next.objects[f.deliveryId] as DeliveryObject).sections[1].id : f.sectionId })).workspace;
    if (change === "refresh") {
      const source = next.objects.a; if (source.type !== "text") throw new Error("text");
      next = { ...next, objects: { ...next.objects, a: { ...source, body: "changed upstream" } } };
      next = updated(refreshDeliveryReferenceSnapshot(next, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0], reason: "adopt new snapshot" })).workspace;
    }
    expect(inspectDeliveryDraft(next, d.draft).status).toBe("stale");
    expect(applyDeliverySectionDraft(next, { deliveryObjectId: f.deliveryId, draftId: d.draft.id, acknowledgeReview: true }).status).toBe("blocked");
    expect(createEditableProjectBackupManifest(next).status).toBe("ok");
  });

  it("keeps frozen dependencies applicable after upstream change, but requires explicit review", () => {
    const f = fixture(), d = draft(f.workspace, f.deliveryId, f.sectionId), source = d.workspace.objects.a;
    if (source.type !== "text") throw new Error("text");
    const next = { ...d.workspace, objects: { ...d.workspace.objects, a: { ...source, body: "upstream B" } } };
    expect(inspectDeliveryDraft(next, d.draft).status).toBe("review-required");
    expect(applyDeliverySectionDraft(next, { deliveryObjectId: f.deliveryId, draftId: d.draft.id }).status).toBe("blocked");
    expect(applyDeliverySectionDraft(next, { deliveryObjectId: f.deliveryId, draftId: d.draft.id, acknowledgeReview: true }).status).toBe("updated");
    expect(next.deliveryReferences[f.ids[0]].snapshot.body).toBe("body-a");
  });

  it("loads legacy Drafts without fabricating evidence and blocks implicit apply; removed targets remain backup-safe", () => {
    const f = fixture(), d = draft(f.workspace, f.deliveryId, f.sectionId);
    const legacy = { ...d.draft, generationBaseline: undefined };
    const loaded = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify({ ...d.workspace, deliverySectionDrafts: { [legacy.id]: legacy } })));
    if (loaded.status !== "ok") throw new Error("migration");
    expect(loaded.workspace.deliverySectionDrafts[legacy.id].generationBaseline).toBeUndefined();
    expect(inspectDeliveryDraft(loaded.workspace, loaded.workspace.deliverySectionDrafts[legacy.id]).status).toBe("review-required");
    expect(applyDeliverySectionDraft(loaded.workspace, { deliveryObjectId: f.deliveryId, draftId: legacy.id }).status).toBe("blocked");
    let next = loaded.workspace;
    for (const referenceId of f.ids) next = updated(removeDeliveryReference(next, { deliveryObjectId: f.deliveryId, referenceId })).workspace;
    next = updated(removeDeliverySection(next, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId })).workspace;
    expect(inspectDeliveryDraft(next, legacy).status).toBe("blocked");
    expect(createEditableProjectBackupManifest(next).status).toBe("ok");
  });
});

describe("P5 inspection, ordering, output and manual history", () => {
  it("preserves copy on refresh, exposes review across surfaces, and Undo/Redo preserves later runtime writes", () => {
    const f = fixture();
    let before = updated(updateDeliveryReferenceEditorial(f.workspace, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0], caption: "old caption", note: "old note" })).workspace;
    before = updated(updateDeliverySection(before, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId, narrative: "old narrative" })).workspace;
    const source = before.objects.a; if (source.type !== "text") throw new Error("text");
    before = { ...before, objects: { ...before.objects, a: { ...source, body: "new snapshot" } } };
    const originalDraft = draft(before, f.deliveryId, f.sectionId);
    before = originalDraft.workspace;
    const after = updated(refreshDeliveryReferenceSnapshot(before, { deliveryObjectId: f.deliveryId, referenceId: f.ids[0], reason: "refresh" })).workspace;
    expect(after.deliveryReferences[f.ids[0]].editorial).toEqual({ caption: "old caption", note: "old note" });
    expect((after.objects[f.deliveryId] as DeliveryObject).sections[0].narrative).toBe("old narrative");
    const facts = inspectDeliveryReference(after, after.deliveryReferences[f.ids[0]]);
    expect(facts).toMatchObject({ sourceFreshness: "current", copyReview: "needsReview" });
    const context = buildDeliverySectionContext(after, after.objects[f.deliveryId] as DeliveryObject, f.sectionId)!;
    expect(context.references[0].inspection).toEqual(facts);
    const manifest = createDeliveryOutputManifest(after, { deliveryObjectId: f.deliveryId });
    if (manifest.status === "blocked") throw new Error(manifest.reason);
    expect(manifest.manifest.references[0].inspection).toEqual(facts);
    const laterDraft = createDeliverySectionDraft(after, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId, generationBaseline: captureDeliveryGenerationBaseline(after, f.deliveryId, f.sectionId), userMessageId: "later-u", assistantMessageId: "later-a", narrative: "independent AI draft B", captions: [], suggestedGaps: [] });
    if (laterDraft.status !== "updated") throw new Error(laterDraft.reason);
    const independent = { ...laterDraft.workspace, ai: { ...after.ai, messages: [...after.ai.messages, { id: "independent-runtime", role: "assistant" as const, body: "B result", createdAt: NOW }] } };
    const history = pushManualHistory(createManualHistory(), captureManualHistory("refresh", before, after));
    const undo = undoManualHistory(history, independent); if (undo.status !== "restored") throw new Error(JSON.stringify(undo));
    expect(undo.workspace.ai).toEqual(independent.ai);
    expect(undo.workspace.deliverySectionDrafts[laterDraft.draftId]).toEqual(independent.deliverySectionDrafts[laterDraft.draftId]);
    expect(inspectDeliveryDraft(undo.workspace, originalDraft.draft).status).toBe("review-required");
    expect(inspectDeliveryDraft(undo.workspace, undo.workspace.deliverySectionDrafts[laterDraft.draftId]).status).toBe("stale");
    expect(inspectDeliveryReference(undo.workspace, undo.workspace.deliveryReferences[f.ids[0]]).sourceFreshness).toBe("sourceUpdated");
    const redo = redoManualHistory(undo.history, undo.workspace); if (redo.status !== "restored") throw new Error(JSON.stringify(redo));
    expect(redo.workspace.ai).toEqual(independent.ai);
    expect(redo.workspace.deliverySectionDrafts[laterDraft.draftId]).toEqual(independent.deliverySectionDrafts[laterDraft.draftId]);
    expect(inspectDeliveryDraft(redo.workspace, originalDraft.draft).status).toBe("stale");
    expect(inspectDeliveryDraft(redo.workspace, redo.workspace.deliverySectionDrafts[laterDraft.draftId]).status).toBe("review-required");
    expect(inspectDeliveryReference(redo.workspace, redo.workspace.deliveryReferences[f.ids[0]])).toEqual(facts);
    const loaded = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(redo.workspace)));
    if (loaded.status !== "ok") throw new Error("reload");
    expect(inspectDelivery(loaded.workspace, loaded.workspace.objects[f.deliveryId] as DeliveryObject).sections[f.sectionId].copyReview).toBe("needsReview");
    const reviewed = updated(confirmDeliveryCopyReview(redo.workspace, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId })).workspace;
    expect(inspectDeliveryReference(reviewed, reviewed.deliveryReferences[f.ids[0]]).copyReview).toBe("reviewed");
  });

  it("uses the section authority for repeated moves, context, output, reload and Undo/Redo", () => {
    const f = fixture(), before = f.workspace;
    let next = before;
    for (const [referenceId, toIndex] of [[f.ids[0], 2], [f.ids[1], 2], [f.ids[2], 1]] as const) next = updated(moveDeliveryReference(next, { deliveryObjectId: f.deliveryId, referenceId, toIndex, toSectionId: f.sectionId })).workspace;
    const assertOrder = (workspace: MorphoWorkspace) => {
      const delivery = workspace.objects[f.deliveryId] as DeliveryObject, section = delivery.sections[0];
      expect(getDeliverySectionReferences(workspace, section).map((ref) => ref.id)).toEqual(section.referenceIds);
      expect(buildDeliverySectionContext(workspace, delivery, section.id)?.references.map((ref) => ref.referenceId)).toEqual(section.referenceIds);
      const output = createDeliveryOutputManifest(workspace, { deliveryObjectId: f.deliveryId }); if (output.status === "blocked") throw new Error(output.reason);
      expect(output.manifest.references.map((ref) => ref.referenceId)).toEqual(section.referenceIds);
      expect(output.manifest.references.map((ref) => ref.order)).toEqual([0, 1, 2]);
    };
    assertOrder(next);
    const loaded = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(next))); if (loaded.status !== "ok") throw new Error("migration"); assertOrder(loaded.workspace);
    const history = pushManualHistory(createManualHistory(), captureManualHistory("move references", before, next));
    const undo = undoManualHistory(history, next); if (undo.status !== "restored") throw new Error(JSON.stringify(undo)); assertOrder(undo.workspace);
    const redo = redoManualHistory(undo.history, undo.workspace); if (redo.status !== "restored") throw new Error(JSON.stringify(redo)); assertOrder(redo.workspace);
  });

  it("exports simultaneous freshness, availability, draft, review, gap and provenance facts consistently", async () => {
    const f = fixture(); let next = f.workspace;
    const assetId = "missing-metadata";
    next = { ...next, objects: { ...next.objects, image: { id: "image", incarnationId: "image-incarnation", type: "image", role: "reference", title: "missing image", summary: "unverified", assetId, visibility: "active", createdBy: "ai" }, research: { id: "research", incarnationId: "research-incarnation", type: "research", title: "candidate research", summary: "not confirmed", findings: ["candidate finding"], opportunities: [], constraints: [], openQuestions: ["unverified question"], visibility: "active", createdBy: "ai" } } };
    next = updated(addObjectsToDeliverySection(next, { deliveryObjectId: f.deliveryId, sectionId: f.sectionId, sourceObjectIds: ["d", "image", "research"] })).workspace;
    const referenceD = (next.objects[f.deliveryId] as DeliveryObject).sections[0].referenceIds[3];
    next = updated(updateDeliveryReferenceEditorial(next, { deliveryObjectId: f.deliveryId, referenceId: referenceD, caption: "preserved", note: "preserved note" })).workspace;
    const sourceD = next.objects.d; if (sourceD.type !== "text") throw new Error("text");
    next = { ...next, objects: { ...next.objects, d: { ...sourceD, body: "new D" } } };
    next = updated(refreshDeliveryReferenceSnapshot(next, { deliveryObjectId: f.deliveryId, referenceId: referenceD, reason: "adopt D" })).workspace;
    next = draft(next, f.deliveryId, f.sectionId).workspace;
    const sourceA = next.objects.a; if (sourceA.type !== "text") throw new Error("text");
    next = { ...next, objects: { ...next.objects, a: { ...sourceA, title: "updated A" }, b: { ...next.objects.b, visibility: "hidden" } } };
    delete next.objects.c;
    const delivery = next.objects[f.deliveryId] as DeliveryObject;
    next.objects[f.deliveryId] = { ...delivery, gaps: [{ id: "gap-p5", label: "handoff gap", status: "open", origin: "manual", createdAt: NOW, updatedAt: NOW }] };
    const output = await exportDeliveryOutputPackage(next, { deliveryObjectId: f.deliveryId, createdAt: NOW, blobStore: { get: async () => null, put: async () => {}, delete: async () => {} } });
    if (output.status !== "ok") throw new Error(output.reason);
    expect(output.summary).toMatchObject({ missingOrMismatchedAssets: 1, sourceUpdated: 1, sourceHidden: 1, sourceMissing: 1, pendingDrafts: 1, openGaps: 1, copyReview: 2, unknownProvenance: 5, unverifiedProvenance: 1 });
    expect(output.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["delivery_output_source_updated", "delivery_output_source_hidden", "delivery_output_source_unavailable", "delivery_output_asset_missing_metadata", "delivery_output_pending_drafts", "delivery_output_copy_review", "delivery_output_open_gaps", "delivery_output_provenance_unknown"]));
    const zip = unzipSync(new Uint8Array(await output.file.arrayBuffer()));
    const map = JSON.parse(strFromU8(zip["source-map.json"]));
    expect(map.references.map((ref: { inspection: unknown }) => ref.inspection)).toEqual(output.manifest.references.map((ref) => ref.inspection));
    expect(map.diagnostics).toEqual(output.diagnostics);
    expect(map.pendingSectionDrafts).toEqual(output.manifest.pendingSectionDrafts);
    expect(map.gaps).toEqual(output.manifest.gaps);
    const readme = strFromU8(zip["README.md"]), copy = strFromU8(zip["captions-and-copy.md"]);
    expect(readme).toContain("缺失或大小异常资产数量：1");
    expect(readme).toContain("不代表内容、文案或素材已经确认");
    expect(copy).toContain("sourceUpdated"); expect(copy).toContain("sourceHidden"); expect(copy).toContain("sourceMissing"); expect(copy).toContain("needsReview"); expect(copy).toContain("unknown");
    expect(inspectDelivery(next, next.objects[f.deliveryId] as DeliveryObject).references[f.ids[0]]).toEqual(output.manifest.references[0].inspection);
  });

  it("binds elimination rationale to the real status effect, never the older primary decision", () => {
    let next = createInitialWorkspace();
    next = setConceptDirectionStatus(next, "direction-soft-rail", "primary", "primary rationale should not leak");
    next = setConceptDirectionStatus(next, "direction-soft-rail", "eliminated", "real elimination rationale");
    const archive = createHumanReadableArchiveManifest(next); if (archive.status !== "ok") throw new Error("archive");
    const bundle = createHumanReadableArchiveBundle(archive.manifest, []);
    const overview = bundle.files.find((file) => file.path.endsWith("project-overview.md"));
    expect(overview).toBeDefined();
    const content = overview ? new TextDecoder().decode(overview.bytes) : "";
    expect(content).toContain("原因：real elimination rationale");
    expect(content).not.toContain("原因：primary rationale should not leak");
    const unknownReason = { ...next, decisionRecords: next.decisionRecords.map((record) => record.effect?.kind === "setDirectionStatus" && record.effect.status === "eliminated" ? { ...record, effect: undefined } : record) };
    const legacyArchive = createHumanReadableArchiveManifest(unknownReason); if (legacyArchive.status !== "ok") throw new Error("archive");
    const legacyOverview = createHumanReadableArchiveBundle(legacyArchive.manifest, []).files.find((file) => file.path === "project-overview.md")!;
    expect(new TextDecoder().decode(legacyOverview.bytes)).toContain("原因：未记录明确原因");
  });
});
