// @vitest-environment happy-dom

import { act, createElement, useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { WorkspaceSnapshotEntry } from "./workspaceUndo";
import {
  useWorkspaceObjectHistoryController,
  type WorkspaceObjectHistoryController
} from "./useWorkspaceObjectHistoryController";

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

describe("useWorkspaceObjectHistoryController", () => {
  it("pushes explicit snapshots and restores them through undo and redo", async () => {
    const before = createBlankWorkspace("project-a");
    const harness = await renderController({ projectId: "project-a", workspace: before, workspaceReady: true });

    harness.setLabel("before");
    act(() => harness.current().pushUndoSnapshot());
    act(() => harness.setWorkspace(renameProject(harness.workspace(), "after")));
    harness.setLabel("after");

    expect(harness.current().undo()).toBe(true);
    expect(harness.applied().map((entry) => entry.label)).toEqual(["before"]);

    act(() => harness.setWorkspace(harness.applied()[0]?.workspace ?? before));
    expect(harness.current().redo()).toBe(true);
    expect(harness.applied().map((entry) => entry.label)).toEqual(["before", "after"]);
  });

  it("captures the latest state at push time and preserves history for ready updates", async () => {
    const harness = await renderController({ projectId: "project-a", workspace: createBlankWorkspace("project-a"), workspaceReady: true });

    harness.setLabel("latest");
    act(() => harness.current().pushUndoSnapshot());
    act(() => harness.setWorkspace(renameProject(harness.workspace(), "same-project-update")));
    harness.setLabel("current");
    expect(harness.current().undo()).toBe(true);
    expect(harness.applied().at(-1)?.label).toBe("latest");
  });

  it("gives detail navigation undo priority over object history", async () => {
    const detailUndo = vi.fn(() => true);
    const harness = await renderController({
      projectId: "project-a",
      workspace: createBlankWorkspace("project-a"),
      workspaceReady: true,
      undoDetailNavigation: detailUndo
    });

    act(() => harness.current().pushUndoSnapshot());
    expect(harness.current().undo()).toBe(true);
    expect(detailUndo).toHaveBeenCalledTimes(1);
    expect(harness.applied()).toHaveLength(0);
  });

  it("blocks undo and redo after AI content without consuming the protected history", async () => {
    const harness = await renderController({ projectId: "project-a", workspace: createBlankWorkspace("project-a"), workspaceReady: true });

    act(() => harness.current().pushUndoSnapshot());
    act(() => harness.setWorkspace(appendAiMessage(harness.workspace(), "ai-after-manual")));
    expect(harness.current().undo()).toBe(true);
    expect(harness.closedContextMenuCount()).toBe(1);
    expect(harness.notices()).toEqual([
      {
        message: "撤销已暂停：此步早于 AI 生成的内容，AI 结果不进入撤销；撤销历史已保留。",
        durationMs: 2600
      }
    ]);

    expect(harness.current().undo()).toBe(true);
    expect(harness.notices()).toHaveLength(2);
  });

  it("owns keyboard undo and redo, but leaves editable targets and empty history alone", async () => {
    const harness = await renderController({ projectId: "project-a", workspace: createBlankWorkspace("project-a"), workspaceReady: true });
    const emptyUndo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(emptyUndo));
    expect(emptyUndo.defaultPrevented).toBe(false);

    act(() => harness.current().pushUndoSnapshot());
    act(() => harness.setWorkspace(renameProject(harness.workspace(), "after")));
    const undoEvent = new KeyboardEvent("keydown", { key: "z", metaKey: true, cancelable: true });
    act(() => window.dispatchEvent(undoEvent));
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(harness.applied()).toHaveLength(1);

    act(() => harness.setWorkspace(harness.applied()[0]?.workspace ?? createBlankWorkspace("project-a")));
    const redoEvent = new KeyboardEvent("keydown", { key: "y", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(redoEvent));
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(harness.applied()).toHaveLength(2);

    const input = document.createElement("input");
    document.body.appendChild(input);
    const editableEvent = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(editableEvent));
    expect(editableEvent.defaultPrevented).toBe(false);
  });

  it("does not intercept shortcuts or retain history while switching projects", async () => {
    const harness = await renderController({ projectId: "project-a", workspace: createBlankWorkspace("project-a"), workspaceReady: true });
    act(() => harness.current().pushUndoSnapshot());

    await harness.rerender({ projectId: "project-b", workspace: harness.workspace(), workspaceReady: false });
    const blockedSwitchEvent = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(blockedSwitchEvent));
    expect(blockedSwitchEvent.defaultPrevented).toBe(false);
    expect(harness.current().undo()).toBe(false);

    await harness.rerender({ projectId: "project-b", workspace: createBlankWorkspace("project-b"), workspaceReady: false });
    await harness.rerender({ projectId: "project-b", workspace: createBlankWorkspace("project-b"), workspaceReady: true });
    expect(harness.current().undo()).toBe(false);
  });

  it("removes its global keyboard listener on unmount", async () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const harness = await renderController({ projectId: "project-a", workspace: createBlankWorkspace("project-a"), workspaceReady: true });
    await harness.unmount();
    expect(removeListener).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
  });
});

type TestEntry = WorkspaceSnapshotEntry & { label: string };
type HistoryTestInput = {
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  undoDetailNavigation?: () => boolean;
  closeCanvasContextMenu?: () => void;
  showNotice?: (message: string, durationMs?: number) => void;
  initialLabel?: string;
};

function renameProject(workspace: MorphoWorkspace, title: string): MorphoWorkspace {
  return { ...workspace, project: { ...workspace.project, title } };
}

function appendAiMessage(workspace: MorphoWorkspace, messageId: string): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [...workspace.ai.messages, { id: messageId, role: "assistant", body: "AI 结果", status: "done" }]
    }
  };
}

async function renderController(initialInput: HistoryTestInput) {
  let currentInput = initialInput;
  let currentLabel = initialInput.initialLabel ?? "current";
  let controller: WorkspaceObjectHistoryController<TestEntry> | null = null;
  let forceRender: Dispatch<SetStateAction<number>> | null = null;
  const appliedEntries: TestEntry[] = [];
  const notices: Array<{ message: string; durationMs: number }> = [];
  let closedContextMenuCount = 0;
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
    const captureCurrent = useCallback((): TestEntry => ({ workspace: currentInput.workspace, label: currentLabel }), []);
    const applyEntry = useCallback((entry: TestEntry) => {
      appliedEntries.push(entry);
      currentInput = { ...currentInput, workspace: entry.workspace };
      currentLabel = entry.label;
      forceRender?.((version) => version + 1);
    }, []);
    const undoDetailNavigation = currentInput.undoDetailNavigation ?? (() => false);
    const closeCanvasContextMenu = currentInput.closeCanvasContextMenu ?? (() => {
      closedContextMenuCount += 1;
    });
    const showNotice = currentInput.showNotice ?? ((message: string, durationMs = 1600) => {
      notices.push({ message, durationMs });
    });

    controller = useWorkspaceObjectHistoryController({
      projectId: currentInput.projectId,
      workspace: currentInput.workspace,
      workspaceReady: currentInput.workspaceReady,
      captureCurrent,
      applyEntry,
      undoDetailNavigation,
      closeCanvasContextMenu,
      showNotice
    });
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
    applied: () => appliedEntries,
    notices: () => notices,
    closedContextMenuCount: () => closedContextMenuCount,
    setLabel: (label: string) => {
      currentLabel = label;
    },
    setWorkspace: (workspace: MorphoWorkspace) => {
      currentInput = { ...currentInput, workspace };
      forceRender?.((version) => version + 1);
    },
    rerender: async (nextInput: HistoryTestInput) => {
      currentInput = nextInput;
      await act(async () => root.render(createElement(Harness)));
    },
    unmount: async () => {
      await act(async () => root.unmount());
    }
  };
}
