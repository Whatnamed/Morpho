import { GRS_REFERENCE_IMAGE_LIMIT } from "../morpho/imageLimits";
import type { ImageObject, MorphoWorkspace } from "../morpho/types";
import type {
  VisualIntentItem,
  VisualReferenceReason,
  VisualReferenceResolution
} from "./types";
import type { VisualReferenceRole } from "./types";

type CandidateInput = {
  objectId: string;
  reason: VisualReferenceReason;
  priority: number;
  role: VisualReferenceRole;
  required: boolean;
};

export function resolveVisualReferences(input: {
  workspace: MorphoWorkspace;
  intent: VisualIntentItem;
  selectedSourceObjectIds: readonly string[];
  projectReferenceObjectIds?: readonly string[];
  providerLimit?: number;
  allowedReferenceObjectIds?: readonly string[];
  excludedReferenceObjectIds?: readonly string[];
}): VisualReferenceResolution {
  const providerLimit = Math.max(0, input.providerLimit ?? GRS_REFERENCE_IMAGE_LIMIT);
  const candidates: CandidateInput[] = [];
  const parentId = input.intent.identityParentObjectId;
  const bindings = new Map((input.intent.referenceBindings ?? []).map((binding) => [binding.objectId, binding]));
  const append = (objectIds: readonly string[], reason: VisualReferenceReason, priority: number) => {
    objectIds.forEach((objectId) => {
      const binding = bindings.get(objectId);
      candidates.push({ objectId, reason, priority,
        role: objectId === parentId ? "identity" : binding?.role ?? "unspecified",
        required: objectId === parentId || Boolean(binding?.required) });
    });
  };

  if (parentId) append([parentId], "identityParent", 0);
  append([...bindings.keys()], "roleBinding", 1);
  append(input.intent.requestedReferenceObjectIds, "userExplicit", 1);
  append(input.selectedSourceObjectIds, "selectedSource", 2);

  const branch = input.intent.visualBranchId ? input.workspace.visualBranches[input.intent.visualBranchId] : undefined;
  if (branch?.rootObjectId) {
    append([branch.rootObjectId], "branchRoot", 3);
  }

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
  const excluded = new Set([...(input.intent.excludedReferenceObjectIds ?? []), ...(input.excludedReferenceObjectIds ?? [])]);
  append([...excluded], "userExplicit", 1);
  const resolvedCandidates: VisualReferenceResolution["candidates"] = candidates
    .sort((left, right) => Number(right.required) - Number(left.required) || left.priority - right.priority)
    .map((candidate) => {
      if (excluded.has(candidate.objectId)) {
        return { ...candidate, included: false, omissionReason: "explicitExcluded" as const };
      }
      if (input.allowedReferenceObjectIds && !input.allowedReferenceObjectIds.includes(candidate.objectId)) {
        return { ...candidate, included: false, omissionReason: "taskScopeExcluded" as const };
      }
      const object = input.workspace.objects[candidate.objectId];
      if (!object || object.type !== "image" || object.visibility !== "active" || !object.assetId) {
        return { ...candidate, included: false, omissionReason: "unavailable" as const };
      }
      const isExplicitSelection = candidate.reason === "userExplicit" || candidate.reason === "selectedSource" || candidate.reason === "identityParent" || candidate.reason === "roleBinding";
      if (
        input.intent.excludeDefaultReference &&
        defaultReference?.id === candidate.objectId &&
        !isExplicitSelection
      ) {
        return { ...candidate, included: false, omissionReason: "defaultExcluded" as const };
      }
      const crossDirection = Boolean(
        input.intent.targetDirectionId && object.directionId && object.directionId !== input.intent.targetDirectionId
      );
      const directionMetadata = {
        ...(object.directionId ? { sourceDirectionId: object.directionId } : {}),
        ...(input.intent.targetDirectionId ? { targetDirectionId: input.intent.targetDirectionId } : {}),
        ...(crossDirection ? { crossDirection: true } : {})
      };
      if (crossDirection && !isStrongCrossDirectionReference(candidate.reason)) {
        return { ...candidate, ...directionMetadata, included: false, omissionReason: "directionMismatch" as const };
      }
      if (seen.has(candidate.objectId)) {
        return { ...candidate, ...directionMetadata, included: false, omissionReason: "duplicate" as const };
      }
      seen.add(candidate.objectId);
      if (includedCount >= providerLimit) {
        return { ...candidate, ...directionMetadata, included: false, omissionReason: "providerLimit" as const };
      }
      includedCount += 1;
      return {
        ...candidate,
        ...directionMetadata,
        ...(crossDirection ? { retentionReason: crossDirectionRetentionReason(candidate.reason) } : {}),
        included: true
      };
    });

  return {
    resolvedObjectIds: resolvedCandidates.filter((candidate) => candidate.included).map((candidate) => candidate.objectId),
    candidates: resolvedCandidates,
    providerLimit,
    defaultReferenceExcluded: Boolean(input.intent.excludeDefaultReference)
  };
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

function isStrongCrossDirectionReference(reason: VisualReferenceReason): boolean {
  return reason === "identityParent" || reason === "roleBinding" || reason === "userExplicit" || reason === "selectedSource" || reason === "branchRoot" || reason === "defaultReference";
}

function crossDirectionRetentionReason(reason: VisualReferenceReason): string {
  switch (reason) {
    case "userExplicit":
      return "用户明确指定，保留跨方向参考。";
    case "selectedSource":
      return "用户当前选择，保留跨方向参考。";
    case "branchRoot":
      return "当前视觉分支根图，保留作为分支连续性参考。";
    case "directParent":
      return "来源图的直接父图，保留作为版本连续性参考。";
    case "defaultReference":
      return "当前后续默认参考，保留作为项目一致性基线。";
    default:
      return "保留用户可追溯的强关系参考。";
  }
}
