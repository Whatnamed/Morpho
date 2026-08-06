// @vitest-environment happy-dom

import { act, createElement, useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { CanvasView, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";

import {
  useWorkspaceSelectionNavigationController,
  type UseWorkspaceSelectionNavigationControllerInput,
  type WorkspaceSelectionNavigationController
} from "./useWorkspaceSelectionNavigationController";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useWorkspaceSelectionNavigationController", () => {
  it("hydrates persisted selection once and keeps request ids defensive", async () => {
    const persistedIds = ["object-a", "object-b"];
    const harness = await renderController({
      projectId: "project-a",
      workspace: withSelection(createBlankWorkspace("project-a"), persistedIds),
      workspaceReady: true
    });

    expect(harness.current().selectedObjectIds).toEqual(persistedIds);
    expect(harness.current().selectionRequest.objectIds).toEqual(persistedIds);
    expect(harness.current().selectionRequest.objectIds).not.toBe(persistedIds);

    persistedIds.push("mutated-after-hydration");
    expect(harness.current().selectedObjectIds).toEqual(["object-a", "object-b"]);
  });

  it("increments selection request nonce even when ids are unchanged", async () => {
    const harness = await renderController(createInput());
    const firstNonce = harness.current().selectionRequest.nonce;
    const ids = ["object-a"];

    act(() => harness.current().requestCanvasSelection(ids));
    ids.push("mutated-after-request");

    expect(harness.current().selectionRequest).toEqual({ objectIds: ["object-a"], nonce: firstNonce + 1 });

    act(() => harness.current().requestCanvasSelection(["object-a"]));
    expect(harness.current().selectionRequest.nonce).toBe(firstNonce + 2);
  });

  it("accepts canvas selection with functional workspace persistence and preserves same-value identity", async () => {
    const harness = await renderController(createInput());
    const before = harness.workspace();

    act(() => harness.current().acceptCanvasSelection(["object-a", "object-b"]));

    expect(harness.current().selectedObjectIds).toEqual(["object-a", "object-b"]);
    expect(harness.workspace().ui.lastSelectionIds).toEqual(["object-a", "object-b"]);
    expect(harness.workspace()).not.toBe(before);

    const persisted = harness.workspace();
    act(() => harness.current().acceptCanvasSelection(["object-a", "object-b"]));
    expect(harness.workspace()).toBe(persisted);

    act(() => harness.current().setSelectedObjectIds((current) => [...current, "object-c"]));
    expect(harness.current().selectedObjectIds).toEqual(["object-a", "object-b", "object-c"]);
  });

  it("keeps focus requests separate from selection and restores detail navigation first", async () => {
    const initialView = { x: 10, y: 20, zoom: 1 };
    const liveView = { x: 80, y: 90, zoom: 0.7 };
    const harness = await renderController({
      projectId: "project-a",
      workspace: withSelection(withView(createBlankWorkspace("project-a"), initialView), ["object-a"]),
      workspaceReady: true
    });

    act(() => harness.current().observeCanvasView(liveView));
    expect(harness.workspace().canvas.view).toEqual(initialView);

    act(() => harness.current().focusObject("object-b", { rememberView: true }));
    expect(harness.current().selectedObjectIds).toEqual(["object-b"]);
    expect(harness.current().focusRequest).toMatchObject({ objectId: "object-b" });

    act(() => harness.current().locateObjectFromDetail("object-c"));
    expect(harness.current().selectedObjectIds).toEqual(["object-c"]);

    act(() => expect(harness.current().undoDetailNavigation()).toBe(true));
    expect(harness.current().selectedObjectIds).toEqual(["object-b"]);
    expect(harness.current().focusRequest).toMatchObject({
      view: liveView,
      selectionObjectIds: ["object-b"]
    });

    act(() => expect(harness.current().undoDetailNavigation()).toBe(true));
    expect(harness.current().selectedObjectIds).toEqual(["object-a"]);
    expect(harness.current().focusRequest).toMatchObject({
      view: initialView,
      selectionObjectIds: ["object-a"]
    });
    expect(harness.current().undoDetailNavigation()).toBe(false);
  });

  it("writes committed view to both workspace locations but keeps live view transient", async () => {
    const harness = await renderController(createInput());
    const before = harness.workspace();
    const nextView = { x: 120, y: 80, zoom: 0.9 };

    act(() => harness.current().observeCanvasView(nextView));
    expect(harness.workspace()).toBe(before);

    act(() => harness.current().commitCanvasView(nextView));
    expect(harness.workspace().canvas.view).toEqual(nextView);
    expect(harness.workspace().ui.canvasView).toEqual(nextView);

    const committed = harness.workspace();
    act(() => harness.current().commitCanvasView(nextView));
    expect(harness.workspace()).toBe(committed);
  });

  it("keeps shortcut select-all and context-menu select-all semantics distinct", async () => {
    const harness = await renderController(createInput());
    act(() => harness.current().acceptCanvasSelection(["object-current"]));

    const before = harness.current().selectedObjectIds;
    act(() => expect(harness.current().selectAllCanvasObjects(["object-a", "object-b"])).toBe(true));

    expect(harness.current().selectedObjectIds).toBe(before);
    expect(harness.current().selectionRequest.objectIds).toEqual(["object-a", "object-b"]);
    expect(harness.workspace().ui.lastSelectionIds).toEqual(["object-a", "object-b"]);

    act(() => expect(harness.current().clearCanvasSelection()).toBe(true));
    expect(harness.current().selectedObjectIds).toEqual([]);
    expect(harness.workspace().ui.lastSelectionIds).toEqual([]);
    act(() => expect(harness.current().clearCanvasSelection()).toBe(false));
  });

  it("does not let stale selection, focus, view, or detail history cross an unready project switch", async () => {
    const oldWorkspace = withSelection(createBlankWorkspace("project-old"), ["old-object"]);
    const harness = await renderController({
      projectId: "project-old",
      workspace: oldWorkspace,
      workspaceReady: true
    });

    act(() => {
      harness.current().focusObject("old-object", { rememberView: true });
      harness.current().requestCanvasSelection(["old-request"]);
      harness.current().observeCanvasView({ x: 99, y: 99, zoom: 2 });
    });
    const staleRequest = harness.current().requestCanvasSelection;

    await harness.rerender({ projectId: "project-new", workspace: oldWorkspace, workspaceReady: false });
    act(() => {
      staleRequest(["stale-request"]);
      harness.current().requestCanvasSelection(["new-request"]);
      harness.current().focusArea("research");
      harness.current().focusObject("new-object", { rememberView: true });
      harness.current().observeCanvasView({ x: 400, y: 400, zoom: 3 });
      harness.current().commitCanvasView({ x: 400, y: 400, zoom: 3 });
      expect(harness.current().clearCanvasSelection()).toBe(false);
      expect(harness.current().selectAllCanvasObjects(["new-object"])).toBe(false);
    });

    expect(harness.current().selectedObjectIds).toEqual([]);
    expect(harness.current().selectionRequest).toEqual({ objectIds: [], nonce: 0 });
    expect(harness.current().focusRequest).toEqual({ nonce: 0 });
    expect(harness.workspace()).toBe(oldWorkspace);

    const blankWorkspace = createBlankWorkspace("project-new");
    await harness.rerender({ projectId: "project-new", workspace: blankWorkspace, workspaceReady: false });
    expect(harness.current().undoDetailNavigation()).toBe(false);

    const realWorkspace = withSelection(blankWorkspace, ["new-persisted"]);
    await harness.rerender({ projectId: "project-new", workspace: realWorkspace, workspaceReady: true });
    expect(harness.current().selectedObjectIds).toEqual(["new-persisted"]);
    expect(harness.current().focusRequest).toEqual({ nonce: 0 });
    expect(harness.current().undoDetailNavigation()).toBe(false);
  });

  it("keeps the session history during ready updates within the same project", async () => {
    const harness = await renderController(createInput());
    act(() => harness.current().focusObject("object-a", { rememberView: true }));

    await harness.rerender({
      projectId: "project-a",
      workspace: withSelection(harness.workspace(), ["object-a"]),
      workspaceReady: true
    });

    expect(harness.current().undoDetailNavigation()).toBe(true);
  });
});

type SelectionTestInput = Omit<UseWorkspaceSelectionNavigationControllerInput, "updateWorkspace">;

function createInput(overrides: Partial<SelectionTestInput> = {}): SelectionTestInput {
  return {
    projectId: "project-a",
    workspace: createBlankWorkspace("project-a"),
    workspaceReady: true,
    ...overrides
  };
}

function withSelection(workspace: MorphoWorkspace, objectIds: string[]): MorphoWorkspace {
  return {
    ...workspace,
    ui: {
      ...workspace.ui,
      lastSelectionIds: [...objectIds]
    }
  };
}

function withView(workspace: MorphoWorkspace, view: CanvasView): MorphoWorkspace {
  return {
    ...workspace,
    canvas: { ...workspace.canvas, view: { ...view } },
    ui: { ...workspace.ui, canvasView: { ...view } }
  };
}

async function renderController(initialInput: SelectionTestInput) {
  let currentInput = initialInput;
  let controller: WorkspaceSelectionNavigationController | null = null;
  let forceRender: Dispatch<SetStateAction<number>> | null = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness() {
    const [, setRenderVersion] = useState(0);
    forceRender = setRenderVersion;
    const updateWorkspace = useCallback<Dispatch<SetStateAction<MorphoWorkspace>>>((action) => {
      const nextWorkspace = typeof action === "function" ? action(currentInput.workspace) : action;
      currentInput = { ...currentInput, workspace: nextWorkspace };
      forceRender?.((version) => version + 1);
    }, []);

    controller = useWorkspaceSelectionNavigationController({ ...currentInput, updateWorkspace });
    return null;
  }

  await act(async () => root.render(createElement(Harness)));

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller has not rendered.");
      }
      return controller;
    },
    workspace: () => currentInput.workspace,
    rerender: async (nextInput: SelectionTestInput) => {
      currentInput = nextInput;
      await act(async () => root.render(createElement(Harness)));
    }
  };
}
