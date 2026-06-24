import { describe, expect, it } from "vitest";

import { calculateAnchoredZoom } from "./canvasCamera";

describe("canvas camera anchored zoom", () => {
  it("keeps the anchor page point under the cursor when zooming in", () => {
    const next = calculateAnchoredZoom({
      camera: { x: 100, y: 50, zoom: 1 },
      anchorPagePoint: { x: 400, y: 300 },
      deltaY: -60
    });

    const screenBefore = {
      x: (400 + 100) * 1,
      y: (300 + 50) * 1
    };
    const screenAfter = {
      x: (400 + next.x) / next.zoom,
      y: (300 + next.y) / next.zoom
    };

    expect(next.zoom).toBeGreaterThan(1);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
  });

  it("clamps zoom and still returns a finite camera", () => {
    const next = calculateAnchoredZoom({
      camera: { x: 0, y: 0, zoom: 0.13 },
      anchorPagePoint: { x: 200, y: 150 },
      deltaY: 9000,
      minZoom: 0.12,
      maxZoom: 2.4
    });

    expect(next.zoom).toBeGreaterThanOrEqual(0.12);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
  });
});
