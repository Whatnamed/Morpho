import { describe, expect, it } from "vitest";

import { getLeftRailPopoverPosition } from "./leftRailPopoverPlacement";

describe("left rail popover placement", () => {
  it("anchors a panel beside the triggering rail button instead of pinning it to the bottom", () => {
    expect(
      getLeftRailPopoverPosition({
        anchor: { top: 150, right: 70, bottom: 182, left: 38, width: 32, height: 32 },
        panel: { width: 340, height: 260 },
        viewport: { width: 1440, height: 1024 }
      })
    ).toEqual({ top: 76, left: 84 });
  });

  it("clamps a lower trigger into the free viewport band", () => {
    const position = getLeftRailPopoverPosition({
      anchor: { top: 850, right: 70, bottom: 882, left: 38, width: 32, height: 32 },
      panel: { width: 340, height: 280 },
      viewport: { width: 1440, height: 1024 }
    });

    expect(position.top).toBe(662);
    expect(position.left).toBe(84);
  });
});
