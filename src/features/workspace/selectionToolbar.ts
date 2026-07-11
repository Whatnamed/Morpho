export type ScreenRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ScreenSize = {
  w: number;
  h: number;
};

export type SelectionToolbarPlacement = {
  x: number;
  y: number;
  placement: "above" | "below";
};

export type FloatingMenuPlacement = {
  x: number;
  y: number;
};

export type SelectionToolbarPlacementOptions = {
  toolbar: ScreenSize;
  margin: number;
  gap: number;
  /**
   * Screen-space regions that must not overlap the toolbar (e.g. AI panel).
   * When every candidate placement collides, the toolbar is hidden instead of
   * being glued to an obstacle edge.
   */
  obstacles?: ScreenRect[];
  /**
   * Minimum fraction of the selection that must remain visible inside the
   * viewport. Below this, the toolbar is hidden rather than edge-clamped.
   */
  minVisibleRatio?: number;
  /** Minimum visible width/height in CSS pixels before the toolbar may show. */
  minVisibleEdge?: number;
};

/**
 * Whether the selection toolbar may render for the current interaction state.
 * Callers still need a valid placement from getSelectionToolbarPlacement.
 *
 * Hidden while:
 * - select tool is not idle (translating, brushing, etc.)
 * - the pointer is dragging a shape
 * - the canvas camera is panning
 */
export function shouldShowSelectionToolbarForInteraction(input: {
  isSelectIdle: boolean;
  isDragging: boolean;
  isPanning?: boolean;
}): boolean {
  return input.isSelectIdle && !input.isDragging && !input.isPanning;
}

/** CSS selectors for floating UI that should hide/avoid the selection toolbar. */
export const SELECTION_TOOLBAR_OBSTACLE_SELECTORS = [
  ".ai-panel:not(.collapsed)",
  ".detail-popover",
  ".side-drawer",
  ".project-map",
  ".left-rail",
  ".floating-cluster",
  ".delivery-panel",
  ".delivery-output-panel",
  ".archive-panel",
  ".document-reader-panel",
  ".proposal-detail-dialog",
  ".ai-queue"
] as const;

/**
 * Convert DOM client rects into screen-space obstacle rectangles.
 * Pure helper so MorphoCanvas only does document queries.
 */
export function screenRectsFromClientRects(
  rects: Array<Pick<DOMRect, "left" | "top" | "width" | "height">>
): ScreenRect[] {
  return rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height
    }));
}

/**
 * Returns true when enough of the selection remains on-screen to anchor a toolbar.
 */
export function isSelectionVisibleEnoughForToolbar(
  selectionBounds: ScreenRect,
  viewport: ScreenSize,
  options: {
    margin: number;
    minVisibleRatio?: number;
    minVisibleEdge?: number;
  }
): boolean {
  const minVisibleRatio = options.minVisibleRatio ?? 0.2;
  const minVisibleEdge = options.minVisibleEdge ?? 28;
  const visible = getViewportIntersection(selectionBounds, viewport, options.margin);
  if (!visible) {
    return false;
  }

  if (visible.w < minVisibleEdge || visible.h < minVisibleEdge) {
    return false;
  }

  const selectionArea = Math.max(1, selectionBounds.w * selectionBounds.h);
  const visibleArea = visible.w * visible.h;
  return visibleArea / selectionArea >= minVisibleRatio;
}

/**
 * Place the selection toolbar near the selection.
 * Returns null when the selection is off-screen or every candidate hits an obstacle / leaves the viewport.
 * Does not glue the toolbar to window edges or obstacle edges as a last resort.
 */
export function getSelectionToolbarPlacement(
  selectionBounds: ScreenRect,
  viewport: ScreenSize,
  options: SelectionToolbarPlacementOptions
): SelectionToolbarPlacement | null {
  if (
    !isSelectionVisibleEnoughForToolbar(selectionBounds, viewport, {
      margin: options.margin,
      minVisibleRatio: options.minVisibleRatio,
      minVisibleEdge: options.minVisibleEdge
    })
  ) {
    return null;
  }

  const toolbar = options.toolbar;
  const preferredCenterX = selectionBounds.x + selectionBounds.w / 2;
  const minCenterX = options.margin + toolbar.w / 2;
  const maxCenterX = viewport.w - options.margin - toolbar.w / 2;
  if (maxCenterX < minCenterX) {
    return null;
  }

  // Soft-clamp only while the selection center is still inside the viewport.
  // If the selection has mostly left the screen, visibility already returned null.
  const x = clamp(preferredCenterX, minCenterX, maxCenterX);
  const obstacles = options.obstacles ?? [];

  const candidates: Array<{ placement: "above" | "below"; y: number }> = [
    {
      placement: "above",
      y: selectionBounds.y - options.gap - toolbar.h
    },
    {
      placement: "below",
      y: selectionBounds.y + selectionBounds.h + options.gap
    }
  ];

  for (const candidate of candidates) {
    const rect = getToolbarScreenRect(x, candidate.y, toolbar);
    if (!fitsInsideViewport(rect, viewport, options.margin)) {
      continue;
    }
    if (obstacles.some((obstacle) => rectanglesIntersect(rect, obstacle))) {
      continue;
    }
    return {
      x,
      y: candidate.y,
      placement: candidate.placement
    };
  }

  return null;
}

export function getToolbarScreenRect(centerX: number, topY: number, toolbar: ScreenSize): ScreenRect {
  return {
    x: centerX - toolbar.w / 2,
    y: topY,
    w: toolbar.w,
    h: toolbar.h
  };
}

export function rectanglesIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function getViewportIntersection(
  rect: ScreenRect,
  viewport: ScreenSize,
  margin: number
): ScreenRect | null {
  const left = Math.max(rect.x, margin);
  const top = Math.max(rect.y, margin);
  const right = Math.min(rect.x + rect.w, viewport.w - margin);
  const bottom = Math.min(rect.y + rect.h, viewport.h - margin);
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top
  };
}

function fitsInsideViewport(rect: ScreenRect, viewport: ScreenSize, margin: number): boolean {
  return (
    rect.x >= margin &&
    rect.y >= margin &&
    rect.x + rect.w <= viewport.w - margin &&
    rect.y + rect.h <= viewport.h - margin
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getFloatingMenuPlacement(
  point: { x: number; y: number },
  viewport: ScreenSize,
  options: {
    menu: ScreenSize;
    margin: number;
  }
): FloatingMenuPlacement {
  return {
    x: clamp(point.x, options.margin, Math.max(options.margin, viewport.w - options.menu.w - options.margin)),
    y: clamp(point.y, options.margin, Math.max(options.margin, viewport.h - options.menu.h - options.margin))
  };
}
