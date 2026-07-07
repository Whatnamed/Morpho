import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  areMorphoShapePropsEqual,
  isMorphoShapeActiveInWorkspace,
  resolveInstanceForEditorSync,
  shouldReplaceSelectionForContextMenuTarget,
  shouldApplyFocusRequest,
  resolveFocusBounds,
  shouldOpenCanvasContextMenuFromPointerDown
} from "./MorphoCanvas";

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

  it("preserves a multi-selection when right-clicking an already selected shape", () => {
    expect(shouldReplaceSelectionForContextMenuTarget("shape:a", ["shape:a", "shape:b"])).toBe(false);
    expect(shouldReplaceSelectionForContextMenuTarget("shape:c", ["shape:a", "shape:b"])).toBe(true);
  });

  it("treats newly imported object shapes as active when the latest workspace contains them", () => {
    const workspace = createInitialWorkspace();
    const importedObject = {
      id: "imported-text-object",
      type: "text" as const,
      title: "Imported note",
      summary: "Dropped text",
      body: "Dropped text",
      createdBy: "user" as const,
      visibility: "active" as const
    };
    const shape = {
      props: {
        objectId: importedObject.id
      }
    };

    expect(isMorphoShapeActiveInWorkspace(shape, workspace)).toBe(false);
    expect(
      isMorphoShapeActiveInWorkspace(shape, {
        ...workspace,
        objects: {
          ...workspace.objects,
          [importedObject.id]: importedObject
        }
      })
    ).toBe(true);
  });

  it("keeps pending editor geometry ahead of stale workspace geometry while syncing back to tldraw", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances.find((item) => item.objectId === "image-soft-rail-v2");

    if (!instance) {
      throw new Error("Expected seed workspace to include an image canvas instance.");
    }

    const pending = {
      ...instance,
      size: { w: instance.size.w + 80, h: instance.size.h + 80 }
    };

    expect(resolveInstanceForEditorSync(instance, [pending])).toBe(pending);
    expect(resolveInstanceForEditorSync(instance, null)).toBe(instance);
  });

  it("compares Morpho shape props before writing redundant tldraw updates", () => {
    const props = {
      w: 240,
      h: 180,
      objectId: "object-a",
      instanceId: "instance-a",
      morphoType: "image" as const,
      title: "Image",
      summary: "Summary",
      label: "参考图",
      details: [],
      imageVariant: "rail",
      isDefaultReference: true,
      isBeingLocallyEdited: false,
      isInDesignTrace: false,
      assetUrl: "blob:asset"
    };

    expect(areMorphoShapePropsEqual(props, { ...props })).toBe(true);
    expect(areMorphoShapePropsEqual(props, { ...props, w: 300 })).toBe(false);
    expect(areMorphoShapePropsEqual(props, { ...props, details: ["source"] })).toBe(false);
  });
});
