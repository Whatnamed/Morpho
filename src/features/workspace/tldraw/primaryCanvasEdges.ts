import type { MorphoObjectId, MorphoWorkspace } from "@/domain/morpho/types";
import { collectDirectCanvasEdges, type DirectCanvasEdge } from "./canvasRelationships";

export type PrimaryCanvasEdge = DirectCanvasEdge & { primary: true };

const FIRST_PREVIEW_ROLES = new Set(["preview", "conceptImage", "primaryVisual"]);

/**
 * Stable edge key used by overlay and trace highlighting.
 */
export function canvasEdgeKey(fromObjectId: string, toObjectId: string): string {
  return `${fromObjectId}|${toObjectId}`;
}

/**
 * First-batch direction preview: direction-owned image with preview/concept role,
 * no image parent via generation references, stable sort by createdAt then id.
 * At most one root preview edge per direction for the permanent overlay.
 */
export function selectFirstBatchDirectionPreviewIds(
  workspace: MorphoWorkspace,
  directionId: MorphoObjectId
): MorphoObjectId[] {
  const candidates = Object.values(workspace.objects).filter((object) => {
    if (object.type !== "image" || object.visibility !== "active") {
      return false;
    }
    if (object.directionId !== directionId) {
      return false;
    }
    if (!FIRST_PREVIEW_ROLES.has(object.role)) {
      return false;
    }
    const refs = object.generation?.referenceObjectIds ?? [];
    const hasImageParent = refs.some((refId) => workspace.objects[refId]?.type === "image");
    return !hasImageParent;
  });

  candidates.sort((a, b) => {
    const aTime = a.createdAt ?? "";
    const bTime = b.createdAt ?? "";
    if (aTime !== bTime) {
      return aTime.localeCompare(bTime);
    }
    return a.id.localeCompare(b.id);
  });

  if (candidates.length === 0) {
    return [];
  }
  // Conservative: one root preview per direction for permanent overlay density.
  return [candidates[0].id];
}

/**
 * Project the full direct-edge aggregate down to the five permanent primary families.
 * Keeps collectDirectCanvasEdges intact for other consumers.
 */
export function selectPrimaryCanvasEdges(
  workspace: MorphoWorkspace,
  allEdges: DirectCanvasEdge[] = collectDirectCanvasEdges(workspace)
): PrimaryCanvasEdge[] {
  const currentDefinitionId = workspace.workingState.currentDesignDefinitionId;
  const firstPreviewByDirection = new Map<MorphoObjectId, Set<MorphoObjectId>>();

  for (const object of Object.values(workspace.objects)) {
    if (object.type !== "conceptDirection" || object.visibility !== "active") {
      continue;
    }
    firstPreviewByDirection.set(object.id, new Set(selectFirstBatchDirectionPreviewIds(workspace, object.id)));
  }

  const selected: PrimaryCanvasEdge[] = [];

  for (const edge of allEdges) {
    if (!isPrimaryCanvasEdge(workspace, edge, currentDefinitionId, firstPreviewByDirection)) {
      continue;
    }
    selected.push({ ...edge, primary: true });
  }

  return selected;
}

function isPrimaryCanvasEdge(
  workspace: MorphoWorkspace,
  edge: DirectCanvasEdge,
  currentDefinitionId: MorphoObjectId | undefined,
  firstPreviewByDirection: Map<MorphoObjectId, Set<MorphoObjectId>>
): boolean {
  const from = workspace.objects[edge.fromObjectId];
  const to = workspace.objects[edge.toObjectId];
  if (!from || !to) {
    return false;
  }

  // 5. Direct parent version -> direct child version
  if (edge.relationKind === "version") {
    return true;
  }

  // 4. Source image -> directly derived image (primary generation reference only)
  if (edge.relationKind === "generationReference" && edge.primary && from.type === "image" && to.type === "image") {
    return true;
  }

  // 1. Research or key conclusion -> current design definition
  if (
    currentDefinitionId &&
    edge.toObjectId === currentDefinitionId &&
    (from.type === "research" || from.type === "keyConclusion") &&
    (edge.relationKind === "definitionRevisionSource" ||
      edge.relationKind === "supports" ||
      edge.relationKind === "supportsConclusion" ||
      edge.relationKind === "source")
  ) {
    return true;
  }

  // 2. Current design definition -> concept direction
  if (
    currentDefinitionId &&
    edge.fromObjectId === currentDefinitionId &&
    to.type === "conceptDirection" &&
    (edge.relationKind === "definitionBase" || edge.relationKind === "belongsToDirection")
  ) {
    return true;
  }

  // 3. Concept direction -> first-batch direction preview
  if (from.type === "conceptDirection" && to.type === "image" && edge.relationKind === "directionOwnership") {
    const previews = firstPreviewByDirection.get(from.id);
    return Boolean(previews?.has(to.id));
  }

  return false;
}

export function collectPrimaryCanvasEdges(workspace: MorphoWorkspace): PrimaryCanvasEdge[] {
  return selectPrimaryCanvasEdges(workspace);
}
