import type {
  ConceptDirectionObject,
  DesignDefinitionObject,
  DesignDefinitionRevision,
  KeyConclusionObject,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  ProjectWorkingState,
  ResearchObject,
  ImageObject
} from "./types";

const MAX_RECENT_RESEARCH = 3;

export function createEmptyProjectWorkingState(now = new Date().toISOString()): ProjectWorkingState {
  return {
    currentDesignDefinitionAvailability: "missing",
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

export function reconcileWorkspaceDerivedState(
  workspace: MorphoWorkspace,
  now = new Date().toISOString()
): MorphoWorkspace {
  const objects = reconcileCurrentEffectiveDesignDefinitions(workspace);
  const relations = reconcileLegacyMultiReferenceVersionRelations(workspace, objects);
  const normalizedWorkspace = {
    ...workspace,
    objects,
    relations
  };
  const workingState = deriveProjectWorkingState(normalizedWorkspace, now);

  return {
    ...normalizedWorkspace,
    workingState
  };
}

function reconcileLegacyMultiReferenceVersionRelations(
  workspace: MorphoWorkspace,
  objects: Record<MorphoObjectId, MorphoObject>
) {
  const generatedMultiReferenceImageIds = new Set(
    Object.values(objects)
      .filter((object): object is ImageObject => object.type === "image")
      .filter((object) => {
        const imageReferenceCount = new Set(
          (object.generation?.referenceObjectIds ?? []).filter(
            (referenceObjectId) => objects[referenceObjectId]?.type === "image"
          )
        ).size;
        return imageReferenceCount > 1;
      })
      .map((object) => object.id)
  );

  if (generatedMultiReferenceImageIds.size === 0) {
    return workspace.relations;
  }

  return workspace.relations.filter(
    (relation) =>
      !(
        relation.kind === "version" &&
        generatedMultiReferenceImageIds.has(relation.toObjectId)
      )
  );
}

export function deriveProjectWorkingState(workspace: MorphoWorkspace, now = new Date().toISOString()): ProjectWorkingState {
  const designDefinitions = Object.values(workspace.objects).filter(isDesignDefinitionObject);
  const directions = Object.values(workspace.objects).filter(isConceptDirectionObject);
  const keyConclusions = Object.values(workspace.objects).filter(isKeyConclusionObject);
  const researchObjects = Object.values(workspace.objects).filter(isResearchObject);
  const images = Object.values(workspace.objects).filter((object) => object.type === "image");

  const currentDesignDefinition = designDefinitions.find((object) => object.isCurrentEffective);
  const currentDesignDefinitionAvailability =
    currentDesignDefinition?.visibility === "active"
      ? "available"
      : currentDesignDefinition?.visibility === "hidden"
        ? "hidden"
        : "missing";
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
    currentDesignDefinitionAvailability,
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

function compareByCreatedAt(left: { createdAt?: string }, right: { createdAt?: string }) {
  return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
}

function reconcileCurrentEffectiveDesignDefinitions(
  workspace: MorphoWorkspace
): Record<MorphoObjectId, MorphoObject> {
  const currentDefinitions = Object.values(workspace.objects)
    .filter(isDesignDefinitionObject)
    .filter((object) => object.isCurrentEffective);

  if (currentDefinitions.length <= 1) {
    return workspace.objects;
  }

  const [winner] = [...currentDefinitions].sort((left, right) => {
    const leftRevision = workspace.designDefinitionRevisions[left.currentRevisionId];
    const rightRevision = workspace.designDefinitionRevisions[right.currentRevisionId];
    const createdAtOrder = (rightRevision?.createdAt ?? "").localeCompare(leftRevision?.createdAt ?? "");
    return createdAtOrder !== 0 ? createdAtOrder : left.id.localeCompare(right.id);
  });
  const nextObjects = { ...workspace.objects };

  for (const definition of currentDefinitions) {
    if (definition.id === winner.id) {
      continue;
    }

    nextObjects[definition.id] = {
      ...definition,
      isCurrentEffective: false
    };
  }

  return nextObjects;
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
