import { describe, expect, it } from "vitest";

import { getImageCanvasSize } from "./imageSizing";

describe("Morpho image canvas sizing", () => {
  it("keeps imported and generated wide images proportional within canvas bounds", () => {
    expect(getImageCanvasSize({ width: 1920, height: 1080 })).toEqual({ w: 320, h: 180 });
  });

  it("keeps portrait images proportional within canvas bounds", () => {
    expect(getImageCanvasSize({ width: 900, height: 1600 })).toEqual({ w: 158, h: 280 });
  });

  it("uses a stable square size for square images", () => {
    expect(getImageCanvasSize({ width: 1024, height: 1024 })).toEqual({ w: 240, h: 240 });
  });

  it("falls back to the existing default when intrinsic dimensions are unavailable", () => {
    expect(getImageCanvasSize({})).toEqual({ w: 245, h: 178 });
  });
});
