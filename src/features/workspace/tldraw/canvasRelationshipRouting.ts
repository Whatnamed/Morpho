export type CanvasPageBounds = { x: number; y: number; w: number; h: number };
export type CanvasPoint = { x: number; y: number };
export type RelationshipRoute = { start: CanvasPoint; end: CanvasPoint; waypoints: CanvasPoint[] };

type Port = { index: number; count: number };

type BuildRelationshipRouteInput = {
  source: CanvasPageBounds;
  target: CanvasPageBounds;
  obstacles: CanvasPageBounds[];
  // Retained for callers while direct Morpho relationships converge on one
  // anchor per object side instead of allocating one port per edge.
  sourcePort?: Port;
  targetPort?: Port;
};

const ENDPOINT_GAP = 6;
export const RELATIONSHIP_EXIT_DISTANCE = 42;
const RELATIONSHIP_RETURN_DISTANCE = 34;
const RELATIONSHIP_CORNER_RADIUS = 12;

export function buildRelationshipRoute({
  source,
  target,
  obstacles: _obstacles
}: BuildRelationshipRouteInput): RelationshipRoute {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const start = edgePoint(source, "right");
  const end = edgePoint(target, "left");
  const exit = { x: start.x + RELATIONSHIP_EXIT_DISTANCE, y: start.y };

  if (targetCenter.x >= sourceCenter.x) {
    return {
      start,
      end,
      waypoints: [exit, { x: exit.x, y: end.y }]
    };
  }

  // A target on the left still exits right first. It then returns around both
  // cards before entering the target's left side, which keeps the gesture
  // legible and avoids abrupt vertical turns at the source edge.
  const routeY =
    targetCenter.y >= sourceCenter.y
      ? Math.max(source.y + source.h, target.y + target.h) + RELATIONSHIP_RETURN_DISTANCE
      : Math.min(source.y, target.y) - RELATIONSHIP_RETURN_DISTANCE;
  const returnX = Math.min(source.x, target.x) - RELATIONSHIP_RETURN_DISTANCE;
  return {
    start,
    end,
    waypoints: [
      exit,
      { x: exit.x, y: routeY },
      { x: returnX, y: routeY },
      { x: returnX, y: end.y }
    ]
  };
}

export function buildFastRelationshipRoute(input: Omit<BuildRelationshipRouteInput, "obstacles">): RelationshipRoute {
  return buildRelationshipRoute({ ...input, obstacles: [] });
}

export function buildRelationshipPath(route: RelationshipRoute): string {
  const points = removeDuplicateAndCollinearPoints([route.start, ...route.waypoints, route.end]);
  if (points.length <= 1) {
    return "";
  }

  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const radius = Math.min(
      RELATIONSHIP_CORNER_RADIUS,
      distance(previous, corner) / 2,
      distance(corner, next) / 2
    );
    const entry = moveToward(corner, previous, radius);
    const exit = moveToward(corner, next, radius);
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y}, ${exit.x} ${exit.y}`;
  }

  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
}

export function createRelationshipRouteCache() {
  const routeByEdge = new Map<string, RelationshipRoute>();
  const edgeKeysByEndpoint = new Map<string, Set<string>>();

  const addEdgeKey = (index: Map<string, Set<string>>, objectId: string, edgeKey: string) => {
    const keys = index.get(objectId) ?? new Set<string>();
    keys.add(edgeKey);
    index.set(objectId, keys);
  };

  const removeEdgeKey = (edgeKey: string) => {
    routeByEdge.delete(edgeKey);
    for (const [objectId, keys] of edgeKeysByEndpoint) {
      keys.delete(edgeKey);
      if (keys.size === 0) edgeKeysByEndpoint.delete(objectId);
    }
  };

  return {
    get(edgeKey: string): RelationshipRoute | undefined {
      return routeByEdge.get(edgeKey);
    },
    set(edgeKey: string, route: RelationshipRoute, endpointObjectIds: string[]): void {
      removeEdgeKey(edgeKey);
      routeByEdge.set(edgeKey, route);
      endpointObjectIds.forEach((objectId) => addEdgeKey(edgeKeysByEndpoint, objectId, edgeKey));
    },
    invalidateConnectedObject(objectId: string): void {
      [...(edgeKeysByEndpoint.get(objectId) ?? [])].forEach(removeEdgeKey);
    },
    clear(): void {
      routeByEdge.clear();
      edgeKeysByEndpoint.clear();
    }
  };
}

function edgePoint(bounds: CanvasPageBounds, side: "left" | "right" | "top" | "bottom"): CanvasPoint {
  if (side === "left") return { x: bounds.x - ENDPOINT_GAP, y: bounds.y + bounds.h / 2 };
  if (side === "right") return { x: bounds.x + bounds.w + ENDPOINT_GAP, y: bounds.y + bounds.h / 2 };
  if (side === "top") return { x: bounds.x + bounds.w / 2, y: bounds.y - ENDPOINT_GAP };
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h + ENDPOINT_GAP };
}

function centerOf(bounds: CanvasPageBounds): CanvasPoint {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

function removeDuplicateAndCollinearPoints(points: CanvasPoint[]): CanvasPoint[] {
  return points.reduce<CanvasPoint[]>((result, point) => {
    const previous = result.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) {
      return result;
    }
    const beforePrevious = result.at(-2);
    if (
      beforePrevious &&
      previous &&
      ((beforePrevious.x === previous.x && previous.x === point.x) ||
        (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      result[result.length - 1] = point;
      return result;
    }
    result.push(point);
    return result;
  }, []);
}

function distance(left: CanvasPoint, right: CanvasPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function moveToward(from: CanvasPoint, toward: CanvasPoint, amount: number): CanvasPoint {
  const distanceToTarget = distance(from, toward);
  if (distanceToTarget === 0) {
    return { ...from };
  }
  return {
    x: from.x + ((toward.x - from.x) / distanceToTarget) * amount,
    y: from.y + ((toward.y - from.y) / distanceToTarget) * amount
  };
}
