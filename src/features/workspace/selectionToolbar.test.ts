import { describe, expect, it } from "vitest";

import {
  getFloatingMenuPlacement,
  getSelectionToolbarPlacement,
  getToolbarScreenRect,
  isSelectionVisibleEnoughForToolbar,
  screenRectsFromClientRects,
  SELECTION_TOOLBAR_OBSTACLE_SELECTORS,
  shouldKeepStageToolbarVisible,
  shouldShowSelectionToolbarForInteraction
} from "./selectionToolbar";

describe("selection toolbar interaction visibility", () => {
  it("shows only while select is idle, not dragging, and not panning", () => {
    expect(shouldShowSelectionToolbarForInteraction({ isSelectIdle: true, isDragging: false, isPanning: false })).toBe(
      true
    );
    expect(shouldShowSelectionToolbarForInteraction({ isSelectIdle: true, isDragging: true, isPanning: false })).toBe(
      false
    );
    expect(shouldShowSelectionToolbarForInteraction({ isSelectIdle: true, isDragging: false, isPanning: true })).toBe(
      false
    );
    expect(shouldShowSelectionToolbarForInteraction({ isSelectIdle: false, isDragging: false, isPanning: false })).toBe(
      false
    );
  });

  it("keeps the stage toolbar while a style popover is open even if tldraw reports dragging", () => {
    expect(
      shouldKeepStageToolbarVisible({
        interactionAllowsToolbar: false,
        stagePopoverOpen: true,
        stageOnlySelection: true
      })
    ).toBe(true);
    expect(
      shouldKeepStageToolbarVisible({
        interactionAllowsToolbar: false,
        stagePopoverOpen: true,
        stageOnlySelection: false
      })
    ).toBe(false);
    expect(
      shouldKeepStageToolbarVisible({
        interactionAllowsToolbar: true,
        stagePopoverOpen: false,
        stageOnlySelection: true
      })
    ).toBe(true);
  });
});

describe("selection toolbar placement", () => {
  it("uses the space below when the selection is too close to the top edge", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 120, y: 24, w: 300, h: 180 },
      { w: 1280, h: 800 },
      { toolbar: { w: 520, h: 44 }, margin: 16, gap: 12 }
    );

    // Selection center is 270; toolbar half-width 260 needs min center 16+260=276.
    expect(placement).toEqual({
      placement: "below",
      x: 276,
      y: 216
    });
  });

  it("keeps the toolbar centered on the selected object when free space exists", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 620, y: 520, w: 220, h: 160 },
      { w: 1280, h: 800 },
      {
        toolbar: { w: 320, h: 44 },
        margin: 16,
        gap: 12
      }
    );

    expect(placement).toEqual({
      placement: "above",
      x: 730,
      y: 464
    });
  });

  it("hides instead of gluing to an AI-panel obstacle edge", () => {
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

    expect(placement).toBeNull();
  });

  it("hides when the selection is mostly outside the viewport", () => {
    expect(
      isSelectionVisibleEnoughForToolbar(
        { x: -400, y: 200, w: 220, h: 160 },
        { w: 1280, h: 800 },
        { margin: 16 }
      )
    ).toBe(false);

    const placement = getSelectionToolbarPlacement(
      { x: -400, y: 200, w: 220, h: 160 },
      { w: 1280, h: 800 },
      { toolbar: { w: 320, h: 44 }, margin: 16, gap: 12 }
    );

    expect(placement).toBeNull();
  });

  it("returns a fully on-screen rect when a candidate placement fits", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 40, y: 40, w: 120, h: 80 },
      { w: 400, h: 200 },
      { toolbar: { w: 360, h: 44 }, margin: 16, gap: 12 }
    );

    expect(placement).not.toBeNull();
    if (!placement) {
      return;
    }

    const rect = getToolbarScreenRect(placement.x, placement.y, { w: 360, h: 44 });
    expect(rect.x).toBeGreaterThanOrEqual(16);
    expect(rect.y).toBeGreaterThanOrEqual(16);
    expect(rect.x + rect.w).toBeLessThanOrEqual(400 - 16);
    expect(rect.y + rect.h).toBeLessThanOrEqual(200 - 16);
  });

  it("clamps context menus inside the visible viewport", () => {
    const placement = getFloatingMenuPlacement(
      { x: 1220, y: 760 },
      { w: 1280, h: 800 },
      { menu: { w: 220, h: 320 }, margin: 16 }
    );

    expect(placement).toEqual({ x: 1044, y: 464 });
  });

  it("maps positive client rects into screen obstacles and keeps obstacle selectors stable", () => {
    expect(SELECTION_TOOLBAR_OBSTACLE_SELECTORS).toContain(".ai-panel:not(.collapsed)");
    expect(SELECTION_TOOLBAR_OBSTACLE_SELECTORS).toContain(".detail-popover");
    expect(SELECTION_TOOLBAR_OBSTACLE_SELECTORS).toContain(".side-drawer");
    expect(SELECTION_TOOLBAR_OBSTACLE_SELECTORS).toContain(".project-map");
    expect(
      screenRectsFromClientRects([
        { left: 10, top: 20, width: 100, height: 50 },
        { left: 0, top: 0, width: 0, height: 0 }
      ])
    ).toEqual([{ x: 10, y: 20, w: 100, h: 50 }]);
  });

  it("hides when the toolbar would overlap a left side drawer", () => {
    const placement = getSelectionToolbarPlacement(
      { x: 120, y: 240, w: 220, h: 160 },
      { w: 1280, h: 800 },
      {
        toolbar: { w: 360, h: 44 },
        margin: 16,
        gap: 12,
        obstacles: [{ x: 84, y: 84, w: 340, h: 600 }]
      }
    );

    expect(placement).toBeNull();
  });
});
