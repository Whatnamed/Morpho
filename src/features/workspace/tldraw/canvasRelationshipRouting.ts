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

export function buildRelationshipRoute({
  source,
  target,
  obstacles: _obstacles
}: BuildRelationshipRouteInput): RelationshipRoute {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(target);
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const start = horizontal
    ? edgePoint(source, targetCenter.x >= sourceCenter.x ? "right" : "left")
    : edgePoint(source, targetCenter.y >= sourceCenter.y ? "bottom" : "top");
  const end = horizontal
    ? edgePoint(target, targetCenter.x >= sourceCenter.x ? "left" : "right")
    : edgePoint(target, targetCenter.y >= sourceCenter.y ? "top" : "bottom");
  return { start, end, waypoints: [] };
}

export function buildFastRelationshipRoute(input: Omit<BuildRelationshipRouteInput, "obstacles">): RelationshipRoute {
  return buildRelationshipRoute({ ...input, obstacles: [] });
}

export function buildRelationshipPath(route: RelationshipRoute): string {
  const points = [route.start, ...route.waypoints, route.end];
  if (points.length === 2) {
    const [start, end] = points;
    const controlDistance = Math.max(28, Math.abs(end.x - start.x) * 0.34, Math.abs(end.y - start.y) * 0.34);
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const firstControl = horizontal ? { x: start.x + Math.sign(end.x - start.x) * controlDistance, y: start.y } : { x: start.x, y: start.y + Math.sign(end.y - start.y) * controlDistance };
    const secondControl = horizontal ? { x: end.x - Math.sign(end.x - start.x) * controlDistance, y: end.y } : { x: end.x, y: end.y - Math.sign(end.y - start.y) * controlDistance };
    return `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
  }

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
    return `${path} Q ${previous.x} ${previous.y}, ${midpoint.x} ${midpoint.y}`;
  }, `M ${points[0].x} ${points[0].y}`) + ` T ${points.at(-1)!.x} ${points.at(-1)!.y}`;
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
