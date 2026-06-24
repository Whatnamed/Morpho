import { describe, expect, it } from "vitest";

import { calculateAnchoredZoom } from "./canvasCamera";

describe("canvas camera anchored zoom", () => {
  const pageToScreen = (
    camera: { x: number; y: number; zoom: number },
    point: { x: number; y: number }
  ): { x: number; y: number } => ({
    x: (point.x + camera.x) * camera.zoom,
    y: (point.y + camera.y) * camera.zoom
  });

  it("keeps the anchor page point under the cursor when zooming in", () => {
    const camera = { x: 100, y: 50, zoom: 1 };
    const anchorPagePoint = { x: 400, y: 300 };
    const next = calculateAnchoredZoom({
      camera,
      anchorPagePoint,
      deltaY: -60
    });

    const screenBefore = pageToScreen(camera, anchorPagePoint);
    const screenAfter = pageToScreen(next, anchorPagePoint);

    expect(next.zoom).toBeGreaterThan(1);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
  });

  it("keeps the anchor page point under the cursor when zooming out", () => {
    const camera = { x: -240, y: 120, zoom: 1.45 };
    const anchorPagePoint = { x: 960, y: -180 };
    const next = calculateAnchoredZoom({
      camera,
      anchorPagePoint,
      deltaY: 60
    });

    const screenBefore = pageToScreen(camera, anchorPagePoint);
    const screenAfter = pageToScreen(next, anchorPagePoint);

    expect(next.zoom).toBeLessThan(camera.zoom);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
  });

  it("keeps the anchor stable when clamping near the minimum zoom", () => {
    const camera = { x: 0, y: 0, zoom: 0.13 };
    const anchorPagePoint = { x: 200, y: 150 };
    const next = calculateAnchoredZoom({
      camera,
      anchorPagePoint,
      deltaY: 9000,
      minZoom: 0.12,
      maxZoom: 2.4
    });
    const screenBefore = pageToScreen(camera, anchorPagePoint);
    const screenAfter = pageToScreen(next, anchorPagePoint);

    expect(next.zoom).toBeGreaterThanOrEqual(0.12);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
    expect(Number.isFinite(next.zoom)).toBe(true);
  });

  it("keeps the anchor stable when clamping near the maximum zoom", () => {
    const camera = { x: -320, y: 180, zoom: 2.35 };
    const anchorPagePoint = { x: -60, y: 420 };
    const next = calculateAnchoredZoom({
      camera,
      anchorPagePoint,
      deltaY: -9000,
      minZoom: 0.12,
      maxZoom: 2.4
    });
    const screenBefore = pageToScreen(camera, anchorPagePoint);
    const screenAfter = pageToScreen(next, anchorPagePoint);

    expect(next.zoom).toBeLessThanOrEqual(2.4);
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
    expect(Number.isFinite(next.zoom)).toBe(true);
  });
});
