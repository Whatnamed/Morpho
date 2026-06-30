import { describe, expect, it } from "vitest";

import { createInitialWorkspace, deleteObject, hideObject } from "./workspace";
import {
  applyProjectContinuityEvent,
  buildProjectContinuityContext,
  deriveProjectMemoryViews,
  getContinuityRecordGroups,
  resolveContinuityValidity
} from "./projectContinuity";

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
  });

  it("keeps exploration empty unless an explicit exploration event exists", () => {
    const workspace = createInitialWorkspace();
    const groups = getContinuityRecordGroups(workspace);

    expect(groups.exploration.entries).toEqual([]);
    expect(groups.exploration.emptyMessage).toBe("暂无探索记录。");
  });

  it("separates hidden from deleted source availability without removing history", () => {
    const workspace = applyProjectContinuityEvent(createInitialWorkspace(), {
      type: "defaultReferenceChanged",
      imageObjectId: "image-soft-rail-v2",
      previousImageObjectId: "image-night-scenario",
      createdAt: "2026-06-30T08:10:00.000Z"
    });
    const hidden = resolveContinuityValidity(hideObject(workspace, "image-soft-rail-v2"));
    const deletedResult = deleteObject(workspace, "image-soft-rail-v2", {
      confirmed: true,
      reason: "用户明确删除默认参考源图。"
    });

    expect(hidden.projectContinuity.recordEntries.at(-1)?.validity).toBe("reviewRequired");
    expect(hidden.projectContinuity.recordEntries.at(-1)?.invalidationReasons).toContain("sourceHidden:image-soft-rail-v2");
    expect(deletedResult.status).toBe("updated");
    if (deletedResult.status !== "updated") {
      throw new Error("Expected deletion to update workspace.");
    }
    const deleted = resolveContinuityValidity(deletedResult.workspace);
    expect(deleted.projectContinuity.recordEntries.at(-1)?.validity).toBe("sourceUnavailable");
    expect(deleted.projectContinuity.recordEntries.at(-1)?.sourceRefs[0]?.snapshot?.title).toBe("柔光轨道 v2");
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
