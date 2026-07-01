import type { MorphoObject, MorphoObjectId, MorphoWorkspace } from "../../domain/morpho/types";

export type ComparisonActionKind =
  | "setPrimary"
  | "setAlternative"
  | "eliminate"
  | "restoreAlternative"
  | "setDefaultReference"
  | "clearDefaultReference"
  | "createKeyConclusion";

export type ComparisonActionValidationResult =
  | {
      status: "ok";
      targetObject?: MorphoObject;
      targetObjectId?: MorphoObjectId;
    }
  | { status: "blocked"; reason: string };

export function validateComparisonActionTarget(
  workspace: MorphoWorkspace,
  analysisId: string,
  action: ComparisonActionKind,
  objectId?: MorphoObjectId
): ComparisonActionValidationResult {
  const analysis = workspace.ai.comparisonAnalyses?.[analysisId];
  if (!analysis) {
    return { status: "blocked", reason: "Comparison analysis no longer exists." };
  }

  if (action === "createKeyConclusion") {
    return analysis.keyConclusionCandidate
      ? { status: "ok" }
      : { status: "blocked", reason: "Comparison analysis has no key conclusion candidate." };
  }

  if (!objectId || !analysis.sourceObjectIds.includes(objectId)) {
    return { status: "blocked", reason: "Comparison action target must belong to the saved Compare sources." };
  }

  const targetObject = workspace.objects[objectId];
  if (!targetObject) {
    return { status: "blocked", reason: "Comparison action target no longer exists." };
  }
  if (targetObject.visibility !== "active") {
    return { status: "blocked", reason: "Comparison action target must still be active." };
  }

  if (action === "setPrimary" || action === "setAlternative") {
    if (targetObject.type !== "conceptDirection" || targetObject.status === "eliminated") {
      return { status: "blocked", reason: "Only non-eliminated concept directions can be promoted from Compare." };
    }
    return { status: "ok", targetObject, targetObjectId: objectId };
  }

  if (action === "eliminate") {
    if (targetObject.type !== "conceptDirection" || targetObject.status === "eliminated") {
      return { status: "blocked", reason: "Only non-eliminated concept directions can be eliminated from Compare." };
    }
    return { status: "ok", targetObject, targetObjectId: objectId };
  }

  if (action === "restoreAlternative") {
    if (targetObject.type !== "conceptDirection" || targetObject.status !== "eliminated") {
      return { status: "blocked", reason: "Only eliminated concept directions can be restored from Compare." };
    }
    return { status: "ok", targetObject, targetObjectId: objectId };
  }

  if (action === "setDefaultReference") {
    if (targetObject.type !== "image" || targetObject.isDefaultReference === true) {
      return { status: "blocked", reason: "Only active non-default images can become default references from Compare." };
    }
    return { status: "ok", targetObject, targetObjectId: objectId };
  }

  if (action === "clearDefaultReference") {
    if (targetObject.type !== "image" || targetObject.isDefaultReference !== true) {
      return { status: "blocked", reason: "Only the current default image can clear default reference from Compare." };
    }
    return { status: "ok", targetObject, targetObjectId: objectId };
  }

  return { status: "blocked", reason: "Unsupported Compare action." };
}

export function validateComparisonKeyConclusionSources(
  workspace: MorphoWorkspace,
  analysisId: string,
  sourceObjectIds: MorphoObjectId[]
): ComparisonActionValidationResult {
  const analysis = workspace.ai.comparisonAnalyses?.[analysisId];
  const candidateIds = analysis?.keyConclusionCandidate?.sourceObjectIds;
  if (!candidateIds) {
    return { status: "blocked", reason: "Comparison analysis has no key conclusion candidate." };
  }
  if (!sameIdSet(candidateIds, sourceObjectIds)) {
    return { status: "blocked", reason: "Key conclusion sources must match the saved Compare candidate." };
  }
  return { status: "ok" };
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
