"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useReducer } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { ensureStageRegions } from "@/domain/morpho/stageRegions";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import { absorbCanvasMeasurements, captureManualHistory, createManualHistory, pushManualHistory, redoManualHistory, undoManualHistory } from "./workspaceUndo";

export type UseWorkspaceObjectHistoryControllerInput = {
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  onRestored?: (workspace: MorphoWorkspace) => void;
  closeCanvasContextMenu: () => void;
  showNotice: (message: string, durationMs?: number) => void;
};
export type WorkspaceObjectHistoryController = {
  commitManualWorkspace: <T>(transform: WorkspaceCommitTransform<T>, label?: string) => T;
  updateManualWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>;
  updateCanvasProjectionWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>;
  undo: () => boolean;
  redo: () => boolean;
  clearHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
};
export function isEditableDomTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
}
export function useWorkspaceObjectHistoryController({ projectId, workspace, workspaceReady, commitWorkspace, onRestored, closeCanvasContextMenu, showNotice }: UseWorkspaceObjectHistoryControllerInput): WorkspaceObjectHistoryController {
  const session = useMemo(() => ({ projectId, workspaceId: workspace.project.id, workspaceReady }), [projectId, workspace.project.id, workspaceReady]);
  const activeSession = useRef(session);
  const history = useRef(createManualHistory());
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => {
    if (activeSession.current === session) return;
    activeSession.current = session;
    history.current = createManualHistory();
    refresh();
  }, [session]);
  const isCurrent = useCallback(() => activeSession.current === session && session.workspaceReady && session.projectId === session.workspaceId, [session]);
  const commitManualWorkspace = useCallback(<T,>(transform: WorkspaceCommitTransform<T>, label = "人工操作"): T => {
    if (!isCurrent()) throw new Error("Manual history session is no longer current.");
    // Capture outside the React updater, which React may evaluate more than once.
    const committed = commitWorkspace((current) => {
      if (!isCurrent() || current.project.id !== session.projectId) throw new Error("Manual history session is no longer current.");
      const baseline = ensureStageRegions(current);
      const result = transform(baseline);
      const completed = ensureStageRegions(result.workspace);
      return { workspace: completed, value: { before: baseline, after: completed, result: result.value } };
    });
    const entry = captureManualHistory(label, committed.before, committed.after);
    if (entry && isCurrent()) { history.current = pushManualHistory(history.current, entry); refresh(); }
    return committed.result;
  }, [commitWorkspace, isCurrent, session]);
  const updateManualWorkspace = useCallback<Dispatch<SetStateAction<MorphoWorkspace>>>((action) => {
    if (!isCurrent()) return;
    commitManualWorkspace((current) => ({ workspace: typeof action === "function" ? action(current) : action, value: undefined }));
  }, [commitManualWorkspace, isCurrent]);
  const updateCanvasProjectionWorkspace = useCallback<Dispatch<SetStateAction<MorphoWorkspace>>>((action) => {
    if (!isCurrent()) return;
    const committed = commitWorkspace((current) => {
      const next = typeof action === "function" ? action(current) : action;
      return { workspace: next, value: { before: current, after: next } };
    });
    if (isCurrent()) history.current = absorbCanvasMeasurements(history.current, committed.before, committed.after);
  }, [commitWorkspace, isCurrent]);
  const restore = useCallback((direction: "undo" | "redo") => {
    if (!isCurrent()) return false;
    const result = commitWorkspace((current) => {
      const restored = direction === "undo" ? undoManualHistory(history.current, current) : redoManualHistory(history.current, current);
      return { workspace: restored.status === "restored" ? restored.workspace : current, value: restored };
    });
    if (result.status === "empty") return false;
    closeCanvasContextMenu();
    if (result.status === "blocked") {
      showNotice(`${direction === "undo" ? "撤销" : "重做"}已暂停：相关内容已被其他操作改变，或恢复会破坏现有关系；历史已保留。`, 2600);
    } else {
      history.current = result.history;
      refresh();
      onRestored?.(result.workspace);
    }
    return true;
  }, [closeCanvasContextMenu, commitWorkspace, isCurrent, onRestored, showNotice]);
  const undo = useCallback(() => restore("undo"), [restore]);
  const redo = useCallback(() => restore("redo"), [restore]);
  const clearHistory = useCallback(() => {
    if (!isCurrent()) return;
    history.current = createManualHistory();
    refresh();
  }, [isCurrent]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isEditableDomTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (!(isUndo || isRedo)) return;
      // Consume mutation shortcuts even when empty; tldraw's private history must
      // not replay projection writes. Text inputs keep native editing history.
      if (!isCurrent()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isUndo) undo(); else redo();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isCurrent, redo, undo]);
  // eslint-disable-next-line react-hooks/refs -- refs are read after the refresh reducer commits the history change.
  return { commitManualWorkspace, updateManualWorkspace, updateCanvasProjectionWorkspace, undo, redo, clearHistory, canUndo: history.current.undo.length > 0, canRedo: history.current.redo.length > 0 };
}
