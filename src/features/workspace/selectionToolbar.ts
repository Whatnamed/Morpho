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

export function getSelectionToolbarPlacement(
  selectionBounds: ScreenRect,
  viewport: ScreenSize,
  options: {
    toolbar: ScreenSize;
    margin: number;
    gap: number;
    obstacles?: ScreenRect[];
  }
): SelectionToolbarPlacement {
  const preferredCenterX = selectionBounds.x + selectionBounds.w / 2;
  const minCenterX = options.margin + options.toolbar.w / 2;
  const maxCenterX = Math.max(minCenterX, viewport.w - options.margin - options.toolbar.w / 2);
  const x = clamp(preferredCenterX, minCenterX, maxCenterX);
  const aboveY = selectionBounds.y - options.gap - options.toolbar.h;
  const belowY = selectionBounds.y + selectionBounds.h + options.gap;
  const canFitAbove = aboveY >= options.margin;
  const maxY = viewport.h - options.margin - options.toolbar.h;

  if (canFitAbove) {
    return {
      x,
      y: clamp(aboveY, options.margin, maxY),
      placement: "above"
    };
  }

  return {
    x,
    y: clamp(belowY, options.margin, maxY),
    placement: "below"
  };
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
