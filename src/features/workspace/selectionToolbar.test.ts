import { describe, expect, it } from "vitest";

import { getFloatingMenuPlacement, getSelectionToolbarPlacement } from "./selectionToolbar";

describe("selection toolbar placement", () => {
  it("uses the space below when the selection is too close to the top edge", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 120, y: 24, w: 300, h: 180 },
      { w: 1280, h: 800 },
      { toolbar: { w: 520, h: 44 }, margin: 16, gap: 12 }
    );

    expect(placement.placement).toBe("below");
    expect(placement.y).toBe(216);
  });

  it("keeps the toolbar centered on the selected object unless the viewport edge requires clamping", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 620, y: 520, w: 220, h: 160 },
      { w: 1280, h: 800 },
      {
        toolbar: { w: 520, h: 44 },
        margin: 16,
        gap: 12,
        obstacles: [{ x: 880, y: 72, w: 380, h: 644 }]
      }
    );

    expect(placement.placement).toBe("above");
    expect(placement.x).toBe(470);
  });

  it("clamps context menus inside the visible viewport", () => {
    const placement = getFloatingMenuPlacement(
      { x: 1220, y: 760 },
      { w: 1280, h: 800 },
      { menu: { w: 220, h: 320 }, margin: 16 }
    );

    expect(placement).toEqual({ x: 1044, y: 464 });
  });
});
