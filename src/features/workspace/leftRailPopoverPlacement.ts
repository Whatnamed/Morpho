export type LeftRailAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type LeftRailPopoverPosition = {
  top: number;
  left: number;
};

const TOP_CLEARANCE = 76;
const BOTTOM_CLEARANCE = 82;
const RIGHT_PANEL_CLEARANCE = 354;
const RAIL_GAP = 12;

export function getLeftRailPopoverPosition(input: {
  anchor: LeftRailAnchor | null;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
}): LeftRailPopoverPosition {
  const fallback = { top: TOP_CLEARANCE + 8, left: 84 };
  if (!input.anchor) {
    return fallback;
  }

  const availableBottom = Math.max(TOP_CLEARANCE, input.viewport.height - BOTTOM_CLEARANCE - input.panel.height);
  const centeredTop = input.anchor.top + input.anchor.height / 2 - input.panel.height / 2;
  const top = clamp(centeredTop, TOP_CLEARANCE, availableBottom);

  const availableRight = Math.max(84, input.viewport.width - RIGHT_PANEL_CLEARANCE - input.panel.width);
  const left = clamp(input.anchor.right + RAIL_GAP, 84, availableRight);
  return { top, left };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
