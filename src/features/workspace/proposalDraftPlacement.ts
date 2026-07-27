import type { CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";

const PROPOSAL_DRAFT_HEIGHT = 168;
const SIBLING_PROPOSAL_GAP = 32;

export function getSiblingProposalPlacement(
  origin: { x: number; y: number },
  siblingIndex: number
): { x: number; y: number } {
  return {
    x: origin.x,
    y: origin.y + siblingIndex * (PROPOSAL_DRAFT_HEIGHT + SIBLING_PROPOSAL_GAP)
  };
}

export function getPlacementNearObjects(
  workspace: MorphoWorkspace,
  sourceObjectIds: string[],
  fallback: { x: number; y: number }
): { x: number; y: number } {
  const sourceInstances = sourceObjectIds
    .map((objectId) => workspace.canvas.instances.find((instance) => instance.objectId === objectId))
    .filter((instance): instance is CanvasInstance => Boolean(instance));

  if (sourceInstances.length === 0) {
    return fallback;
  }

  const right = Math.max(...sourceInstances.map((instance) => instance.position.x + instance.size.w));
  const top = Math.min(...sourceInstances.map((instance) => instance.position.y));
  return {
    x: right + 92,
    y: top
  };
}

export function getProposalPlacement(
  workspace: MorphoWorkspace,
  sourceObjectIds: string[],
  kind: "definition" | "direction"
): { x: number; y: number } {
  const fallback =
    kind === "definition"
      ? {
          x: workspace.canvas.view.x + 280,
          y: workspace.canvas.view.y + 180
        }
      : {
          x: workspace.canvas.view.x + 420,
          y: workspace.canvas.view.y + 220
        };

  return getPlacementNearObjects(workspace, sourceObjectIds, fallback);
}
