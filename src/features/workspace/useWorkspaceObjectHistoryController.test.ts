// @vitest-environment happy-dom
import { act, createElement, useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import { useWorkspaceObjectHistoryController, type WorkspaceObjectHistoryController } from "./useWorkspaceObjectHistoryController";

const roots: Root[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });

describe("manual history controller", () => {
  it("captures at the commit boundary and preserves independent writes in both directions", async () => {
    const h = await renderController();
    act(() => h.current().updateManualWorkspace((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    const ai = { id: "ai-later", role: "assistant" as const, body: "独立结果", status: "done" as const };
    act(() => h.independent((w) => ({ ...w, ai: { ...w.ai, messages: [ai] } })));
    act(() => expect(h.current().undo()).toBe(true));
    expect(h.workspace().project.title).not.toBe("manual");
    expect(h.workspace().ai.messages).toEqual([ai]);
    act(() => expect(h.current().redo()).toBe(true));
    expect(h.workspace().project.title).toBe("manual");
    expect(h.workspace().ai.messages).toEqual([ai]);
    expect(h.current().canUndo).toBe(true);
    expect(h.current().canRedo).toBe(false);
  });
  it("retains blocked history and availability without partial writes", async () => {
    const h = await renderController();
    act(() => h.current().updateManualWorkspace((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    act(() => h.independent((w) => ({ ...w, project: { ...w.project, title: "third party" } })));
    for (let i = 0; i < 2; i++) act(() => expect(h.current().undo()).toBe(true));
    expect(h.notices).toHaveLength(2);
    expect(h.notices[0]).toContain("历史已保留");
    expect(h.workspace().project.title).toBe("third party");
    expect(h.current().canUndo).toBe(true);
    act(() => h.independent((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    act(() => h.current().undo());
    expect(h.current().canRedo).toBe(true);
  });
  it("owns all mutation shortcuts and empty history, leaving input native history alone", async () => {
    const h = await renderController();
    act(() => h.current().updateManualWorkspace((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    for (const [key, ctrlKey, metaKey, shiftKey] of [["z", true, false, false], ["y", true, false, false], ["z", false, true, false], ["z", false, true, true]] as const) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey, metaKey, shiftKey, cancelable: true });
      act(() => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
    }
    for (const tag of ["input", "textarea", "div"]) {
      const target = document.createElement(tag); if (tag === "div") target.contentEditable = "true";
      document.body.appendChild(target);
      const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true, bubbles: true });
      act(() => target.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false);
    }
    act(() => h.current().clearHistory());
    const empty = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(empty)); expect(empty.defaultPrevented).toBe(true);
  });
  it("resets on project/readiness transitions and rejects stale callbacks after A/B/A", async () => {
    const h = await renderController(); const stale = h.current().updateManualWorkspace;
    act(() => h.current().updateManualWorkspace((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    await h.switchProject("b", false);
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    act(() => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false);
    await h.switchProject("a", true); act(() => stale((w) => ({ ...w, project: { ...w.project, title: "stale" } })));
    expect(h.workspace().project.title).not.toBe("stale"); expect(h.current().undo()).toBe(false);
  });
  it("does not consume redo for an empty/blocked domain operation and removes its keyboard listener", async () => {
    const remove = vi.spyOn(window, "removeEventListener"); const h = await renderController();
    act(() => h.current().updateManualWorkspace((w) => ({ ...w, project: { ...w.project, title: "manual" } })));
    act(() => h.current().undo()); act(() => h.current().updateManualWorkspace((w) => w));
    expect(h.current().canRedo).toBe(true);
    await act(async () => h.root.unmount()); roots.splice(roots.indexOf(h.root), 1);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), { capture: true });
  });
});
async function renderController() {
  let workspace = createBlankWorkspace("a"), projectId = "a", ready = true;
  let controller: WorkspaceObjectHistoryController | undefined;
  let render: Dispatch<SetStateAction<number>> | undefined;
  const notices: string[] = [];
  function Harness() {
    const [, setVersion] = useState(0); render = setVersion;
    const commitWorkspace = useCallback(<T,>(transform: WorkspaceCommitTransform<T>): T => {
      const result = transform(workspace); workspace = result.workspace; setVersion((v) => v + 1); return result.value;
    }, []);
    controller = useWorkspaceObjectHistoryController({ projectId, workspace, workspaceReady: ready, commitWorkspace, closeCanvasContextMenu: () => undefined, showNotice: (m) => notices.push(m) });
    return null;
  }
  const div = document.createElement("div"); document.body.appendChild(div); const root = createRoot(div); roots.push(root);
  await act(async () => root.render(createElement(Harness)));
  return { root, current: () => { if (!controller) throw new Error("not rendered"); return controller; }, workspace: () => workspace, notices,
    independent: (transform: (w: MorphoWorkspace) => MorphoWorkspace) => { workspace = transform(workspace); render?.((v) => v + 1); },
    switchProject: async (id: string, workspaceReady: boolean) => { projectId = id; workspace = createBlankWorkspace(id); ready = workspaceReady; await act(async () => root.render(createElement(Harness))); }
  };
}
