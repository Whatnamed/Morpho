import { describe, expect, it } from "vitest";

import { buildSemanticPatchAuthorization } from "./conversationSemanticPatch";
import { applyConversationSemanticPatch } from "./projectContinuity";
import {
  buildAgentDefaultMemoryContext,
  getCurrentProjectMemoryRevision,
  getCurrentStageRecordRevision,
  getProjectMemoryHistory,
  getStageRecordHistory,
  normalizeProjectMemoryState,
  reconcileProjectMemory
} from "./projectMemory";
import type { AiMessage, MorphoWorkspace, ProjectMemoryKey } from "./types";
import { clearDefaultReference, createBlankWorkspace, createInitialWorkspace } from "./workspace";

const MEMORY_KEYS: ProjectMemoryKey[] = [
  "projectOverview",
  "designBrief",
  "userPreferences",
  "decisionLog",
  "rejectedDirections",
  "openQuestions",
  "outputPlan"
];

describe("Project Memory Kernel", () => {
  it("projects seven current documents and only stages that actually have project facts", () => {
    const workspace = reconcileProjectMemory(createInitialWorkspace(), "2026-07-13T12:00:00.000Z");

    expect(MEMORY_KEYS.map((key) => workspace.projectMemory.documents[key].title)).toHaveLength(7);
    expect(MEMORY_KEYS.filter((key) => getCurrentProjectMemoryRevision(workspace.projectMemory, key))).toEqual([
      "projectOverview",
      "designBrief",
      "decisionLog",
      "rejectedDirections",
      "openQuestions",
      "outputPlan"
    ]);
    expect(getCurrentStageRecordRevision(workspace.projectMemory, "exploration")).toBeUndefined();
    expect(getCurrentStageRecordRevision(workspace.projectMemory, "research")).toBeDefined();
    expect(getCurrentStageRecordRevision(workspace.projectMemory, "directionAndVisual")).toBeDefined();
    expect(getCurrentStageRecordRevision(workspace.projectMemory, "deliveryPreparation")).toBeDefined();
  });

  it("builds a bounded current-only default memory context for ordinary Agent turns", () => {
    let workspace = withUserMessage(createInitialWorkspace(), "default-memory-user", "以后这个项目都保持克制、低压迫感。", "12:00");
    workspace = applyMemoryItems(workspace, "default-memory-user", "以后这个项目都保持克制、低压迫感。", [
      { kind: "preference", evidenceQuote: "以后这个项目都保持克制、低压迫感" }
    ]);
    workspace = reconcileProjectMemory(workspace, "2026-07-13T12:01:00.000Z");

    const context = buildAgentDefaultMemoryContext(workspace, "discussion");
    expect(context.documents.map((document) => document.key)).toEqual([
      "projectOverview",
      "designBrief",
      "userPreferences",
      "openQuestions"
    ]);
    expect(JSON.stringify(context.documents.find((document) => document.key === "userPreferences"))).toContain(
      "克制、低压迫感"
    );
    expect(context.documents.every((document) => document.sections.length <= 9)).toBe(true);
    expect(context.documents.every((document) => document.sections.every((section) => section.items.length <= 5))).toBe(true);
    const designBrief = context.documents.find((document) => document.key === "designBrief");
    expect(designBrief?.sections.slice(0, 4).map((section) => section.key)).toEqual([
      "coreProblem",
      "designPrinciples",
      "constraints",
      "avoidDirections"
    ]);
    expect(context.stageRecords).toHaveLength(1);
    expect(context.stageRecords[0]?.stage).toBe("directionAndVisual");
  });

  it("derives overview reviewRequired from real source gaps instead of an unreachable filtered entry", () => {
    const valid = reconcileProjectMemory(createInitialWorkspace(), "2026-07-13T12:00:00.000Z");
    expect(getCurrentProjectMemoryRevision(valid.projectMemory, "projectOverview")?.reviewRequired).toBe(false);

    const missingFocusSource = reconcileProjectMemory(
      {
        ...valid,
        projectContinuity: {
          ...valid.projectContinuity,
          currentFocus: {
            ...valid.projectContinuity.currentFocus,
            sourceObjectIds: ["object-no-longer-present"]
          }
        }
      },
      "2026-07-13T12:01:00.000Z"
    );
    expect(getCurrentProjectMemoryRevision(missingFocusSource.projectMemory, "projectOverview")?.reviewRequired).toBe(true);

    const empty = reconcileProjectMemory(createBlankWorkspace("empty-memory-review"), "2026-07-13T12:02:00.000Z");
    expect(getCurrentProjectMemoryRevision(empty.projectMemory, "projectOverview")?.reviewRequired).toBe(false);
  });

  it("does not turn an assistant suggestion into a stable user preference", () => {
    const workspace = createInitialWorkspace();
    const withSuggestion: MorphoWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        messages: [
          ...workspace.ai.messages,
          message("assistant-suggestion", "assistant", "我建议以后都使用高饱和紫色。")
        ]
      }
    };
    const reconciled = reconcileProjectMemory(withSuggestion, "2026-07-13T12:00:00.000Z");
    expect(getCurrentProjectMemoryRevision(reconciled.projectMemory, "userPreferences")).toBeUndefined();
  });

  it("records explicit user evidence once, updates memory and stage revisions, and preserves revision chains", () => {
    let workspace = withUserMessage(createInitialWorkspace(), "user-pref-1", "以后都保持低眩光，避免医疗器械感。", "12:00");
    workspace = applyMemoryItems(workspace, "user-pref-1", "以后都保持低眩光，避免医疗器械感。", [
      { kind: "preference", evidenceQuote: "以后都保持低眩光" },
      { kind: "avoidance", evidenceQuote: "避免医疗器械感" }
    ]);
    workspace = reconcileProjectMemory(workspace, "2026-07-13T12:01:00.000Z");
    const firstRevision = getCurrentProjectMemoryRevision(workspace.projectMemory, "userPreferences");
    expect(firstRevision?.basis).toBe("userExplicit");
    expect(JSON.stringify(firstRevision?.sections)).toContain("以后都保持低眩光");
    expect(firstRevision?.sourceRefs).toContainEqual(expect.objectContaining({ kind: "message", id: "user-pref-1" }));

    const replay = reconcileProjectMemory(
      applyMemoryItems(workspace, "user-pref-1", "以后都保持低眩光，避免医疗器械感。", [
        { kind: "preference", evidenceQuote: "以后都保持低眩光" }
      ]),
      "2026-07-13T12:02:00.000Z"
    );
    expect(getProjectMemoryHistory(replay.projectMemory, "userPreferences")).toHaveLength(1);

    let second = withUserMessage(replay, "user-pref-2", "后续材质优先使用低反光表面。", "12:03");
    second = applyMemoryItems(second, "user-pref-2", "后续材质优先使用低反光表面。", [
      { kind: "preference", evidenceQuote: "材质优先使用低反光表面" }
    ]);
    second = reconcileProjectMemory(second, "2026-07-13T12:04:00.000Z");
    const currentRevision = getCurrentProjectMemoryRevision(second.projectMemory, "userPreferences");
    expect(currentRevision?.previousRevisionId).toBe(firstRevision?.id);
    expect(getProjectMemoryHistory(second.projectMemory, "userPreferences")).toHaveLength(2);
    expect(getStageRecordHistory(second.projectMemory, "directionAndVisual").length).toBeGreaterThanOrEqual(2);
  });

  it("removes invalidated message-backed content from the current projection without deleting history", () => {
    let workspace = withUserMessage(createInitialWorkspace(), "user-pref-remove", "始终避免高亮镜面。", "12:00");
    workspace = applyMemoryItems(workspace, "user-pref-remove", "始终避免高亮镜面。", [
      { kind: "avoidance", evidenceQuote: "始终避免高亮镜面" }
    ]);
    workspace = reconcileProjectMemory(workspace, "2026-07-13T12:01:00.000Z");
    expect(getCurrentProjectMemoryRevision(workspace.projectMemory, "userPreferences")?.sections.length).toBeGreaterThan(0);

    const removed = reconcileProjectMemory(
      { ...workspace, ai: { ...workspace.ai, messages: workspace.ai.messages.filter((entry) => entry.id !== "user-pref-remove") } },
      "2026-07-13T12:02:00.000Z"
    );
    expect(getCurrentProjectMemoryRevision(removed.projectMemory, "userPreferences")?.sections).toEqual([]);
    expect(getProjectMemoryHistory(removed.projectMemory, "userPreferences")).toHaveLength(2);
  });

  it("keeps unanchored one-off generations out of project memory sources", () => {
    const base = createBlankWorkspace("project-image-anchoring");
    const image = (
      id: string,
      title: string,
      generation: Partial<NonNullable<MorphoWorkspace["objects"][string] & { type: "image" }>["generation"]>
    ) => ({
      id,
      type: "image" as const,
      title,
      summary: "",
      createdBy: "ai" as const,
      visibility: "active" as const,
      role: "conceptImage" as const,
      imageVariant: "detail" as const,
      assetId: `asset-${id}`,
      generation: {
        operationId: `operation-${id}`,
        modelId: "gpt-image-2",
        modelLabel: "GPT Image 2",
        aspectRatio: "1:1",
        prompt: "…",
        referenceObjectIds: [],
        createdAt: "2026-07-13T12:00:00.000Z",
        ...generation
      }
    });
    const workspace: MorphoWorkspace = {
      ...base,
      objects: {
        ...base.objects,
        // Generated from project objects: a real project outcome.
        [`image-anchored`]: image("image-anchored", "浮标主视角", {
          referenceObjectIds: ["direction-buoy"]
        }),
        // A one-off trial generation with no link into the project.
        [`image-free`]: image("image-free", "夜间柔光扶手", {})
      }
    };

    const reconciled = reconcileProjectMemory(workspace, "2026-07-13T12:05:00.000Z");
    const directionStage = getCurrentStageRecordRevision(reconciled.projectMemory, "directionAndVisual");
    const sourceIds = directionStage?.sourceRefs.map((ref) => ref.id) ?? [];

    expect(sourceIds).toContain("image-anchored");
    expect(sourceIds).not.toContain("image-free");
    // The object itself is untouched; only its meaning as a memory source changes.
    expect(reconciled.objects["image-free"]?.visibility).toBe("active");
  });

  it("treats a direction, branch, delivery or default-reference image as an anchored outcome", () => {
    const base = createBlankWorkspace("project-image-anchoring-links");
    const generation = {
      operationId: "operation-linked",
      modelId: "gpt-image-2",
      modelLabel: "GPT Image 2",
      aspectRatio: "1:1",
      prompt: "…",
      referenceObjectIds: [],
      createdAt: "2026-07-13T12:00:00.000Z"
    };
    const image = (id: string, extra: Record<string, unknown>) => ({
      id,
      type: "image" as const,
      title: id,
      summary: "",
      createdBy: "ai" as const,
      visibility: "active" as const,
      role: "conceptImage" as const,
      imageVariant: "detail" as const,
      assetId: `asset-${id}`,
      generation: { ...generation, ...extra }
    });
    const workspace: MorphoWorkspace = {
      ...base,
      objects: {
        ...base.objects,
        "image-by-direction": image("image-by-direction", { directionId: "direction-buoy" }),
        "image-by-branch": image("image-by-branch", { visualBranchId: "branch-buoy" }),
        "image-default": image("image-default", {}),
        "image-unlinked": image("image-unlinked", {})
      },
      workingState: { ...base.workingState, currentDefaultReferenceId: "image-default" }
    };

    const reconciled = reconcileProjectMemory(workspace, "2026-07-13T12:06:00.000Z");
    const sourceIds = getCurrentStageRecordRevision(reconciled.projectMemory, "directionAndVisual")
      ?.sourceRefs.map((ref) => ref.id) ?? [];

    expect(sourceIds).toEqual(expect.arrayContaining([
      "image-by-direction",
      "image-by-branch",
      "image-default"
    ]));
    expect(sourceIds).not.toContain("image-unlinked");
  });

  it("normalizes legacy cleared-default wording before projecting current memory and stage records", () => {
    const cleared = clearDefaultReference(createInitialWorkspace(), "image-soft-rail-v2", {
      reason: "用户明确取消后续默认参考。"
    });
    const latestEntry = cleared.projectContinuity.recordEntries.at(-1);
    if (!latestEntry) {
      throw new Error("Expected a default-reference continuity entry.");
    }
    const staleSummary = "已将「柔光轨道 v2」设为后续默认参考。";
    const stale: MorphoWorkspace = {
      ...cleared,
      projectContinuity: {
        ...cleared.projectContinuity,
        currentFocus: { ...cleared.projectContinuity.currentFocus, note: staleSummary },
        recordEntries: cleared.projectContinuity.recordEntries.map((entry) =>
          entry.id === latestEntry.id ? { ...entry, summary: staleSummary } : entry
        )
      }
    };

    const reconciled = reconcileProjectMemory(stale, "2026-07-13T12:02:00.000Z");
    const overview = getCurrentProjectMemoryRevision(reconciled.projectMemory, "projectOverview");
    const directionStage = getCurrentStageRecordRevision(reconciled.projectMemory, "directionAndVisual");
    expect(JSON.stringify(overview?.sections)).toContain("已清除「柔光轨道 v2」的后续默认参考");
    expect(JSON.stringify(directionStage?.sections)).toContain("已清除「柔光轨道 v2」的后续默认参考");
    expect(JSON.stringify(overview?.sections)).not.toContain(staleSummary);
  });

  it("stays idempotent across JSON persistence and collapses consecutive equivalent revisions", () => {
    const workspace = reconcileProjectMemory(createInitialWorkspace(), "2026-07-13T12:00:00.000Z");
    const persisted = JSON.parse(JSON.stringify(workspace.projectMemory)) as MorphoWorkspace["projectMemory"];
    const root = getCurrentProjectMemoryRevision(persisted, "projectOverview");
    if (!root) {
      throw new Error("Expected a Project Overview revision.");
    }
    const duplicateId = "memory-projectOverview-duplicate";
    persisted.revisions[duplicateId] = {
      ...root,
      id: duplicateId,
      previousRevisionId: root.id
    };
    persisted.documents.projectOverview = {
      ...persisted.documents.projectOverview,
      currentRevisionId: duplicateId
    };

    const normalized = normalizeProjectMemoryState(workspace, persisted, "2026-07-13T12:05:00.000Z");
    const normalizedAgain = normalizeProjectMemoryState(
      workspace,
      JSON.parse(JSON.stringify(normalized)),
      "2026-07-13T12:10:00.000Z"
    );

    expect(normalized.documents.projectOverview.currentRevisionId).toBe(root.id);
    expect(normalized.revisions[duplicateId]).toBeUndefined();
    expect(normalizedAgain).toEqual(normalized);
  });
});

function applyMemoryItems(
  workspace: MorphoWorkspace,
  userMessageId: string,
  draft: string,
  items: Array<{ kind: "preference" | "avoidance"; evidenceQuote: string }>
): MorphoWorkspace {
  const authorization = buildSemanticPatchAuthorization({
    taskMode: "chatAnalysis",
    draft,
    userMessageId,
    userMessageCreatedAt: workspace.ai.messages.find((entry) => entry.id === userMessageId)?.createdAt ?? "",
    currentFocusArea: workspace.projectContinuity.currentFocus.area,
    objectIds: [],
    revisionIds: [],
    decisionIds: []
  });
  return applyConversationSemanticPatch(
    workspace,
    authorization,
    items.map((item) => ({
      ...item,
      scope: "project" as const,
      relatedObjectIds: [],
      relatedRevisionIds: [],
      relatedDecisionIds: []
    }))
  ).workspace;
}

function withUserMessage(workspace: MorphoWorkspace, id: string, body: string, time: string): MorphoWorkspace {
  return {
    ...workspace,
    ai: { ...workspace.ai, messages: [...workspace.ai.messages, message(id, "user", body, time)] }
  };
}

function message(id: string, role: "user" | "assistant", body: string, time = "12:00"): AiMessage {
  return {
    id,
    role,
    body,
    createdAt: `2026-07-13T${time}:00.000Z`,
    taskMode: "chatAnalysis",
    status: "done"
  };
}
