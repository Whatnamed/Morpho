import type { MorphoWorkspace } from "@/domain/morpho/types";

export const SNAPSHOT_HISTORY_LIMIT = 20;

export type WorkspaceSnapshotEntry = { workspace: MorphoWorkspace };

export type SnapshotHistory<T extends WorkspaceSnapshotEntry> = {
  undo: T[];
  redo: T[];
};

export type SnapshotRestoreResult<T extends WorkspaceSnapshotEntry> =
  | { status: "empty" }
  | { status: "blocked"; history: SnapshotHistory<T> }
  | { status: "restored"; history: SnapshotHistory<T>; entry: T };

export function createSnapshotHistory<T extends WorkspaceSnapshotEntry>(): SnapshotHistory<T> {
  return { undo: [], redo: [] };
}

/** A new explicit operation starts a fresh forward path, so redo entries become unreachable. */
export function pushSnapshotHistoryEntry<T extends WorkspaceSnapshotEntry>(
  history: SnapshotHistory<T>,
  entry: T
): SnapshotHistory<T> {
  return {
    undo: [...history.undo.slice(-(SNAPSHOT_HISTORY_LIMIT - 1)), entry],
    redo: []
  };
}

export function undoSnapshotHistory<T extends WorkspaceSnapshotEntry>(
  history: SnapshotHistory<T>,
  current: MorphoWorkspace,
  captureCurrent: () => T
): SnapshotRestoreResult<T> {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) {
    return { status: "empty" };
  }

  if (shouldBlockSnapshotUndo(entry.workspace, current)) {
    // AI results never enter undo. The snapshot stays on the stack so a
    // blocked attempt does not silently burn manual history.
    return { status: "blocked", history };
  }

  return {
    status: "restored",
    entry,
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo.slice(-(SNAPSHOT_HISTORY_LIMIT - 1)), captureCurrent()]
    }
  };
}

export function redoSnapshotHistory<T extends WorkspaceSnapshotEntry>(
  history: SnapshotHistory<T>,
  current: MorphoWorkspace,
  captureCurrent: () => T
): SnapshotRestoreResult<T> {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) {
    return { status: "empty" };
  }

  if (shouldBlockSnapshotUndo(entry.workspace, current)) {
    // Content created after the undo (for example an AI turn) is missing from
    // the redo snapshot; restoring it would silently delete those records.
    return { status: "blocked", history };
  }

  return {
    status: "restored",
    entry,
    history: {
      undo: [...history.undo.slice(-(SNAPSHOT_HISTORY_LIMIT - 1)), captureCurrent()],
      redo: history.redo.slice(0, -1)
    }
  };
}

export function shouldBlockSnapshotUndo(snapshot: MorphoWorkspace, current: MorphoWorkspace): boolean {
  return (
    hasNewRecord(Object.keys(snapshot.objects), Object.keys(current.objects)) ||
    hasNewRecord(snapshot.canvas.instances.map((instance) => instance.id), current.canvas.instances.map((instance) => instance.id)) ||
    hasNewRecord(Object.keys(snapshot.assets), Object.keys(current.assets)) ||
    hasNewRecord(Object.keys(snapshot.operations), Object.keys(current.operations)) ||
    hasNewRecord(Object.keys(snapshot.artifactProposals), Object.keys(current.artifactProposals)) ||
    hasNewRecord(Object.keys(snapshot.citationSnapshots), Object.keys(current.citationSnapshots)) ||
    hasNewRecord(snapshot.ai.messages.map((message) => message.id), current.ai.messages.map((message) => message.id))
  );
}

function hasNewRecord(snapshotIds: string[], currentIds: string[]): boolean {
  const snapshotIdSet = new Set(snapshotIds);
  return currentIds.some((id) => !snapshotIdSet.has(id));
}
