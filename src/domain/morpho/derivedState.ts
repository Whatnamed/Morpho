import type {
  ConceptDirectionObject,
  DesignDefinitionObject,
  DecisionRecordId,
  DesignDefinitionRevision,
  KeyConclusionObject,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  ProjectWorkingState,
  ResearchObject,
  StageRecord,
  StageRecordKind
} from "./types";

const MAX_RECENT_RESEARCH = 3;

export function createEmptyProjectWorkingState(now = new Date().toISOString()): ProjectWorkingState {
  return {
    alternativeDirectionIds: [],
    eliminatedDirectionIds: [],
    activeKeyConclusionIds: [],
    directionReferenceIds: {},
    recentResearchObjectIds: [],
    openQuestionIds: [],
    derivedFromRevision: "empty",
    lastReconciledAt: now
  };
}

export function createDefaultStageRecords(now = new Date().toISOString()): Record<StageRecordKind, StageRecord> {
  return {
    research: createStageRecord("research", now),
    designDefinition: createStageRecord("designDefinition", now),
    directionVisualDevelopment: createStageRecord("directionVisualDevelopment", now),
    deliveryPreparation: createStageRecord("deliveryPreparation", now)
  };
}

export function reconcileWorkspaceDerivedState(workspace: MorphoWorkspace): MorphoWorkspace {
  const now = new Date().toISOString();
  const workingState = deriveProjectWorkingState(workspace, now);
  const stageRecords = deriveStageRecords(workspace, workingState, now);

  return {
    ...workspace,
    workingState,
    stageRecords
  };
}

export function deriveProjectWorkingState(workspace: MorphoWorkspace, now = new Date().toISOString()): ProjectWorkingState {
  const designDefinitions = Object.values(workspace.objects).filter(isDesignDefinitionObject);
  const directions = Object.values(workspace.objects).filter(isConceptDirectionObject);
  const keyConclusions = Object.values(workspace.objects).filter(isKeyConclusionObject);
  const researchObjects = Object.values(workspace.objects).filter(isResearchObject);
  const images = Object.values(workspace.objects).filter((object) => object.type === "image");

  const currentDesignDefinition = designDefinitions.find((object) => object.isCurrentEffective) ?? designDefinitions[0];
  const primaryDirection = directions.find((direction) => direction.status === "primary");
  const alternativeDirectionIds = directions
    .filter((direction) => direction.status === "alternative")
    .map((direction) => direction.id);
  const eliminatedDirectionIds = directions
    .filter((direction) => direction.status === "eliminated")
    .map((direction) => direction.id);
  const activeKeyConclusionIds = keyConclusions
    .filter((conclusion) => conclusion.state === "active")
    .map((conclusion) => conclusion.id);
  const currentDefaultReference = images.find((image) => image.isDefaultReference);
  const recentResearchObjectIds = [...researchObjects]
    .sort(compareByCreatedAt)
    .slice(-MAX_RECENT_RESEARCH)
    .map((object) => object.id);
  const openQuestionIds = [
    ...keyConclusions.filter((conclusion) => conclusion.state === "needsVerification").map((conclusion) => conclusion.id),
    ...researchObjects.filter((object) => object.openQuestions.length > 0).map((object) => object.id)
  ];

  return {
    currentDesignDefinitionId: currentDesignDefinition?.id,
    primaryDirectionId: primaryDirection?.id,
    alternativeDirectionIds,
    eliminatedDirectionIds,
    activeKeyConclusionIds,
    currentDefaultReferenceId: currentDefaultReference?.id,
    directionReferenceIds: Object.fromEntries(
      directions.map((direction) => [
        direction.id,
        images
          .filter((image) => image.directionId === direction.id && image.visibility === "active")
          .map((image) => image.id)
      ])
    ),
    recentResearchObjectIds,
    openQuestionIds,
    derivedFromRevision: computeWorkingStateRevision(workspace),
    lastReconciledAt: now
  };
}

export function deriveStageRecords(
  workspace: MorphoWorkspace,
  workingState: ProjectWorkingState,
  now = new Date().toISOString()
): Record<StageRecordKind, StageRecord> {
  const previous = workspace.stageRecords ?? createDefaultStageRecords(now);
  const currentDefinitionRevision = getCurrentDesignDefinitionRevision(workspace, workingState.currentDesignDefinitionId);
  const directionObjects = Object.values(workspace.objects).filter(isConceptDirectionObject);
  const researchObjects = Object.values(workspace.objects).filter(isResearchObject);
  const savedKeyConclusionIds = Object.values(workspace.objects)
    .filter(isKeyConclusionObject)
    .filter((conclusion) => conclusion.state === "active" || conclusion.state === "needsVerification")
    .map((conclusion) => conclusion.id);
  const directionReferenceObjectIds = Object.values(workingState.directionReferenceIds).flat();

  return {
    research: {
      ...previous.research,
      goal: "沉淀研究对象、关键结论和待验证问题，形成后续定义与方向的依据。",
      currentStatus: workingState.recentResearchObjectIds.length > 0 ? "active" : "empty",
      savedObjectIds: uniqueIds([...workingState.recentResearchObjectIds, ...savedKeyConclusionIds]),
      decisionIds: getDecisionIds(workspace, ["createKeyConclusion"]),
      constraints: flattenUnique(researchObjects.map((object) => object.constraints)),
      openQuestions: flattenUnique(researchObjects.map((object) => object.openQuestions)),
      nextSuggestion:
        workingState.activeKeyConclusionIds.length > 0
          ? "基于已确认关键结论整理当前设计定义。"
          : "先从研究结果中保留关键结论，再进入设计定义。",
      updatedAt: now
    },
    designDefinition: {
      ...previous.designDefinition,
      goal: "维护唯一当前有效的设计定义，并保留可追溯修订链。",
      currentStatus: currentDefinitionRevision ? "active" : "pending",
      savedObjectIds: workingState.currentDesignDefinitionId ? [workingState.currentDesignDefinitionId] : [],
      decisionIds: getDecisionIds(workspace, ["applyDesignDefinition"]),
      constraints: currentDefinitionRevision?.constraints ?? [],
      openQuestions: currentDefinitionRevision?.openQuestions ?? [],
      nextSuggestion: currentDefinitionRevision
        ? "基于当前设计定义生成有差异的概念方向。"
        : "从研究与关键结论形成首版设计定义。",
      updatedAt: now
    },
    directionVisualDevelopment: {
      ...previous.directionVisualDevelopment,
      goal: "让概念方向、视觉分支和默认参考保持可判断、可回溯、可持续发展。",
      currentStatus: directionObjects.length > 0 ? "active" : "pending",
      savedObjectIds: uniqueIds([
        ...directionObjects.map((direction) => direction.id),
        ...directionReferenceObjectIds,
        ...(workingState.currentDefaultReferenceId ? [workingState.currentDefaultReferenceId] : [])
      ]),
      decisionIds: getDecisionIds(workspace, [
        "applyConceptDirection",
        "setDirectionStatus",
        "setDefaultReference",
        "setImageRole"
      ]),
      constraints: currentDefinitionRevision?.designPrinciples ?? [],
      openQuestions: directionObjects
        .filter((direction) => direction.status === "needsReview")
        .map((direction) => `${direction.title} 需要重新复核。`),
      nextSuggestion: workingState.primaryDirectionId
        ? "继续基于主方向发展视觉分支，必要时通过比较形成新的判断。"
        : "先确认一个主方向，再让视觉发展形成稳定路线。",
      updatedAt: now
    },
    deliveryPreparation: {
      ...previous.deliveryPreparation,
      goal: "整理稳定交付引用和输出叙事，不让源对象变化静默改写交付内容。",
      currentStatus: "pending",
      savedObjectIds: Object.values(workspace.objects)
        .filter((object) => object.type === "delivery")
        .map((object) => object.id),
      decisionIds: getDecisionIds(workspace, [
        "createDeliveryReference",
        "replaceDeliveryReference",
        "removeDeliveryReference"
      ]),
      constraints: [],
      openQuestions: [],
      nextSuggestion: "当前阶段尚未进入 M6 交付准备闭环，先稳定设计语义与方向判断。",
      updatedAt: now
    }
  };
}

export function getCurrentDesignDefinitionRevision(
  workspace: MorphoWorkspace,
  designDefinitionId: MorphoObjectId | undefined
): DesignDefinitionRevision | undefined {
  if (!designDefinitionId) {
    return undefined;
  }

  const object = workspace.objects[designDefinitionId];
  if (!isDesignDefinitionObject(object)) {
    return undefined;
  }

  return workspace.designDefinitionRevisions[object.currentRevisionId];
}

export function hasPendingDesignDefinitionRevisionProposal(
  workspace: MorphoWorkspace,
  designDefinitionId: MorphoObjectId | undefined
): boolean {
  if (!designDefinitionId) {
    return false;
  }

  return Object.values(workspace.artifactProposals).some(
    (proposal) =>
      proposal.type === "designDefinition" &&
      proposal.status === "pending" &&
      proposal.workIntent === "reviseDesignDefinition" &&
      proposal.basedOnDesignDefinitionId === designDefinitionId
  );
}

function createStageRecord(kind: StageRecordKind, now: string): StageRecord {
  return {
    kind,
    goal: "",
    currentStatus: "empty",
    savedObjectIds: [],
    decisionIds: [],
    constraints: [],
    openQuestions: [],
    nextSuggestion: "",
    updatedAt: now
  };
}

function computeWorkingStateRevision(workspace: MorphoWorkspace): string {
  const signature = JSON.stringify({
    objects: Object.values(workspace.objects)
      .map((object) => ({
        id: object.id,
        type: object.type,
        visibility: object.visibility,
        summary: object.summary,
        state: getObjectStateSignature(object)
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    relations: workspace.relations
      .map((relation) => ({
        kind: relation.kind,
        from: relation.fromObjectId,
        to: relation.toObjectId
      }))
      .sort((left, right) => `${left.kind}:${left.from}:${left.to}`.localeCompare(`${right.kind}:${right.from}:${right.to}`)),
    decisions: workspace.decisionRecords.map((record) => ({
      id: record.id,
      kind: record.kind,
      objectId: record.objectSnapshot?.id
    }))
  });

  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = (hash * 31 + signature.charCodeAt(index)) >>> 0;
  }

  return `ws-${hash.toString(16)}`;
}

function getObjectStateSignature(object: MorphoObject): string {
  switch (object.type) {
    case "image":
      return `${object.role}:${object.directionId ?? ""}:${object.visualBranchId ?? ""}:${object.isDefaultReference === true}`;
    case "research":
      return `${object.findings.length}:${object.openQuestions.length}`;
    case "keyConclusion":
      return `${object.state}:${object.confidence}:${object.supersededById ?? ""}`;
    case "designDefinition":
      return `${object.currentRevisionId}:${object.isCurrentEffective}`;
    case "conceptDirection":
      return `${object.status}:${object.currentRevisionId}:${object.lineageRootId}`;
    case "delivery":
      return `${object.references.length}:${object.gaps.length}`;
    default:
      return object.summary;
  }
}

function getDecisionIds(workspace: MorphoWorkspace, kinds: string[]): DecisionRecordId[] {
  return workspace.decisionRecords.filter((record) => kinds.includes(record.kind)).map((record) => record.id);
}

function uniqueIds(values: MorphoObjectId[]): MorphoObjectId[] {
  return [...new Set(values)];
}

function flattenUnique(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))];
}

function compareByCreatedAt(left: { createdAt?: string }, right: { createdAt?: string }) {
  return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
}

function isResearchObject(object: MorphoObject): object is ResearchObject {
  return object.type === "research";
}

function isKeyConclusionObject(object: MorphoObject): object is KeyConclusionObject {
  return object.type === "keyConclusion";
}

function isDesignDefinitionObject(object: MorphoObject): object is DesignDefinitionObject {
  return object.type === "designDefinition";
}

function isConceptDirectionObject(object: MorphoObject): object is ConceptDirectionObject {
  return object.type === "conceptDirection";
}
