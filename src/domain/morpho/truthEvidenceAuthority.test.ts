import { describe, expect, it } from "vitest";
import { createBlankWorkspace, createKeyConclusion, buildKeyConclusionDraftFromResearchSource, deleteObject, hideObject, migrateWorkspaceToCurrentSchema, parseWorkspace, serializeWorkspace, setConceptDirectionStatus } from "./workspace";
import { applyConversationSemanticPatch, getContinuityEntryEligibility, setConversationSemanticEntryManualState } from "./projectContinuity";
import { buildSemanticPatchAuthorization, type ParsedConversationSemanticPatchItem } from "./conversationSemanticPatch";
import { classifyDecisionRecords } from "./decisionRecords";
import { captureSourceSnapshot, captureSourceSnapshots, resolveSource } from "./sourceResolution";
import { captureEvidenceBasis, qualifyEvidence } from "./evidenceAuthority";
import { reconcileWorkspaceDerivedState } from "./derivedState";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";
import { createEditableProjectBackupManifest } from "./projectArchive";
import { applyConceptDirectionProposal, recordConceptDirectionProposal, applyDesignDefinitionProposal, applyResearchAnalysisProposal, createResearchOperation, recordDesignDefinitionProposal, recordResearchAnalysisProposal } from "../operations/operations";
import type { MorphoWorkspace } from "./types";
import type { ResearchEvidence } from "../operations/types";

function fixture(): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-truth-authority");
  workspace.objects.source = { id: "source", type: "text", title: "来源", summary: "原始资料", body: "一手数据", visibility: "active", createdBy: "user" };
  workspace.objects.link = { id: "link", type: "link", title: "链接", summary: "链接摘要", url: "https://example.com/a", domain: "example.com", visibility: "active", createdBy: "user" };
  workspace.assets.extract = { id: "extract", fileName: "extract.txt", mimeType: "text/plain", size: 100, storageKey: "extract", createdAt: "2026-09-30T00:00:00Z", sourceType: "documentExtract" };
  workspace.objects.file = { id: "file", type: "file", fileKind: "pdf", sourceLabel: "本地文件", title: "文档", summary: "文档资料", fileName: "source.pdf", parseStatus: "parsed", extractedAssetId: "extract", extractedCharCount: 100, visibility: "active", createdBy: "user" };
  workspace.objects.fragment = { id: "fragment", type: "documentFragment", title: "摘录", summary: "摘录资料", body: "摘录正文", source: { fileObjectId: "file", fileTitle: "文档", sourceExtractAssetId: "extract", startOffset: 0, endOffset: 4, blockIds: [] }, visibility: "active", createdBy: "user" };
  return reconcileWorkspaceDerivedState(workspace, "2026-09-30T00:00:00Z");
}

function research(workspace: MorphoWorkspace, sources = ["source"]) {
  const operation = createResearchOperation(workspace, { operationId: "operation-authority", selectedObjectIds: sources, userInput: "研究这些来源", allowWebSearch: false });
  return recordResearchAnalysisProposal(operation.workspace, {
    operationId: operation.operation.id, title: "研究", summary: "研究结果", findings: ["结论一", "结论二"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: sources,
    citations: [{ title: "实测数据", url: "https://example.com/evidence", snippet: "测量内容" }],
    evidence: [{ claim: "支撑结论一的依据", sourceObjectIds: sources, citationUrls: ["https://example.com/evidence"], confidence: "supported", item: { kind: "finding", index: 0 } }]
  });
}

function definition(workspace: MorphoWorkspace, basedOnDesignDefinitionId?: string) {
  const recorded = recordDesignDefinitionProposal(workspace, { workIntent: basedOnDesignDefinitionId ? "reviseDesignDefinition" : "createDesignDefinition", title: "定义", summary: "定义内容", projectGoal: "目标", targetUsers: [], primaryScenarios: [], coreProblem: "问题", designPrinciples: [], constraints: [], avoidDirections: [], opportunities: [], openQuestions: [], sourceObjectIds: [], citations: [], basedOnDesignDefinitionId });
  const applied = applyDesignDefinitionProposal(recorded.workspace, recorded.proposal.id);
  if (applied.status !== "updated") throw new Error(applied.reason);
  return applied;
}

describe("P1B-1 source and proposal authority", () => {
  it.each(["url", "description"] as const)("detects link %s changes", (key) => {
    const workspace = fixture(); const baseline = captureSourceSnapshot(workspace, "link");
    const link = workspace.objects.link; if (link.type !== "link") throw new Error("fixture");
    const changed = { ...workspace, objects: { ...workspace.objects, link: { ...link, [key]: "changed" } } };
    expect(resolveSource(changed, "link", baseline)).toMatchObject({ existence: "present", freshness: "changed", content: "referenceOnly" });
  });
  it.each(["body", "range", "extraction", "fileDeleted", "fileHidden", "assetMissing"])("detects fragment %s dependency changes", (change) => {
    const workspace = fixture(); const baseline = captureSourceSnapshot(workspace, "fragment");
    const next = structuredClone(workspace); const fragment = next.objects.fragment; const file = next.objects.file;
    if (fragment.type !== "documentFragment" || file.type !== "file") throw new Error("fixture");
    if (change === "body") fragment.body = "新正文";
    if (change === "range") fragment.source.endOffset = 5;
    if (change === "extraction") file.extractedAssetId = "new-extract";
    if (change === "fileDeleted") delete next.objects.file;
    if (change === "fileHidden") file.visibility = "hidden";
    if (change === "assetMissing") delete next.assets.extract;
    expect(resolveSource(next, "fragment", baseline).freshness).toBe("changed");
  });
  it("retains an unknown old fingerprint without manufacturing a current baseline", () => {
    const recorded = research(fixture(), ["file"]);
    const legacy = structuredClone(recorded.workspace);
    legacy.artifactProposals[recorded.proposal.id].sourceSnapshots = [{ objectId: "file", objectType: "file", visibility: "active", semanticFingerprint: '{"type":"file"}' }];
    const migrated = migrateWorkspaceToCurrentSchema({ ...legacy, schemaVersion: 17 });
    expect(migrated.status).toBe("ok"); if (migrated.status !== "ok") return;
    expect(migrated.workspace.artifactProposals[recorded.proposal.id].sourceSnapshots[0].fingerprintVersion).toBeUndefined();
    expect(applyResearchAnalysisProposal(migrated.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } }).status).toBe("blocked");
  });
  it("does not rebase Operation sources when the result arrives after a change", () => {
    const workspace = fixture(); const created = createResearchOperation(workspace, { operationId: "frozen", selectedObjectIds: ["source"], userInput: "研究", allowWebSearch: false });
    const source = workspace.objects.source; if (source.type !== "text") throw new Error("fixture");
    const changed = { ...created.workspace, objects: { ...created.workspace.objects, source: { ...source, body: "后来编辑" } } };
    const proposal = recordResearchAnalysisProposal(changed, { operationId: "frozen", title: "旧输入结果", summary: "旧结果", findings: ["旧结论"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: ["source"], citations: [] });
    expect(proposal.proposal.sourceSnapshots).toEqual(created.operation.inputSnapshot.sourceSnapshots);
    expect(applyResearchAnalysisProposal(proposal.workspace, proposal.proposal.id, { position: { x: 0, y: 0 } }).status).toBe("blocked");
  });
  it("does not invent baselines for sources missing from a frozen operation", () => {
    const workspace = fixture(); const created = createResearchOperation(workspace, { operationId: "scope", selectedObjectIds: ["source"], userInput: "研究", allowWebSearch: false });
    const recorded = recordResearchAnalysisProposal(created.workspace, { operationId: "scope", title: "结果", summary: "结果", findings: ["结论"], opportunities: [], constraints: [], openQuestions: [], sourceObjectIds: ["file"], citations: [] });
    expect(recorded.proposal.sourceSnapshots[0].semanticFingerprint).toBe("unknown");
    expect(applyResearchAnalysisProposal(recorded.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } }).status).toBe("blocked");
  });
});

describe("P1B-1 evidence qualification and inheritance", () => {
  it.each(["missing", "hidden", "changed"])("removes supported qualification when the only source is %s", (state) => {
    const workspace = fixture(); const entry: ResearchEvidence = { claim: "依据", sourceObjectIds: ["source"], citationIds: [], confidence: "supported" };
    entry.basis = captureEvidenceBasis(workspace, entry);
    const next = structuredClone(workspace); const source = next.objects.source; if (source.type !== "text") throw new Error("fixture");
    if (state === "missing") delete next.objects.source;
    if (state === "hidden") source.visibility = "hidden";
    if (state === "changed") source.body = "新数据";
    expect(qualifyEvidence(next, entry).confidence).toBe("needsVerification");
    expect(entry.basis.sourceSnapshots).toEqual(captureSourceSnapshots(workspace, ["source"]));
  });
  it("narrows partially removed evidence and never elevates a reference-only link", () => {
    const workspace = fixture(); const entry: ResearchEvidence = { claim: "依据", sourceObjectIds: ["source", "link"], citationIds: [], confidence: "supported" };
    entry.basis = captureEvidenceBasis(workspace, entry);
    expect(qualifyEvidence(workspace, entry)).toMatchObject({ confidence: "partial", usableObjectIds: ["source"] });
    expect(qualifyEvidence(workspace, { ...entry, sourceObjectIds: ["link"] }).confidence).toBe("needsVerification");
  });
  it("inherits only explicitly bound evidence and keeps Research lineage separate", () => {
    const recorded = research(fixture()); const applied = applyResearchAnalysisProposal(recorded.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } });
    if (applied.status !== "updated") throw new Error(applied.reason);
    const bound = buildKeyConclusionDraftFromResearchSource(applied.workspace, applied.researchObject.id, { kind: "finding", index: 0 });
    const unbound = buildKeyConclusionDraftFromResearchSource(applied.workspace, applied.researchObject.id, { kind: "finding", index: 1 });
    if (bound.status !== "ready" || unbound.status !== "ready") throw new Error("draft");
    expect(bound.draft.confidence).toBe("supported"); expect(bound.draft.citationIds).toEqual(recorded.proposal.citationIds);
    expect(bound.draft.sourceObjectIds).toEqual([applied.researchObject.id, "source"]);
    expect(unbound.draft).toMatchObject({ confidence: "needsVerification", citationIds: [], evidence: [] });
    const conclusion = createKeyConclusion(applied.workspace, { ...bound.draft, position: { x: 300, y: 0 } });
    const changed = deleteObject(conclusion.workspace, "source", { confirmed: true });
    expect(changed.workspace.objects[conclusion.keyConclusion.id]).toMatchObject({ state: "active", confidence: "partial" });
    // Adoption remains distinct from evidence support; the unchanged citation survives.
    expect(conclusion.workspace.objects[conclusion.keyConclusion.id]).toMatchObject({ confidence: "supported" });
  });
  it("does not transfer an item binding to later edited list text", () => {
    const recorded = research(fixture()); const applied = applyResearchAnalysisProposal(recorded.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } });
    if (applied.status !== "updated") throw new Error(applied.reason);
    const next = structuredClone(applied.workspace); const object = next.objects[applied.researchObject.id]; if (object.type !== "research") throw new Error("fixture");
    object.findings[0] = "新的不同结论";
    const draft = buildKeyConclusionDraftFromResearchSource(next, object.id, { kind: "finding", index: 0 });
    expect(draft).toMatchObject({ status: "ready", draft: { confidence: "needsVerification", citationIds: [] } });
  });
  it("preserves legacy reported confidence as unknown and migrates idempotently", () => {
    const workspace = fixture(); workspace.objects.legacy = { id: "legacy", type: "research", title: "旧研究", summary: "旧内容", findings: ["旧结论"], opportunities: [], constraints: [], openQuestions: [], evidence: [{ claim: "旧结论", sourceObjectIds: ["source"], citationIds: [], confidence: "supported" }], visibility: "active", createdBy: "ai" };
    const migrated = migrateWorkspaceToCurrentSchema({ ...workspace, schemaVersion: 17 });
    if (migrated.status !== "ok") throw new Error(migrated.reason);
    expect(migrated.workspace.objects.legacy).toMatchObject({ evidence: [{ confidence: "needsVerification", reportedConfidence: "supported" }] });
    const object = migrated.workspace.objects.legacy; if (object.type !== "research") throw new Error("fixture");
    expect(object.evidence?.[0].basis).toBeUndefined();
    const again = parseWorkspace(serializeWorkspace(migrated.workspace));
    if (again.status !== "ok") throw new Error(again.reason);
    expect(again.didMigrate).toBe(false); expect(again.workspace).toEqual(migrated.workspace);
  });
});

describe("P1B-1 structured decisions", () => {
  it("keeps another direction's adopted effect current when revising one member of a batch", () => {
    const draft = (title: string) => ({ title, summary: title, conceptStatement: title, keywords: [], strategy: "策略", differentiators: [], visualSignals: [], risks: [], openQuestions: [] });
    const recorded = recordConceptDirectionProposal(fixture(), { title: "两个方向", summary: "两个候选", applicationMode: "create", parentDirectionIds: [], directions: [draft("A"), draft("B")], sourceObjectIds: [], citations: [] });
    const first = applyConceptDirectionProposal(recorded.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } });
    if (first.status !== "updated") throw new Error(first.reason);
    const revised = recordConceptDirectionProposal(first.workspace, { title: "修订 A", summary: "只修订 A", applicationMode: "revise", workIntent: "reviseConceptDirection", targetDirectionId: first.directions[0].id, parentDirectionIds: [], directions: [draft("A2")], sourceObjectIds: [], citations: [] });
    const second = applyConceptDirectionProposal(revised.workspace, revised.proposal.id, { position: { x: 0, y: 0 } });
    if (second.status !== "updated") throw new Error(second.reason);
    expect(classifyDecisionRecords(second.workspace).map((item) => item.state)).toEqual(["superseded", "current", "current"]);
    expect(validateCurrentMorphoWorkspace(second.workspace).status).toBe("ok");
  });
  it("rejects malformed effect payloads and a revision owned by another definition", () => {
    const first = definition(fixture()); const second = definition(first.workspace);
    const malformed = structuredClone(second.workspace);
    malformed.decisionRecords[0].effect = { kind: "applyDesignDefinition", targetObjectId: first.designDefinitionObject.id, revisionId: second.revision.id };
    expect(validateCurrentMorphoWorkspace(malformed)).toMatchObject({ status: "failed", issues: expect.arrayContaining([expect.objectContaining({ path: "decisionRecords[0].effect.revisionId" })]) });
    const badShape = JSON.parse(serializeWorkspace(first.workspace)) as Record<string, unknown>;
    const records = badShape.decisionRecords as Array<Record<string, unknown>>;
    records[0].effect = { kind: "setDirectionStatus", targetObjectId: first.designDefinitionObject.id, status: "bogus" };
    expect(validateCurrentMorphoWorkspace(badShape).status).toBe("failed");
  });
  it("binds definition Decisions to r1/r2 instead of only the object", () => {
    const first = definition(fixture()); const second = definition(first.workspace, first.designDefinitionObject.id);
    expect(first.designDefinitionObject.id).toBe(second.designDefinitionObject.id);
    const records = classifyDecisionRecords(second.workspace);
    expect(records.map((item) => item.state)).toEqual(["superseded", "current"]);
    expect(records[0].record.effect).toMatchObject({ revisionId: first.revision.id });
    expect(records[1].record.effect).toMatchObject({ revisionId: second.revision.id });
  });
  it("never parses a misleading title and never revives an earlier A-B-A Decision", () => {
    const workspace = fixture(); workspace.objects.direction = { id: "direction", type: "conceptDirection", keywords: [], lineageRootId: "direction", title: "Primary alternative 候选", summary: "方向", status: "alternative", visibility: "active", createdBy: "user", currentRevisionId: "r1", revisionIds: ["r1"] };
    const first = setConceptDirectionStatus(workspace, "direction", "eliminated", "淘汰");
    expect(classifyDecisionRecords(first)[0].state).toBe("current");
    const second = setConceptDirectionStatus(first, "direction", "alternative", "恢复");
    const third = setConceptDirectionStatus(second, "direction", "eliminated", "再次淘汰");
    expect(classifyDecisionRecords(third).map((item) => item.state)).toEqual(["superseded", "superseded", "current"]);
    expect(classifyDecisionRecords(hideObject(third, "direction")).at(-1)?.state).toBe("reviewRequired");
  });
  it("keeps an unstructured historical decision unknown even when its text matches current state", () => {
    const workspace = fixture(); workspace.decisionRecords.push({ id: "old", kind: "applyDesignDefinition", summary: "应用设计定义", createdAt: "2026-07-01", relatedObjectIds: [] });
    expect(classifyDecisionRecords(workspace)[0].state).toBe("reviewRequired");
    const migrated = migrateWorkspaceToCurrentSchema({ ...workspace, schemaVersion: 17 });
    if (migrated.status !== "ok") throw new Error(migrated.reason);
    expect(migrated.workspace.decisionRecords[0].effect).toBeUndefined();
  });
});

function semantic(workspace: MorphoWorkspace, draft: string, items: ParsedConversationSemanticPatchItem[], messageId: string) {
  const now = "2026-09-30T00:00:00Z";
  const next = { ...workspace, ai: { ...workspace.ai, messages: [...workspace.ai.messages, { id: messageId, role: "user" as const, body: draft, createdAt: now, contextVisibility: "model" as const }] } };
  const authorization = buildSemanticPatchAuthorization({ taskMode: "chatAnalysis", draft, userMessageId: messageId, userMessageCreatedAt: now, currentFocusArea: "research", objectIds: [], revisionIds: [], decisionIds: [], entryIds: workspace.projectContinuity.recordEntries.map((entry) => entry.id) });
  return applyConversationSemanticPatch(next, authorization, items);
}
const assertion: ParsedConversationSemanticPatchItem = { kind: "constraint", scope: "project", evidenceQuote: "预算上限 500 元", relatedObjectIds: [], relatedRevisionIds: [], relatedDecisionIds: [] };

describe("P1B-1 semantic lifecycle and portable compatibility", () => {
  it("rejects malformed semantic replacement cycles", () => {
    const first = semantic(fixture(), assertion.evidenceQuote, [assertion], "user-1");
    const next = structuredClone(first.workspace);
    next.projectContinuity.recordEntries[0].supersededByEntryId = next.projectContinuity.recordEntries[0].id;
    expect(validateCurrentMorphoWorkspace(next)).toMatchObject({ status: "failed", issues: expect.arrayContaining([expect.objectContaining({ message: "Semantic replacement chain cannot contain a cycle." })]) });
  });
  it("explicitly supersedes a fact, retains both histories and deduplicates replay", () => {
    const first = semantic(fixture(), assertion.evidenceQuote, [assertion], "user-1");
    const item = { ...assertion, action: "supersede" as const, targetEntryId: first.entries[0].id, evidenceQuote: "预算上限改为 800 元，替代 500 元" };
    const changed = semantic(first.workspace, item.evidenceQuote, [item], "user-2");
    expect(changed.rejected).toEqual([]); expect(changed.entries).toHaveLength(1);
    const old = changed.workspace.projectContinuity.recordEntries.find((entry) => entry.id === first.entries[0].id)!;
    expect(old).toMatchObject({ validity: "superseded", supersededByEntryId: changed.entries[0].id, evidenceQuote: assertion.evidenceQuote });
    expect(getContinuityEntryEligibility(old).canEnterMemory).toBe(false);
    expect(setConversationSemanticEntryManualState(changed.workspace, old.id, "active").projectContinuity.recordEntries.find((entry) => entry.id === old.id)?.validity).toBe("superseded");
    const replay = applyConversationSemanticPatch(changed.workspace, buildSemanticPatchAuthorization({ taskMode: "chatAnalysis", draft: item.evidenceQuote, userMessageId: "user-2", userMessageCreatedAt: "2026-09-30T00:00:00Z", currentFocusArea: "research", objectIds: [], revisionIds: [], decisionIds: [], entryIds: [old.id] }), [item]);
    expect(replay.workspace.projectContinuity.recordEntries).toEqual(changed.workspace.projectContinuity.recordEntries);
  });
  it("leaves an ambiguous new constraint alongside its predecessor without guessing a replacement", () => {
    const first = semantic(fixture(), assertion.evidenceQuote, [assertion], "user-1");
    const second = semantic(first.workspace, "预算上限 800 元", [{ ...assertion, evidenceQuote: "预算上限 800 元" }], "user-2");
    expect(second.workspace.projectContinuity.recordEntries.filter((entry) => entry.origin === "conversationSemanticPatch" && getContinuityEntryEligibility(entry).canEnterMemory)).toHaveLength(2);
  });
  it("uses the same domain transition for UI withdrawal and evidence-backed Tool withdrawal/resolution", () => {
    const question = { ...assertion, kind: "openQuestion" as const, evidenceQuote: "单手操作问题待确认" };
    const first = semantic(fixture(), question.evidenceQuote, [question], "user-1");
    const resolved = semantic(first.workspace, "单手操作问题已解决", [{ ...question, action: "resolve", targetEntryId: first.entries[0].id, evidenceQuote: "单手操作问题已解决" }], "user-2");
    expect(resolved.rejected).toEqual([]); expect(resolved.entries[0].manualState).toBe("resolved");
    expect(getContinuityEntryEligibility(resolved.entries[0]).canEnterDefaultContext).toBe(false);
    const ui = setConversationSemanticEntryManualState(first.workspace, first.entries[0].id, "resolved");
    expect(ui.projectContinuity.recordEntries.find((entry) => entry.id === first.entries[0].id)?.manualState).toBe("resolved");
    const retracted = semantic(first.workspace, "撤回单手操作问题", [{ ...question, action: "retract", targetEntryId: first.entries[0].id, evidenceQuote: "撤回单手操作问题" }], "user-3");
    expect(retracted.entries[0].manualState).toBe("withdrawn");
    expect(setConversationSemanticEntryManualState(first.workspace, first.entries[0].id, "withdrawn").projectContinuity.recordEntries.find((entry) => entry.id === first.entries[0].id)?.manualState).toBe("withdrawn");
  });
  it("rejects implicit/unauthorized replacement, non-question resolution and deterministic event targets", () => {
    const first = semantic(fixture(), assertion.evidenceQuote, [assertion], "user-1");
    const implicit = semantic(first.workspace, "预算上限 800 元", [{ ...assertion, action: "supersede", targetEntryId: first.entries[0].id, evidenceQuote: "预算上限 800 元" }], "user-2");
    expect(implicit.rejected).toHaveLength(1);
    const wrong = semantic(first.workspace, "约束问题已解决", [{ ...assertion, action: "resolve", targetEntryId: first.entries[0].id, evidenceQuote: "约束问题已解决" }], "user-3");
    expect(wrong.rejected).toHaveLength(1);
    const unauthorized = semantic(first.workspace, "替代预算", [{ ...assertion, action: "supersede", targetEntryId: "missing", evidenceQuote: "替代预算" }], "user-4");
    expect(unauthorized.rejected).toHaveLength(1);
  });
  it("round-trips the integrated evidence, Decision and semantic lifecycle through schema 18 and Editable Backup", () => {
    const defined = definition(fixture()); const recorded = research(defined.workspace); const applied = applyResearchAnalysisProposal(recorded.workspace, recorded.proposal.id, { position: { x: 0, y: 0 } });
    if (applied.status !== "updated") throw new Error(applied.reason);
    const first = semantic(applied.workspace, assertion.evidenceQuote, [assertion], "user-1");
    const next = semantic(first.workspace, "预算改为 800 元替代 500 元", [{ ...assertion, action: "supersede", targetEntryId: first.entries[0].id, evidenceQuote: "预算改为 800 元替代 500 元" }], "user-2").workspace;
    expect(validateCurrentMorphoWorkspace(next)).toMatchObject({ status: "ok" });
    const roundTrip = parseWorkspace(serializeWorkspace(next)); if (roundTrip.status !== "ok") throw new Error(roundTrip.reason);
    expect(validateCurrentMorphoWorkspace(roundTrip.workspace)).toMatchObject({ status: "ok" });
    expect(roundTrip.workspace.decisionRecords).toEqual(next.decisionRecords);
    expect(createEditableProjectBackupManifest(roundTrip.workspace).status).toBe("ok");
  });
});
