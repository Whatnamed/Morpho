import { describe, expect, it } from "vitest";
import { buildSemanticPatchAuthorization } from "./conversationSemanticPatch";
import { applyConversationSemanticPatch, buildProjectContinuityContext, deriveProjectMemoryViews, setConversationSemanticEntryManualState } from "./projectContinuity";
import { buildAgentDefaultMemoryContext, getCurrentProjectMemoryRevision, getCurrentStageRecordRevision, getProjectMemoryHistory, reconcileProjectMemory } from "./projectMemory";
import { createInitialWorkspace, hideObject, migrateWorkspaceToCurrentSchema, setConceptDirectionStatus } from "./workspace";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";
import { createEditableProjectBackupManifest, validateEditableProjectBackupManifest } from "./projectArchive";
import { compileImagePrompt } from "../operations/imagePromptCompiler";
import { resolveVisualReferences } from "../operations/visualReferenceResolver";
import type { VisualIntentItem } from "../operations/types";
import type { MorphoWorkspace } from "./types";
import { buildTaskContext, buildProviderTaskContext } from "../../features/workspace/taskContext";
import { appendAgentProviderStateFrames } from "../../features/workspace/providerContextFrames";

const A = "direction-soft-rail";
const B = "direction-support-island";
const preference = "只在柔光轨道方向保留紫色连接节点";

function withPreference(): MorphoWorkspace {
  const base = createInitialWorkspace();
  const workspace = { ...base, ai: { ...base.ai, messages: [...base.ai.messages, { id: "scope-user", role: "user" as const, body: preference, createdAt: "2026-10-01T00:00:00.000Z" }] } };
  const authorization = buildSemanticPatchAuthorization({ taskMode: "chatAnalysis", draft: preference, userMessageId: "scope-user", userMessageCreatedAt: "2026-10-01T00:00:00.000Z", currentFocusArea: "directionAndVisual", objectIds: [A], revisionIds: [], decisionIds: [] });
  const applied = applyConversationSemanticPatch(workspace, authorization, [{ kind: "preference", scope: "direction", evidenceQuote: preference, relatedObjectIds: [A], relatedRevisionIds: [], relatedDecisionIds: [] }]);
  expect(applied.rejected).toEqual([]);
  return applied.workspace;
}

function imagePrompt(workspace: MorphoWorkspace, targetDirectionId: string): string {
  const intent: VisualIntentItem = { id: "intent-scope", title: "节点研究", purpose: "节点研究", targetDirectionId, role: "conceptImage", requestedReferenceObjectIds: [], changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [] };
  const referenceResolution = resolveVisualReferences({ workspace, intent, selectedSourceObjectIds: [] });
  return compileImagePrompt({ workspace, intent, referenceResolution, modelId: "gpt-image-2", currentUserInput: "生成节点研究" }).prompt;
}

describe("P1B-2 projection consumer convergence", () => {
  it("preserves item identity and scope across Memory, views, Stage, Context and final image prompts", () => {
    const workspace = withPreference(); // No React setter or persistence hook.
    const revision = getCurrentProjectMemoryRevision(workspace.projectMemory, "userPreferences")!;
    const item = revision.sections.find((section) => section.key === "direction")!;
    expect(item.itemMetadata?.[0]).toMatchObject({ scope: "direction", sourceRefs: expect.arrayContaining([expect.objectContaining({ id: A })]), canEnterDefaultContext: true });
    const view = deriveProjectMemoryViews(workspace).preferencesAndAvoids.items.find((item) => item.summary.includes(preference))!;
    expect(view.id).toBe(item.itemMetadata?.[0]?.sourceEntryId);
    expect(view.sourceRefs).toEqual(item.itemMetadata?.[0]?.sourceRefs);
    const stage = getCurrentStageRecordRevision(workspace.projectMemory, "directionAndVisual")!;
    expect(stage.itemMetadata?.preferences?.some((metadata) => metadata.sourceEntryId === view.id)).toBe(true);
    for (const target of [A, B]) {
      const context = buildProjectContinuityContext(workspace, { taskKind: "visualDevelopment", targetDirectionIds: [target], selectedObjectIds: [target] });
      const defaults = buildAgentDefaultMemoryContext(workspace, "visualDevelopment", { targetDirectionIds: [target], directObjectIds: [A, B] });
      const contains = (value: unknown) => JSON.stringify(value).includes(preference);
      expect(contains(context.relevantProjectMemoryViews)).toBe(target === A);
      expect(contains(context.currentStageRecords)).toBe(target === A);
      expect(contains(defaults)).toBe(target === A);
      expect(imagePrompt(workspace, target).includes(preference)).toBe(target === A);
    }
    const context = buildTaskContext(workspace, { kind: "general", draft: "继续", selectedObjectIds: [] });
    const frames = appendAgentProviderStateFrames(workspace, { workspace, strategy: "historyAndMemory", mode: "auto", context, providerTaskContext: buildProviderTaskContext(context), defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "historyAndMemory"), projectId: workspace.project.id, promptContractVersion: "test", userMessageId: "scope-user" });
    expect(frames.ai.providerContextFrames?.at(-1)?.renderedText).not.toContain(preference);
  });

  it("withdraws the last preference at the domain boundary, keeps history and reuses equivalent history on restore", () => {
    const workspace = withPreference();
    const current = getCurrentProjectMemoryRevision(workspace.projectMemory, "userPreferences")!;
    const entryId = current.sections[0]!.itemMetadata![0]!.sourceEntryId!;
    const removed = setConversationSemanticEntryManualState(workspace, entryId, "withdrawn");
    expect(getCurrentProjectMemoryRevision(removed.projectMemory, "userPreferences")).toBeUndefined();
    expect(getProjectMemoryHistory(removed.projectMemory, "userPreferences")).toEqual([current]);
    expect(imagePrompt(removed, A)).not.toContain(preference);
    const restored = setConversationSemanticEntryManualState(removed, entryId, "active");
    expect(getCurrentProjectMemoryRevision(restored.projectMemory, "userPreferences")).toEqual(current);
    expect(reconcileProjectMemory(restored).projectMemory).toEqual(restored.projectMemory);
  });

  it("qualifies a revision-only direction fact against its actual target owner", () => {
    const workspace = withPreference();
    const direction = workspace.objects[A];
    if (direction?.type !== "conceptDirection") throw new Error("Missing direction");
    const entry = workspace.projectContinuity.recordEntries.find((entry) => entry.evidenceQuote === preference)!;
    const changed = reconcileProjectMemory({ ...workspace, projectContinuity: { ...workspace.projectContinuity, recordEntries: workspace.projectContinuity.recordEntries.map((item) => item.id === entry.id ? { ...item, sourceRefs: item.sourceRefs.filter((ref) => ref.kind !== "object").concat({ kind: "revision", id: direction.currentRevisionId }) } : item) } });
    expect(imagePrompt(changed, A)).toContain(preference);
    expect(imagePrompt(changed, B)).not.toContain(preference);
    expect(imagePrompt(hideObject(changed, A), A)).not.toContain(preference);
  });

  it("retains review diagnostics without putting them back into current claims or default inputs", () => {
    const workspace = withPreference();
    const missing = reconcileProjectMemory({ ...workspace, ai: { ...workspace.ai, messages: workspace.ai.messages.filter((message) => message.id !== "scope-user") } });
    const stage = getCurrentStageRecordRevision(missing.projectMemory, "directionAndVisual")!;
    expect(stage.sections.preferences?.some((text) => text.includes(preference)) ?? false).toBe(false);
    expect(stage.sections.openRisks?.some((text) => text.includes(preference) && text.startsWith("待复核："))).toBe(true);
    const diagnostic = stage.itemMetadata?.openRisks?.find((item) => item.sourceEntryId);
    expect(diagnostic).toMatchObject({ validity: "sourceUnavailable", canEnterMemory: false, canEnterDefaultContext: false, canEnterReviewList: true });
    expect(JSON.stringify(buildAgentDefaultMemoryContext(missing, "visualDevelopment", { targetDirectionIds: [A] }))).not.toContain(preference);
    expect(imagePrompt(missing, A)).not.toContain(preference);
  });

  it("does not use a hidden current definition or scoped preference via revision-only sources", () => {
    const workspace = withPreference();
    const hidden = hideObject(hideObject(workspace, A), "definition-current");
    expect(getCurrentProjectMemoryRevision(hidden.projectMemory, "designBrief")).toBeUndefined();
    expect(buildAgentDefaultMemoryContext(hidden, "visualDevelopment", { targetDirectionIds: [A] }).documents.find((document) => document.key === "designBrief")?.empty).toBe(true);
    expect(imagePrompt(hidden, A)).not.toContain(preference);
    const definition = workspace.objects["definition-current"];
    if (definition?.type !== "designDefinition") throw new Error("Missing definition");
    const constraints = workspace.designDefinitionRevisions[definition.currentRevisionId]!.constraints;
    for (const constraint of constraints) expect(imagePrompt(hidden, B)).not.toContain(constraint);
    expect(getProjectMemoryHistory(hidden.projectMemory, "designBrief").length).toBeGreaterThan(0);
  });

  it("keeps historical direction Decisions out of current Stage after elimination and restoration", () => {
    const base = createInitialWorkspace();
    const eliminated = setConceptDirectionStatus(base, A, "eliminated", "测试淘汰");
    const restored = setConceptDirectionStatus(eliminated, A, "alternative", "测试恢复");
    const current = getCurrentStageRecordRevision(restored.projectMemory, "directionAndVisual")!;
    const oldEntries = restored.projectContinuity.recordEntries.filter((entry) => entry.sourceRefs.some((ref) => ref.kind === "decision" && eliminated.decisionRecords.some((decision) => decision.id === ref.id)));
    for (const entry of oldEntries) {
      if (entry.validity === "superseded") expect(Object.values(current.sections).flat()).not.toContain(entry.summary);
    }
    expect(restored.projectMemory.stageRevisions).toMatchObject(eliminated.projectMemory.stageRevisions);
    expect(validateCurrentMorphoWorkspace(restored).status).toBe("ok");
  });

  it("rebuilds legacy current projections without rewriting legacy history and survives JSON and Editable Backup", () => {
    const original = withPreference();
    const legacy = structuredClone(original);
    for (const revision of Object.values(legacy.projectMemory.revisions)) for (const section of revision.sections) delete section.itemMetadata;
    for (const revision of Object.values(legacy.projectMemory.stageRevisions)) delete revision.itemMetadata;
    const old = getCurrentProjectMemoryRevision(legacy.projectMemory, "userPreferences")!;
    const migrated = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(legacy)));
    if (migrated.status !== "ok") throw new Error("Migration failed");
    expect(migrated.workspace.schemaVersion).toBe(18);
    expect(migrated.workspace.projectMemory.revisions[old.id]).toEqual(old);
    expect(getCurrentProjectMemoryRevision(migrated.workspace.projectMemory, "userPreferences")?.sections[0]?.itemMetadata).toBeDefined();
    expect(imagePrompt(migrated.workspace, B)).not.toContain(preference);
    const backup = createEditableProjectBackupManifest(migrated.workspace);
    if (backup.status !== "ok") throw new Error("Backup failed");
    expect(validateEditableProjectBackupManifest(JSON.parse(JSON.stringify(backup.manifest))).status).toBe("ok");
    const repeat = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(migrated.workspace)));
    if (repeat.status !== "ok") throw new Error("Round-trip failed");
    expect(repeat.workspace.projectMemory).toEqual(migrated.workspace.projectMemory);
  });

  it("rejects malformed optional item metadata while accepting historical omissions", () => {
    const workspace = withPreference();
    const revision = getCurrentProjectMemoryRevision(workspace.projectMemory, "userPreferences")!;
    revision.sections[0]!.itemMetadata = [];
    expect(validateCurrentMorphoWorkspace(workspace).status).toBe("failed");
    delete revision.sections[0]!.itemMetadata;
    expect(validateCurrentMorphoWorkspace(workspace).status).toBe("ok");
  });
});
