import { Editor, StateNode, createTLStore, defaultBindingUtils, defaultShapeUtils } from "tldraw";
import { describe, expect, it } from "vitest";

import { createStageRegionShapePartial, StageRegionShapeUtil, type StageRegionShape } from "./StageRegionShapeUtil";
import { createMorphoShapePartial, isMorphoShape, MorphoShapeUtil } from "./MorphoShapeUtil";
import { ensureStageRegions, getStageRegions } from "@/domain/morpho/stageRegions";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { areSelectionIdsEqual, normalizeCanvasSelectionIds } from "./canvasSelection";
import { createStageOpacitySessionController } from "./stageOpacitySession";

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

function createOpacitySession(editor: Editor, stageId: string) {
  const persisted: Array<{ stageId: string; opacity: number }> = [];
  const sessionStages: Array<string | null> = [];
  const readOpacity = () => (editor.getShape(`shape:${stageId}` as StageRegionShape["id"]) as StageRegionShape).props.fillOpacity;
  const controller = createStageOpacitySessionController({
    getOpacity: (requestedStageId) =>
      requestedStageId === stageId ? readOpacity() : null,
    writeOpacity: (requestedStageId, opacity, options) => {
      const write = () => editor.updateShapes([{ id: `shape:${requestedStageId}` as StageRegionShape["id"], type: "stageRegion", props: { fillOpacity: opacity } }]);
      if (options.history === "ignore") {
        editor.run(write, { history: "ignore" });
      } else {
        write();
      }
    },
    markHistoryStoppingPoint: (label) => editor.markHistoryStoppingPoint(label),
    persist: (persistedStageId, opacity) => persisted.push({ stageId: persistedStageId, opacity }),
    onSessionStageChange: (activeStageId) => sessionStages.push(activeStageId)
  });
  return { controller, persisted, sessionStages, readOpacity };
}

describe("stage opacity editor session", () => {
  function createStage() {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0]!;
    const editor = createInMemoryEditor();
    editor.createShapes([createStageRegionShapePartial(region)]);
    const id = `shape:${region.id}` as StageRegionShape["id"];
    editor.select(id);
    editor.clearHistory();
    return { editor, id, initialOpacity: (editor.getShape(id) as StageRegionShape).props.fillOpacity };
  }

  it("commits multiple previews once and preserves one undo/redo step", () => {
    const { editor, id, initialOpacity } = createStage();
    const { controller, persisted, readOpacity, sessionStages } = createOpacitySession(editor, id.replace(/^shape:/, ""));
    controller.begin(id.replace(/^shape:/, ""));
    controller.preview(id.replace(/^shape:/, ""), 24);
    controller.preview(id.replace(/^shape:/, ""), 36);
    controller.preview(id.replace(/^shape:/, ""), 48);
    expect(readOpacity()).toBe(48);
    expect(controller.commit()).toBe(true);
    expect(controller.commit()).toBe(false);
    expect(persisted).toEqual([{ stageId: id.replace(/^shape:/, ""), opacity: 48 }]);
    expect(sessionStages.at(-1)).toBeNull();
    editor.undo();
    expect(readOpacity()).toBe(initialOpacity);
    editor.redo();
    expect(readOpacity()).toBe(48);
  });

  it("cancels on Escape or pointercancel without history or workspace persistence", () => {
    for (const ending of ["escape", "pointercancel"] as const) {
      const { editor, id, initialOpacity } = createStage();
      const { controller, persisted, readOpacity, sessionStages } = createOpacitySession(editor, id.replace(/^shape:/, ""));
      controller.preview(id.replace(/^shape:/, ""), 52);
      expect(readOpacity()).toBe(52);
      expect(controller.cancel(), ending).toBe(true);
      expect(controller.dispose()).toBe(false);
      expect(readOpacity()).toBe(initialOpacity);
      expect(persisted).toEqual([]);
      expect(sessionStages.at(-1)).toBeNull();
      editor.undo();
      expect(readOpacity()).toBe(initialOpacity);
    }
  });

  it("does not record or persist an unchanged gesture", () => {
    const { editor, id, initialOpacity } = createStage();
    const { controller, persisted, readOpacity } = createOpacitySession(editor, id.replace(/^shape:/, ""));
    controller.begin(id.replace(/^shape:/, ""));
    expect(controller.commit()).toBe(false);
    expect(persisted).toEqual([]);
    editor.undo();
    expect(readOpacity()).toBe(initialOpacity);
  });

  it("commits an active stage before beginning a different stage", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const [first, second] = getStageRegions(workspace);
    const editor = createInMemoryEditor();
    editor.createShapes([createStageRegionShapePartial(first), createStageRegionShapePartial(second)]);
    const persisted: Array<{ stageId: string; opacity: number }> = [];
    const controller = createStageOpacitySessionController({
      getOpacity: (stageId) => (editor.getShape(`shape:${stageId}` as StageRegionShape["id"]) as StageRegionShape | undefined)?.props.fillOpacity ?? null,
      writeOpacity: (stageId, opacity, options) => {
        const write = () => editor.updateShapes([{ id: `shape:${stageId}` as StageRegionShape["id"], type: "stageRegion", props: { fillOpacity: opacity } }]);
        options.history === "ignore" ? editor.run(write, { history: "ignore" }) : write();
      },
      markHistoryStoppingPoint: (label) => editor.markHistoryStoppingPoint(label),
      persist: (stageId, opacity) => persisted.push({ stageId, opacity }),
      onSessionStageChange: () => undefined
    });
    controller.preview(first.id, 41);
    controller.begin(second.id);
    expect(persisted).toEqual([{ stageId: first.id, opacity: 41 }]);
    expect(controller.activeStageId).toBe(second.id);
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
