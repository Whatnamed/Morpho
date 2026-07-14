import { GRS_REFERENCE_IMAGE_LIMIT } from "../morpho/imageLimits";
import type { ImageObject, MorphoWorkspace } from "../morpho/types";
import type {
  VisualIntentItem,
  VisualReferenceReason,
  VisualReferenceResolution
} from "./types";

type CandidateInput = {
  objectId: string;
  reason: VisualReferenceReason;
  priority: number;
};

export function resolveVisualReferences(input: {
  workspace: MorphoWorkspace;
  intent: VisualIntentItem;
  selectedSourceObjectIds: readonly string[];
  projectReferenceObjectIds?: readonly string[];
  providerLimit?: number;
}): VisualReferenceResolution {
  const providerLimit = Math.max(0, input.providerLimit ?? GRS_REFERENCE_IMAGE_LIMIT);
  const candidates: CandidateInput[] = [];
  const append = (objectIds: readonly string[], reason: VisualReferenceReason, priority: number) => {
    objectIds.forEach((objectId) => candidates.push({ objectId, reason, priority }));
  };

  append(input.intent.requestedReferenceObjectIds, "userExplicit", 1);
  append(input.selectedSourceObjectIds, "selectedSource", 2);

  const branch = input.intent.visualBranchId ? input.workspace.visualBranches[input.intent.visualBranchId] : undefined;
  if (branch?.rootObjectId) {
    append([branch.rootObjectId], "branchRoot", 3);
  }
  append(resolveDirectParentIds(input.workspace, input.selectedSourceObjectIds), "directParent", 3);

  const representative = resolveDirectionRepresentative(input.workspace, input.intent.targetDirectionId);
  if (representative) {
    append([representative.id], "directionRepresentative", 4);
  }

  const defaultReference = resolveDefaultReference(input.workspace);
  if (defaultReference) {
    append([defaultReference.id], "defaultReference", 5);
  }
  append(input.projectReferenceObjectIds ?? [], "projectReference", 6);

  const seen = new Set<string>();
  let includedCount = 0;
  const resolvedCandidates: VisualReferenceResolution["candidates"] = candidates
    .sort((left, right) => left.priority - right.priority)
    .map((candidate) => {
      const object = input.workspace.objects[candidate.objectId];
      if (!object || object.type !== "image" || object.visibility !== "active" || !object.assetId) {
        return { ...candidate, included: false, omissionReason: "unavailable" as const };
      }
      if (!isDirectionCompatible(object, input.intent.targetDirectionId)) {
        return { ...candidate, included: false, omissionReason: "directionMismatch" as const };
      }
      const isExplicitSelection = candidate.reason === "userExplicit" || candidate.reason === "selectedSource";
      if (
        input.intent.excludeDefaultReference &&
        defaultReference?.id === candidate.objectId &&
        !isExplicitSelection
      ) {
        return { ...candidate, included: false, omissionReason: "defaultExcluded" as const };
      }
      if (seen.has(candidate.objectId)) {
        return { ...candidate, included: false, omissionReason: "duplicate" as const };
      }
      seen.add(candidate.objectId);
      if (includedCount >= providerLimit) {
        return { ...candidate, included: false, omissionReason: "providerLimit" as const };
      }
      includedCount += 1;
      return { ...candidate, included: true };
    });

  return {
    resolvedObjectIds: resolvedCandidates.filter((candidate) => candidate.included).map((candidate) => candidate.objectId),
    candidates: resolvedCandidates,
    providerLimit,
    defaultReferenceExcluded: Boolean(input.intent.excludeDefaultReference)
  };
}

function resolveDirectParentIds(workspace: MorphoWorkspace, sourceObjectIds: readonly string[]): string[] {
  const result: string[] = [];
  for (const sourceObjectId of sourceObjectIds) {
    const object = workspace.objects[sourceObjectId];
    if (object?.type !== "image") {
      continue;
    }
    for (const referenceObjectId of object.generation?.referenceObjectIds ?? []) {
      if (!result.includes(referenceObjectId)) {
        result.push(referenceObjectId);
      }
    }
    for (const relation of workspace.relations) {
      if (relation.kind === "version" && relation.toObjectId === object.id && !result.includes(relation.fromObjectId)) {
        result.push(relation.fromObjectId);
      }
    }
  }
  return result;
}

function resolveDirectionRepresentative(workspace: MorphoWorkspace, directionId: string | undefined): ImageObject | undefined {
  if (!directionId) {
    return undefined;
  }
  return Object.values(workspace.objects)
    .filter(
      (object): object is ImageObject =>
        object.type === "image" &&
        object.visibility === "active" &&
        object.directionId === directionId &&
        Boolean(object.assetId)
    )
    .sort((left, right) => imageRepresentativeRank(left) - imageRepresentativeRank(right))[0];
}

function resolveDefaultReference(workspace: MorphoWorkspace): ImageObject | undefined {
  const objectId = workspace.workingState.currentDefaultReferenceId;
  const object = objectId ? workspace.objects[objectId] : undefined;
  return object?.type === "image" && object.visibility === "active" && object.assetId ? object : undefined;
}

function imageRepresentativeRank(image: ImageObject): number {
  if (image.isDefaultReference) {
    return 0;
  }
  switch (image.role) {
    case "primaryVisual":
      return 1;
    case "conceptImage":
    case "preview":
      return 2;
    default:
      return 3;
  }
}

function isDirectionCompatible(
  image: ImageObject,
  targetDirectionId: string | undefined
): boolean {
  if (!targetDirectionId || !image.directionId || image.directionId === targetDirectionId) {
    return true;
  }
  return false;
}
