import { Editor, StateNode, createTLStore, defaultBindingUtils, defaultShapeUtils } from "tldraw";
import { describe, expect, it } from "vitest";

import { createStageRegionShapePartial, StageRegionShapeUtil, type StageRegionShape } from "./StageRegionShapeUtil";
import { createMorphoShapePartial, isMorphoShape, MorphoShapeUtil } from "./MorphoShapeUtil";
import { ensureStageRegions, getStageRegions } from "@/domain/morpho/stageRegions";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { areSelectionIdsEqual, normalizeCanvasSelectionIds } from "./canvasSelection";

class TestTool extends StateNode {
  static override id = "test";
}

function createInMemoryEditor() {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
  }
  if (!("window" in globalThis)) {
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  }
  Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
  const style = { setProperty: () => undefined, removeProperty: () => undefined, getPropertyValue: () => "" };
  const fakeDocument = {
    createElement: () => ({
      classList: { add: () => undefined },
      setAttribute: () => undefined,
      style,
      tabIndex: -1,
      appendChild: () => undefined,
      remove: () => undefined
    }),
    defaultView: globalThis,
    body: { addEventListener: () => undefined, removeEventListener: () => undefined },
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  } as unknown as Document;
  const container = {
    tabIndex: 0,
    classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    focus: () => undefined,
    contains: () => false,
    appendChild: () => undefined,
    ownerDocument: fakeDocument,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 })
  } as unknown as HTMLElement;
  const shapeUtils = [...defaultShapeUtils, MorphoShapeUtil, StageRegionShapeUtil];
  return new Editor({
    store: createTLStore({ shapeUtils }),
    shapeUtils,
    bindingUtils: [...defaultBindingUtils],
    tools: [TestTool],
    getContainer: () => container,
    initialState: "test"
  });
}

describe("stage opacity editor session", () => {
  it("keeps previews out of history and commits the final opacity as one undoable change", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0]!;
    const editor = createInMemoryEditor();
    editor.createShapes([createStageRegionShapePartial(region)]);
    const id = `shape:${region.id}` as StageRegionShape["id"];
    editor.select(id);
    editor.clearHistory();
    const initial = editor.getShape(id) as StageRegionShape;
    const preview = (fillOpacity: number) => editor.run(() => editor.updateShapes([{ id, type: "stageRegion", props: { fillOpacity } }]), { history: "ignore" });
    preview(24);
    preview(36);
    preview(48);
    expect((editor.getShape(id) as StageRegionShape | undefined)?.props.fillOpacity).toBe(48);
    editor.undo();
    expect((editor.getShape(id) as StageRegionShape | undefined)?.props.fillOpacity).toBe(48);

    editor.run(() => editor.updateShapes([{ id, type: "stageRegion", props: { fillOpacity: initial.props.fillOpacity } }]), { history: "ignore" });
    editor.markHistoryStoppingPoint("调整分区透明度");
    editor.updateShapes([{ id, type: "stageRegion", props: { fillOpacity: 48 } }]);
    editor.undo();
    expect((editor.getShape(id) as StageRegionShape | undefined)?.props.fillOpacity).toBe(initial.props.fillOpacity);
    editor.redo();
    expect((editor.getShape(id) as StageRegionShape | undefined)?.props.fillOpacity).toBe(48);
  });
});

describe("stage selection editor integration", () => {
  it("normalizes a stage plus its member into ordinary-object selection before page state commits", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0]!;
    const instance = workspace.canvas.instances.find((item) => region.memberObjectIds.includes(item.objectId))!;
    const object = workspace.objects[instance.objectId]!;
    const editor = createInMemoryEditor();
    editor.createShapes([
      createStageRegionShapePartial(region),
      createMorphoShapePartial(instance, object, undefined, workspace, false, false)
    ]);
    editor.sideEffects.registerBeforeChangeHandler("instance_page_state", (previous, next) => {
      const normalized = normalizeCanvasSelectionIds(previous.selectedShapeIds, next.selectedShapeIds, (id) => {
        const shape = editor.getShape(id as never);
        if (shape && isMorphoShape(shape)) return "morpho";
        if (shape?.type === "stageRegion") return "stage";
        return "other";
      });
      return areSelectionIdsEqual(next.selectedShapeIds, normalized) ? next : { ...next, selectedShapeIds: normalized as never };
    });

    editor.select(`shape:${region.id}` as never);
    editor.select(`shape:${region.id}` as never, `shape:${instance.id}` as never);
    expect(editor.getSelectedShapeIds()).toEqual([`shape:${instance.id}`]);
  });
});
