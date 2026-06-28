import type { CanvasPoint, CanvasSize, MorphoWorkspace } from "../../domain/morpho/types";

export type DirectionPreviewPlacementInput = {
  id: string;
  targetDirectionId?: string;
  width: number;
  height: number;
};

export type DirectionPreviewPlacement = {
  planItemId: string;
  targetDirectionId?: string;
  position: CanvasPoint;
  size: CanvasSize;
};

const COLUMN_GAP = 28;
const ROW_GAP = 32;
const DIRECTION_OFFSET_Y = 80;
const DEFAULT_START = { x: 1520, y: 520 };

export function planDirectionPreviewPlacements(
  workspace: MorphoWorkspace,
  items: readonly DirectionPreviewPlacementInput[]
): DirectionPreviewPlacement[] {
  const groups = groupByDirection(items);
  const placements: DirectionPreviewPlacement[] = [];

  for (const [directionId, groupItems] of groups) {
    const anchor = getDirectionAnchor(workspace, directionId);
    const existingBottom = getExistingDirectionImagesBottom(workspace, directionId);
    const firstY = Math.max(anchor.y + anchor.h + DIRECTION_OFFSET_Y, existingBottom + ROW_GAP);
    const columns = groupItems.length <= 2 ? groupItems.length : 2;

    groupItems.forEach((item, index) => {
      const column = columns === 0 ? 0 : index % columns;
      const row = columns === 0 ? 0 : Math.floor(index / columns);
      placements.push({
        planItemId: item.id,
        targetDirectionId: item.targetDirectionId,
        size: { w: item.width, h: item.height },
        position: {
          x: anchor.x + column * (item.width + COLUMN_GAP),
          y: firstY + row * (item.height + ROW_GAP)
        }
      });
    });
  }

  return placements;
}

function groupByDirection(items: readonly DirectionPreviewPlacementInput[]): Map<string, DirectionPreviewPlacementInput[]> {
  const groups = new Map<string, DirectionPreviewPlacementInput[]>();
  for (const item of items) {
    const key = item.targetDirectionId ?? "__none__";
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function getDirectionAnchor(workspace: MorphoWorkspace, directionId: string): { x: number; y: number; w: number; h: number } {
  const instance = workspace.canvas.instances.find((candidate) => candidate.objectId === directionId);
  if (!instance) {
    return { ...DEFAULT_START, w: 260, h: 180 };
  }
  return {
    x: instance.position.x,
    y: instance.position.y,
    w: instance.size.w,
    h: instance.size.h
  };
}

function getExistingDirectionImagesBottom(workspace: MorphoWorkspace, directionId: string): number {
  const bottoms = workspace.canvas.instances
    .filter((instance) => {
      const object = workspace.objects[instance.objectId];
      return object?.type === "image" && object.directionId === directionId && object.visibility === "active";
    })
    .map((instance) => instance.position.y + instance.size.h);
  return bottoms.length > 0 ? Math.max(...bottoms) : Number.NEGATIVE_INFINITY;
}
