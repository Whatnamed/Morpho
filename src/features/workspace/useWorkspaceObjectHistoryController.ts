"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useReducer } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";

import {
  createSnapshotHistory,
  pushSnapshotHistoryEntry,
  redoSnapshotHistory,
  undoSnapshotHistory,
  type WorkspaceSnapshotEntry
} from "./workspaceUndo";

export type UseWorkspaceObjectHistoryControllerInput<TEntry extends WorkspaceSnapshotEntry> = {
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  captureCurrent: () => TEntry;
  applyEntry: (entry: TEntry) => void;
  undoDetailNavigation: () => boolean;
  closeCanvasContextMenu: () => void;
  showNotice: (message: string, durationMs?: number) => void;
};

export type WorkspaceObjectHistoryController<TEntry extends WorkspaceSnapshotEntry> = {
  pushUndoSnapshot: () => void;
  undo: () => boolean;
  redo: () => boolean;
  clearHistory: () => void;
};

type ObjectHistorySession = Readonly<{
  projectId: string;
  workspaceId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export function isEditableDomTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
  );
}

export function useWorkspaceObjectHistoryController<TEntry extends WorkspaceSnapshotEntry>({
  projectId,
  workspace,
  workspaceReady,
  captureCurrent,
  applyEntry,
  undoDetailNavigation,
  closeCanvasContextMenu,
  showNotice
}: UseWorkspaceObjectHistoryControllerInput<TEntry>): WorkspaceObjectHistoryController<TEntry> {
  const session = useMemo<ObjectHistorySession>(
    () => ({
      projectId,
      workspaceId: workspace.project.id,
      workspaceReady,
      generation: Symbol("workspace-object-history-session")
    }),
    [projectId, workspace.project.id, workspaceReady]
  );
  const historyRef = useRef(createSnapshotHistory<TEntry>());
  const activeSessionRef = useRef<ObjectHistorySession>(session);
  const [committedSession, commitSession] = useReducer(
    (_current: ObjectHistorySession, next: ObjectHistorySession) => next,
    session
  );

  const isCurrentSession = useCallback(
    (expectedSession: ObjectHistorySession) => {
      return activeSessionRef.current === expectedSession && expectedSession.workspaceReady;
    },
    []
  );

  useLayoutEffect(() => {
    if (committedSession === session && activeSessionRef.current === session) {
      return;
    }

    activeSessionRef.current = session;
    historyRef.current = createSnapshotHistory<TEntry>();
    commitSession(session);
  }, [committedSession, session]);

  const pushUndoSnapshot = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }

    historyRef.current = pushSnapshotHistoryEntry(historyRef.current, captureCurrent());
  }, [captureCurrent, isCurrentSession, session]);

  const undo = useCallback(() => {
    if (!isCurrentSession(session)) {
      return false;
    }

    if (undoDetailNavigation()) {
      return true;
    }

    const result = undoSnapshotHistory(historyRef.current, workspace, captureCurrent);
    if (result.status === "empty") {
      return false;
    }

    if (result.status === "blocked") {
      closeCanvasContextMenu();
      showNotice("撤销已暂停：此步早于 AI 生成的内容，AI 结果不进入撤销；撤销历史已保留。", 2600);
      return true;
    }

    historyRef.current = result.history;
    applyEntry(result.entry);
    return true;
  }, [applyEntry, captureCurrent, closeCanvasContextMenu, isCurrentSession, session, showNotice, undoDetailNavigation, workspace]);

  const redo = useCallback(() => {
    if (!isCurrentSession(session)) {
      return false;
    }

    const result = redoSnapshotHistory(historyRef.current, workspace, captureCurrent);
    if (result.status === "empty") {
      return false;
    }

    if (result.status === "blocked") {
      closeCanvasContextMenu();
      showNotice("重做已暂停：撤销之后已有新内容创建，重做不会移除它们；历史已保留。", 2600);
      return true;
    }

    historyRef.current = result.history;
    applyEntry(result.entry);
    return true;
  }, [applyEntry, captureCurrent, closeCanvasContextMenu, isCurrentSession, session, showNotice, workspace]);

  const clearHistory = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    historyRef.current = createSnapshotHistory<TEntry>();
  }, [isCurrentSession, session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (!isUndo && !isRedo) {
        return;
      }

      if (isEditableDomTarget(event.target)) {
        return;
      }

      const handled = isUndo ? undo() : redo();
      if (!handled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [redo, undo]);

  return { pushUndoSnapshot, undo, redo, clearHistory };
}
