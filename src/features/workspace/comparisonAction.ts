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
  const candidate = analysis?.keyConclusionCandidate;
  const candidateIds = candidate?.sourceObjectIds;
  if (!analysis || !candidateIds || !candidate) {
    return { status: "blocked", reason: "Comparison analysis has no key conclusion candidate." };
  }
  if (candidateIds.length === 0 || candidateIds.length !== new Set(candidateIds).size) {
    return { status: "blocked", reason: "Key conclusion candidate must have non-empty unique sources." };
  }
  if (!sameIdSet(candidateIds, sourceObjectIds)) {
    return { status: "blocked", reason: "Key conclusion sources must match the saved Compare candidate." };
  }
  if (!candidateIds.every((objectId) => analysis.sourceObjectIds.includes(objectId))) {
    return { status: "blocked", reason: "Key conclusion candidate sources must belong to the saved Compare sources." };
  }
  if (!candidateIds.every((objectId) => isCurrentTextEvidenceSource(workspace, objectId))) {
    return { status: "blocked", reason: "Key conclusion candidate sources must still be research, key conclusions, or parsed files." };
  }
  if (candidate.evidence.length === 0 || candidate.evidence.some((entry) => entry.evidence.trim().length === 0)) {
    return { status: "blocked", reason: "Key conclusion candidate requires explicit text evidence." };
  }
  if (!sameIdSet(candidateIds, candidate.evidence.map((entry) => entry.objectId))) {
    return { status: "blocked", reason: "Key conclusion candidate evidence must match its source objects." };
  }
  return { status: "ok" };
}

function isCurrentTextEvidenceSource(workspace: MorphoWorkspace, objectId: MorphoObjectId): boolean {
  const object = workspace.objects[objectId];
  if (!object) {
    return false;
  }
  if (object.type === "research" || object.type === "keyConclusion") {
    return true;
  }
  return (
    object.type === "file" &&
    object.parseStatus === "parsed" &&
    typeof object.extractedAssetId === "string" &&
    workspace.assets[object.extractedAssetId]?.sourceType === "documentExtract"
  );
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
