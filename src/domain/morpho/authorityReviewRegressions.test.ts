import { describe, expect, it } from "vitest";
import { importTextObject } from "./imports";
import { createObjectIncarnationId } from "./objectIdentity";
import { captureEvidenceBasis, qualifyEvidence } from "./evidenceAuthority";
import { captureSourceSnapshot, resolveSource } from "./sourceResolution";
import { classifyDecisionRecords } from "./decisionRecords";
import { reconcileProjectMemory } from "./projectMemory";
import { createBlankWorkspace, createKeyConclusion, deleteObject, migrateWorkspaceToCurrentSchema, parseWorkspace, serializeWorkspace } from "./workspace";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";
import { createEditableProjectBackupManifest, validateEditableProjectBackupManifest } from "./projectArchive";
import { addObjectsToDeliverySection, applyDeliverySectionDraft, createDeliveryPreparation, createDeliverySectionDraft, refreshDeliveryReferenceSnapshot, removeDeliveryReference } from "./deliveryPreparation";
import { applyDesignDefinitionProposal, applyResearchAnalysisProposal, createResearchOperation, recordDesignDefinitionProposal, recordResearchAnalysisProposal } from "../operations/operations";
import type { ResearchEvidence } from "../operations/types";
import type { DecisionKind, MorphoWorkspace } from "./types";

const position = { x: 0, y: 0 };

function imported() {
  const result = importTextObject(createBlankWorkspace("identity-regression"), { text: "相同语义内容", position });
  return { workspace: result.workspace, id: result.objectIds[0] };
}

function deleted(workspace: MorphoWorkspace, id: string) {
  const result = deleteObject(workspace, id, { confirmed: true });
  if (result.status !== "updated") throw new Error("Deletion blocked");
  return result.workspace;
}

function definition(workspace: MorphoWorkspace, target?: string) {
  return recordDesignDefinitionProposal(workspace, { workIntent: target ? "reviseDesignDefinition" : "createDesignDefinition", basedOnDesignDefinitionId: target, title: "定义", summary: "定义", projectGoal: "目标", targetUsers: [], primaryScenarios: [], coreProblem: "问题", designPrinciples: [], constraints: [], avoidDirections: [], opportunities: [], openQuestions: [], sourceObjectIds: [], citations: [] });
}

describe("P1B-1 review: object incarnation", () => {
  it("blocks an old Proposal and evidence after real delete/reimport with the same ID and content", () => {
    const { workspace, id } = imported();
    const baseline = captureSourceSnapshot(workspace, id);
    const entry: ResearchEvidence = { claim: "证据", sourceObjectIds: [id], citationIds: [], confidence: "supported" };
    entry.basis = captureEvidenceBasis(workspace, entry);
    const operation = createResearchOperation(workspace, { selectedObjectIds: [id], userInput: "研究", allowWebSearch: false });
    const proposed = recordResearchAnalysisProposal(operation.workspace, { operationId: operation.operation.id, title: "研究", summary: "研究", findings: ["发现"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: [id], citations: [] });
    const recreated = importTextObject(deleted(proposed.workspace, id), { text: "相同语义内容", position });
    expect(recreated.objectIds).toEqual([id]);
    expect(captureSourceSnapshot(recreated.workspace, id).semanticFingerprint).toBe(baseline.semanticFingerprint);
    expect(recreated.workspace.objects[id].incarnationId).not.toBe(baseline.incarnationId);
    expect(resolveSource(recreated.workspace, id, baseline)).toMatchObject({ identity: "different", freshness: "changed" });
    expect(qualifyEvidence(recreated.workspace, entry)).toMatchObject({ confidence: "needsVerification", usableObjectIds: [] });
    expect(applyResearchAnalysisProposal(recreated.workspace, proposed.proposal.id, { position }).status).toBe("blocked");
    const roundTrip = parseWorkspace(serializeWorkspace(recreated.workspace));
    if (roundTrip.status !== "ok") throw new Error(roundTrip.reason);
    expect(roundTrip.workspace.objects[id].incarnationId).toBe(recreated.workspace.objects[id].incarnationId);
    expect(qualifyEvidence(roundTrip.workspace, entry).confidence).toBe("needsVerification");
    expect(applyResearchAnalysisProposal(roundTrip.workspace, proposed.proposal.id, { position }).status).toBe("blocked");
    const backup = createEditableProjectBackupManifest(roundTrip.workspace);
    if (backup.status !== "ok") throw new Error(backup.reason);
    expect(validateEditableProjectBackupManifest(backup.manifest).status).toBe("ok");
    expect(backup.manifest.workspaceSnapshot.objects[id].incarnationId).toBe(roundTrip.workspace.objects[id].incarnationId);
  });

  it("never revives a Decision when a conclusion is deleted and recreated under the same ID", () => {
    const input = { title: "结论", body: "同一内容", category: "finding" as const, summary: "结论", confidence: "needsVerification" as const, sourceObjectIds: [], citationIds: [], position };
    const first = createKeyConclusion(createBlankWorkspace("decision-identity"), input);
    const second = createKeyConclusion(deleted(first.workspace, first.keyConclusion.id), input);
    expect(second.keyConclusion.id).toBe(first.keyConclusion.id);
    expect(second.keyConclusion.incarnationId).not.toBe(first.keyConclusion.incarnationId);
    expect(classifyDecisionRecords(second.workspace).map((item) => item.state)).toEqual(["reviewRequired", "current"]);
  });

  it("checks a Proposal's revision target identity even when sourceObjectIds is empty", () => {
    const proposed = definition(createBlankWorkspace("target-identity"));
    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);
    if (applied.status !== "updated") throw new Error(applied.reason);
    const target = applied.designDefinitionObject;
    const pending = definition(applied.workspace, target.id);
    const revised = applyDesignDefinitionProposal(pending.workspace, pending.proposal.id);
    if (revised.status !== "updated") throw new Error(revised.reason);
    expect(revised.designDefinitionObject.incarnationId).toBe(target.incarnationId);
    const recreated = deleted(pending.workspace, target.id);
    // Model a new creation with identical owned revision/content and reused ID.
    recreated.objects[target.id] = { ...target, incarnationId: createObjectIncarnationId() };
    expect(applyDesignDefinitionProposal(recreated, pending.proposal.id).status).toBe("blocked");
    const legacy = structuredClone(pending.workspace);
    delete legacy.artifactProposals[pending.proposal.id].targetIdentitySnapshots;
    expect(applyDesignDefinitionProposal(legacy, pending.proposal.id).status).toBe("blocked");
  });

  it.each([17, 18])("keeps identity-less schema %s baselines unknown without backfilling history", (schemaVersion) => {
    const { workspace, id } = imported();
    const baseline = captureSourceSnapshot(workspace, id);
    delete workspace.objects[id].incarnationId;
    delete baseline.incarnationId;
    expect(resolveSource(workspace, id, baseline)).toMatchObject({ identity: "unknown", freshness: "unknown" });
    const evidence: ResearchEvidence = { claim: "旧依据", sourceObjectIds: [id], citationIds: [], confidence: "supported", basis: { confidence: "supported", sourceSnapshots: [baseline], citationSnapshots: [] } };
    expect(qualifyEvidence(workspace, evidence).confidence).toBe("needsVerification");
    const first = migrateWorkspaceToCurrentSchema({ ...workspace, schemaVersion });
    if (first.status !== "ok") throw new Error(first.reason);
    expect(first.workspace.objects[id].incarnationId).toBeUndefined();
    const again = parseWorkspace(serializeWorkspace(first.workspace));
    if (again.status !== "ok") throw new Error(again.reason);
    expect(again.workspace).toEqual(first.workspace);
    expect(resolveSource(again.workspace, id, baseline).identity).toBe("unknown");
  });

  it("validates new identity fields without requiring a historical target to still exist", () => {
    const { workspace, id } = imported();
    const invalid = structuredClone(workspace);
    invalid.objects[id].incarnationId = "";
    expect(validateCurrentMorphoWorkspace(invalid).status).toBe("failed");
    const duplicate = importTextObject(workspace, { text: "另一个", position });
    duplicate.workspace.objects[duplicate.objectIds[0]].incarnationId = workspace.objects[id].incarnationId;
    expect(validateCurrentMorphoWorkspace(duplicate.workspace).status).toBe("failed");
    const conclusion = createKeyConclusion(workspace, { title: "结论", body: "结论", summary: "结论", category: "finding", confidence: "needsVerification", sourceObjectIds: [], citationIds: [], position });
    const gone = deleted(conclusion.workspace, conclusion.keyConclusion.id);
    expect(validateCurrentMorphoWorkspace(gone).status).toBe("ok");
    const badDecision = structuredClone(conclusion.workspace);
    badDecision.decisionRecords[0].effect!.targetIncarnationId = "";
    expect(validateCurrentMorphoWorkspace(badDecision).status).toBe("failed");
    const oldDecision = structuredClone(conclusion.workspace);
    delete oldDecision.decisionRecords[0].effect!.targetIncarnationId;
    expect(classifyDecisionRecords(oldDecision)[0].state).toBe("reviewRequired");
    const proposal = definition(workspace);
    proposal.workspace.artifactProposals[proposal.proposal.id].targetIdentitySnapshots = [{ objectId: id, incarnationId: "" }];
    expect(validateCurrentMorphoWorkspace(proposal.workspace).status).toBe("failed");
  });
});

describe("P1B-1 review: event Decisions", () => {
  it.each<DecisionKind>(["createDeliveryPreparation", "createDeliveryReference", "replaceDeliveryReference", "removeDeliveryReference", "refreshDeliveryReference", "applyDeliverySectionDraft", "updateDeliverySection", "setDeliveryGapStatus"])("classifies %s as historical without inventing an effect", (kind) => {
    const workspace = createBlankWorkspace("event-decision");
    workspace.decisionRecords = [{ id: "event", kind, createdAt: "2026-10-01T00:00:00Z", summary: "已发生动作", relatedObjectIds: [] }];
    expect(classifyDecisionRecords(workspace)[0]).toMatchObject({ state: "historical" });
    expect(workspace.decisionRecords[0].effect).toBeUndefined();
  });

  it("classifies real Delivery create/add/refresh/apply/remove writes as historical", () => {
    const source = imported();
    const created = createDeliveryPreparation(source.workspace, { title: "交付", format: "board", position });
    if (created.status !== "updated") throw new Error(created.reason);
    const delivery = created.workspace.objects[created.deliveryObjectId];
    if (delivery.type !== "delivery") throw new Error("Delivery missing");
    const sectionId = delivery.sections[0].id;
    const added = addObjectsToDeliverySection(created.workspace, { deliveryObjectId: delivery.id, sectionId, sourceObjectIds: [source.id] });
    if (added.status !== "updated") throw new Error(added.reason);
    const referenceId = added.createdReferenceIds[0];
    const refreshed = refreshDeliveryReferenceSnapshot(added.workspace, { deliveryObjectId: delivery.id, referenceId, reason: "用户更新快照" });
    if (refreshed.status !== "updated") throw new Error(refreshed.reason);
    const draft = createDeliverySectionDraft(refreshed.workspace, { deliveryObjectId: delivery.id, sectionId, userMessageId: "user", assistantMessageId: "assistant", narrative: "章节说明", captions: [], suggestedGaps: [] });
    if (draft.status !== "updated") throw new Error(draft.reason);
    const applied = applyDeliverySectionDraft(draft.workspace, { deliveryObjectId: delivery.id, draftId: draft.draftId });
    if (applied.status !== "updated") throw new Error(applied.reason);
    expect(validateCurrentMorphoWorkspace(applied.workspace).status).toBe("ok");
    const removed = removeDeliveryReference(applied.workspace, { deliveryObjectId: delivery.id, referenceId });
    if (removed.status !== "updated") throw new Error(removed.reason);
    expect(classifyDecisionRecords(removed.workspace).map((item) => item.state)).toEqual(Array(5).fill("historical"));
    expect(removed.workspace.decisionRecords.every((record) => !record.effect)).toBe(true);
    const projected = reconcileProjectMemory(removed.workspace);
    const document = projected.projectMemory.documents.decisionLog;
    expect(document.currentRevisionId).toBeUndefined();
  });
});
