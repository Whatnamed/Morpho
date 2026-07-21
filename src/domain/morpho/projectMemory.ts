import type {
  ConceptDirectionObject,
  ContinuityRecordEntry,
  ContinuitySourceRef,
  AgentTaskStrategyKind,
  MemoryRevisionBasis,
  MorphoObject,
  MorphoWorkspace,
  ProjectMemoryDocument,
  ProjectMemoryKey,
  ProjectMemoryRevision,
  ProjectMemorySection,
  ProjectMemoryState,
  StageRecordKey,
  StageRecordRevision,
  StageRecordSectionKey,
  StageRecordSections
} from "./types";
import { getContinuityEntryEligibility, resolveContinuityValidity } from "./projectContinuity";
import { classifyDecisionRecords } from "./decisionRecords";

export const PROJECT_MEMORY_KEYS: readonly ProjectMemoryKey[] = [
  "projectOverview",
  "designBrief",
  "userPreferences",
  "decisionLog",
  "rejectedDirections",
  "openQuestions",
  "outputPlan"
];

export const STAGE_RECORD_KEYS: readonly StageRecordKey[] = [
  "startAndInput",
  "exploration",
  "research",
  "designDefinition",
  "directionAndVisual",
  "deliveryPreparation"
];

export const PROJECT_MEMORY_TITLES: Record<ProjectMemoryKey, string> = {
  projectOverview: "项目概览",
  designBrief: "设计定义",
  userPreferences: "偏好与避免项",
  decisionLog: "决策记录",
  rejectedDirections: "已淘汰方向",
  openQuestions: "待确认问题",
  outputPlan: "交付计划"
};

export const STAGE_RECORD_TITLES: Record<StageRecordKey, string> = {
  startAndInput: "开始与输入",
  exploration: "探索",
  research: "调研",
  designDefinition: "设计定义",
  directionAndVisual: "方向与视觉发展",
  deliveryPreparation: "交付准备"
};

export const AGENT_DEFAULT_MEMORY_LIMITS = {
  maxSectionsPerDocument: 9,
  maxItemsPerSection: 5,
  maxItemChars: 320,
  maxSourceRefs: 3,
  maxTotalItems: 24,
  maxDocumentChars: 6_000
} as const;

const PROJECT_MEMORY_SECTION_PRIORITY: Record<ProjectMemoryKey, readonly string[]> = {
  projectOverview: ["currentFocus", "stableResults", "projectStart", "mainRoute", "recentChange"],
  designBrief: [
    "coreProblem",
    "designPrinciples",
    "constraints",
    "avoidDirections",
    "projectGoal",
    "targetUsers",
    "primaryScenarios",
    "opportunities",
    "openQuestions"
  ],
  userPreferences: [
    "projectAvoids",
    "projectConstraints",
    "projectPreferences",
    "designDefinition",
    "direction",
    "visual",
    "review"
  ],
  decisionLog: ["decisions"],
  rejectedDirections: ["directions"],
  openQuestions: ["blocking", "designDefinition", "direction", "delivery", "exploration"],
  outputPlan: ["formats", "gaps", "sections", "references", "completed"]
};

const STAGE_SECTION_PRIORITY: readonly StageRecordSectionKey[] = [
  "goalAndStatus",
  "decisions",
  "constraints",
  "openRisks",
  "nextFocus",
  "outputs",
  "preferences",
  "rejected"
];

function sectionPriority(priority: readonly string[], key: string): number {
  const index = priority.indexOf(key);
  return index >= 0 ? index : priority.length + 1;
}

function stageSectionPriority(key: keyof StageRecordSections): number {
  const index = STAGE_SECTION_PRIORITY.indexOf(key as StageRecordSectionKey);
  return index >= 0 ? index : STAGE_SECTION_PRIORITY.length + 1;
}

export type AgentDefaultMemoryDocument = {
  key: ProjectMemoryKey;
  title: string;
  revisionId?: string;
  updatedAt?: string;
  reviewRequired: boolean;
  empty: boolean;
  sections: ProjectMemorySection[];
  sourceRefs: Array<{ kind: ContinuitySourceRef["kind"]; id: string; title?: string }>;
};

export type AgentDefaultStageRecord = {
  stage: StageRecordKey;
  revisionId?: string;
  updatedAt?: string;
  reviewRequired: boolean;
  empty: boolean;
  sections: StageRecordSections;
  sourceRefs: Array<{ kind: ContinuitySourceRef["kind"]; id: string; title?: string }>;
};

export type AgentDefaultMemoryContext = {
  documents: AgentDefaultMemoryDocument[];
  stageRecords: AgentDefaultStageRecord[];
  defaultReference?: {
    status: "available" | "missing" | "unavailable";
    objectId?: string;
    title?: string;
    directionId?: string;
  };
};

type ProjectionWorkspace = Pick<
  MorphoWorkspace,
  | "project"
  | "objects"
  | "designDefinitionRevisions"
  | "directionRevisions"
  | "decisionRecords"
  | "deliveryReferences"
  | "projectContinuity"
  | "workingState"
  | "ai"
>;

type ProjectedDocument = {
  sections: ProjectMemorySection[];
  sourceRefs: ContinuitySourceRef[];
  basis: MemoryRevisionBasis;
  reviewRequired: boolean;
};

type ProjectedStage = {
  sections: StageRecordSections;
  sourceRefs: ContinuitySourceRef[];
  reviewRequired: boolean;
};

export function createEmptyProjectMemoryState(now = new Date().toISOString()): ProjectMemoryState {
  return {
    schemaVersion: 1,
    documents: Object.fromEntries(
      PROJECT_MEMORY_KEYS.map((key) => [key, { key, title: PROJECT_MEMORY_TITLES[key] } satisfies ProjectMemoryDocument])
    ) as Record<ProjectMemoryKey, ProjectMemoryDocument>,
    revisions: {},
    stageRecords: {},
    stageRevisions: {},
    updatedAt: now
  };
}

export function createInitialProjectMemoryState(
  workspace: ProjectionWorkspace,
  now = new Date().toISOString()
): ProjectMemoryState {
  return reconcileProjectMemoryState(workspace, createEmptyProjectMemoryState(now), now);
}

export function normalizeProjectMemoryState(
  workspace: ProjectionWorkspace,
  value: unknown,
  now = new Date().toISOString()
): ProjectMemoryState {
  const parsed = collapseEquivalentCurrentRevisions(
    parseProjectMemoryState(value) ?? createEmptyProjectMemoryState(now)
  );
  return reconcileProjectMemoryState(workspace, parsed, now);
}

export function reconcileProjectMemory(workspace: MorphoWorkspace, now = new Date().toISOString()): MorphoWorkspace {
  const projectMemory = reconcileProjectMemoryState(workspace, workspace.projectMemory, now);
  return projectMemory === workspace.projectMemory ? workspace : { ...workspace, projectMemory };
}

export function reconcileProjectMemoryState(
  workspace: ProjectionWorkspace,
  current: ProjectMemoryState,
  now = new Date().toISOString()
): ProjectMemoryState {
  const resolved = resolveContinuityValidity(workspace as MorphoWorkspace);
  let next = current;

  for (const key of PROJECT_MEMORY_KEYS) {
    next = applyProjectedDocument(next, key, projectDocument(workspace, resolved, key), now);
  }

  const projectedStages = projectStages(workspace, resolved);
  for (const stage of STAGE_RECORD_KEYS) {
    const projected = projectedStages[stage];
    if (!projected || stageSectionItemCount(projected.sections) === 0) {
      continue;
    }
    next = applyProjectedStage(next, stage, projected, now);
  }

  return next;
}

export function getCurrentProjectMemoryRevision(
  state: ProjectMemoryState,
  key: ProjectMemoryKey
): ProjectMemoryRevision | undefined {
  const revisionId = state.documents[key]?.currentRevisionId;
  return revisionId ? state.revisions[revisionId] : undefined;
}

export function getCurrentStageRecordRevision(
  state: ProjectMemoryState,
  stage: StageRecordKey
): StageRecordRevision | undefined {
  const revisionId = state.stageRecords[stage]?.currentRevisionId;
  return revisionId ? state.stageRevisions[revisionId] : undefined;
}

export function getProjectMemoryHistory(state: ProjectMemoryState, key: ProjectMemoryKey): ProjectMemoryRevision[] {
  return Object.values(state.revisions)
    .filter((revision) => revision.documentKey === key)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getStageRecordHistory(state: ProjectMemoryState, stage: StageRecordKey): StageRecordRevision[] {
  return Object.values(state.stageRevisions)
    .filter((revision) => revision.stage === stage)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function buildAgentDefaultMemoryContext(
  workspace: MorphoWorkspace,
  strategy: AgentTaskStrategyKind
): AgentDefaultMemoryContext {
  const resolved = reconcileProjectMemory(resolveContinuityValidity(workspace));
  const documentKeys = new Set<ProjectMemoryKey>([
    "projectOverview",
    "designBrief",
    "userPreferences",
    "openQuestions"
  ]);
  for (const key of defaultDocumentKeysForStrategy(strategy)) {
    documentKeys.add(key);
  }

  return {
    documents: [...documentKeys].map((key) => compactDefaultMemoryDocument(resolved.projectMemory, key)),
    stageRecords: defaultStageKeysForStrategy(strategy, resolved.projectContinuity.currentFocus.area).map((stage) =>
      compactDefaultStageRecord(resolved.projectMemory, stage)
    ),
    ...(isVisualStrategy(strategy) ? { defaultReference: compactDefaultReference(resolved) } : {})
  };
}

function defaultDocumentKeysForStrategy(strategy: AgentTaskStrategyKind): ProjectMemoryKey[] {
  switch (strategy) {
    case "conceptDirection":
      return ["rejectedDirections"];
    case "deliveryPreparation":
      return ["outputPlan"];
    default:
      return [];
  }
}

function defaultStageKeysForStrategy(
  strategy: AgentTaskStrategyKind,
  currentFocus: StageRecordKey
): StageRecordKey[] {
  switch (strategy) {
    case "research":
      return ["research"];
    case "designDefinition":
      return ["research", "designDefinition"];
    case "conceptDirection":
    case "directionPreview":
    case "visualDevelopment":
      return ["directionAndVisual"];
    case "deliveryPreparation":
      return ["deliveryPreparation"];
    case "comparison":
    case "historyAndMemory":
      return [];
    case "discussion":
      return [currentFocus];
  }
}

function compactDefaultMemoryDocument(state: ProjectMemoryState, key: ProjectMemoryKey): AgentDefaultMemoryDocument {
  const document = state.documents[key];
  const revision = getCurrentProjectMemoryRevision(state, key);
  return {
    key,
    title: document.title,
    revisionId: revision?.id,
    updatedAt: revision?.createdAt ?? document.updatedAt,
    reviewRequired: revision?.reviewRequired ?? false,
    empty: !revision || revision.sections.length === 0,
    sections: revision ? compactMemorySectionsForAgent(key, revision.sections) : [],
    sourceRefs: revision ? compactSourceRefsForAgent(revision.sourceRefs) : []
  };
}

function compactDefaultStageRecord(state: ProjectMemoryState, stage: StageRecordKey): AgentDefaultStageRecord {
  const record = state.stageRecords[stage];
  const revision = getCurrentStageRecordRevision(state, stage);
  return {
    stage,
    revisionId: revision?.id,
    updatedAt: revision?.createdAt ?? record?.updatedAt,
    reviewRequired: revision?.reviewRequired ?? false,
    empty: !revision || stageSectionItemCount(revision.sections) === 0,
    sections: revision ? compactStageSectionsForAgent(revision.sections) : {},
    sourceRefs: revision ? compactSourceRefsForAgent(revision.sourceRefs) : []
  };
}

function compactMemorySectionsForAgent(
  documentKey: ProjectMemoryKey,
  sections: readonly ProjectMemorySection[]
): ProjectMemorySection[] {
  const priority = PROJECT_MEMORY_SECTION_PRIORITY[documentKey] ?? [];
  const ranked = [...sections]
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const priorityDelta = sectionPriority(priority, left.section.key) - sectionPriority(priority, right.section.key);
      return priorityDelta || left.index - right.index || left.section.key.localeCompare(right.section.key);
    })
    .slice(0, AGENT_DEFAULT_MEMORY_LIMITS.maxSectionsPerDocument);
  const result: ProjectMemorySection[] = [];
  let totalItems = 0;
  let totalChars = 0;
  for (const { section } of ranked) {
    const items: string[] = [];
    for (const item of section.items.slice(0, AGENT_DEFAULT_MEMORY_LIMITS.maxItemsPerSection)) {
      if (totalItems >= AGENT_DEFAULT_MEMORY_LIMITS.maxTotalItems) {
        break;
      }
      const compacted = truncateAgentMemoryItem(item);
      if (!compacted || totalChars + compacted.length > AGENT_DEFAULT_MEMORY_LIMITS.maxDocumentChars) {
        continue;
      }
      items.push(compacted);
      totalItems += 1;
      totalChars += compacted.length;
    }
    if (items.length > 0) {
      result.push({ key: section.key, title: section.title, items });
    }
    if (totalItems >= AGENT_DEFAULT_MEMORY_LIMITS.maxTotalItems) {
      break;
    }
  }
  return result;
}

function compactStageSectionsForAgent(sections: StageRecordSections): StageRecordSections {
  let totalItems = 0;
  const compacted = Object.entries(sections)
      .map(([key, items], index) => ({ key, items: items ?? [], index }))
      .sort((left, right) => {
        const priorityDelta =
          stageSectionPriority(left.key as keyof StageRecordSections) -
          stageSectionPriority(right.key as keyof StageRecordSections);
        return priorityDelta || left.index - right.index || left.key.localeCompare(right.key);
      })
      .slice(0, AGENT_DEFAULT_MEMORY_LIMITS.maxSectionsPerDocument)
      .map(({ key, items }) => {
        const remaining = Math.max(0, AGENT_DEFAULT_MEMORY_LIMITS.maxTotalItems - totalItems);
        const compactedItems = items
          .slice(0, Math.min(AGENT_DEFAULT_MEMORY_LIMITS.maxItemsPerSection, remaining))
          .map((item) => truncateAgentMemoryItem(item));
        totalItems += compactedItems.length;
        return [key, compactedItems] as const;
      })
      .filter(([, items]) => items.length > 0);
  return Object.fromEntries(compacted) as StageRecordSections;
}

function compactSourceRefsForAgent(
  sourceRefs: readonly ContinuitySourceRef[]
): Array<{ kind: ContinuitySourceRef["kind"]; id: string; title?: string }> {
  return [...sourceRefs]
    .filter((source) => source.sourceAvailability !== "hidden" && source.sourceAvailability !== "missing")
    .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))
    .slice(0, AGENT_DEFAULT_MEMORY_LIMITS.maxSourceRefs)
    .map((source) => ({ kind: source.kind, id: source.id, title: source.snapshot?.title }));
}

function compactDefaultReference(workspace: MorphoWorkspace): AgentDefaultMemoryContext["defaultReference"] {
  const objectId = workspace.workingState.currentDefaultReferenceId;
  if (!objectId) {
    return { status: "missing" };
  }
  const object = workspace.objects[objectId];
  if (!object || object.type !== "image" || object.visibility !== "active" || !object.assetId) {
    return { status: "unavailable", objectId };
  }
  return {
    status: "available",
    objectId: object.id,
    title: object.title,
    directionId: object.directionId
  };
}

function isVisualStrategy(strategy: AgentTaskStrategyKind): boolean {
  return strategy === "directionPreview" || strategy === "visualDevelopment";
}

function truncateAgentMemoryItem(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > AGENT_DEFAULT_MEMORY_LIMITS.maxItemChars
    ? `${normalized.slice(0, AGENT_DEFAULT_MEMORY_LIMITS.maxItemChars - 1)}…`
    : normalized;
}

function projectDocument(
  workspace: ProjectionWorkspace,
  resolved: MorphoWorkspace,
  key: ProjectMemoryKey
): ProjectedDocument {
  switch (key) {
    case "projectOverview":
      return projectOverview(workspace, resolved);
    case "designBrief":
      return projectDesignBrief(workspace);
    case "userPreferences":
      return projectUserPreferences(resolved);
    case "decisionLog":
      return projectDecisionLog(workspace);
    case "rejectedDirections":
      return projectRejectedDirections(workspace);
    case "openQuestions":
      return projectOpenQuestions(workspace, resolved);
    case "outputPlan":
      return projectOutputPlan(workspace);
  }
}

function projectOverview(workspace: ProjectionWorkspace, resolved: MorphoWorkspace): ProjectedDocument {
  const primaryDirection = workspace.workingState.primaryDirectionId
    ? workspace.objects[workspace.workingState.primaryDirectionId]
    : undefined;
  const currentDefinition = currentDefinitionRevision(workspace);
  const deliveries = objectsOfType(workspace, "delivery");
  const recentEntry = [...resolved.projectContinuity.recordEntries]
    .filter(isCurrentEligibleEntry)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const currentFocusSourceMissing = resolved.projectContinuity.currentFocus.sourceObjectIds.some(
    (objectId) => !workspace.objects[objectId]
  );
  const currentDefinitionMissing = Boolean(
    workspace.workingState.currentDesignDefinitionId &&
      (!workspace.objects[workspace.workingState.currentDesignDefinitionId] || !currentDefinition)
  );
  const primaryDirectionMissing = Boolean(
    workspace.workingState.primaryDirectionId && !workspace.objects[workspace.workingState.primaryDirectionId]
  );
  const hasReviewRequiredEntry = resolved.projectContinuity.recordEntries.some(
    (entry) => getContinuityEntryEligibility(entry).canEnterReviewList
  );
  const stableResults = uniqueText([
    currentDefinition ? `当前设计定义：${currentDefinition.title}` : "",
    primaryDirection?.type === "conceptDirection" ? `当前主方向：${primaryDirection.title}` : "",
    deliveries.length > 0 ? `已有 ${deliveries.length} 个交付准备对象` : ""
  ]);

  return {
    sections: compactSections([
      section("projectStart", "项目起点与目标", [workspace.project.subtitle || workspace.project.title]),
      section("currentFocus", "当前工作重点", [resolved.projectContinuity.currentFocus.note]),
      section("stableResults", "主要成果", stableResults),
      section("mainRoute", "当前主路线", primaryDirection ? [primaryDirection.title] : []),
      section("recentChange", "最近重要变化", recentEntry ? [recentEntry.summary] : [])
    ]),
    sourceRefs: uniqueSourceRefs([
      ...focusSourceRefs(workspace),
      ...(currentDefinition ? [revisionRef(currentDefinition.id, currentDefinition.title)] : []),
      ...(primaryDirection ? [objectRef(primaryDirection)] : []),
      ...(recentEntry?.sourceRefs ?? [])
    ]),
    basis: recentEntry?.origin === "conversationSemanticPatch" ? "mixed" : "deterministic",
    reviewRequired: currentFocusSourceMissing || currentDefinitionMissing || primaryDirectionMissing || hasReviewRequiredEntry
  };
}

function projectDesignBrief(workspace: ProjectionWorkspace): ProjectedDocument {
  const revision = currentDefinitionRevision(workspace);
  const object = revision ? workspace.objects[revision.designDefinitionId] : undefined;
  if (!revision || object?.type !== "designDefinition") {
    return emptyProjection();
  }

  return {
    sections: compactSections([
      section("projectGoal", "项目目标", [revision.projectGoal]),
      section("targetUsers", "目标用户", revision.targetUsers),
      section("primaryScenarios", "核心场景", revision.primaryScenarios),
      section("coreProblem", "核心问题", [revision.coreProblem]),
      section("designPrinciples", "设计原则", revision.designPrinciples),
      section("constraints", "约束", revision.constraints),
      section("avoidDirections", "避免项", revision.avoidDirections),
      section("opportunities", "机会", revision.opportunities),
      section("openQuestions", "待确认问题", revision.openQuestions)
    ]),
    sourceRefs: uniqueSourceRefs([objectRef(object), revisionRef(revision.id, revision.title)]),
    basis: "deterministic",
    reviewRequired: false
  };
}

function projectUserPreferences(resolved: MorphoWorkspace): ProjectedDocument {
  const entries = resolved.projectContinuity.recordEntries.filter(
    (entry) =>
      entry.origin === "conversationSemanticPatch" &&
      (entry.semanticKind === "preference" || entry.semanticKind === "avoidance" || entry.semanticKind === "constraint") &&
      isCurrentEligibleEntry(entry)
  );

  const sections = [
    preferenceSection(
      "projectAvoids",
      "项目范围明确避免",
      entries.filter((entry) => entry.scope === "project" && entry.semanticKind === "avoidance")
    ),
    preferenceSection(
      "projectConstraints",
      "项目范围明确约束",
      entries.filter((entry) => entry.scope === "project" && entry.semanticKind === "constraint")
    ),
    preferenceSection(
      "projectPreferences",
      "项目范围稳定偏好",
      entries.filter((entry) => entry.scope === "project" && entry.semanticKind === "preference")
    ),
    preferenceSection("designDefinition", "设计定义范围", entries.filter((entry) => entry.scope === "designDefinition")),
    preferenceSection("direction", "方向范围", entries.filter((entry) => entry.scope === "direction")),
    preferenceSection("visual", "视觉范围", entries.filter((entry) => entry.scope === "visual")),
  ].filter((candidate): candidate is ProjectMemorySection => candidate.items.length > 0);

  return {
    sections,
    sourceRefs: uniqueSourceRefs(entries.flatMap((entry) => entry.sourceRefs)),
    basis: entries.length > 0 ? "userExplicit" : "deterministic",
    reviewRequired: false
  };
}

function projectDecisionLog(workspace: ProjectionWorkspace): ProjectedDocument {
  const classified = classifyDecisionRecords(workspace);
  const currentDecisions = classified
    .filter((item) => item.state === "current")
    .map((item) => item.record)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    sections: compactSections([
      section(
        "decisions",
        "当前项目决定",
        currentDecisions.map((decision) =>
          [decision.summary, decision.reason ? `原因：${decision.reason}` : "", `时间：${decision.createdAt}`]
            .filter(Boolean)
            .join("；")
        )
      )
    ]),
    sourceRefs: uniqueSourceRefs(
      currentDecisions.flatMap((decision) => [
        decisionRef(decision.id, decision.summary, decision.kind),
        ...decision.relatedObjectIds.map((objectId) => objectRef(workspace.objects[objectId])).filter(isSourceRef)
      ])
    ),
    basis: "deterministic",
    reviewRequired: classified.some((item) => item.state === "reviewRequired")
  };
}

function projectRejectedDirections(workspace: ProjectionWorkspace): ProjectedDocument {
  const directions = objectsOfType(workspace, "conceptDirection").filter((direction) => direction.status === "eliminated");
  const entries = directions.map((direction) => {
    const decision = [...workspace.decisionRecords]
      .reverse()
      .find((candidate) => candidate.kind === "setDirectionStatus" && candidate.relatedObjectIds.includes(direction.id));
    return {
      text: [direction.title, decision?.reason ? `淘汰原因：${decision.reason}` : direction.summary, "允许恢复为备选"]
        .filter(Boolean)
        .join("；"),
      refs: [objectRef(direction), decision ? decisionRef(decision.id, decision.summary, decision.kind) : undefined].filter(
        isSourceRef
      )
    };
  });

  return {
    sections: compactSections([section("directions", "当前已淘汰方向", entries.map((entry) => entry.text))]),
    sourceRefs: uniqueSourceRefs(entries.flatMap((entry) => entry.refs)),
    basis: "deterministic",
    reviewRequired: false
  };
}

function projectOpenQuestions(workspace: ProjectionWorkspace, resolved: MorphoWorkspace): ProjectedDocument {
  const revision = currentDefinitionRevision(workspace);
  const directionQuestions = objectsOfType(workspace, "conceptDirection").flatMap((direction) => {
    const directionRevision = workspace.directionRevisions[direction.currentRevisionId];
    return directionRevision?.openQuestions ?? [];
  });
  const researchQuestions = objectsOfType(workspace, "research").flatMap((research) => research.openQuestions);
  const deliveryQuestions = objectsOfType(workspace, "delivery").flatMap((delivery) =>
    delivery.gaps.filter((gap) => gap.status !== "resolved").map((gap) => `${delivery.title}：${gap.label}`)
  );
  const semanticEntries = resolved.projectContinuity.recordEntries.filter(
    (entry) => entry.semanticKind === "openQuestion" && isCurrentEligibleEntry(entry)
  );
  const sections = [
    section("blocking", "阻塞当前任务", semanticEntries.filter((entry) => entry.scope === "project").map(semanticEntryText)),
    section("designDefinition", "影响设计定义", revision?.openQuestions ?? []),
    section("direction", "影响方向", directionQuestions),
    section("delivery", "影响交付", deliveryQuestions),
    section("exploration", "普通探索问题", researchQuestions)
  ].filter((candidate) => candidate.items.length > 0);

  return {
    sections: compactSections(sections),
    sourceRefs: uniqueSourceRefs([
      ...(revision ? [revisionRef(revision.id, revision.title)] : []),
      ...objectsOfType(workspace, "conceptDirection").map(objectRef),
      ...objectsOfType(workspace, "research").map(objectRef),
      ...semanticEntries.flatMap((entry) => entry.sourceRefs)
    ]),
    basis: semanticEntries.length > 0 ? "mixed" : "deterministic",
    reviewRequired: false
  };
}

function projectOutputPlan(workspace: ProjectionWorkspace): ProjectedDocument {
  const deliveries = objectsOfType(workspace, "delivery");
  const sectionItems = deliveries.flatMap((delivery) =>
    delivery.sections.map((sectionItem) => `${delivery.title} / ${sectionItem.title}：${sectionItem.narrative || "待整理"}`)
  );
  const gaps = deliveries.flatMap((delivery) =>
    delivery.gaps.filter((gap) => gap.status !== "resolved").map((gap) => `${delivery.title}：${gap.label}`)
  );
  const references = deliveries.flatMap((delivery) =>
    delivery.references
      .map((referenceId) => workspace.deliveryReferences[referenceId])
      .filter(Boolean)
      .map((reference) => `${delivery.title}：${reference.snapshot.title}`)
  );
  const completed = deliveries.flatMap((delivery) =>
    delivery.sections
      .filter((sectionItem) => Boolean(sectionItem.narrative?.trim()))
      .map((sectionItem) => `${delivery.title}：${sectionItem.title}`)
  );

  return {
    sections: compactSections([
      section("formats", "输出形式", deliveries.map((delivery) => delivery.title)),
      section("gaps", "待补内容", gaps),
      section("sections", "章节结构", sectionItems),
      section("references", "稳定引用", references),
      section("completed", "已完成内容", completed)
    ]),
    sourceRefs: uniqueSourceRefs([
      ...deliveries.map(objectRef),
      ...Object.values(workspace.deliveryReferences).map((reference) => ({
        kind: "deliveryReference" as const,
        id: reference.id,
        snapshot: { title: reference.snapshot.title, summarySnippet: reference.snapshot.summary }
      }))
    ]),
    basis: "deterministic",
    reviewRequired: Object.values(workspace.deliveryReferences).some(
      (reference) => Boolean(reference.sourceObjectId && !workspace.objects[reference.sourceObjectId])
    )
  };
}

function projectStages(
  workspace: ProjectionWorkspace,
  resolved: MorphoWorkspace
): Partial<Record<StageRecordKey, ProjectedStage>> {
  const stageEntries = Object.fromEntries(STAGE_RECORD_KEYS.map((stage) => [stage, [] as ContinuityRecordEntry[]])) as Record<
    StageRecordKey,
    ContinuityRecordEntry[]
  >;
  for (const entry of resolved.projectContinuity.recordEntries) {
    if (entry.manualState === "active" && entry.validity !== "superseded") {
      stageEntries[entry.stage].push(entry);
    }
  }

  const result: Partial<Record<StageRecordKey, ProjectedStage>> = {};
  for (const stage of STAGE_RECORD_KEYS) {
    const entries = stageEntries[stage];
    const sections: StageRecordSections = {};
    for (const entry of entries) {
      const sectionKey = stageSectionForCategory(entry.category);
      if (!sectionKey) {
        continue;
      }
      sections[sectionKey] = uniqueText([...(sections[sectionKey] ?? []), entry.summary]);
    }

    if (resolved.projectContinuity.currentFocus.area === stage) {
      sections.goalAndStatus = uniqueText([
        ...(sections.goalAndStatus ?? []),
        resolved.projectContinuity.currentFocus.note
      ]);
    }

    addInferredStageContent(workspace, stage, sections);
    if (stageSectionItemCount(sections) === 0) {
      continue;
    }
    result[stage] = {
      sections,
      sourceRefs: uniqueSourceRefs([
        ...entries.flatMap((entry) => entry.sourceRefs),
        ...inferredStageSourceRefs(workspace, stage)
      ]),
      reviewRequired: entries.some((entry) => entry.validity === "reviewRequired" || entry.validity === "sourceUnavailable")
    };
  }
  return result;
}

function addInferredStageContent(
  workspace: ProjectionWorkspace,
  stage: StageRecordKey,
  sections: StageRecordSections
): void {
  if (stage === "startAndInput") {
    const inputs = Object.values(workspace.objects).filter((object) =>
      ["file", "link", "text"].includes(object.type)
    );
    if (inputs.length > 0) {
      sections.outputs = uniqueText([...(sections.outputs ?? []), ...inputs.map((object) => object.title)]);
    }
  }
  if (stage === "research") {
    const research = objectsOfType(workspace, "research");
    if (research.length > 0) {
      sections.outputs = uniqueText([...(sections.outputs ?? []), ...research.map((object) => object.title)]);
      sections.openRisks = uniqueText([
        ...(sections.openRisks ?? []),
        ...research.flatMap((object) => object.openQuestions)
      ]);
    }
  }
  if (stage === "designDefinition") {
    const revision = currentDefinitionRevision(workspace);
    if (revision) {
      sections.outputs = uniqueText([...(sections.outputs ?? []), `${revision.title}（r${revision.revisionNumber}）`]);
      sections.constraints = uniqueText([...(sections.constraints ?? []), ...revision.constraints]);
      sections.openRisks = uniqueText([...(sections.openRisks ?? []), ...revision.openQuestions]);
    }
  }
  if (stage === "directionAndVisual") {
    const directions = objectsOfType(workspace, "conceptDirection");
    const images = objectsOfType(workspace, "image").filter((image) => Boolean(image.generation));
    if (directions.length > 0 || images.length > 0) {
      sections.outputs = uniqueText([
        ...(sections.outputs ?? []),
        ...directions.map((direction) => `${direction.title}（${direction.status}）`),
        ...(images.length > 0 ? [`已生成 ${images.length} 个视觉对象`] : [])
      ]);
    }
  }
  if (stage === "deliveryPreparation") {
    const deliveries = objectsOfType(workspace, "delivery");
    if (deliveries.length > 0) {
      sections.outputs = uniqueText([...(sections.outputs ?? []), ...deliveries.map((delivery) => delivery.title)]);
      sections.openRisks = uniqueText([
        ...(sections.openRisks ?? []),
        ...deliveries.flatMap((delivery) =>
          delivery.gaps.filter((gap) => gap.status !== "resolved").map((gap) => gap.label)
        )
      ]);
    }
  }
}

function inferredStageSourceRefs(workspace: ProjectionWorkspace, stage: StageRecordKey): ContinuitySourceRef[] {
  switch (stage) {
    case "startAndInput":
      return Object.values(workspace.objects)
        .filter((object) => ["file", "link", "text"].includes(object.type))
        .map(objectRef)
        .filter(isSourceRef);
    case "exploration":
      return [];
    case "research":
      return objectsOfType(workspace, "research").map(objectRef).filter(isSourceRef);
    case "designDefinition": {
      const revision = currentDefinitionRevision(workspace);
      return revision ? [revisionRef(revision.id, revision.title)] : [];
    }
    case "directionAndVisual":
      return [
        ...objectsOfType(workspace, "conceptDirection").map(objectRef),
        ...objectsOfType(workspace, "image").filter((image) => Boolean(image.generation)).map(objectRef)
      ].filter(isSourceRef);
    case "deliveryPreparation":
      return objectsOfType(workspace, "delivery").map(objectRef).filter(isSourceRef);
  }
}

function applyProjectedDocument(
  state: ProjectMemoryState,
  key: ProjectMemoryKey,
  projected: ProjectedDocument,
  now: string
): ProjectMemoryState {
  const document = state.documents[key] ?? { key, title: PROJECT_MEMORY_TITLES[key] };
  const currentRevision = document.currentRevisionId ? state.revisions[document.currentRevisionId] : undefined;
  if (!currentRevision && projected.sections.length === 0) {
    return document === state.documents[key]
      ? state
      : { ...state, documents: { ...state.documents, [key]: document } };
  }

  const signature = revisionSignature(projected);
  if (currentRevision && revisionSignature(currentRevision) === signature) {
    return state;
  }

  const revisionId = `memory-${key}-${stableHash(`${currentRevision?.id ?? "root"}|${signature}`)}`;
  const revision: ProjectMemoryRevision = {
    id: revisionId,
    documentKey: key,
    previousRevisionId: currentRevision?.id,
    sections: projected.sections,
    sourceRefs: projected.sourceRefs,
    basis: projected.basis,
    createdAt: now,
    reviewRequired: projected.reviewRequired
  };
  return {
    ...state,
    documents: {
      ...state.documents,
      [key]: { ...document, currentRevisionId: revisionId, updatedAt: now }
    },
    revisions: { ...state.revisions, [revisionId]: revision },
    updatedAt: now
  };
}

function applyProjectedStage(
  state: ProjectMemoryState,
  stage: StageRecordKey,
  projected: ProjectedStage,
  now: string
): ProjectMemoryState {
  const record = state.stageRecords[stage] ?? { stage };
  const currentRevision = record.currentRevisionId ? state.stageRevisions[record.currentRevisionId] : undefined;
  const signature = revisionSignature(projected);
  if (currentRevision && revisionSignature(currentRevision) === signature) {
    return state;
  }

  const revisionId = `stage-${stage}-${stableHash(`${currentRevision?.id ?? "root"}|${signature}`)}`;
  const revision: StageRecordRevision = {
    id: revisionId,
    stage,
    previousRevisionId: currentRevision?.id,
    sections: projected.sections,
    sourceRefs: projected.sourceRefs,
    createdAt: now,
    reviewRequired: projected.reviewRequired
  };
  return {
    ...state,
    stageRecords: {
      ...state.stageRecords,
      [stage]: { ...record, currentRevisionId: revisionId, updatedAt: now }
    },
    stageRevisions: { ...state.stageRevisions, [revisionId]: revision },
    updatedAt: now
  };
}

function parseProjectMemoryState(value: unknown): ProjectMemoryState | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.documents) || !isRecord(value.revisions)) {
    return undefined;
  }
  if (!isRecord(value.stageRecords) || !isRecord(value.stageRevisions) || typeof value.updatedAt !== "string") {
    return undefined;
  }

  const documents = createEmptyProjectMemoryState(value.updatedAt).documents;
  for (const key of PROJECT_MEMORY_KEYS) {
    const candidate = value.documents[key];
    if (isRecord(candidate) && candidate.key === key && typeof candidate.title === "string") {
      documents[key] = {
        key,
        title: candidate.title,
        currentRevisionId: typeof candidate.currentRevisionId === "string" ? candidate.currentRevisionId : undefined,
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined
      };
    }
  }

  return {
    schemaVersion: 1,
    documents,
    revisions: value.revisions as ProjectMemoryState["revisions"],
    stageRecords: value.stageRecords as ProjectMemoryState["stageRecords"],
    stageRevisions: value.stageRevisions as ProjectMemoryState["stageRevisions"],
    updatedAt: value.updatedAt
  };
}

function collapseEquivalentCurrentRevisions(state: ProjectMemoryState): ProjectMemoryState {
  let changed = false;
  const documents = { ...state.documents };
  const revisions = { ...state.revisions };
  const stageRecords = { ...state.stageRecords };
  const stageRevisions = { ...state.stageRevisions };

  for (const key of PROJECT_MEMORY_KEYS) {
    const document = documents[key];
    let current = document.currentRevisionId ? revisions[document.currentRevisionId] : undefined;
    while (current?.previousRevisionId) {
      const previous = revisions[current.previousRevisionId];
      if (!previous || revisionSignature(previous) !== revisionSignature(current)) {
        break;
      }
      delete revisions[current.id];
      documents[key] = {
        ...document,
        currentRevisionId: previous.id,
        updatedAt: previous.createdAt
      };
      current = previous;
      changed = true;
    }
  }

  for (const stage of STAGE_RECORD_KEYS) {
    const record = stageRecords[stage];
    let current = record?.currentRevisionId ? stageRevisions[record.currentRevisionId] : undefined;
    while (record && current?.previousRevisionId) {
      const previous = stageRevisions[current.previousRevisionId];
      if (!previous || revisionSignature(previous) !== revisionSignature(current)) {
        break;
      }
      delete stageRevisions[current.id];
      stageRecords[stage] = {
        ...record,
        currentRevisionId: previous.id,
        updatedAt: previous.createdAt
      };
      current = previous;
      changed = true;
    }
  }

  return changed ? { ...state, documents, revisions, stageRecords, stageRevisions } : state;
}

function currentDefinitionRevision(workspace: ProjectionWorkspace) {
  const definitionId = workspace.workingState.currentDesignDefinitionId;
  const object = definitionId ? workspace.objects[definitionId] : undefined;
  return object?.type === "designDefinition" ? workspace.designDefinitionRevisions[object.currentRevisionId] : undefined;
}

function focusSourceRefs(workspace: ProjectionWorkspace): ContinuitySourceRef[] {
  return workspace.projectContinuity.currentFocus.sourceObjectIds.map((objectId) => objectRef(workspace.objects[objectId])).filter(isSourceRef);
}

function section(key: string, title: string, items: readonly string[]): ProjectMemorySection {
  return { key, title, items: uniqueText(items) };
}

function preferenceSection(
  key: string,
  title: string,
  entries: readonly ContinuityRecordEntry[]
): ProjectMemorySection {
  return section(
    key,
    title,
    entries.map((entry) => {
      const prefix = entry.semanticKind === "avoidance" ? "避免" : entry.semanticKind === "constraint" ? "约束" : "偏好";
      const review = getContinuityEntryEligibility(entry).canEnterReviewList ? "（待复核）" : "";
      return `${prefix}${review}：${semanticEntryText(entry)}`;
    })
  );
}

function compactSections(sections: ProjectMemorySection[]): ProjectMemorySection[] {
  return sections.filter((item) => item.items.length > 0);
}

function emptyProjection(): ProjectedDocument {
  return { sections: [], sourceRefs: [], basis: "deterministic", reviewRequired: false };
}

function semanticEntryText(entry: ContinuityRecordEntry): string {
  return entry.evidenceQuote?.trim() || entry.summary.replace(/^[^：]+：/, "").trim() || entry.summary;
}

function isCurrentEligibleEntry(entry: ContinuityRecordEntry): boolean {
  return getContinuityEntryEligibility(entry).canEnterMemory;
}

function stageSectionForCategory(category: ContinuityRecordEntry["category"]): keyof StageRecordSections | undefined {
  switch (category) {
    case "output":
      return "outputs";
    case "decision":
      return "decisions";
    case "rejection":
      return "rejected";
    case "preference":
      return "preferences";
    case "constraint":
      return "constraints";
    case "openQuestion":
      return "openRisks";
    case "nextFocus":
      return "nextFocus";
    case "systemNote":
      return "goalAndStatus";
  }
}

function stageSectionItemCount(sections: StageRecordSections): number {
  return Object.values(sections).reduce((total, items) => total + (items?.length ?? 0), 0);
}

function objectsOfType<T extends MorphoObject["type"]>(
  workspace: ProjectionWorkspace,
  type: T
): Array<Extract<MorphoObject, { type: T }>> {
  return Object.values(workspace.objects).filter(
    (object): object is Extract<MorphoObject, { type: T }> => object.type === type && object.visibility === "active"
  );
}

function objectRef(object: MorphoObject | undefined): ContinuitySourceRef | undefined {
  if (!object) {
    return undefined;
  }
  return {
    kind: "object",
    id: object.id,
    snapshot: {
      title: object.title,
      objectType: object.type,
      visibility: object.visibility,
      summarySnippet: object.summary,
      createdAt: object.createdAt
    },
    sourceAvailability: object.visibility === "hidden" ? "hidden" : "active"
  };
}

function revisionRef(id: string, title: string): ContinuitySourceRef {
  return { kind: "revision", id, snapshot: { title } };
}

function decisionRef(id: string, title: string, status: string): ContinuitySourceRef {
  return { kind: "decision", id, snapshot: { title, status } };
}

function isSourceRef(value: ContinuitySourceRef | undefined): value is ContinuitySourceRef {
  return Boolean(value);
}

function uniqueText(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function uniqueSourceRefs(values: readonly (ContinuitySourceRef | undefined)[]): ContinuitySourceRef[] {
  const byKey = new Map<string, ContinuitySourceRef>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    byKey.set(`${value.kind}:${value.id}`, value);
  }
  return [...byKey.values()].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function revisionSignature(value: {
  sections: ProjectMemorySection[] | StageRecordSections;
  sourceRefs: ContinuitySourceRef[];
  basis?: MemoryRevisionBasis;
  reviewRequired: boolean;
}): string {
  return stableJson({
    sections: value.sections,
    sourceRefs: value.sourceRefs.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      sourceAvailability: ref.sourceAvailability,
      snapshot: ref.snapshot
    })),
    basis: value.basis,
    reviewRequired: value.reviewRequired
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
