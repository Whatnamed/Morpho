import type {
  ConceptDirectionObject,
  ContinuityRecordCategory,
  ContinuityRecordEntry,
  ContinuitySourceRef,
  ContinuityValidity,
  CurrentProjectFocus,
  DesignDefinitionObject,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  ProjectContinuityState,
  ProjectFocusArea,
  ProjectMemoryItem,
  ProjectMemoryView,
  ProjectMemoryViewKey,
  StageRecordKey,
  VisualBranchRecord
} from "./types";

export type LegacyProjectFocus =
  | "direction_visual_development"
  | "research"
  | "design_definition"
  | "delivery_preparation";

export type ProjectContinuityEvent =
  | {
      type: "inputImported";
      objectIds: MorphoObjectId[];
      createdAt?: string;
    }
  | {
      type: "researchApplied";
      operationId: string;
      researchObjectId: MorphoObjectId;
      sourceObjectIds: MorphoObjectId[];
      citationIds?: string[];
      createdAt?: string;
    }
  | {
      type: "keyConclusionSaved";
      objectId: MorphoObjectId;
      sourceObjectIds: MorphoObjectId[];
      decisionId?: string;
      createdAt?: string;
    }
  | {
      type: "designDefinitionApplied";
      designDefinitionObjectId: MorphoObjectId;
      revisionId: string;
      sourceObjectIds: MorphoObjectId[];
      proposalId?: string;
      operationId?: string;
      citationIds?: string[];
      createdAt?: string;
    }
  | {
      type: "conceptDirectionApplied";
      directionObjectIds: MorphoObjectId[];
      revisionIds?: string[];
      proposalId?: string;
      operationId?: string;
      citationIds?: string[];
      createdAt?: string;
    }
  | {
      type: "directionStatusChanged";
      directionObjectId: MorphoObjectId;
      status: ConceptDirectionObject["status"];
      decisionId?: string;
      createdAt?: string;
    }
  | {
      type: "visualGenerationCompleted";
      operationId: string;
      resultObjectIds: MorphoObjectId[];
      sourceObjectIds: MorphoObjectId[];
      definitionRevisionId?: string;
      branchId?: string;
      successCount: number;
      failureCount: number;
      createdAt?: string;
    }
  | {
      type: "visualBranchChanged";
      action: "created" | "archived" | "restored";
      branchId: string;
      directionId: MorphoObjectId;
      createdAt?: string;
    }
  | {
      type: "defaultReferenceChanged";
      imageObjectId: MorphoObjectId;
      previousImageObjectId?: MorphoObjectId;
      decisionId?: string;
      createdAt?: string;
    }
  | {
      type: "explorationRecorded";
      objectIds: MorphoObjectId[];
      summary: string;
      createdAt?: string;
    };

export type ContinuityRecordGroup = {
  stage: StageRecordKey;
  title: string;
  entries: ContinuityRecordEntry[];
  emptyMessage: string;
};

export type ProjectMemoryViews = Record<ProjectMemoryViewKey, ProjectMemoryView>;

export type BuildProjectContinuityContextInput = {
  taskKind: "research" | "general" | "directionPreview" | "visualDevelopment" | "designDefinition" | "conceptDirection";
  selectedObjectIds: MorphoObjectId[];
  targetDirectionIds?: MorphoObjectId[];
  includeHistorical?: boolean;
};

export type ProjectContinuityContext = {
  currentFocus: CurrentProjectFocus;
  relevantStageRecords: ContinuityRecordEntry[];
  relevantProjectMemoryViews: ProjectMemoryView[];
  reviewRequiredItems: ContinuityRecordEntry[];
  omitted: Array<{ id: string; reason: string }>;
  truncated: boolean;
  limits: typeof PROJECT_CONTINUITY_CONTEXT_LIMITS;
};

export const PROJECT_CONTINUITY_CONTEXT_LIMITS = {
  maxStageRecords: 6,
  maxMemoryViews: 4,
  maxItemsPerMemoryView: 5,
  maxReviewRequiredItems: 4,
  maxCharsPerSummary: 220
} as const;

const STAGE_TITLES: Record<StageRecordKey, string> = {
  startAndInput: "开始与输入",
  exploration: "探索",
  research: "调研",
  designDefinition: "设计定义",
  directionAndVisual: "方向与视觉发展",
  deliveryPreparation: "交付准备"
};

const STAGE_EMPTY_MESSAGES: Record<StageRecordKey, string> = {
  startAndInput: "暂无输入记录。",
  exploration: "暂无探索记录。",
  research: "暂无调研记录。",
  designDefinition: "暂无设计定义记录。",
  directionAndVisual: "暂无方向与视觉记录。",
  deliveryPreparation: "暂无交付准备记录。"
};

const MEMORY_TITLES: Record<ProjectMemoryViewKey, string> = {
  projectOverview: "项目概览",
  designDefinition: "设计定义",
  preferencesAndAvoids: "偏好与避免项",
  decisionLog: "决策记录",
  rejectedDirections: "已淘汰方向",
  openQuestions: "待确认问题",
  deliveryPlan: "交付计划"
};

const MEMORY_EMPTY_MESSAGES: Record<ProjectMemoryViewKey, string> = {
  projectOverview: "暂无项目概览。",
  designDefinition: "暂无当前设计定义。",
  preferencesAndAvoids: "暂无明确偏好或避免项。",
  decisionLog: "暂无关键决策记录。",
  rejectedDirections: "暂无已淘汰方向。",
  openQuestions: "暂无待确认问题。",
  deliveryPlan: "暂无真实交付计划。"
};

const CONTEXT_STAGE_RELEVANCE: Record<BuildProjectContinuityContextInput["taskKind"], StageRecordKey[]> = {
  research: ["research", "startAndInput", "designDefinition", "directionAndVisual", "exploration", "deliveryPreparation"],
  designDefinition: ["designDefinition", "research", "startAndInput", "directionAndVisual", "exploration", "deliveryPreparation"],
  conceptDirection: ["designDefinition", "research", "directionAndVisual", "startAndInput", "exploration", "deliveryPreparation"],
  directionPreview: ["directionAndVisual", "designDefinition", "research", "startAndInput", "exploration", "deliveryPreparation"],
  visualDevelopment: ["directionAndVisual", "designDefinition", "research", "startAndInput", "exploration", "deliveryPreparation"],
  general: ["directionAndVisual", "designDefinition", "research", "startAndInput", "exploration", "deliveryPreparation"]
};

const CONTEXT_MEMORY_RELEVANCE: Record<BuildProjectContinuityContextInput["taskKind"], ProjectMemoryViewKey[]> = {
  research: ["projectOverview", "designDefinition", "preferencesAndAvoids", "openQuestions", "decisionLog", "rejectedDirections", "deliveryPlan"],
  designDefinition: ["projectOverview", "designDefinition", "preferencesAndAvoids", "openQuestions", "decisionLog", "rejectedDirections", "deliveryPlan"],
  conceptDirection: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  directionPreview: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  visualDevelopment: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  general: ["projectOverview", "designDefinition", "decisionLog", "openQuestions", "preferencesAndAvoids", "rejectedDirections", "deliveryPlan"]
};

export function createInitialProjectContinuity(input: {
  workspace: Pick<MorphoWorkspace, "project" | "objects" | "designDefinitionRevisions" | "directionRevisions">;
  now?: string;
  legacyFocus?: LegacyProjectFocus;
}): ProjectContinuityState {
  const now = input.now ?? new Date().toISOString();
  const area = input.legacyFocus ? legacyFocusToArea(input.legacyFocus) : inferInitialFocusArea(input.workspace);

  return {
    schemaVersion: 1,
    currentFocus: {
      area,
      updatedAt: now,
      sourceKind: "migration",
      sourceObjectIds: inferFocusSourceObjectIds(input.workspace, area),
      note: `${STAGE_TITLES[area]}为迁移后的初始工作重点。`
    },
    recordEntries: [],
    updatedAt: now
  };
}

export function normalizeProjectContinuity(
  workspace: Pick<MorphoWorkspace, "project" | "objects" | "designDefinitionRevisions" | "directionRevisions">,
  value: unknown,
  legacyFocus?: LegacyProjectFocus
): ProjectContinuityState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.currentFocus) || !Array.isArray(value.recordEntries)) {
    return createInitialProjectContinuity({ workspace, legacyFocus });
  }

  const fallback = createInitialProjectContinuity({ workspace, legacyFocus });
  const currentFocus = normalizeCurrentFocus(value.currentFocus, fallback.currentFocus);
  const recordEntries = value.recordEntries
    .map(normalizeRecordEntry)
    .filter((entry): entry is ContinuityRecordEntry => Boolean(entry));

  return {
    schemaVersion: 1,
    currentFocus,
    recordEntries,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : currentFocus.updatedAt
  };
}

export function applyProjectContinuityEvent(workspace: MorphoWorkspace, event: ProjectContinuityEvent): MorphoWorkspace {
  const resolved = resolveContinuityValidity(workspace);
  const dedupeKey = getEventDedupeKey(event);
  if (resolved.projectContinuity.recordEntries.some((entry) => entry.dedupeKey === dedupeKey)) {
    return resolved;
  }

  const now = event.createdAt ?? new Date().toISOString();
  const entry = createRecordEntry(resolved, event, dedupeKey, now);
  const currentFocus = createFocusForEvent(event, entry, now);

  return {
    ...resolved,
    projectContinuity: {
      ...resolved.projectContinuity,
      currentFocus,
      recordEntries: [...resolved.projectContinuity.recordEntries, entry],
      updatedAt: now
    }
  };
}

export function resolveContinuityValidity(workspace: MorphoWorkspace): MorphoWorkspace {
  const recordEntries = workspace.projectContinuity.recordEntries.map((entry) => {
    const reasons = getInvalidationReasons(workspace, entry);
    const validity = validityFromReasons(reasons);
    return {
      ...entry,
      validity,
      invalidationReasons: reasons.length > 0 ? reasons : undefined
    };
  });

  return {
    ...workspace,
    projectContinuity: {
      ...workspace.projectContinuity,
      recordEntries
    }
  };
}

export function getContinuityRecordGroups(workspace: MorphoWorkspace): Record<StageRecordKey, ContinuityRecordGroup> {
  const resolved = resolveContinuityValidity(workspace);
  return Object.fromEntries(
    (Object.keys(STAGE_TITLES) as StageRecordKey[]).map((stage) => [
      stage,
      {
        stage,
        title: STAGE_TITLES[stage],
        entries: [...resolved.projectContinuity.recordEntries]
          .filter((entry) => entry.stage === stage)
          .sort(compareEntriesByRecent),
        emptyMessage: STAGE_EMPTY_MESSAGES[stage]
      }
    ])
  ) as Record<StageRecordKey, ContinuityRecordGroup>;
}

export function deriveProjectMemoryViews(workspace: MorphoWorkspace): ProjectMemoryViews {
  const resolved = resolveContinuityValidity(workspace);
  const currentDefinitionRevision = getCurrentDesignDefinitionRevision(resolved);
  const currentDefinitionObject = currentDefinitionRevision
    ? resolved.objects[currentDefinitionRevision.designDefinitionId]
    : undefined;
  const decisionEntries = resolved.projectContinuity.recordEntries.filter(
    (entry) => entry.category === "decision" && entry.validity !== "sourceUnavailable"
  );
  const preferenceEntries = resolved.projectContinuity.recordEntries.filter(
    (entry) => (entry.category === "preference" || entry.category === "constraint") && entry.validity === "current"
  );
  const rejectedDirections = Object.values(resolved.objects).filter(
    (object): object is ConceptDirectionObject => object.type === "conceptDirection" && object.status === "eliminated"
  );
  const openQuestions = collectOpenQuestionItems(resolved);

  return {
    projectOverview: createMemoryView("projectOverview", [
      {
        id: `overview-${resolved.project.id}`,
        title: resolved.project.title,
        summary: truncateText(`${resolved.project.subtitle || "未命名项目"}；当前重点：${resolved.projectContinuity.currentFocus.note}`),
        sourceRefs: [],
        validity: "current"
      }
    ]),
    designDefinition: createMemoryView(
      "designDefinition",
      currentDefinitionRevision && currentDefinitionObject
        ? [
            {
              id: currentDefinitionRevision.id,
              title: currentDefinitionRevision.title,
              summary: truncateText(currentDefinitionRevision.summary || currentDefinitionRevision.coreProblem),
              sourceRefs: [
                createObjectRef(resolved, currentDefinitionObject.id),
                createRevisionRef(resolved, currentDefinitionRevision.id)
              ].filter(isDefined),
              validity: currentDefinitionObject.visibility === "hidden" ? "reviewRequired" : "current"
            }
          ]
        : []
    ),
    preferencesAndAvoids: createMemoryView("preferencesAndAvoids", [
      ...stringItemsFromDefinition(currentDefinitionRevision, "design-principle", currentDefinitionRevision?.designPrinciples ?? []),
      ...stringItemsFromDefinition(currentDefinitionRevision, "constraint", currentDefinitionRevision?.constraints ?? []),
      ...stringItemsFromDefinition(currentDefinitionRevision, "avoid", currentDefinitionRevision?.avoidDirections ?? []),
      ...preferenceEntries.map((entry) => memoryItemFromEntry(entry))
    ]),
    decisionLog: createMemoryView("decisionLog", [
      ...decisionEntries.map((entry) => memoryItemFromEntry(entry)),
      ...resolved.decisionRecords.slice(-8).map((decision) => ({
        id: decision.id,
        title: decision.summary,
        summary: truncateText(decision.reason ?? decision.summary),
        sourceRefs: [
          {
            kind: "decision" as const,
            id: decision.id,
            snapshot: {
              title: decision.summary,
              status: decision.kind,
              summarySnippet: truncateText(decision.reason ?? decision.summary)
            }
          },
          ...(decision.objectSnapshot ? [createObjectRef(resolved, decision.objectSnapshot.id)] : [])
        ].filter(isDefined),
        validity: "current" as const
      }))
    ]),
    rejectedDirections: createMemoryView(
      "rejectedDirections",
      rejectedDirections.map((direction) => ({
        id: direction.id,
        title: direction.title,
        summary: truncateText(direction.summary),
        sourceRefs: [createObjectRef(resolved, direction.id)].filter(isDefined),
        validity: "current" as const
      }))
    ),
    openQuestions: createMemoryView("openQuestions", openQuestions),
    deliveryPlan: createMemoryView(
      "deliveryPlan",
      resolved.projectContinuity.recordEntries
        .filter((entry) => entry.stage === "deliveryPreparation" && entry.validity === "current")
        .map((entry) => memoryItemFromEntry(entry))
    )
  };
}

export function buildProjectContinuityContext(
  workspace: MorphoWorkspace,
  input: BuildProjectContinuityContextInput
): ProjectContinuityContext {
  const resolved = resolveContinuityValidity(workspace);
  const selected = new Set([...(input.selectedObjectIds ?? []), ...(input.targetDirectionIds ?? [])]);
  const stageRank = new Map(CONTEXT_STAGE_RELEVANCE[input.taskKind].map((stage, index) => [stage, index]));
  const rankedEntries = [...resolved.projectContinuity.recordEntries].sort((left, right) =>
    compareEntriesForContext(left, right, selected, resolved.projectContinuity.currentFocus.area, stageRank)
  );
  const included: ContinuityRecordEntry[] = [];
  const omitted: ProjectContinuityContext["omitted"] = [];

  for (const entry of rankedEntries) {
    if (!shouldIncludeEntryInContext(entry, selected, input.taskKind, resolved.projectContinuity.currentFocus.area, input.includeHistorical === true)) {
      omitted.push({ id: entry.id, reason: `not relevant for ${input.taskKind}` });
      continue;
    }
    if (included.length >= PROJECT_CONTINUITY_CONTEXT_LIMITS.maxStageRecords) {
      omitted.push({ id: entry.id, reason: `stage record limit ${PROJECT_CONTINUITY_CONTEXT_LIMITS.maxStageRecords}` });
      continue;
    }
    included.push(limitEntrySummary(entry));
  }

  const memoryViews = deriveProjectMemoryViews(resolved);
  const memoryRank = CONTEXT_MEMORY_RELEVANCE[input.taskKind];
  const relevantProjectMemoryViews = memoryRank
    .map((key) => memoryViews[key])
    .filter((view) => view.items.length > 0)
    .slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxMemoryViews)
    .map((view) => ({
      ...view,
      items: view.items.slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxItemsPerMemoryView)
    }));
  const reviewRequiredItems = rankedEntries
    .filter((entry) => entry.validity === "reviewRequired" || entry.validity === "sourceUnavailable")
    .filter((entry) => hasDirectSourceMatch(entry, selected) || entry.stage === resolved.projectContinuity.currentFocus.area)
    .slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxReviewRequiredItems)
    .map(limitEntrySummary);

  return {
    currentFocus: resolved.projectContinuity.currentFocus,
    relevantStageRecords: included,
    relevantProjectMemoryViews,
    reviewRequiredItems,
    omitted,
    truncated: omitted.some((item) => item.reason.includes("limit")),
    limits: PROJECT_CONTINUITY_CONTEXT_LIMITS
  };
}

function createRecordEntry(
  workspace: MorphoWorkspace,
  event: ProjectContinuityEvent,
  dedupeKey: string,
  now: string
): ContinuityRecordEntry {
  const base = {
    id: `continuity-${slugify(dedupeKey)}`,
    dedupeKey,
    createdAt: now,
    updatedAt: now,
    validity: "current" as const
  };

  switch (event.type) {
    case "inputImported":
      return {
        ...base,
        stage: "startAndInput",
        category: "output",
        summary: `已加入 ${event.objectIds.length} 项项目输入。`,
        sourceRefs: event.objectIds.map((objectId) => createObjectRef(workspace, objectId)).filter(isDefined)
      };
    case "researchApplied":
      return {
        ...base,
        stage: "research",
        category: "output",
        summary: `已创建研究卡「${workspace.objects[event.researchObjectId]?.title ?? event.researchObjectId}」。`,
        sourceRefs: [
          createOperationRef(workspace, event.operationId),
          createObjectRef(workspace, event.researchObjectId),
          ...event.sourceObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          ...(event.citationIds ?? []).map((citationId) => createCitationRef(workspace, citationId))
        ].filter(isDefined)
      };
    case "keyConclusionSaved":
      return {
        ...base,
        stage: "research",
        category: "decision",
        summary: `已保留关键结论「${workspace.objects[event.objectId]?.title ?? event.objectId}」。`,
        sourceRefs: [
          createObjectRef(workspace, event.objectId),
          ...event.sourceObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          event.decisionId ? createDecisionRef(workspace, event.decisionId) : undefined
        ].filter(isDefined)
      };
    case "designDefinitionApplied":
      return {
        ...base,
        stage: "designDefinition",
        category: "decision",
        summary: `已应用设计定义「${workspace.designDefinitionRevisions[event.revisionId]?.title ?? event.revisionId}」。`,
        sourceRefs: [
          createObjectRef(workspace, event.designDefinitionObjectId),
          createRevisionRef(workspace, event.revisionId),
          event.operationId ? createOperationRef(workspace, event.operationId) : undefined,
          ...event.sourceObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          ...(event.citationIds ?? []).map((citationId) => createCitationRef(workspace, citationId))
        ].filter(isDefined)
      };
    case "conceptDirectionApplied":
      return {
        ...base,
        stage: "directionAndVisual",
        category: "output",
        summary: `已应用 ${event.directionObjectIds.length} 个概念方向。`,
        sourceRefs: [
          event.operationId ? createOperationRef(workspace, event.operationId) : undefined,
          ...event.directionObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          ...(event.revisionIds ?? []).map((revisionId) => createRevisionRef(workspace, revisionId)),
          ...(event.citationIds ?? []).map((citationId) => createCitationRef(workspace, citationId))
        ].filter(isDefined)
      };
    case "directionStatusChanged":
      return {
        ...base,
        stage: "directionAndVisual",
        category: event.status === "eliminated" ? "rejection" : "decision",
        summary: `${workspace.objects[event.directionObjectId]?.title ?? event.directionObjectId} 已标记为 ${directionStatusLabel(event.status)}。`,
        sourceRefs: [
          createObjectRef(workspace, event.directionObjectId),
          event.decisionId ? createDecisionRef(workspace, event.decisionId) : undefined
        ].filter(isDefined)
      };
    case "visualGenerationCompleted":
      return {
        ...base,
        stage: "directionAndVisual",
        category: event.successCount > 0 ? "output" : "systemNote",
        summary:
          event.failureCount > 0
            ? `视觉生成完成 ${event.successCount} 项，失败 ${event.failureCount} 项。`
            : `视觉生成完成 ${event.successCount} 项。`,
        sourceRefs: [
          createOperationRef(workspace, event.operationId),
          ...event.resultObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          ...event.sourceObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
          event.definitionRevisionId ? createRevisionRef(workspace, event.definitionRevisionId) : undefined,
          event.branchId ? createBranchRef(workspace, event.branchId) : undefined
        ].filter(isDefined)
      };
    case "visualBranchChanged":
      return {
        ...base,
        stage: "directionAndVisual",
        category: "decision",
        summary: `${visualBranchActionLabel(event.action)}视觉分支「${workspace.visualBranches[event.branchId]?.label ?? event.branchId}」。`,
        sourceRefs: [createBranchRef(workspace, event.branchId), createObjectRef(workspace, event.directionId)].filter(isDefined)
      };
    case "defaultReferenceChanged":
      return {
        ...base,
        stage: "directionAndVisual",
        category: "decision",
        summary: `已将「${workspace.objects[event.imageObjectId]?.title ?? event.imageObjectId}」设为后续默认参考。`,
        sourceRefs: [
          createObjectRef(workspace, event.imageObjectId),
          event.decisionId ? createDecisionRef(workspace, event.decisionId) : undefined
        ].filter(isDefined)
      };
    case "explorationRecorded":
      return {
        ...base,
        stage: "exploration",
        category: "output",
        summary: truncateText(event.summary),
        sourceRefs: event.objectIds.map((objectId) => createObjectRef(workspace, objectId)).filter(isDefined)
      };
  }
}

function createFocusForEvent(event: ProjectContinuityEvent, entry: ContinuityRecordEntry, now: string): CurrentProjectFocus {
  const area = focusAreaForEvent(event);
  const sourceObjectIds = entry.sourceRefs
    .filter((ref) => ref.kind === "object")
    .map((ref) => ref.id);
  const operationRef = entry.sourceRefs.find((ref) => ref.kind === "operation");

  return {
    area,
    updatedAt: now,
    sourceKind: focusSourceKindForEvent(event),
    sourceObjectIds,
    sourceOperationId: operationRef?.id,
    note: entry.summary
  };
}

function getEventDedupeKey(event: ProjectContinuityEvent): string {
  switch (event.type) {
    case "inputImported":
      return `inputImported:${stableIds(event.objectIds).join("+")}`;
    case "researchApplied":
      return `researchApplied:${event.operationId}`;
    case "keyConclusionSaved":
      return `keyConclusionSaved:${event.objectId}`;
    case "designDefinitionApplied":
      return `designDefinitionApplied:${event.revisionId}`;
    case "conceptDirectionApplied":
      return `conceptDirectionApplied:${event.proposalId ?? event.operationId ?? stableIds(event.directionObjectIds).join("+")}`;
    case "directionStatusChanged":
      return `directionStatusChanged:${event.directionObjectId}:${event.status}:${event.decisionId ?? "no-decision"}`;
    case "visualGenerationCompleted":
      return `visualGenerationCompleted:${event.operationId}`;
    case "visualBranchChanged":
      return `visualBranchChanged:${event.action}:${event.branchId}`;
    case "defaultReferenceChanged":
      return `defaultReferenceChanged:${event.imageObjectId}:${event.previousImageObjectId ?? "none"}:${event.decisionId ?? "no-decision"}`;
    case "explorationRecorded":
      return `explorationRecorded:${stableIds(event.objectIds).join("+")}:${event.summary}`;
  }
}

function focusAreaForEvent(event: ProjectContinuityEvent): ProjectFocusArea {
  switch (event.type) {
    case "inputImported":
      return "startAndInput";
    case "researchApplied":
    case "keyConclusionSaved":
      return "research";
    case "designDefinitionApplied":
      return "designDefinition";
    case "explorationRecorded":
      return "exploration";
    default:
      return "directionAndVisual";
  }
}

function focusSourceKindForEvent(event: ProjectContinuityEvent): CurrentProjectFocus["sourceKind"] {
  switch (event.type) {
    case "researchApplied":
    case "visualGenerationCompleted":
      return "operation";
    case "designDefinitionApplied":
    case "conceptDirectionApplied":
      return "proposalApplied";
    default:
      return "userAction";
  }
}

function getInvalidationReasons(workspace: MorphoWorkspace, entry: ContinuityRecordEntry): string[] {
  const reasons: string[] = [];

  for (const ref of entry.sourceRefs) {
    if (ref.kind === "object") {
      const object = workspace.objects[ref.id];
      if (!object) {
        reasons.push(`sourceDeleted:${ref.id}`);
      } else if (object.visibility === "hidden") {
        reasons.push(`sourceHidden:${ref.id}`);
      } else if (object.type === "image" && ref.snapshot?.status === "defaultReference" && !object.isDefaultReference) {
        reasons.push(`defaultReferenceSuperseded:${ref.id}`);
      }
      continue;
    }

    if (ref.kind === "revision") {
      const definitionRevision = workspace.designDefinitionRevisions[ref.id];
      if (definitionRevision) {
        const owner = workspace.objects[definitionRevision.designDefinitionId];
        if (owner?.type === "designDefinition" && owner.currentRevisionId !== ref.id) {
          reasons.push(`definitionRevisionSuperseded:${ref.id}`);
        }
        continue;
      }
      const directionRevision = workspace.directionRevisions[ref.id];
      if (directionRevision) {
        const owner = workspace.objects[directionRevision.directionId];
        if (owner?.type === "conceptDirection" && owner.currentRevisionId !== ref.id) {
          reasons.push(`directionRevisionSuperseded:${ref.id}`);
        }
        continue;
      }
      reasons.push(`sourceDeleted:${ref.id}`);
      continue;
    }

    if (ref.kind === "branch") {
      const branch = workspace.visualBranches[ref.id];
      if (!branch) {
        reasons.push(`sourceDeleted:${ref.id}`);
      } else if (branch.archivedAt) {
        reasons.push(`branchArchived:${ref.id}`);
      }
    }
  }

  return [...new Set(reasons)];
}

function validityFromReasons(reasons: string[]): ContinuityValidity {
  if (reasons.some((reason) => reason.startsWith("sourceDeleted:"))) {
    return "sourceUnavailable";
  }
  if (reasons.some((reason) => reason.includes("Superseded"))) {
    return "superseded";
  }
  if (reasons.length > 0) {
    return "reviewRequired";
  }
  return "current";
}

function createMemoryView(key: ProjectMemoryViewKey, items: ProjectMemoryItem[]): ProjectMemoryView {
  return {
    key,
    title: MEMORY_TITLES[key],
    items,
    emptyMessage: MEMORY_EMPTY_MESSAGES[key]
  };
}

function collectOpenQuestionItems(workspace: MorphoWorkspace): ProjectMemoryItem[] {
  const definitionRevision = getCurrentDesignDefinitionRevision(workspace);
  const definitionItems = stringItemsFromDefinition(definitionRevision, "definition-open-question", definitionRevision?.openQuestions ?? []);
  const researchItems = Object.values(workspace.objects)
    .filter((object) => object.type === "research")
    .flatMap((object) =>
      object.openQuestions.map((question, index) => ({
        id: `${object.id}-open-question-${index}`,
        title: question,
        summary: question,
        sourceRefs: [createObjectRef(workspace, object.id)].filter(isDefined),
        validity: (object.visibility === "hidden" ? "reviewRequired" : "current") as ContinuityValidity
      }))
    );
  const directionItems = Object.values(workspace.objects)
    .filter((object): object is ConceptDirectionObject => object.type === "conceptDirection" && object.visibility === "active")
    .flatMap((direction) => {
      const revision = workspace.directionRevisions[direction.currentRevisionId];
      return (revision?.openQuestions ?? []).map((question, index) => ({
        id: `${revision.id}-open-question-${index}`,
        title: question,
        summary: question,
        sourceRefs: [createObjectRef(workspace, direction.id), createRevisionRef(workspace, revision.id)].filter(isDefined),
        validity: "current" as ContinuityValidity
      }));
    });
  return [...definitionItems, ...researchItems, ...directionItems];
}

function stringItemsFromDefinition(
  revision: ReturnType<typeof getCurrentDesignDefinitionRevision>,
  prefix: string,
  values: string[]
): ProjectMemoryItem[] {
  if (!revision) {
    return [];
  }
  return values.map((value, index) => ({
    id: `${revision.id}-${prefix}-${index}`,
    title: value,
    summary: value,
    sourceRefs: [
      {
        kind: "revision",
        id: revision.id,
        snapshot: {
          title: revision.title,
          revisionNumber: revision.revisionNumber,
          summarySnippet: truncateText(revision.summary)
        }
      }
    ],
    validity: "current"
  }));
}

function memoryItemFromEntry(entry: ContinuityRecordEntry): ProjectMemoryItem {
  return {
    id: entry.id,
    title: entry.summary,
    summary: entry.summary,
    sourceRefs: entry.sourceRefs,
    validity: entry.validity
  };
}

function getCurrentDesignDefinitionRevision(workspace: MorphoWorkspace) {
  const definition = Object.values(workspace.objects).find(
    (object): object is DesignDefinitionObject => object.type === "designDefinition" && object.isCurrentEffective
  );
  return definition ? workspace.designDefinitionRevisions[definition.currentRevisionId] : undefined;
}

function compareEntriesForContext(
  left: ContinuityRecordEntry,
  right: ContinuityRecordEntry,
  selected: Set<string>,
  currentFocus: ProjectFocusArea,
  stageRank: Map<StageRecordKey, number>
): number {
  return (
    (stageRank.get(left.stage) ?? 999) - (stageRank.get(right.stage) ?? 999) ||
    Number(hasDirectSourceMatch(right, selected)) - Number(hasDirectSourceMatch(left, selected)) ||
    Number(right.stage === currentFocus) - Number(left.stage === currentFocus) ||
    validityRank(left.validity) - validityRank(right.validity) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareEntriesByRecent(left: ContinuityRecordEntry, right: ContinuityRecordEntry): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function shouldIncludeEntryInContext(
  entry: ContinuityRecordEntry,
  selected: Set<string>,
  taskKind: BuildProjectContinuityContextInput["taskKind"],
  currentFocus: ProjectFocusArea,
  includeHistorical: boolean
): boolean {
  const hasDirectMatch = hasDirectSourceMatch(entry, selected);
  if (entry.validity === "current") {
    return hasDirectMatch || isStageRelevantToTask(entry.stage, taskKind, currentFocus);
  }
  if (entry.validity === "reviewRequired") {
    return hasDirectMatch;
  }
  if (entry.validity === "superseded") {
    return hasDirectMatch || includeHistorical;
  }
  if (entry.validity === "sourceUnavailable") {
    return false;
  }
  return hasDirectMatch;
}

function isStageRelevantToTask(
  stage: StageRecordKey,
  taskKind: BuildProjectContinuityContextInput["taskKind"],
  currentFocus: ProjectFocusArea
): boolean {
  if (taskKind === "general") {
    return stage === currentFocus;
  }

  const includedStages: Record<Exclude<BuildProjectContinuityContextInput["taskKind"], "general">, StageRecordKey[]> = {
    research: ["research", "startAndInput", "designDefinition"],
    designDefinition: ["designDefinition", "research", "startAndInput"],
    conceptDirection: ["designDefinition", "directionAndVisual", "research"],
    directionPreview: ["directionAndVisual", "designDefinition", "research"],
    visualDevelopment: ["directionAndVisual", "designDefinition"]
  };

  return includedStages[taskKind].includes(stage);
}

function hasDirectSourceMatch(entry: ContinuityRecordEntry, selected: Set<string>): boolean {
  if (selected.size === 0) {
    return false;
  }
  return entry.sourceRefs.some((ref) => selected.has(ref.id));
}

function limitEntrySummary(entry: ContinuityRecordEntry): ContinuityRecordEntry {
  return {
    ...entry,
    summary: truncateText(entry.summary, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxCharsPerSummary)
  };
}

function validityRank(validity: ContinuityValidity): number {
  switch (validity) {
    case "current":
      return 0;
    case "reviewRequired":
      return 1;
    case "superseded":
      return 2;
    case "sourceUnavailable":
      return 3;
  }
}

function createObjectRef(workspace: Pick<MorphoWorkspace, "objects">, objectId: string): ContinuitySourceRef | undefined {
  const object = workspace.objects[objectId];
  if (!object) {
    return undefined;
  }
  return {
    kind: "object",
    id: object.id,
    snapshot: snapshotObject(object)
  };
}

function createRevisionRef(
  workspace: Pick<MorphoWorkspace, "designDefinitionRevisions" | "directionRevisions">,
  revisionId: string
): ContinuitySourceRef | undefined {
  const definitionRevision = workspace.designDefinitionRevisions[revisionId];
  if (definitionRevision) {
    return {
      kind: "revision",
      id: definitionRevision.id,
      snapshot: {
        title: definitionRevision.title,
        revisionNumber: definitionRevision.revisionNumber,
        status: definitionRevision.isCurrent ? "current" : "historical",
        summarySnippet: truncateText(definitionRevision.summary)
      }
    };
  }
  const directionRevision = workspace.directionRevisions[revisionId];
  if (directionRevision) {
    return {
      kind: "revision",
      id: directionRevision.id,
      snapshot: {
        title: directionRevision.title,
        revisionNumber: directionRevision.revisionNumber,
        status: directionRevision.isCurrent ? "current" : "historical",
        summarySnippet: truncateText(directionRevision.summary)
      }
    };
  }
  return undefined;
}

function createOperationRef(workspace: Pick<MorphoWorkspace, "operations">, operationId: string): ContinuitySourceRef {
  const operation = workspace.operations[operationId];
  return {
    kind: "operation",
    id: operationId,
    snapshot: {
      title: operation ? `${operation.type} operation` : operationId,
      status: operation?.status
    }
  };
}

function createBranchRef(workspace: Pick<MorphoWorkspace, "visualBranches">, branchId: string): ContinuitySourceRef | undefined {
  const branch = workspace.visualBranches[branchId];
  if (!branch) {
    return undefined;
  }
  return {
    kind: "branch",
    id: branch.id,
    snapshot: snapshotBranch(branch)
  };
}

function createDecisionRef(workspace: Pick<MorphoWorkspace, "decisionRecords">, decisionId: string): ContinuitySourceRef | undefined {
  const decision = workspace.decisionRecords.find((record) => record.id === decisionId);
  if (!decision) {
    return undefined;
  }
  return {
    kind: "decision",
    id: decision.id,
    snapshot: {
      title: decision.summary,
      status: decision.kind,
      summarySnippet: truncateText(decision.reason ?? decision.summary)
    }
  };
}

function createCitationRef(workspace: Pick<MorphoWorkspace, "citationSnapshots">, citationId: string): ContinuitySourceRef | undefined {
  const citation = workspace.citationSnapshots[citationId];
  if (!citation) {
    return undefined;
  }

  return {
    kind: "citation",
    id: citation.id,
    snapshot: {
      title: citation.title,
      status: citation.domain,
      summarySnippet: truncateText(citation.snippet ?? citation.url ?? citation.title)
    }
  };
}

function snapshotObject(object: MorphoObject) {
  return {
    title: object.title,
    objectType: object.type,
    status: objectStatus(object),
    visibility: object.visibility,
    summarySnippet: truncateText(object.summary)
  };
}

function snapshotBranch(branch: VisualBranchRecord) {
  return {
    title: branch.label,
    status: branch.archivedAt ? "archived" : "active",
    summarySnippet: `direction=${branch.directionId}`
  };
}

function objectStatus(object: MorphoObject): string | undefined {
  switch (object.type) {
    case "conceptDirection":
      return object.status;
    case "keyConclusion":
      return object.state;
    case "designDefinition":
      return object.isCurrentEffective ? "currentEffective" : "historical";
    case "image":
      return object.isDefaultReference ? "defaultReference" : object.role;
    case "file":
      return object.parseStatus;
    default:
      return undefined;
  }
}

function inferInitialFocusArea(
  workspace: Pick<MorphoWorkspace, "objects" | "designDefinitionRevisions" | "directionRevisions">
): ProjectFocusArea {
  if (Object.values(workspace.objects).some((object) => object.type === "image" && object.createdBy === "ai")) {
    return "directionAndVisual";
  }
  if (Object.values(workspace.objects).some((object) => object.type === "designDefinition")) {
    return "designDefinition";
  }
  if (Object.values(workspace.objects).some((object) => object.type === "research" || object.type === "keyConclusion")) {
    return "research";
  }
  if (Object.keys(workspace.objects).length > 0) {
    return "startAndInput";
  }
  return "startAndInput";
}

function inferFocusSourceObjectIds(
  workspace: Pick<MorphoWorkspace, "objects">,
  area: ProjectFocusArea
): MorphoObjectId[] {
  if (area === "directionAndVisual") {
    return Object.values(workspace.objects)
      .filter((object) => object.type === "conceptDirection" || (object.type === "image" && object.isDefaultReference))
      .slice(0, 4)
      .map((object) => object.id);
  }
  if (area === "designDefinition") {
    return Object.values(workspace.objects)
      .filter((object) => object.type === "designDefinition")
      .slice(0, 2)
      .map((object) => object.id);
  }
  if (area === "research") {
    return Object.values(workspace.objects)
      .filter((object) => object.type === "research" || object.type === "keyConclusion")
      .slice(0, 4)
      .map((object) => object.id);
  }
  return [];
}

function legacyFocusToArea(focus: LegacyProjectFocus): ProjectFocusArea {
  switch (focus) {
    case "direction_visual_development":
      return "directionAndVisual";
    case "design_definition":
      return "designDefinition";
    case "delivery_preparation":
      return "deliveryPreparation";
    case "research":
      return "research";
  }
}

function normalizeCurrentFocus(value: Record<string, unknown>, fallback: CurrentProjectFocus): CurrentProjectFocus {
  return {
    area: isProjectFocusArea(value.area) ? value.area : fallback.area,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : fallback.updatedAt,
    sourceKind:
      value.sourceKind === "migration" ||
      value.sourceKind === "userAction" ||
      value.sourceKind === "operation" ||
      value.sourceKind === "proposalApplied"
        ? value.sourceKind
        : fallback.sourceKind,
    sourceObjectIds: Array.isArray(value.sourceObjectIds)
      ? value.sourceObjectIds.filter((item): item is string => typeof item === "string")
      : fallback.sourceObjectIds,
    sourceOperationId: typeof value.sourceOperationId === "string" ? value.sourceOperationId : undefined,
    note: typeof value.note === "string" ? value.note : fallback.note
  };
}

function normalizeRecordEntry(value: unknown): ContinuityRecordEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.dedupeKey !== "string" || !isStageRecordKey(value.stage)) {
    return undefined;
  }
  return {
    id: value.id,
    dedupeKey: value.dedupeKey,
    stage: value.stage,
    category: isRecordCategory(value.category) ? value.category : "systemNote",
    summary: typeof value.summary === "string" ? value.summary : "",
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.map(normalizeSourceRef).filter(isDefined) : [],
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    validity: isContinuityValidity(value.validity) ? value.validity : "current",
    invalidationReasons: Array.isArray(value.invalidationReasons)
      ? value.invalidationReasons.filter((item): item is string => typeof item === "string")
      : undefined
  };
}

function normalizeSourceRef(value: unknown): ContinuitySourceRef | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  if (
    value.kind !== "object" &&
    value.kind !== "revision" &&
    value.kind !== "operation" &&
    value.kind !== "branch" &&
    value.kind !== "decision" &&
    value.kind !== "citation" &&
    value.kind !== "deliveryReference"
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    id: value.id,
    snapshot: isRecord(value.snapshot)
      ? {
          title: typeof value.snapshot.title === "string" ? value.snapshot.title : value.id,
          objectType: typeof value.snapshot.objectType === "string" ? value.snapshot.objectType as MorphoObject["type"] : undefined,
          revisionNumber: typeof value.snapshot.revisionNumber === "number" ? value.snapshot.revisionNumber : undefined,
          status: typeof value.snapshot.status === "string" ? value.snapshot.status : undefined,
          visibility:
            value.snapshot.visibility === "active" || value.snapshot.visibility === "hidden" || value.snapshot.visibility === "deleted"
              ? value.snapshot.visibility
              : undefined,
          summarySnippet: typeof value.snapshot.summarySnippet === "string" ? value.snapshot.summarySnippet : undefined
        }
      : undefined
  };
}

function isProjectFocusArea(value: unknown): value is ProjectFocusArea {
  return (
    value === "startAndInput" ||
    value === "exploration" ||
    value === "research" ||
    value === "designDefinition" ||
    value === "directionAndVisual" ||
    value === "deliveryPreparation"
  );
}

function isStageRecordKey(value: unknown): value is StageRecordKey {
  return isProjectFocusArea(value);
}

function isRecordCategory(value: unknown): value is ContinuityRecordCategory {
  return (
    value === "output" ||
    value === "decision" ||
    value === "rejection" ||
    value === "preference" ||
    value === "constraint" ||
    value === "openQuestion" ||
    value === "nextFocus" ||
    value === "systemNote"
  );
}

function isContinuityValidity(value: unknown): value is ContinuityValidity {
  return value === "current" || value === "reviewRequired" || value === "superseded" || value === "sourceUnavailable";
}

function directionStatusLabel(status: ConceptDirectionObject["status"]): string {
  switch (status) {
    case "primary":
      return "主方向";
    case "alternative":
      return "备选";
    case "eliminated":
      return "已淘汰";
    case "needsReview":
      return "待复核";
    case "pendingPreview":
      return "待预览";
  }
}

function visualBranchActionLabel(action: "created" | "archived" | "restored"): string {
  switch (action) {
    case "created":
      return "已创建";
    case "archived":
      return "已归档";
    case "restored":
      return "已恢复";
  }
}

function stableIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function truncateText(value: string, maxLength = 220): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
