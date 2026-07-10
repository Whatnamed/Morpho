import type { CanvasPoint, CanvasSize, MorphoWorkspace } from "./types";

export type CanvasPlacementRect = {
  position: CanvasPoint;
  size: CanvasSize;
};

export type FindAvailableCanvasPositionInput = {
  preferred: CanvasPoint;
  size: CanvasSize;
  gap?: number;
  flow?: "vertical" | "nearest";
  reserved?: readonly CanvasPlacementRect[];
  ignoreObjectIds?: readonly string[];
};

const DEFAULT_GAP = 32;
const MAX_PLACEMENT_STEPS = 200;

export function findAvailableCanvasPosition(
  workspace: MorphoWorkspace,
  input: FindAvailableCanvasPositionInput
): CanvasPoint {
  const gap = input.gap ?? DEFAULT_GAP;
  const ignoredObjectIds = new Set(input.ignoreObjectIds ?? []);
  const obstacles: CanvasPlacementRect[] = [
    ...workspace.canvas.instances
      .filter((instance) => {
        if (ignoredObjectIds.has(instance.objectId)) {
          return false;
        }
        return workspace.objects[instance.objectId]?.visibility !== "hidden";
      })
      .map((instance) => ({
        position: instance.position,
        size: instance.size
      })),
    ...(input.reserved ?? [])
  ];
  if (input.flow === "nearest") {
    return findNearestAvailablePosition(input.preferred, input.size, obstacles, gap);
  }
  let candidate = { ...input.preferred };

  for (let step = 0; step < MAX_PLACEMENT_STEPS; step += 1) {
    const collisions = obstacles.filter((obstacle) =>
      rectanglesOverlapWithGap(
        {
          position: candidate,
          size: input.size
        },
        obstacle,
        gap
      )
    );
    if (collisions.length === 0) {
      return candidate;
    }

    candidate = {
      x: input.preferred.x,
      y: Math.max(...collisions.map((collision) => collision.position.y + collision.size.h + gap))
    };
  }

  return candidate;
}

function findNearestAvailablePosition(
  preferred: CanvasPoint,
  size: CanvasSize,
  obstacles: readonly CanvasPlacementRect[],
  gap: number
): CanvasPoint {
  const xCandidates = uniqueSortedNumbers([
    preferred.x,
    ...obstacles.map((obstacle) => obstacle.position.x + obstacle.size.w + gap)
  ]).filter((x) => x >= preferred.x);
  const yCandidates = uniqueSortedNumbers([
    preferred.y,
    ...obstacles.map((obstacle) => obstacle.position.y + obstacle.size.h + gap)
  ]).filter((y) => y >= preferred.y);
  let best: CanvasPoint | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestHorizontalShift = Number.POSITIVE_INFINITY;

  for (const y of yCandidates) {
    for (const x of xCandidates) {
      const candidate = { x, y };
      const rect = { position: candidate, size };
      if (obstacles.some((obstacle) => rectanglesOverlapWithGap(rect, obstacle, gap))) {
        continue;
      }

      const horizontalShift = x - preferred.x;
      const score = horizontalShift + (y - preferred.y);
      if (score < bestScore || (score === bestScore && horizontalShift < bestHorizontalShift)) {
        best = candidate;
        bestScore = score;
        bestHorizontalShift = horizontalShift;
      }
    }
  }

  return best ?? preferred;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function rectanglesOverlapWithGap(
  left: CanvasPlacementRect,
  right: CanvasPlacementRect,
  gap: number
): boolean {
  return !(
    left.position.x + left.size.w + gap <= right.position.x ||
    right.position.x + right.size.w + gap <= left.position.x ||
    left.position.y + left.size.h + gap <= right.position.y ||
    right.position.y + right.size.h + gap <= left.position.y
  );
}
