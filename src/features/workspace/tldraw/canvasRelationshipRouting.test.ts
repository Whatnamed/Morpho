import { describe, expect, it } from "vitest";

import {
  RELATIONSHIP_EXIT_DISTANCE,
  buildFastRelationshipRoute,
  buildRelationshipPath,
  buildRelationshipRoute,
  createRelationshipRouteCache,
  type CanvasPageBounds
} from "./canvasRelationshipRouting";

const source: CanvasPageBounds = { x: 0, y: 80, w: 120, h: 80 };
const target: CanvasPageBounds = { x: 420, y: 80, w: 120, h: 80 };

describe("buildRelationshipRoute", () => {
  it.each([
    ["right upper", { ...target, y: 20 }],
    ["right lower", { ...target, y: 220 }],
    ["very close right", { x: 145, y: 220, w: 120, h: 80 }]
  ])("routes %s with a right-first lead before turning", (_label, routeTarget) => {
    const route = buildRelationshipRoute({ source, target: routeTarget, obstacles: [] });

    expect(route.start).toMatchObject({ x: 126, y: 120 });
    expect(route.end).toMatchObject({ x: routeTarget.x - 6, y: routeTarget.y + routeTarget.h / 2 });
    expect(route.waypoints[0]).toEqual({ x: 126 + RELATIONSHIP_EXIT_DISTANCE, y: 120 });
    expect(route.waypoints[1]).toEqual({ x: 126 + RELATIONSHIP_EXIT_DISTANCE, y: route.end.y });
  });

  it("keeps the stable route independent of unrelated obstacles", () => {
    const route = buildRelationshipRoute({
      source,
      target,
      obstacles: [{ x: 220, y: 70, w: 110, h: 120 }]
    });

    expect(route.waypoints).toHaveLength(2);
  });

  it("uses one shared edge anchor when several relationships leave the same side", () => {
    const upperTarget = { ...target, y: 20 };
    const lowerTarget = { ...target, y: 220 };
    const upper = buildRelationshipRoute({ source, target: upperTarget, obstacles: [], sourcePort: { index: 0, count: 3 } });
    const center = buildRelationshipRoute({ source, target, obstacles: [], sourcePort: { index: 1, count: 3 } });
    const lower = buildRelationshipRoute({ source, target: lowerTarget, obstacles: [], sourcePort: { index: 2, count: 3 } });

    expect([upper.start.y, center.start.y, lower.start.y]).toEqual([120, 120, 120]);

    const upperSource = { ...source, y: 20 };
    const lowerSource = { ...source, y: 220 };
    const incomingUpper = buildRelationshipRoute({ source: upperSource, target, obstacles: [], targetPort: { index: 0, count: 3 } });
    const incomingCenter = buildRelationshipRoute({ source, target, obstacles: [], targetPort: { index: 1, count: 3 } });
    const incomingLower = buildRelationshipRoute({ source: lowerSource, target, obstacles: [], targetPort: { index: 2, count: 3 } });

    expect([incomingUpper.end.y, incomingCenter.end.y, incomingLower.end.y]).toEqual([120, 120, 120]);
  });
});

describe("relationship route cache", () => {
  it("reuses stable routes and only invalidates edges connected to an active object", () => {
    const cache = createRelationshipRouteCache();
    const first = buildRelationshipRoute({ source, target, obstacles: [] });
    cache.set("edge-a", first, ["source", "target"]);
    cache.set("edge-b", first, ["other-a", "other-b"]);

    expect(cache.get("edge-a")).toBe(first);
    expect(cache.get("edge-b")).toBe(first);

    cache.invalidateConnectedObject("source");

    expect(cache.get("edge-a")).toBeUndefined();
    expect(cache.get("edge-b")).toBe(first);
  });

  it("uses the same right-first route for fast relationship updates", () => {
    const fast = buildFastRelationshipRoute({ source, target });
    expect(fast.waypoints[0]).toEqual({ x: 126 + RELATIONSHIP_EXIT_DISTANCE, y: 120 });
  });

  it("wraps deterministically when the target is on the left", () => {
    const leftTarget = { x: -300, y: 280, w: 120, h: 80 };
    const route = buildRelationshipRoute({ source, target: leftTarget, obstacles: [] });

    expect(route.waypoints[0]).toEqual({ x: 126 + RELATIONSHIP_EXIT_DISTANCE, y: 120 });
    expect(route.waypoints).toHaveLength(4);
    expect(route.waypoints.at(-1)).toEqual({ x: leftTarget.x - 34, y: leftTarget.y + leftTarget.h / 2 });
    expect(route.end).toEqual({ x: leftTarget.x - 6, y: leftTarget.y + leftTarget.h / 2 });
  });

  it("builds rounded orthogonal segments instead of a bezier curve", () => {
    const route = buildRelationshipRoute({ source, target: { ...target, y: 220 }, obstacles: [] });
    const path = buildRelationshipPath(route);

    expect(path).toContain(" Q ");
    expect(path).not.toContain(" C ");
    expect(path).toMatch(/^M 126 120 L /);
  });
});
