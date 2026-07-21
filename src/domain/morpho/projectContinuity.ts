import type {
  AiMessage,
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
  StageRecordRevision,
  StageRecordKey,
  VisualBranchRecord
} from "./types";
import {
  getCurrentProjectMemoryRevision,
  getCurrentStageRecordRevision,
  reconcileProjectMemory
} from "./projectMemory";
import {
  buildSemanticPatchSummary,
  validateConversationSemanticPatch,
  type ParsedConversationSemanticPatchItem,
  type SemanticPatchAuthorization
} from "./conversationSemanticPatch";

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
    }
  | {
      type: "documentFragmentCreated";
      fragmentObjectId: MorphoObjectId;
      fileObjectId: MorphoObjectId;
      startOffset: number;
      endOffset: number;
      blockIds: MorphoObjectId[];
      createdAt?: string;
    }
  | {
      type: "deliveryPreparationChanged";
      action:
        | "created"
        | "sectionChanged"
        | "referenceAdded"
        | "referenceRemoved"
        | "referenceRefreshed"
        | "draftApplied"
        | "gapChanged";
      deliveryObjectId: MorphoObjectId;
      referenceIds?: string[];
      sectionId?: string;
      gapId?: string;
      decisionId?: string;
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
  taskKind: "research" | "general" | "directionPreview" | "visualDevelopment" | "designDefinition" | "conceptDirection" | "comparison";
  selectedObjectIds: MorphoObjectId[];
  directObjectIds?: MorphoObjectId[];
  directRevisionIds?: string[];
  directBranchIds?: string[];
  directDecisionIds?: string[];
  targetDirectionIds?: MorphoObjectId[];
  includeHistorical?: boolean;
};

export type SemanticEntryTaskScope = {
  taskKind: BuildProjectContinuityContextInput["taskKind"];
  directObjectIds: readonly string[];
  directRevisionIds: readonly string[];
  directBranchIds: readonly string[];
  directDecisionIds: readonly string[];
  targetDirectionIds: readonly string[];
};

export type ProjectContinuityContext = {
  currentFocus: CurrentProjectFocus;
  relevantStageRecords: ContinuityRecordEntry[];
  currentStageRecords: StageRecordRevision[];
  relevantProjectMemoryViews: ProjectMemoryView[];
  reviewRequiredItems: ContinuityRecordEntry[];
  omitted: Array<{ id: string; reason: string }>;
  truncated: boolean;
  limits: typeof PROJECT_CONTINUITY_CONTEXT_LIMITS;
};

export type ApplyConversationSemanticPatchResult = {
  workspace: MorphoWorkspace;
  entries: ContinuityRecordEntry[];
  rejected: Array<{ evidenceQuote?: string; reason: string }>;
};

export type ContinuityEntryEligibility = {
  canEnterMemory: boolean;
  canEnterDefaultContext: boolean;
  canEnterReviewList: boolean;
  uiLabel: string;
  reason: string;
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
  general: ["directionAndVisual", "designDefinition", "research", "startAndInput", "exploration", "deliveryPreparation"],
  comparison: ["directionAndVisual", "designDefinition", "research", "startAndInput", "exploration", "deliveryPreparation"]
};

const CONTEXT_MEMORY_RELEVANCE: Record<BuildProjectContinuityContextInput["taskKind"], ProjectMemoryViewKey[]> = {
  research: ["projectOverview", "designDefinition", "preferencesAndAvoids", "openQuestions", "decisionLog", "rejectedDirections", "deliveryPlan"],
  designDefinition: ["projectOverview", "designDefinition", "preferencesAndAvoids", "openQuestions", "decisionLog", "rejectedDirections", "deliveryPlan"],
  conceptDirection: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  directionPreview: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  visualDevelopment: ["designDefinition", "preferencesAndAvoids", "decisionLog", "openQuestions", "projectOverview", "rejectedDirections", "deliveryPlan"],
  general: ["projectOverview", "designDefinition", "decisionLog", "openQuestions", "preferencesAndAvoids", "rejectedDirections", "deliveryPlan"],
  comparison: ["projectOverview", "designDefinition", "decisionLog", "openQuestions", "preferencesAndAvoids", "rejectedDirections", "deliveryPlan"]
};

export function createInitialProjectContinuity(input: {
  workspace: Pick<MorphoWorkspace, "project" | "objects" | "designDefinitionRevisions" | "directionRevisions">;
  now?: string;
  legacyFocus?: LegacyProjectFocus;
}): ProjectContinuityState {
  const now = input.now ?? new Date().toISOString();
  const area = input.legacyFocus ? legacyFocusToArea(input.legacyFocus) : inferInitialFocusArea(input.workspace);

  return {
    schemaVersion: 2,
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
  return normalizeProjectContinuityWithIdMigration(workspace, value, legacyFocus).state;
}

export function normalizeProjectContinuityWithMessageReferences(
  workspace: Pick<MorphoWorkspace, "project" | "objects" | "designDefinitionRevisions" | "directionRevisions">,
  value: unknown,
  messages: AiMessage[],
  legacyFocus?: LegacyProjectFocus
): { state: ProjectContinuityState; messages: AiMessage[] } {
  const normalized = normalizeProjectContinuityWithIdMigration(workspace, value, legacyFocus);
  if (normalized.entryIdsByLegacyId.size === 0) {
    return { state: normalized.state, messages };
  }

  return {
    state: normalized.state,
    messages: messages.map((message) => {
      if (!message.continuityEntryIds || message.continuityEntryIds.length === 0) {
        return message;
      }

      return {
        ...message,
        continuityEntryIds: [
          ...new Set(
            message.continuityEntryIds.flatMap(
              (entryId) => normalized.entryIdsByLegacyId.get(entryId) ?? [entryId]
            )
          )
        ]
      };
    })
  };
}

function normalizeProjectContinuityWithIdMigration(
  workspace: Pick<MorphoWorkspace, "project" | "objects" | "designDefinitionRevisions" | "directionRevisions">,
  value: unknown,
  legacyFocus?: LegacyProjectFocus
): { state: ProjectContinuityState; entryIdsByLegacyId: Map<string, string[]> } {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !isRecord(value.currentFocus) ||
    !Array.isArray(value.recordEntries)
  ) {
    return {
      state: createInitialProjectContinuity({ workspace, legacyFocus }),
      entryIdsByLegacyId: new Map()
    };
  }

  const fallback = createInitialProjectContinuity({ workspace, legacyFocus });
  const currentFocus = normalizeCurrentFocus(value.currentFocus, fallback.currentFocus);
  const entryIdsByLegacyId = new Map<string, string[]>();
  const recordEntries = value.recordEntries
    .map(normalizeRecordEntry)
    .filter((entry): entry is ContinuityRecordEntry => Boolean(entry))
    .map((entry) => {
      const id = buildContinuityRecordId(entry.dedupeKey);
      entryIdsByLegacyId.set(entry.id, [...(entryIdsByLegacyId.get(entry.id) ?? []), id]);
      return { ...entry, id };
    });

  return {
    state: {
      schemaVersion: 2,
      currentFocus,
      recordEntries,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : currentFocus.updatedAt
    },
    entryIdsByLegacyId
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
  const currentFocus = shouldPreserveCurrentFocus(event) ? resolved.projectContinuity.currentFocus : createFocusForEvent(event, entry, now);

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

function shouldPreserveCurrentFocus(event: ProjectContinuityEvent): boolean {
  return event.type === "documentFragmentCreated";
}

export function applyConversationSemanticPatch(
  workspace: MorphoWorkspace,
  authorization: SemanticPatchAuthorization,
  items: ParsedConversationSemanticPatchItem[]
): ApplyConversationSemanticPatchResult {
  const resolved = resolveContinuityValidity(workspace);
  let nextWorkspace = resolved;
  const entries: ContinuityRecordEntry[] = [];
  const rejected: ApplyConversationSemanticPatchResult["rejected"] = [];

  const persistedUserMessage = resolved.ai.messages.find((message) => message.id === authorization.userMessageId);
  if (
    !persistedUserMessage ||
    persistedUserMessage.role !== "user" ||
    normalizeForDedupe(persistedUserMessage.body) !== normalizeForDedupe(authorization.draft)
  ) {
    return {
      workspace: nextWorkspace,
      entries,
      rejected: items.map((item) => ({
        evidenceQuote: item.evidenceQuote,
        reason: "Semantic patch requires a persisted user message whose body matches the current user message draft."
      }))
    };
  }

  for (const item of items) {
    const validation = validateConversationSemanticPatch(item, authorization);
    if (validation.status === "failed") {
      rejected.push({ evidenceQuote: item.evidenceQuote, reason: validation.reason });
      continue;
    }

    const dedupeKey = getConversationSemanticPatchDedupeKey(validation.item, validation.summary, authorization.userMessageId);
    if (
      nextWorkspace.projectContinuity.recordEntries.some((entry) => entry.dedupeKey === dedupeKey) ||
      hasEquivalentCurrentSemanticEntry(nextWorkspace.projectContinuity.recordEntries, validation.item, validation.summary)
    ) {
      continue;
    }

    const entry = createConversationSemanticPatchEntry(nextWorkspace, validation.item, validation.summary, dedupeKey, authorization);
    entries.push(entry);
    nextWorkspace = {
      ...nextWorkspace,
      projectContinuity: {
        ...nextWorkspace.projectContinuity,
        recordEntries: [...nextWorkspace.projectContinuity.recordEntries, entry],
        updatedAt: authorization.userMessageCreatedAt
      }
    };
  }

  return { workspace: nextWorkspace, entries, rejected };
}

export function resolveContinuityValidity(workspace: MorphoWorkspace): MorphoWorkspace {
  const recordEntries = workspace.projectContinuity.recordEntries.map((entry) => {
    const reasons = getInvalidationReasons(workspace, entry);
    const sourceRefs = entry.sourceRefs.map((ref) => resolveSourceRefAvailability(workspace, ref));
    const resolvedReasons = [
      ...reasons,
      ...(sourceRefs.some((ref) => ref.sourceAvailability === "missing") ? ["sourceDeleted:sourceRef"] : [])
    ];
    const validity = validityFromReasons(resolvedReasons);
    return {
      ...entry,
      summary: normalizeDeterministicEntrySummary(workspace, entry),
      validity,
      sourceRefs,
      invalidationReasons: resolvedReasons.length > 0 ? [...new Set(resolvedReasons)] : undefined
    };
  });
  const currentFocus = normalizeCurrentFocusSummary(workspace.projectContinuity.currentFocus, recordEntries);

  return {
    ...workspace,
    projectContinuity: {
      ...workspace.projectContinuity,
      currentFocus,
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
  const memoryWorkspace = reconcileProjectMemory(workspace);
  const mapping = {
    projectOverview: "projectOverview",
    designDefinition: "designBrief",
    preferencesAndAvoids: "userPreferences",
    decisionLog: "decisionLog",
    rejectedDirections: "rejectedDirections",
    openQuestions: "openQuestions",
    deliveryPlan: "outputPlan"
  } as const;

  return Object.fromEntries(
    (Object.keys(mapping) as ProjectMemoryViewKey[]).map((viewKey) => {
      const revision = getCurrentProjectMemoryRevision(memoryWorkspace.projectMemory, mapping[viewKey]);
      const items = revision
        ? revision.sections.flatMap((section) =>
            section.items.map((summary, itemIndex) => ({
              id: `${revision.id}:${section.key}:${itemIndex}`,
              title: viewKey === "rejectedDirections" ? summary.split("；")[0] ?? section.title : section.title,
              summary: truncateText(summary),
              sourceRefs: revision.sourceRefs,
              validity: revision.reviewRequired ? ("reviewRequired" as const) : ("current" as const)
            }))
          )
        : [];
      return [viewKey, createMemoryView(viewKey, items)];
    })
  ) as ProjectMemoryViews;
}

export function buildProjectContinuityContext(
  workspace: MorphoWorkspace,
  input: BuildProjectContinuityContextInput
): ProjectContinuityContext {
  const resolved = resolveContinuityValidity(workspace);
  const taskScope = normalizeSemanticEntryTaskScope(input);
  const selected = new Set([
    ...taskScope.directObjectIds,
    ...taskScope.directRevisionIds,
    ...taskScope.directBranchIds,
    ...taskScope.directDecisionIds,
    ...taskScope.targetDirectionIds
  ]);
  const stageRank = new Map(CONTEXT_STAGE_RELEVANCE[input.taskKind].map((stage, index) => [stage, index]));
  const rankedEntries = [...resolved.projectContinuity.recordEntries].sort((left, right) =>
    compareEntriesForContext(left, right, selected, resolved.projectContinuity.currentFocus.area, stageRank)
  );
  const included: ContinuityRecordEntry[] = [];
  const omitted: ProjectContinuityContext["omitted"] = [];

  for (const entry of rankedEntries) {
    const relevance = shouldIncludeEntryInContext(entry, selected, taskScope, resolved.projectContinuity.currentFocus.area, input.includeHistorical === true);
    if (!relevance.include) {
      omitted.push({ id: entry.id, reason: relevance.reason });
      continue;
    }
    if (included.length >= PROJECT_CONTINUITY_CONTEXT_LIMITS.maxStageRecords) {
      omitted.push({ id: entry.id, reason: `stage record limit ${PROJECT_CONTINUITY_CONTEXT_LIMITS.maxStageRecords}` });
      continue;
    }
    included.push(limitEntrySummary(entry));
  }

  const memoryWorkspace = reconcileProjectMemory(resolved);
  const memoryViews = deriveProjectMemoryViews(memoryWorkspace);
  const memoryRank = CONTEXT_MEMORY_RELEVANCE[input.taskKind];
  const relevantProjectMemoryViews = memoryRank
    .map((key) => ({
      ...memoryViews[key],
      items: filterProjectMemoryItemsForTaskContext(memoryViews[key].items, resolved.projectContinuity.recordEntries, taskScope)
    }))
    .filter((view) => view.items.length > 0)
    .slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxMemoryViews)
    .map((view) => ({
      ...view,
      items: view.items.slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxItemsPerMemoryView)
    }));
  const reviewRequiredItems = rankedEntries
    .filter((entry) => entry.validity === "reviewRequired")
    .filter((entry) => getContinuityEntryEligibility(entry).canEnterReviewList)
    .filter((entry) => isSemanticEntryScopeRelevantToTaskContext(entry, taskScope))
    .slice(0, PROJECT_CONTINUITY_CONTEXT_LIMITS.maxReviewRequiredItems)
    .map(limitEntrySummary);
  const currentStageRecords = CONTEXT_STAGE_RELEVANCE[input.taskKind]
    .map((stage) => getCurrentStageRecordRevision(memoryWorkspace.projectMemory, stage))
    .filter((revision): revision is StageRecordRevision => Boolean(revision));

  return {
    currentFocus: resolved.projectContinuity.currentFocus,
    relevantStageRecords: included,
    currentStageRecords,
    relevantProjectMemoryViews,
    reviewRequiredItems,
    omitted,
    truncated: omitted.some((item) => item.reason.includes("limit")),
    limits: PROJECT_CONTINUITY_CONTEXT_LIMITS
  };
}

export function isSemanticEntryScopeRelevantToTaskContext(
  entry: ContinuityRecordEntry,
  taskScope: SemanticEntryTaskScope
): boolean {
  if (entry.origin !== "conversationSemanticPatch") {
    return true;
  }

  const scope = entry.scope ?? "project";
  if (scope === "project") {
    return true;
  }

  const hasDirectMatch = hasTypedDirectSourceMatch(entry, taskScope);
  if (scope === "designDefinition") {
    if (hasDirectMatch) {
      return true;
    }
    return taskScope.taskKind === "designDefinition" || taskScope.taskKind === "conceptDirection" || taskScope.taskKind === "directionPreview" || taskScope.taskKind === "visualDevelopment";
  }

  if (scope === "direction") {
    if (!isDirectionScopedTask(taskScope.taskKind)) {
      return false;
    }
    return hasDirectMatch;
  }

  if (scope === "visual") {
    if (!isVisualScopedTask(taskScope.taskKind)) {
      return false;
    }
    return hasDirectMatch;
  }

  return false;
}

export function getContinuityEntryEligibility(entry: ContinuityRecordEntry): ContinuityEntryEligibility {
  if (entry.manualState === "withdrawn") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "已撤回",
      reason: "manualState=withdrawn"
    };
  }
  if (entry.manualState === "notApplicable") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "当前不适用",
      reason: "manualState=notApplicable"
    };
  }

  const hasHiddenSource = entry.sourceRefs.some((ref) => ref.sourceAvailability === "hidden");
  const hasMissingSource = entry.sourceRefs.some((ref) => ref.sourceAvailability === "missing");
  if (hasMissingSource || entry.validity === "sourceUnavailable") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: true,
      uiLabel: "来源不可用",
      reason: "sourceUnavailable"
    };
  }
  if (hasHiddenSource) {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: entry.validity === "current" ? "当前有效 · 来源已隐藏" : `${validityUiLabel(entry.validity)} · 来源已隐藏`,
      reason: "sourceAvailability=hidden"
    };
  }
  if (entry.validity === "reviewRequired") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: true,
      uiLabel: "待复核",
      reason: "validity=reviewRequired"
    };
  }
  if (entry.validity === "superseded") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "已被更新替代",
      reason: "validity=superseded"
    };
  }

  return {
    canEnterMemory: true,
    canEnterDefaultContext: true,
    canEnterReviewList: false,
    uiLabel: "当前有效",
    reason: "eligible"
  };
}

export function setConversationSemanticEntryManualState(
  workspace: MorphoWorkspace,
  entryId: string,
  manualState: ContinuityRecordEntry["manualState"],
  updatedAt = new Date().toISOString()
): MorphoWorkspace {
  const recordEntries = workspace.projectContinuity.recordEntries.map((entry) => {
    if (entry.id !== entryId || entry.origin !== "conversationSemanticPatch") {
      return entry;
    }

    return {
      ...entry,
      manualState,
      updatedAt
    };
  });

  return {
    ...workspace,
    projectContinuity: {
      ...workspace.projectContinuity,
      recordEntries,
      updatedAt
    }
  };
}

function createRecordEntry(
  workspace: MorphoWorkspace,
  event: ProjectContinuityEvent,
  dedupeKey: string,
  now: string
): ContinuityRecordEntry {
  const base = {
    id: buildContinuityRecordId(dedupeKey),
    dedupeKey,
    origin: "deterministicEvent" as const,
    manualState: "active" as const,
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
        summary: defaultReferenceEventSummary(workspace, event),
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
    case "documentFragmentCreated":
      return {
        ...base,
        stage: "research",
        category: "output",
        summary: truncateText(`已创建文档片段 ${workspace.objects[event.fragmentObjectId]?.title ?? event.fragmentObjectId}`),
        sourceRefs: [createObjectRef(workspace, event.fragmentObjectId), createObjectRef(workspace, event.fileObjectId)].filter(
          isDefined
        )
      };
    case "deliveryPreparationChanged":
      return {
        ...base,
        stage: "deliveryPreparation",
        category: event.action === "gapChanged" ? "openQuestion" : event.action === "created" ? "output" : "decision",
        summary: deliveryEventSummary(workspace, event),
        sourceRefs: [
          createObjectRef(workspace, event.deliveryObjectId),
          ...(event.referenceIds ?? []).map((referenceId) => createDeliveryReferenceRef(workspace, referenceId)),
          event.decisionId ? createDecisionRef(workspace, event.decisionId) : undefined
        ].filter(isDefined)
      };
  }
}

function createConversationSemanticPatchEntry(
  workspace: MorphoWorkspace,
  item: ParsedConversationSemanticPatchItem,
  summary: string,
  dedupeKey: string,
  authorization: SemanticPatchAuthorization
): ContinuityRecordEntry {
  const sourceRefs = [
    createMessageRef(authorization, item.evidenceQuote),
    ...item.relatedObjectIds.map((objectId) => createObjectRef(workspace, objectId)),
    ...item.relatedRevisionIds.map((revisionId) => createRevisionRef(workspace, revisionId)),
    ...item.relatedDecisionIds.map((decisionId) => createDecisionRef(workspace, decisionId))
  ].filter(isDefined);

  return {
    id: buildContinuityRecordId(dedupeKey),
    dedupeKey,
    origin: "conversationSemanticPatch",
    manualState: "active",
    semanticKind: item.kind,
    sourceMessageId: authorization.userMessageId,
    evidenceQuote: item.evidenceQuote,
    scope: item.scope,
    stage: authorization.currentFocusArea,
    category: categoryForSemanticPatchKind(item.kind),
    summary,
    sourceRefs,
    createdAt: authorization.userMessageCreatedAt,
    updatedAt: authorization.userMessageCreatedAt,
    validity: "current"
  };
}

function getConversationSemanticPatchDedupeKey(item: ParsedConversationSemanticPatchItem, summary: string, userMessageId: string): string {
  return [
    "conversationSemanticPatch",
    userMessageId,
    item.kind,
    item.scope,
    normalizeForDedupe(summary),
    stableIds([...item.relatedObjectIds, ...item.relatedRevisionIds, ...item.relatedDecisionIds]).join("+") || "no-source"
  ].join(":");
}

function hasEquivalentCurrentSemanticEntry(
  entries: readonly ContinuityRecordEntry[],
  item: ParsedConversationSemanticPatchItem,
  summary: string
): boolean {
  const sourceIds = stableIds([...item.relatedObjectIds, ...item.relatedRevisionIds, ...item.relatedDecisionIds]);
  return entries.some((entry) => {
    if (
      entry.origin !== "conversationSemanticPatch" ||
      entry.manualState !== "active" ||
      entry.validity !== "current" ||
      entry.semanticKind !== item.kind ||
      (entry.scope ?? "project") !== item.scope ||
      normalizeForDedupe(entry.summary) !== normalizeForDedupe(summary)
    ) {
      return false;
    }
    const entrySourceIds = stableIds(
      entry.sourceRefs
        .filter((ref) => ref.kind === "object" || ref.kind === "revision" || ref.kind === "decision")
        .map((ref) => ref.id)
    );
    return entrySourceIds.length === sourceIds.length && entrySourceIds.every((id, index) => id === sourceIds[index]);
  });
}

function createMessageRef(authorization: SemanticPatchAuthorization, evidenceQuote: string): ContinuitySourceRef {
  return {
    kind: "message",
    id: authorization.userMessageId,
    snapshot: {
      title: "用户表达",
      status: authorization.taskMode,
      summarySnippet: truncateText(evidenceQuote, 180),
      createdAt: authorization.userMessageCreatedAt
    },
    sourceAvailability: "active"
  };
}

function categoryForSemanticPatchKind(kind: ParsedConversationSemanticPatchItem["kind"]): ContinuityRecordCategory {
  switch (kind) {
    case "preference":
      return "preference";
    case "constraint":
    case "avoidance":
      return "constraint";
    case "openQuestion":
      return "openQuestion";
    case "decisionReason":
      return "decision";
    case "rejectionReason":
      return "rejection";
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

function defaultReferenceEventSummary(
  workspace: MorphoWorkspace,
  event: Extract<ProjectContinuityEvent, { type: "defaultReferenceChanged" }>
): string {
  const title = workspace.objects[event.imageObjectId]?.title ?? event.imageObjectId;
  const decision = event.decisionId
    ? workspace.decisionRecords.find((record) => record.id === event.decisionId)
    : undefined;
  const wasCleared =
    event.previousImageObjectId === event.imageObjectId ||
    (decision?.kind === "setDefaultReference" && decision.summary.startsWith("清除后续默认参考"));
  return wasCleared ? `已清除「${title}」的后续默认参考。` : `已将「${title}」设为后续默认参考。`;
}

function normalizeDeterministicEntrySummary(workspace: MorphoWorkspace, entry: ContinuityRecordEntry): string {
  if (entry.origin !== "deterministicEvent" || !entry.dedupeKey.startsWith("defaultReferenceChanged:")) {
    return entry.summary;
  }
  const decisionRef = entry.sourceRefs.find((ref) => ref.kind === "decision");
  const decision = decisionRef
    ? workspace.decisionRecords.find((record) => record.id === decisionRef.id)
    : undefined;
  if (decision?.kind !== "setDefaultReference") {
    return entry.summary;
  }
  const objectRef = entry.sourceRefs.find((ref) => ref.kind === "object");
  const title = objectRef?.snapshot?.title ?? (objectRef ? workspace.objects[objectRef.id]?.title : undefined);
  if (!title) {
    return entry.summary;
  }
  return decision.summary.startsWith("清除后续默认参考")
    ? `已清除「${title}」的后续默认参考。`
    : `已将「${title}」设为后续默认参考。`;
}

function normalizeCurrentFocusSummary(
  currentFocus: CurrentProjectFocus,
  entries: ContinuityRecordEntry[]
): CurrentProjectFocus {
  const sourceObjectIds = [...currentFocus.sourceObjectIds].sort();
  const matchingEntry = [...entries].reverse().find((entry) => {
    if (entry.stage !== currentFocus.area || entry.updatedAt !== currentFocus.updatedAt) {
      return false;
    }
    const entryObjectIds = entry.sourceRefs
      .filter((ref) => ref.kind === "object")
      .map((ref) => ref.id)
      .sort();
    return entryObjectIds.length === sourceObjectIds.length && entryObjectIds.every((id, index) => id === sourceObjectIds[index]);
  });
  return matchingEntry && matchingEntry.summary !== currentFocus.note
    ? { ...currentFocus, note: matchingEntry.summary }
    : currentFocus;
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
    case "documentFragmentCreated":
      return `documentFragmentCreated:${event.fragmentObjectId}:${event.fileObjectId}:${event.startOffset}-${event.endOffset}:${stableIds(event.blockIds).join("+")}`;
    case "deliveryPreparationChanged":
      return [
        "deliveryPreparationChanged",
        event.action,
        event.deliveryObjectId,
        event.sectionId ?? "no-section",
        event.gapId ?? "no-gap",
        stableIds(event.referenceIds ?? []).join("+") || "no-reference",
        event.decisionId ?? "no-decision"
      ].join(":");
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
    case "documentFragmentCreated":
      return "research";
    case "deliveryPreparationChanged":
      return "deliveryPreparation";
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

function deliveryEventSummary(workspace: MorphoWorkspace, event: Extract<ProjectContinuityEvent, { type: "deliveryPreparationChanged" }>): string {
  const title = workspace.objects[event.deliveryObjectId]?.title ?? event.deliveryObjectId;
  switch (event.action) {
    case "created":
      return `已创建交付准备包「${title}」。`;
    case "sectionChanged":
      return `已更新交付准备包「${title}」的章节结构。`;
    case "referenceAdded":
      return `已向「${title}」加入 ${event.referenceIds?.length ?? 0} 项交付引用。`;
    case "referenceRemoved":
      return `已从「${title}」移除交付引用。`;
    case "referenceRefreshed":
      return `已将「${title}」中的交付引用更新为当前版本。`;
    case "draftApplied":
      return `已应用「${title}」的交付说明草案。`;
    case "gapChanged":
      return `已更新「${title}」的待补内容。`;
  }
}

function createDeliveryReferenceRef(workspace: Pick<MorphoWorkspace, "deliveryReferences">, referenceId: string): ContinuitySourceRef | undefined {
  const reference = workspace.deliveryReferences[referenceId];
  if (!reference) {
    return undefined;
  }
  return {
    kind: "deliveryReference",
    id: reference.id,
    snapshot: {
      title: reference.snapshot.title,
      objectType: reference.snapshot.sourceType,
      summarySnippet: truncateText(reference.snapshot.summary ?? reference.snapshot.body ?? reference.snapshot.title)
    },
    sourceAvailability: "active"
  };
}

function getInvalidationReasons(workspace: MorphoWorkspace, entry: ContinuityRecordEntry): string[] {
  const reasons: string[] = [];

  for (const ref of entry.sourceRefs) {
    if (ref.kind === "object") {
      const object = workspace.objects[ref.id];
      if (!object) {
        reasons.push(`sourceDeleted:${ref.id}`);
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
  const definitionObject = definitionRevision ? workspace.objects[definitionRevision.designDefinitionId] : undefined;
  const definitionItems = stringItemsFromDefinition(
    definitionRevision,
    definitionObject,
    "definition-open-question",
    definitionRevision?.openQuestions ?? []
  );
  const researchItems = Object.values(workspace.objects)
    .filter((object) => object.type === "research")
    .flatMap((object) =>
      object.openQuestions.map((question, index) => ({
        id: `${object.id}-open-question-${index}`,
        title: question,
        summary: question,
        sourceRefs: [createObjectRef(workspace, object.id)].filter(isDefined),
        validity: "current" as ContinuityValidity
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
  const semanticItems = workspace.projectContinuity.recordEntries
    .filter((entry) => entry.category === "openQuestion" && getContinuityEntryEligibility(entry).canEnterMemory)
    .map((entry) => memoryItemFromEntry(entry));
  return [...definitionItems, ...researchItems, ...directionItems, ...semanticItems];
}

function stringItemsFromDefinition(
  revision: ReturnType<typeof getCurrentDesignDefinitionRevision>,
  owner: MorphoObject | undefined,
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
      owner ? createObjectRef({ objects: { [owner.id]: owner } }, owner.id) : undefined,
      {
        kind: "revision" as const,
        id: revision.id,
        snapshot: {
          title: revision.title,
          revisionNumber: revision.revisionNumber,
          summarySnippet: truncateText(revision.summary)
        },
        sourceAvailability: owner ? (owner.visibility === "hidden" ? "hidden" as const : "active" as const) : "missing" as const
      }
    ].filter(isDefined),
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
  taskScope: SemanticEntryTaskScope,
  currentFocus: ProjectFocusArea,
  includeHistorical: boolean
): { include: true } | { include: false; reason: string } {
  const hasDirectMatch = hasDirectSourceMatch(entry, selected);
  const eligibility = getContinuityEntryEligibility(entry);
  if (entry.manualState !== "active") {
    return { include: false, reason: "manual state is not active" };
  }
  if (entry.validity === "current") {
    if (!eligibility.canEnterDefaultContext) {
      return { include: false, reason: eligibility.reason };
    }
    if (!isSemanticEntryScopeRelevantToTaskContext(entry, taskScope)) {
      return { include: false, reason: `semantic scope not relevant for ${taskScope.taskKind}` };
    }
    if (entry.origin === "conversationSemanticPatch") {
      return { include: true };
    }
    return hasDirectMatch || isStageRelevantToTask(entry.stage, taskScope.taskKind, currentFocus)
      ? { include: true }
      : { include: false, reason: `not relevant for ${taskScope.taskKind}` };
  }
  if (entry.validity === "reviewRequired") {
    return hasDirectMatch && isSemanticEntryScopeRelevantToTaskContext(entry, taskScope)
      ? { include: true }
      : { include: false, reason: `not relevant for ${taskScope.taskKind}` };
  }
  if (entry.validity === "superseded") {
    return hasDirectMatch || includeHistorical
      ? { include: true }
      : { include: false, reason: `not relevant for ${taskScope.taskKind}` };
  }
  if (entry.validity === "sourceUnavailable") {
    return { include: false, reason: "source unavailable" };
  }
  return hasDirectMatch ? { include: true } : { include: false, reason: `not relevant for ${taskScope.taskKind}` };
}

function hasOnlyActiveSources(item: ProjectMemoryItem): boolean {
  return item.sourceRefs.every((ref) => ref.sourceAvailability !== "hidden" && ref.sourceAvailability !== "missing");
}

function filterProjectMemoryItemsForTaskContext(
  items: ProjectMemoryItem[],
  recordEntries: ContinuityRecordEntry[],
  taskScope: SemanticEntryTaskScope
): ProjectMemoryItem[] {
  const entryById = new Map(recordEntries.map((entry) => [entry.id, entry]));
  return items.filter((item) => {
    if (!hasOnlyActiveSources(item)) {
      return false;
    }
    const entry = entryById.get(item.id);
    return entry ? isSemanticEntryScopeRelevantToTaskContext(entry, taskScope) : true;
  });
}

function normalizeSemanticEntryTaskScope(input: BuildProjectContinuityContextInput): SemanticEntryTaskScope {
  return {
    taskKind: input.taskKind,
    directObjectIds: uniqueStrings([...(input.selectedObjectIds ?? []), ...(input.directObjectIds ?? [])]),
    directRevisionIds: uniqueStrings(input.directRevisionIds ?? []),
    directBranchIds: uniqueStrings(input.directBranchIds ?? []),
    directDecisionIds: uniqueStrings(input.directDecisionIds ?? []),
    targetDirectionIds: uniqueStrings(input.targetDirectionIds ?? [])
  };
}

function hasTypedDirectSourceMatch(entry: ContinuityRecordEntry, taskScope: SemanticEntryTaskScope): boolean {
  const directObjectIds = new Set([...taskScope.directObjectIds, ...taskScope.targetDirectionIds]);
  const directRevisionIds = new Set(taskScope.directRevisionIds);
  const directBranchIds = new Set(taskScope.directBranchIds);
  const directDecisionIds = new Set(taskScope.directDecisionIds);

  return entry.sourceRefs.some((ref) => {
    if (ref.kind === "object") {
      return directObjectIds.has(ref.id);
    }
    if (ref.kind === "revision") {
      return directRevisionIds.has(ref.id);
    }
    if (ref.kind === "branch") {
      return directBranchIds.has(ref.id);
    }
    if (ref.kind === "decision") {
      return directDecisionIds.has(ref.id);
    }
    return false;
  });
}

function isDirectionScopedTask(taskKind: BuildProjectContinuityContextInput["taskKind"]): boolean {
  return taskKind === "conceptDirection" || taskKind === "directionPreview" || taskKind === "visualDevelopment" || taskKind === "general";
}

function isVisualScopedTask(taskKind: BuildProjectContinuityContextInput["taskKind"]): boolean {
  return taskKind === "directionPreview" || taskKind === "visualDevelopment" || taskKind === "general";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function withSourceAvailability(
  ref: ContinuitySourceRef | undefined,
  sourceAvailability: NonNullable<ContinuitySourceRef["sourceAvailability"]>
): ContinuitySourceRef | undefined {
  return ref ? { ...ref, sourceAvailability } : undefined;
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
    visualDevelopment: ["directionAndVisual", "designDefinition"],
    comparison: ["directionAndVisual", "designDefinition", "research"]
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
    snapshot: snapshotObject(object),
    sourceAvailability: object.visibility === "hidden" ? "hidden" : "active"
  };
}

function resolveSourceRefAvailability(workspace: MorphoWorkspace, ref: ContinuitySourceRef): ContinuitySourceRef {
  if (ref.kind === "message") {
    return {
      ...ref,
      sourceAvailability: workspace.ai.messages.some((message) => message.id === ref.id) ? "active" : "missing"
    };
  }

  if (ref.kind === "object") {
    const object = workspace.objects[ref.id];
    return {
      ...ref,
      sourceAvailability: !object ? "missing" : object.visibility === "hidden" ? "hidden" : "active"
    };
  }

  if (ref.kind === "revision") {
    const definitionRevision = workspace.designDefinitionRevisions[ref.id];
    if (definitionRevision) {
      return { ...ref, sourceAvailability: "active" };
    }
    const directionRevision = workspace.directionRevisions[ref.id];
    if (directionRevision) {
      return { ...ref, sourceAvailability: "active" };
    }
    return { ...ref, sourceAvailability: "missing" };
  }

  if (ref.kind === "branch") {
    return { ...ref, sourceAvailability: workspace.visualBranches[ref.id] ? "active" : "missing" };
  }

  if (ref.kind === "deliveryReference") {
    return { ...ref, sourceAvailability: workspace.deliveryReferences[ref.id] ? "active" : "missing" };
  }

  return { ...ref, sourceAvailability: "active" };
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
    origin: isRecordOrigin(value.origin) ? value.origin : "deterministicEvent",
    manualState: isManualState(value.manualState) ? value.manualState : "active",
    stage: value.stage,
    category: isRecordCategory(value.category) ? value.category : "systemNote",
    summary: typeof value.summary === "string" ? value.summary : "",
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.map(normalizeSourceRef).filter(isDefined) : [],
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    validity: isContinuityValidity(value.validity) ? value.validity : "current",
    semanticKind: isSemanticPatchKind(value.semanticKind) ? value.semanticKind : undefined,
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    evidenceQuote: typeof value.evidenceQuote === "string" ? value.evidenceQuote : undefined,
    scope: isSemanticPatchScope(value.scope) ? value.scope : undefined,
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
    value.kind !== "deliveryReference" &&
    value.kind !== "message"
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
          summarySnippet: typeof value.snapshot.summarySnippet === "string" ? value.snapshot.summarySnippet : undefined,
          createdAt: typeof value.snapshot.createdAt === "string" ? value.snapshot.createdAt : undefined
        }
      : undefined,
    sourceAvailability:
      value.sourceAvailability === "active" || value.sourceAvailability === "hidden" || value.sourceAvailability === "missing"
        ? value.sourceAvailability
        : undefined
  };
}

function isRecordOrigin(value: unknown): value is ContinuityRecordEntry["origin"] {
  return value === "deterministicEvent" || value === "conversationSemanticPatch";
}

function isManualState(value: unknown): value is ContinuityRecordEntry["manualState"] {
  return value === "active" || value === "notApplicable" || value === "withdrawn";
}

function isSemanticPatchKind(value: unknown): value is NonNullable<ContinuityRecordEntry["semanticKind"]> {
  return value === "preference" || value === "constraint" || value === "avoidance" || value === "openQuestion" || value === "decisionReason" || value === "rejectionReason";
}

function isSemanticPatchScope(value: unknown): value is NonNullable<ContinuityRecordEntry["scope"]> {
  return value === "project" || value === "designDefinition" || value === "direction" || value === "visual";
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

function validityUiLabel(validity: ContinuityValidity): string {
  switch (validity) {
    case "current":
      return "当前有效";
    case "reviewRequired":
      return "待复核";
    case "superseded":
      return "已被更新替代";
    case "sourceUnavailable":
      return "来源不可用";
  }
}

function normalizeForDedupe(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
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

export function buildContinuityRecordId(dedupeKey: string): string {
  const readablePrefix = slugify(dedupeKey).slice(0, 80) || "record";
  return `continuity-${readablePrefix}-${stableContinuityIdHash(dedupeKey)}`;
}

function stableContinuityIdHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }

  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
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
