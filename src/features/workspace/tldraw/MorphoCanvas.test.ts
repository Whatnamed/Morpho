import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { shouldApplyFocusRequest, resolveFocusBounds, shouldOpenCanvasContextMenuFromPointerDown } from "./MorphoCanvas";

describe("MorphoCanvas focus navigation", () => {
  it("uses real canvas instance positions before falling back to fixed landmarks", () => {
    const workspace = createInitialWorkspace();
    const movedWorkspace = {
      ...workspace,
      canvas: {
        ...workspace.canvas,
        instances: workspace.canvas.instances.map((instance) =>
          instance.objectId === "definition-current"
            ? {
                ...instance,
                position: { x: 5200, y: 3400 }
              }
            : instance
        )
      }
    };

    const bounds = resolveFocusBounds(movedWorkspace, "definition");

    expect(bounds.x).toBeGreaterThan(5000);
    expect(bounds.y).toBeGreaterThan(3200);
  });

  it("consumes each focus request nonce only once so user pan and zoom are not reset", () => {
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 4 }, null)).toBe(true);
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 4 }, 4)).toBe(false);
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 5 }, 4)).toBe(true);
    expect(shouldApplyFocusRequest({ nonce: 0 }, null)).toBe(false);
  });

  it("opens the Morpho context menu on right button press instead of waiting for a drag contextmenu", () => {
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 2 })).toBe(true);
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 0 })).toBe(false);
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 1 })).toBe(false);
  });
});
