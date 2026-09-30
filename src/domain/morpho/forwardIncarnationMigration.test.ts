import { describe, expect, it } from "vitest";
import { importTextObject } from "./imports";
import { captureEvidenceBasis, qualifyEvidence } from "./evidenceAuthority";
import { captureSourceSnapshot, resolveSource } from "./sourceResolution";
import { classifyDecisionRecords } from "./decisionRecords";
import { createBlankWorkspace, deleteObject, migrateWorkspaceToCurrentSchema, parseWorkspace, serializeWorkspace } from "./workspace";
import { createEditableProjectBackupManifest } from "./projectArchive";
import { planEditableProjectBackupRestore } from "./projectBundles";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";
import { applyResearchAnalysisProposal, createResearchOperation, recordResearchAnalysisProposal } from "../operations/operations";
import { buildDocumentReaderBlocks } from "../../features/workspace/documentReader";
import { buildDocumentFragmentDraft, createDocumentFragment, resolveDocumentFragmentSelection } from "../../features/workspace/documentFragments";
import type { MorphoWorkspace } from "./types";
import type { ResearchEvidence } from "../operations/types";

const position = { x: 0, y: 0 };
const text = "迁移时仍存活的一手资料";

function legacyWorkspace() {
  const result = importTextObject(createBlankWorkspace("forward-identity"), { text, position });
  const id = result.objectIds[0];
  delete result.workspace.objects[id].incarnationId;
  return { workspace: result.workspace, id };
}

function migrated(value: unknown): MorphoWorkspace {
  const result = migrateWorkspaceToCurrentSchema(value);
  if (result.status !== "ok") throw new Error(result.reason);
  return result.workspace;
}

function roundTrip(workspace: MorphoWorkspace) {
  const result = parseWorkspace(serializeWorkspace(workspace));
  if (result.status !== "ok") throw new Error(result.reason);
  return result.workspace;
}

describe("P1B-1 forward incarnation migration", () => {
  it.each(Array.from({ length: 17 }, (_, index) => index + 1))("establishes stable random identities for live schema %s objects only at upgrade", (schemaVersion) => {
    const { workspace, id } = legacyWorkspace();
    workspace.objects.hidden = { ...workspace.objects[id], id: "hidden", visibility: "hidden" };
    const input = { ...workspace, schemaVersion };
    const before = JSON.stringify(input);
    const first = migrated(input);
    expect(first.schemaVersion).toBe(18);
    expect(first.objects[id].incarnationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.objects.hidden.incarnationId).not.toBe(first.objects[id].incarnationId);
    expect(JSON.stringify(input)).toBe(before);
    expect(roundTrip(first).objects).toEqual(first.objects);
    expect(migrated(first).objects).toEqual(first.objects);
  });

  it("preserves already known live identities and does not mint identities during schema 18 normalization", () => {
    const { workspace, id } = legacyWorkspace();
    expect(roundTrip(workspace).objects[id].incarnationId).toBeUndefined();
    workspace.objects[id].incarnationId = "already-known-incarnation";
    expect(migrated({ ...workspace, schemaVersion: 17 }).objects[id].incarnationId).toBe("already-known-incarnation");
  });

  it("lets new-era baselines apply/support unchanged migrated sources, then rejects same-ID recreation", () => {
    const legacy = legacyWorkspace();
    const oldEvidence: ResearchEvidence = { claim: "旧依据", sourceObjectIds: [legacy.id], citationIds: [], confidence: "supported" };
    oldEvidence.basis = captureEvidenceBasis(legacy.workspace, oldEvidence);
    const oldOperation = createResearchOperation(legacy.workspace, { selectedObjectIds: [legacy.id], userInput: "旧研究", allowWebSearch: false });
    const oldProposal = recordResearchAnalysisProposal(oldOperation.workspace, { operationId: oldOperation.operation.id, title: "旧研究", summary: "旧研究", findings: ["旧结论"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: [legacy.id], citations: [] });
    oldProposal.workspace.objects.oldResearch = { id: "oldResearch", type: "research", title: "旧证据", summary: "旧证据", createdBy: "ai", visibility: "active", findings: [], opportunities: [], constraints: [], openQuestions: [], evidence: [oldEvidence] };
    oldProposal.workspace.decisionRecords.push({ id: "old-effect", kind: "setImageRole", createdAt: "2026-09-01", summary: "旧决定", relatedObjectIds: [legacy.id], effect: { kind: "setImageRole", targetObjectId: legacy.id, role: "reference" } });
    oldProposal.proposal.targetIdentitySnapshots = [{ objectId: legacy.id }];
    for (const object of Object.values(oldProposal.workspace.objects)) delete object.incarnationId;
    const oldSnapshots = structuredClone(oldProposal.proposal.sourceSnapshots);
    const oldTargets = structuredClone(oldProposal.proposal.targetIdentitySnapshots);
    const workspace = migrated({ ...oldProposal.workspace, schemaVersion: 17 });
    expect(workspace.artifactProposals[oldProposal.proposal.id].sourceSnapshots).toEqual(oldSnapshots);
    expect(workspace.artifactProposals[oldProposal.proposal.id].targetIdentitySnapshots).toEqual(oldTargets);
    expect(workspace.operations[oldOperation.operation.id].inputSnapshot.sourceSnapshots).toEqual(oldOperation.operation.inputSnapshot.sourceSnapshots);
    const oldResearch = workspace.objects.oldResearch;
    if (oldResearch.type !== "research") throw new Error("Research missing");
    expect(oldResearch.evidence?.[0].basis).toEqual(oldEvidence.basis);
    expect(qualifyEvidence(workspace, oldEvidence).confidence).toBe("needsVerification");
    expect(classifyDecisionRecords(workspace)[0].state).toBe("reviewRequired");
    expect(workspace.decisionRecords[0].effect?.targetIncarnationId).toBeUndefined();
    expect(resolveSource(workspace, legacy.id, oldSnapshots[0])).toMatchObject({ identity: "unknown", freshness: "unknown" });
    expect(applyResearchAnalysisProposal(workspace, oldProposal.proposal.id, { position }).status).toBe("blocked");

    const newEvidence: ResearchEvidence = { claim: "新依据", sourceObjectIds: [legacy.id], citationIds: [], confidence: "supported" };
    newEvidence.basis = captureEvidenceBasis(workspace, newEvidence);
    const baseline = captureSourceSnapshot(workspace, legacy.id);
    const operation = createResearchOperation(workspace, { selectedObjectIds: [legacy.id], userInput: "迁移后的新研究", allowWebSearch: false });
    const proposal = recordResearchAnalysisProposal(operation.workspace, { operationId: operation.operation.id, title: "新研究", summary: "新研究", findings: ["新结论"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: [legacy.id], citations: [], evidence: [{ claim: "新结论", sourceObjectIds: [legacy.id], citationUrls: [], confidence: "supported", item: { kind: "finding", index: 0 } }] });
    expect(operation.operation.inputSnapshot.sourceSnapshots[0].incarnationId).toBe(workspace.objects[legacy.id].incarnationId);
    expect(proposal.proposal.sourceSnapshots[0].incarnationId).toBe(baseline.incarnationId);
    expect(proposal.proposal.evidence[0].basis?.sourceSnapshots[0].incarnationId).toBe(baseline.incarnationId);
    expect(resolveSource(proposal.workspace, legacy.id, baseline)).toMatchObject({ identity: "same", freshness: "current" });
    expect(qualifyEvidence(proposal.workspace, newEvidence).confidence).toBe("supported");
    const applied = applyResearchAnalysisProposal(proposal.workspace, proposal.proposal.id, { position });
    expect(applied.status).toBe("updated");
    if (applied.status !== "updated") throw new Error(applied.reason);
    expect(applied.researchObject.evidence?.[0].confidence).toBe("supported");
    const backup = createEditableProjectBackupManifest(proposal.workspace);
    if (backup.status !== "ok") throw new Error(backup.reason);
    const restored = planEditableProjectBackupRestore(backup.manifest, {}, { projectId: "restored-forward-identity", projectTitle: "恢复", restoredAt: "2026-10-01T00:00:00Z", createRuntimeStorageKey: (id) => `restored-${id}` });
    if (restored.status !== "ok") throw new Error(restored.reason);
    expect(restored.workspace.objects[legacy.id].incarnationId).toBe(baseline.incarnationId);
    expect(resolveSource(restored.workspace, legacy.id, baseline)).toMatchObject({ identity: "same", freshness: "current" });
    expect(qualifyEvidence(restored.workspace, newEvidence).confidence).toBe("supported");
    expect(applyResearchAnalysisProposal(restored.workspace, proposal.proposal.id, { position }).status).toBe("updated");

    const removed = deleteObject(roundTrip(proposal.workspace), legacy.id, { confirmed: true });
    if (removed.status !== "updated") throw new Error("Deletion blocked");
    const recreated = importTextObject(removed.workspace, { text, position });
    expect(recreated.objectIds).toEqual([legacy.id]);
    expect(captureSourceSnapshot(recreated.workspace, legacy.id).semanticFingerprint).toBe(baseline.semanticFingerprint);
    expect(resolveSource(recreated.workspace, legacy.id, baseline)).toMatchObject({ identity: "different", freshness: "changed" });
    expect(qualifyEvidence(recreated.workspace, newEvidence).confidence).toBe("needsVerification");
    expect(applyResearchAnalysisProposal(recreated.workspace, proposal.proposal.id, { position }).status).toBe("blocked");
    expect(validateCurrentMorphoWorkspace(recreated.workspace).status).toBe("ok");
  });

  it("binds a newly extracted Fragment to a migrated File while keeping old Fragment bindings unknown", () => {
    const legacy = legacyWorkspace().workspace;
    const body = "迁移后的文件摘录正文";
    legacy.assets.extract = { id: "extract", fileName: "extract.txt", mimeType: "text/plain", size: new TextEncoder().encode(body).length, storageKey: "extract", createdAt: "2026-09-01", sourceType: "documentExtract" };
    legacy.objects.file = { id: "file", type: "file", title: "文件", summary: "文件", createdBy: "user", visibility: "active", fileKind: "document", sourceLabel: "用户导入", parseStatus: "parsed", extractedAssetId: "extract", extractedCharCount: body.length };
    legacy.objects.oldFragment = { id: "oldFragment", type: "documentFragment", title: "旧摘录", summary: "旧摘录", body, createdBy: "user", visibility: "active", source: { fileObjectId: "file", fileTitle: "文件", sourceExtractAssetId: "extract", startOffset: 0, endOffset: body.length, blockIds: [] } };
    const workspace = migrated({ ...legacy, schemaVersion: 17 });
    const oldFragment = workspace.objects.oldFragment;
    if (oldFragment.type !== "documentFragment") throw new Error("Fragment missing");
    expect(oldFragment.source.fileIncarnationId).toBeUndefined();
    expect(resolveSource(workspace, oldFragment.id, captureSourceSnapshot(workspace, oldFragment.id)).content).toBe("unavailable");
    const selection = resolveDocumentFragmentSelection(workspace, { fileObjectId: "file", extractAssetId: "extract", blockIds: buildDocumentReaderBlocks(body).map((block) => block.id), title: "新摘录", sourceText: body });
    if (selection.status !== "ready") throw new Error(selection.reason);
    const draft = buildDocumentFragmentDraft(workspace, selection, { title: "新摘录", position });
    if (draft.status !== "ready") throw new Error(draft.reason);
    const created = createDocumentFragment(workspace, draft.draft);
    expect(created.fragment.source.fileIncarnationId).toBe(workspace.objects.file.incarnationId);
    const baseline = captureSourceSnapshot(created.workspace, created.fragment.id);
    expect(resolveSource(roundTrip(created.workspace), created.fragment.id, baseline)).toMatchObject({ identity: "same", freshness: "current", content: "available" });
    const backup = createEditableProjectBackupManifest(created.workspace);
    if (backup.status !== "ok") throw new Error(backup.reason);
    const portableExtract = backup.manifest.assetInventory.entries.find((entry) => entry.sourceAssetId === "extract")!;
    const restored = planEditableProjectBackupRestore(backup.manifest, { [portableExtract.portableBundleKey]: new TextEncoder().encode(body) }, { projectId: "restored-fragment", projectTitle: "恢复摘录", restoredAt: "2026-10-01T00:00:00Z", createRuntimeStorageKey: (id) => `restored-${id}` });
    if (restored.status !== "ok") throw new Error(restored.reason);
    expect(restored.workspace.objects.file.incarnationId).toBe(workspace.objects.file.incarnationId);
    expect(resolveSource(restored.workspace, created.fragment.id, baseline)).toMatchObject({ freshness: "current", content: "available" });
    expect(validateCurrentMorphoWorkspace(restored.workspace).status).toBe("ok");
  });
});
