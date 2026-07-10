import type { CanvasPoint, CanvasSize, MorphoWorkspace } from "../../domain/morpho/types";
import {
  findAvailableCanvasPosition,
  type CanvasPlacementRect
} from "../../domain/morpho/canvasPlacement";

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

export type VisualDevelopmentPlacementInput = {
  id: string;
  referenceObjectIds: readonly string[];
  targetDirectionId?: string;
  width: number;
  height: number;
};

const COLUMN_GAP = 28;
const ROW_GAP = 32;
const DIRECTION_OFFSET_X = 92;
const DEFAULT_START = { x: 1520, y: 520 };

export function planDirectionPreviewPlacements(
  workspace: MorphoWorkspace,
  items: readonly DirectionPreviewPlacementInput[]
): DirectionPreviewPlacement[] {
  const groups = [...groupByDirection(items)].sort(
    ([leftDirectionId], [rightDirectionId]) =>
      getDirectionAnchor(workspace, leftDirectionId).y - getDirectionAnchor(workspace, rightDirectionId).y
  );
  const placements: DirectionPreviewPlacement[] = [];
  const reserved: CanvasPlacementRect[] = [];
  const sharedDirectionRight = Math.max(
    ...groups.map(([directionId]) => {
      const anchor = getDirectionAnchor(workspace, directionId);
      return anchor.x + anchor.w;
    })
  );

  for (const [directionId, groupItems] of groups) {
    const anchor = getDirectionAnchor(workspace, directionId);
    const columns = groupItems.length <= 2 ? groupItems.length : 2;
    const rows = Math.ceil(groupItems.length / Math.max(columns, 1));
    const maxWidth = Math.max(...groupItems.map((item) => item.width));
    const maxHeight = Math.max(...groupItems.map((item) => item.height));
    const blockSize = {
      w: columns * maxWidth + Math.max(0, columns - 1) * COLUMN_GAP,
      h: rows * maxHeight + Math.max(0, rows - 1) * ROW_GAP
    };
    const groupPosition = findAvailableCanvasPosition(workspace, {
      preferred: {
        x: sharedDirectionRight + DIRECTION_OFFSET_X,
        y: anchor.y
      },
      size: blockSize,
      gap: ROW_GAP,
      reserved
    });

    groupItems.forEach((item, index) => {
      const column = columns === 0 ? 0 : index % columns;
      const row = columns === 0 ? 0 : Math.floor(index / columns);
      const placement = {
        planItemId: item.id,
        targetDirectionId: item.targetDirectionId,
        size: { w: item.width, h: item.height },
        position: {
          x: groupPosition.x + column * (maxWidth + COLUMN_GAP),
          y: groupPosition.y + row * (maxHeight + ROW_GAP)
        }
      };
      placements.push(placement);
      reserved.push({
        position: placement.position,
        size: placement.size
      });
    });
  }

  return placements;
}

export function planVisualDevelopmentPlacements(
  workspace: MorphoWorkspace,
  items: readonly VisualDevelopmentPlacementInput[]
): DirectionPreviewPlacement[] {
  const placements: DirectionPreviewPlacement[] = [];
  const reserved: CanvasPlacementRect[] = [];
  const nextPreferredByAnchor = new Map<string, CanvasPoint>();

  for (const item of items) {
    const sourceImage = item.referenceObjectIds
      .map((objectId) => ({
        objectId,
        object: workspace.objects[objectId],
        instance: workspace.canvas.instances.find((candidate) => candidate.objectId === objectId)
      }))
      .find(({ object, instance }) => object?.type === "image" && object.visibility === "active" && Boolean(instance));
    const directionInstance = item.targetDirectionId
      ? workspace.canvas.instances.find((candidate) => candidate.objectId === item.targetDirectionId)
      : undefined;
    const anchor = sourceImage?.instance ?? directionInstance;
    const anchorKey = sourceImage?.objectId ?? item.targetDirectionId ?? "__default__";
    const preferred = nextPreferredByAnchor.get(anchorKey) ?? (anchor
      ? {
          x: anchor.position.x + anchor.size.w + DIRECTION_OFFSET_X,
          y: anchor.position.y
        }
      : DEFAULT_START);
    const size = { w: item.width, h: item.height };
    const position = findAvailableCanvasPosition(workspace, {
      preferred,
      size,
      gap: ROW_GAP,
      flow: "nearest",
      reserved
    });
    const placement = {
      planItemId: item.id,
      targetDirectionId: item.targetDirectionId,
      position,
      size
    };
    placements.push(placement);
    reserved.push({ position, size });
    nextPreferredByAnchor.set(anchorKey, {
      x: position.x + size.w + ROW_GAP,
      y: position.y
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
