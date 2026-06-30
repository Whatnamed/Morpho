import { describe, expect, it } from "vitest";

import { createInitialWorkspace, deleteObject, hideObject } from "./workspace";
import {
  applyConversationSemanticPatch,
  applyProjectContinuityEvent,
  buildProjectContinuityContext,
  deriveProjectMemoryViews,
  getContinuityEntryEligibility,
  getContinuityRecordGroups,
  resolveContinuityValidity,
  setConversationSemanticEntryManualState
} from "./projectContinuity";
import { buildSemanticPatchAuthorization } from "./conversationSemanticPatch";

describe("project continuity runtime", () => {
  it("records import events with structured current focus, typed source refs, and idempotent dedupe", () => {
    const workspace = createInitialWorkspace();
    const updated = applyProjectContinuityEvent(workspace, {
      type: "inputImported",
      objectIds: ["file-course-brief", "file-path-references"],
      createdAt: "2026-06-30T08:00:00.000Z"
    });
    const replayed = applyProjectContinuityEvent(updated, {
      type: "inputImported",
      objectIds: ["file-path-references", "file-course-brief"],
      createdAt: "2026-06-30T08:00:00.000Z"
    });

    expect(updated.projectContinuity.currentFocus).toMatchObject({
      area: "startAndInput",
      sourceKind: "userAction",
      sourceObjectIds: ["file-course-brief", "file-path-references"],
      note: "已加入 2 项项目输入。"
    });
    expect(updated.projectContinuity.recordEntries).toHaveLength(workspace.projectContinuity.recordEntries.length + 1);
    expect(replayed.projectContinuity.recordEntries).toHaveLength(updated.projectContinuity.recordEntries.length);
    expect(replayed.projectContinuity.recordEntries.at(-1)?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "object",
          id: "file-course-brief",
          snapshot: expect.objectContaining({
            title: "课程要求.pdf",
            objectType: "file",
            visibility: "active"
          })
        })
      ])
    );
    expect(JSON.stringify(replayed.projectContinuity)).not.toContain("data:image");
    expect(replayed.projectContinuity.recordEntries.at(-1)).toMatchObject({
      origin: "deterministicEvent",
      manualState: "active"
    });
  });

  it("writes conversation semantic patches as idempotent records without changing current focus", () => {
    const workspace = createInitialWorkspace();
    const originalFocus = workspace.projectContinuity.currentFocus;
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft: "夜间识别感比造型复杂度更重要，后面不要做得太科技化。",
      userMessageId: "ai-user-semantic-1",
      userMessageCreatedAt: "2026-06-30T09:10:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: ["image-soft-rail-v2"],
      revisionIds: [],
      decisionIds: []
    });
    const applied = applyConversationSemanticPatch(workspace, authorization, [
      {
        kind: "preference",
        scope: "project",
        evidenceQuote: "夜间识别感比造型复杂度更重要",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      {
        kind: "avoidance",
        scope: "visual",
        evidenceQuote: "后面不要做得太科技化",
        relatedObjectIds: ["image-soft-rail-v2"],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      }
    ]);
    const replayed = applyConversationSemanticPatch(applied.workspace, authorization, [
      {
        kind: "preference",
        scope: "project",
        evidenceQuote: "夜间识别感比造型复杂度更重要",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      }
    ]);

    expect(applied.entries).toHaveLength(2);
    expect(applied.workspace.projectContinuity.currentFocus).toEqual(originalFocus);
    expect(applied.entries[0]).toMatchObject({
      origin: "conversationSemanticPatch",
      manualState: "active",
      semanticKind: "preference",
      sourceMessageId: "ai-user-semantic-1",
      evidenceQuote: "夜间识别感比造型复杂度更重要",
      scope: "project",
      stage: originalFocus.area,
      category: "preference",
      summary: "明确偏好：夜间识别感比造型复杂度更重要",
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          id: "ai-user-semantic-1",
          snapshot: expect.objectContaining({ title: "用户表达" })
        })
      ])
    });
    expect(JSON.stringify(applied.workspace.projectContinuity)).not.toContain("夜间识别感比造型复杂度更重要，后面不要做得太科技化。");
    expect(replayed.workspace.projectContinuity.recordEntries).toHaveLength(applied.workspace.projectContinuity.recordEntries.length);
  });

  it("uses centralized eligibility for manual state, validity, and source availability", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft: "夜间识别感比造型复杂度更重要，后面不要做得太科技化。",
      userMessageId: "ai-user-semantic-2",
      userMessageCreatedAt: "2026-06-30T09:11:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: ["image-soft-rail-v2"],
      revisionIds: [],
      decisionIds: []
    });
    const applied = applyConversationSemanticPatch(workspace, authorization, [
      {
        kind: "avoidance",
        scope: "visual",
        evidenceQuote: "后面不要做得太科技化",
        relatedObjectIds: ["image-soft-rail-v2"],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      }
    ]).workspace;
    const entry = applied.projectContinuity.recordEntries.at(-1);
    if (!entry) {
      throw new Error("Expected semantic entry.");
    }
    const hidden = resolveContinuityValidity(hideObject(applied, "image-soft-rail-v2"));
    const hiddenEntry = hidden.projectContinuity.recordEntries.at(-1);
    const withdrawn = {
      ...entry,
      manualState: "withdrawn" as const
    };

    expect(getContinuityEntryEligibility(entry)).toMatchObject({
      canEnterMemory: true,
      canEnterDefaultContext: true,
      canEnterReviewList: false,
      uiLabel: "当前有效"
    });
    expect(hiddenEntry ? getContinuityEntryEligibility(hiddenEntry) : undefined).toMatchObject({
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "当前有效 · 来源已隐藏"
    });
    expect(getContinuityEntryEligibility(withdrawn)).toMatchObject({
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "已撤回"
    });
  });

  it("keeps inactive semantic patches in history while excluding them from memory and context", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft: "夜间识别感比造型复杂度更重要，后面不要做得太科技化。",
      userMessageId: "ai-user-semantic-3",
      userMessageCreatedAt: "2026-06-30T09:12:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: [],
      revisionIds: [],
      decisionIds: []
    });
    const applied = applyConversationSemanticPatch(workspace, authorization, [
      {
        kind: "preference",
        scope: "project",
        evidenceQuote: "夜间识别感比造型复杂度更重要",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      }
    ]).workspace;
    const entry = applied.projectContinuity.recordEntries.at(-1);
    if (!entry) {
      throw new Error("Expected semantic entry.");
    }
    const inactive = {
      ...applied,
      projectContinuity: {
        ...applied.projectContinuity,
        recordEntries: applied.projectContinuity.recordEntries.map((candidate) =>
          candidate.id === entry.id ? { ...candidate, manualState: "notApplicable" as const } : candidate
        )
      }
    };
    const memory = deriveProjectMemoryViews(inactive);
    const context = buildProjectContinuityContext(inactive, {
      taskKind: "general",
      selectedObjectIds: []
    });

    expect(inactive.projectContinuity.recordEntries.map((candidate) => candidate.id)).toContain(entry.id);
    expect(memory.preferencesAndAvoids.items.map((item) => item.id)).not.toContain(entry.id);
    expect(context.relevantStageRecords.map((candidate) => candidate.id)).not.toContain(entry.id);
  });

  it("updates manualState only for conversation semantic entries", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft: "Keep the night light warm and do not make it look medical.",
      userMessageId: "ai-user-manual-state",
      userMessageCreatedAt: "2026-06-30T10:00:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: [],
      revisionIds: [],
      decisionIds: []
    });
    const semantic = applyConversationSemanticPatch(workspace, authorization, [
      {
        kind: "preference",
        scope: "project",
        evidenceQuote: "Keep the night light warm",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      }
    ]);
    const semanticEntry = semantic.entries[0];
    if (!semanticEntry) {
      throw new Error("Expected semantic entry.");
    }

    const notApplicable = setConversationSemanticEntryManualState(
      semantic.workspace,
      semanticEntry.id,
      "notApplicable",
      "2026-06-30T10:01:00.000Z"
    );
    const updatedEntry = notApplicable.projectContinuity.recordEntries.find((entry) => entry.id === semanticEntry.id);
    const context = buildProjectContinuityContext(notApplicable, {
      taskKind: "general",
      selectedObjectIds: []
    });

    expect(updatedEntry?.manualState).toBe("notApplicable");
    expect(updatedEntry?.validity).toBe("current");
    expect(context.relevantStageRecords.map((entry) => entry.id)).not.toContain(semanticEntry.id);

    const deterministic = applyProjectContinuityEvent(notApplicable, {
      type: "inputImported",
      objectIds: ["file-course-brief"],
      createdAt: "2026-06-30T10:02:00.000Z"
    });
    const deterministicEntry = deterministic.projectContinuity.recordEntries.at(-1);
    if (!deterministicEntry) {
      throw new Error("Expected deterministic entry.");
    }
    const unchanged = setConversationSemanticEntryManualState(
      deterministic,
      deterministicEntry.id,
      "withdrawn",
      "2026-06-30T10:03:00.000Z"
    );

    expect(unchanged.projectContinuity.recordEntries.at(-1)?.origin).toBe("deterministicEvent");
    expect(unchanged.projectContinuity.recordEntries.at(-1)?.manualState).toBe("active");
  });

  it("keeps exploration empty unless an explicit exploration event exists", () => {
    const workspace = createInitialWorkspace();
    const groups = getContinuityRecordGroups(workspace);

    expect(groups.exploration.entries).toEqual([]);
    expect(groups.exploration.emptyMessage).toBe("暂无探索记录。");
  });

  it("keeps hidden sources current while marking them hidden and out of default context", () => {
    const workspace = applyProjectContinuityEvent(createInitialWorkspace(), {
      type: "defaultReferenceChanged",
      imageObjectId: "image-soft-rail-v2",
      previousImageObjectId: "image-night-scenario",
      createdAt: "2026-06-30T08:10:00.000Z"
    });
    const hidden = resolveContinuityValidity(hideObject(workspace, "image-soft-rail-v2"));
    const hiddenEntry = hidden.projectContinuity.recordEntries.at(-1);
    const hiddenContext = buildProjectContinuityContext(hidden, {
      taskKind: "visualDevelopment",
      selectedObjectIds: []
    });
    const deletedResult = deleteObject(workspace, "image-soft-rail-v2", {
      confirmed: true,
      reason: "用户明确删除默认参考源图。"
    });

    expect(hidden.projectContinuity.recordEntries.at(-1)?.validity).toBe("current");
    expect(hiddenEntry?.sourceRefs[0]?.sourceAvailability).toBe("hidden");
    expect(hiddenContext.relevantStageRecords.map((entry) => entry.dedupeKey)).not.toContain(hiddenEntry?.dedupeKey);
    expect(hiddenContext.reviewRequiredItems.map((entry) => entry.dedupeKey)).not.toContain(hiddenEntry?.dedupeKey);
    expect(deletedResult.status).toBe("updated");
    if (deletedResult.status !== "updated") {
      throw new Error("Expected deletion to update workspace.");
    }
    const deleted = resolveContinuityValidity(deletedResult.workspace);
    expect(deleted.projectContinuity.recordEntries.at(-1)?.validity).toBe("sourceUnavailable");
    expect(deleted.projectContinuity.recordEntries.at(-1)?.sourceRefs[0]?.snapshot?.title).toBe("柔光轨道 v2");
  });


  it("keeps hidden design-definition memories current without marking them review required", () => {
    const hidden = resolveContinuityValidity(hideObject(createInitialWorkspace(), "definition-current"));
    const views = deriveProjectMemoryViews(hidden);
    const designDefinitionItem = views.designDefinition.items[0];
    const context = buildProjectContinuityContext(hidden, {
      taskKind: "visualDevelopment",
      selectedObjectIds: []
    });

    expect(designDefinitionItem?.validity).toBe("current");
    expect(designDefinitionItem?.sourceRefs[0]?.sourceAvailability).toBe("hidden");
    expect(context.relevantProjectMemoryViews.flatMap((view) => view.items).map((item) => item.id)).not.toContain(
      designDefinitionItem?.id
    );
  });

  it("marks only entries tied to superseded design-definition revisions as superseded", () => {
    const workspace = createInitialWorkspace();
    const withVisualRecord = applyProjectContinuityEvent(workspace, {
      type: "visualGenerationCompleted",
      operationId: "operation-image-old-definition",
      resultObjectIds: ["image-soft-rail-v2"],
      sourceObjectIds: ["direction-soft-rail"],
      definitionRevisionId: "definition-revision-current-1",
      successCount: 1,
      failureCount: 0,
      createdAt: "2026-06-30T08:20:00.000Z"
    });
    const withResearchRecord = applyProjectContinuityEvent(withVisualRecord, {
      type: "researchApplied",
      operationId: "operation-research-current",
      researchObjectId: "research-night-path",
      sourceObjectIds: ["file-course-brief"],
      createdAt: "2026-06-30T08:21:00.000Z"
    });
    const definition = withResearchRecord.objects["definition-current"];
    if (!definition || definition.type !== "designDefinition") {
      throw new Error("Expected seed design definition.");
    }
    const revised = resolveContinuityValidity({
      ...withResearchRecord,
      objects: {
        ...withResearchRecord.objects,
        "definition-current": {
          ...definition,
          currentRevisionId: "definition-revision-current-2",
          revisionIds: [...definition.revisionIds, "definition-revision-current-2"]
        }
      },
      designDefinitionRevisions: {
        ...withResearchRecord.designDefinitionRevisions,
        "definition-revision-current-1": {
          ...withResearchRecord.designDefinitionRevisions["definition-revision-current-1"],
          isCurrent: false
        },
        "definition-revision-current-2": {
          ...withResearchRecord.designDefinitionRevisions["definition-revision-current-1"],
          id: "definition-revision-current-2",
          revisionNumber: 2,
          previousRevisionId: "definition-revision-current-1",
          createdAt: "2026-06-30T08:22:00.000Z",
          isCurrent: true
        }
      }
    });

    const visualEntry = revised.projectContinuity.recordEntries.find((entry) => entry.dedupeKey === "visualGenerationCompleted:operation-image-old-definition");
    const researchEntry = revised.projectContinuity.recordEntries.find((entry) => entry.dedupeKey === "researchApplied:operation-research-current");
    expect(visualEntry?.validity).toBe("superseded");
    expect(visualEntry?.invalidationReasons).toContain("definitionRevisionSuperseded:definition-revision-current-1");
    expect(researchEntry?.validity).toBe("current");
  });

  it("derives seven traceable memory views without inventing delivery plans", () => {
    const workspace = createInitialWorkspace();
    const views = deriveProjectMemoryViews(workspace);

    expect(Object.keys(views)).toEqual([
      "projectOverview",
      "designDefinition",
      "preferencesAndAvoids",
      "decisionLog",
      "rejectedDirections",
      "openQuestions",
      "deliveryPlan"
    ]);
    expect(views.designDefinition.items[0]?.sourceRefs).toContainEqual(
      expect.objectContaining({ kind: "revision", id: "definition-revision-current-1" })
    );
    expect(views.rejectedDirections.items.map((item) => item.title)).toContain("方向 C：软性引导带");
    expect(views.deliveryPlan.items).toEqual([]);
    expect(views.deliveryPlan.emptyMessage).toBe("暂无真实交付计划。");
  });

  it("builds deterministic task continuity context with relevance and validity rules", () => {
    const workspace = applyProjectContinuityEvent(
      applyProjectContinuityEvent(createInitialWorkspace(), {
        type: "researchApplied",
        operationId: "operation-research-current",
        researchObjectId: "research-night-path",
        sourceObjectIds: ["file-course-brief"],
        createdAt: "2026-06-30T08:30:00.000Z"
      }),
      {
        type: "defaultReferenceChanged",
        imageObjectId: "image-soft-rail-v2",
        previousImageObjectId: "image-night-scenario",
        createdAt: "2026-06-30T08:31:00.000Z"
      }
    );
    const context = buildProjectContinuityContext(workspace, {
      taskKind: "visualDevelopment",
      selectedObjectIds: ["image-soft-rail-v2"],
      targetDirectionIds: ["direction-soft-rail"]
    });

    expect(context.currentFocus.area).toBe("directionAndVisual");
    expect(context.relevantStageRecords[0]?.stage).toBe("directionAndVisual");
    expect(context.relevantProjectMemoryViews.map((view) => view.key)).toEqual(
      expect.arrayContaining(["designDefinition", "preferencesAndAvoids", "decisionLog"])
    );
    expect(context.omitted.some((item) => item.reason.includes("not relevant"))).toBe(true);
    expect(context.truncated).toBe(false);
    expect(JSON.stringify(context)).not.toContain("prompt");
  });

  it("includes superseded continuity records only for history-oriented context", () => {
    const workspace = applyProjectContinuityEvent(createInitialWorkspace(), {
      type: "visualGenerationCompleted",
      operationId: "operation-image-old-default",
      resultObjectIds: ["image-night-scenario"],
      sourceObjectIds: ["image-soft-rail-v2"],
      successCount: 1,
      failureCount: 0,
      createdAt: "2026-06-30T08:40:00.000Z"
    });
    const image = workspace.objects["image-soft-rail-v2"];
    if (!image || image.type !== "image") {
      throw new Error("Expected seed default reference image.");
    }
    const superseded = resolveContinuityValidity({
      ...workspace,
      objects: {
        ...workspace.objects,
        "image-soft-rail-v2": {
          ...image,
          isDefaultReference: false
        }
      }
    });

    const ordinaryContext = buildProjectContinuityContext(superseded, {
      taskKind: "visualDevelopment",
      selectedObjectIds: []
    });
    const historyContext = buildProjectContinuityContext(superseded, {
      taskKind: "visualDevelopment",
      selectedObjectIds: [],
      includeHistorical: true
    });

    expect(ordinaryContext.relevantStageRecords.map((entry) => entry.dedupeKey)).not.toContain(
      "visualGenerationCompleted:operation-image-old-default"
    );
    expect(historyContext.relevantStageRecords.map((entry) => entry.dedupeKey)).toContain(
      "visualGenerationCompleted:operation-image-old-default"
    );
  });

  it("dedupes repeated visual branch and default reference continuity events", () => {
    const branchWorkspace = createInitialWorkspace();
    const withBranch = applyProjectContinuityEvent(branchWorkspace, {
      type: "visualBranchChanged",
      action: "created",
      branchId: "visual-branch-soft-rail-core",
      directionId: "direction-soft-rail",
      createdAt: "2026-06-30T08:50:00.000Z"
    });
    const replayedBranch = applyProjectContinuityEvent(withBranch, {
      type: "visualBranchChanged",
      action: "created",
      branchId: "visual-branch-soft-rail-core",
      directionId: "direction-soft-rail",
      createdAt: "2026-06-30T08:50:00.000Z"
    });

    expect(replayedBranch.projectContinuity.recordEntries).toHaveLength(withBranch.projectContinuity.recordEntries.length);

    const referenceWorkspace = createInitialWorkspace();
    const withReference = applyProjectContinuityEvent(referenceWorkspace, {
      type: "defaultReferenceChanged",
      imageObjectId: "image-soft-rail-v2",
      previousImageObjectId: "image-night-scenario",
      decisionId: "decision-default-reference-1",
      createdAt: "2026-06-30T08:51:00.000Z"
    });
    const replayedReference = applyProjectContinuityEvent(withReference, {
      type: "defaultReferenceChanged",
      imageObjectId: "image-soft-rail-v2",
      previousImageObjectId: "image-night-scenario",
      decisionId: "decision-default-reference-1",
      createdAt: "2026-06-30T08:51:00.000Z"
    });

    expect(replayedReference.projectContinuity.recordEntries).toHaveLength(withReference.projectContinuity.recordEntries.length);
  });
});
