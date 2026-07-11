import { describe, expect, it } from "vitest";

import { buildFastRelationshipRoute, buildRelationshipRoute, createRelationshipRouteCache, type CanvasPageBounds } from "./canvasRelationshipRouting";

const source: CanvasPageBounds = { x: 0, y: 80, w: 120, h: 80 };
const target: CanvasPageBounds = { x: 420, y: 80, w: 120, h: 80 };

describe("buildRelationshipRoute", () => {
  it("connects horizontal neighbors at opposite card edges instead of their centers", () => {
    const route = buildRelationshipRoute({ source, target, obstacles: [] });

    expect(route.start).toMatchObject({ x: 126, y: 120 });
    expect(route.end).toMatchObject({ x: 414, y: 120 });
    expect(route.waypoints).toEqual([]);
  });

  it("keeps direct source-to-target links readable even when they cross a non-endpoint object", () => {
    const route = buildRelationshipRoute({
      source,
      target,
      obstacles: [{ x: 220, y: 70, w: 110, h: 120 }]
    });

    expect(route.waypoints).toEqual([]);
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

  it("uses a direct low-cost route for every relationship", () => {
    const fast = buildFastRelationshipRoute({ source, target });
    expect(fast.waypoints).toEqual([]);
  });
});
