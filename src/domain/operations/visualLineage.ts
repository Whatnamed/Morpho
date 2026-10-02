import type { MorphoWorkspace } from "../morpho/types";
import type { VisualIntentItem, VisualLineageSnapshot, VisualObjectSnapshot, VisualProviderInputManifest } from "./types";

export function snapshotVisualObject(workspace: MorphoWorkspace, objectId: string): VisualObjectSnapshot {
  const object = workspace.objects[objectId];
  return {
    objectId,
    title: object?.title ?? objectId,
    ...(object?.incarnationId ? { incarnationId: object.incarnationId } : {}),
    ...(object?.type === "image" && object.assetId ? { assetId: object.assetId } : {})
  };
}

const ROLES = ["identity", "structure", "cmf", "environment", "composition", "style", "unspecified"];
const OMISSIONS = ["providerLimit", "duplicate", "unavailable", "directionMismatch", "defaultExcluded", "taskScopeExcluded", "explicitExcluded", "missingPixels", "invalidPixels", "providerBytes"];
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 2000;
const objectSnapshot = (value: unknown): boolean => record(value) && text(value.objectId) && typeof value.title === "string" &&
  (value.incarnationId === undefined || text(value.incarnationId)) && (value.assetId === undefined || text(value.assetId));

export function isVisualLineageSnapshot(value: unknown): value is VisualLineageSnapshot {
  return record(value) && value.version === 1 && (value.identityParent === null || objectSnapshot(value.identityParent)) &&
    ["explicitTask", "singleTaskSource", "newIdentity"].includes(String(value.parentSource)) &&
    (value.identityParent === null ? value.parentSource === "newIdentity" : value.parentSource !== "newIdentity") &&
    (value.direction === null || objectSnapshot(value.direction)) &&
    ["explicitTask", "identityParent", "none"].includes(String(value.directionSource)) &&
    (value.direction === null ? value.directionSource === "none" : value.directionSource !== "none") &&
    ["explicitTask", "identityParent", "none"].includes(String(value.branchSource)) &&
    (value.branch === null ? value.branchSource === "none" : record(value.branch) && text(value.branch.id) && text(value.branch.directionId) &&
      typeof value.branch.label === "string" && (value.branch.rootObjectId === undefined || text(value.branch.rootObjectId)) &&
      record(value.direction) && value.direction.objectId === value.branch.directionId && value.branchSource !== "none") &&
    (value.directionSource !== "identityParent" && value.branchSource !== "identityParent" || value.identityParent !== null);
}

export function isVisualProviderInputManifest(value: unknown): value is VisualProviderInputManifest {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.references) || value.references.length > 4096) return false;
  const ids = new Set<string>();
  let index = 0;
  let parents = 0;
  return value.references.every((entry) => {
    if (!record(entry) || !objectSnapshot(entry.source) || !record(entry.source) || !text(entry.source.objectId) || ids.has(entry.source.objectId) ||
        !ROLES.includes(String(entry.role)) || typeof entry.required !== "boolean" || !["sent", "omitted"].includes(String(entry.status))) return false;
    ids.add(entry.source.objectId);
    if (entry.role === "identity" && (++parents > 1 || !entry.required)) return false;
    if (entry.status === "sent") return entry.omissionReason === undefined && text(entry.pixelHash) && text(entry.source.assetId) && entry.payloadIndex === index++;
    return OMISSIONS.includes(String(entry.omissionReason)) && entry.payloadIndex === undefined && entry.pixelHash === undefined;
  });
}

/** Only current task sources can resolve an unspecified parent; references never do. */
export function freezeVisualLineage(input: {
  workspace: MorphoWorkspace;
  intent: VisualIntentItem;
  kind: "directionPreview" | "visualDevelopment";
  sourceObjectIds: readonly string[];
}): VisualLineageSnapshot {
  const { workspace, intent } = input;
  const sourceImages = [...new Set(input.sourceObjectIds)].filter((id) => workspace.objects[id]?.type === "image");
  const parentId = intent.identityParentObjectId === undefined
    ? input.kind === "visualDevelopment" && sourceImages.length === 1 ? sourceImages[0] : undefined
    : intent.identityParentObjectId ?? undefined;
  if (intent.identityParentObjectId === undefined && input.kind === "visualDevelopment" && sourceImages.length > 1) {
    throw new Error("多个视觉来源需要明确 identity parent；新方案请明确设为 null。");
  }
  const parent = parentId ? workspace.objects[parentId] : undefined;
  if (parentId && (parent?.type !== "image" || parent.visibility !== "active")) {
    throw new Error("身份父图不可用。");
  }
  if (input.kind === "directionPreview" && parentId) throw new Error("方向预览不能隐式成为已有图的版本；请使用视觉继续发展。");
  const directionId = intent.targetDirectionId ?? (parent?.type === "image" ? parent.directionId : undefined);
  const direction = directionId ? workspace.objects[directionId] : undefined;
  if (directionId && (direction?.type !== "conceptDirection" || direction.visibility !== "active")) {
    throw new Error("视觉任务目标方向不可用。");
  }
  const inheritedBranchId = parent?.type === "image" && parent.directionId === directionId ? parent.visualBranchId : undefined;
  const branchId = intent.visualBranchId ?? inheritedBranchId;
  const branch = branchId ? workspace.visualBranches[branchId] : undefined;
  if (intent.visualBranchId && (!branch || branch.archivedAt || branch.directionId !== directionId)) {
    throw new Error("视觉任务显式分支不可用或与目标方向不一致。");
  }
  const usableBranch = branch && !branch.archivedAt && branch.directionId === directionId ? branch : undefined;
  return {
    version: 1,
    identityParent: parentId ? snapshotVisualObject(workspace, parentId) : null,
    parentSource: parentId ? intent.identityParentObjectId ? "explicitTask" : "singleTaskSource" : "newIdentity",
    direction: directionId ? snapshotVisualObject(workspace, directionId) : null,
    directionSource: directionId ? intent.targetDirectionId ? "explicitTask" : "identityParent" : "none",
    branch: usableBranch ? { id: usableBranch.id, directionId: usableBranch.directionId, label: usableBranch.label,
      ...(usableBranch.rootObjectId ? { rootObjectId: usableBranch.rootObjectId } : {}) } : null,
    branchSource: usableBranch ? intent.visualBranchId ? "explicitTask" : "identityParent" : "none"
  };
}
