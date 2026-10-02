import { reconcileProjectMemory } from "@/domain/morpho/projectMemory";
import type { MorphoWorkspace } from "@/domain/morpho/types";

export const SNAPSHOT_HISTORY_LIMIT = 20;

export type WorkspaceSnapshotEntry = {
  workspace: MorphoWorkspace;
  /** Session-only baseline produced by a successful restore, not operation ownership. */
  restoreBaseline?: MorphoWorkspace;
};

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

  if (shouldBlockSnapshotUndo(entry.restoreBaseline ?? entry.workspace, current)) {
    // AI results never enter undo. The snapshot stays on the stack so a
    // blocked attempt does not silently burn manual history.
    return { status: "blocked", history };
  }

  return {
    status: "restored",
    entry,
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo.slice(-(SNAPSHOT_HISTORY_LIMIT - 1)), { ...captureCurrent(), restoreBaseline: entry.workspace }]
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

  if (shouldBlockSnapshotUndo(entry.restoreBaseline ?? entry.workspace, current)) {
    // Content created after the undo (for example an AI turn) is missing from
    // the redo snapshot; restoring it would silently delete those records.
    return { status: "blocked", history };
  }

  return {
    status: "restored",
    entry,
    history: {
      undo: [...history.undo.slice(-(SNAPSHOT_HISTORY_LIMIT - 1)), { ...captureCurrent(), restoreBaseline: entry.workspace }],
      redo: history.redo.slice(0, -1)
    }
  };
}

export function shouldBlockSnapshotUndo(snapshot: MorphoWorkspace, current: MorphoWorkspace): boolean {
  const projected = reconcileProjectMemory(current).projectMemory;
  return (
    hasNewRecord(Object.keys(snapshot.objects), Object.keys(current.objects)) ||
    hasNewRecord(snapshot.canvas.instances.map((instance) => instance.id), current.canvas.instances.map((instance) => instance.id)) ||
    hasChangedRecords(snapshot.assets, current.assets) ||
    hasChangedRecords(snapshot.operations, current.operations) ||
    hasChangedRecords(snapshot.artifactProposals, current.artifactProposals) ||
    hasChangedRecords(snapshot.citationSnapshots, current.citationSnapshots) ||
    !sameValue(snapshot.ai, current.ai) ||
    hasChangedRecords(snapshot.deliverySectionDrafts, current.deliverySectionDrafts) ||
    hasChangedRecords(snapshot.designDefinitionRevisions, current.designDefinitionRevisions) ||
    hasChangedRecords(snapshot.directionRevisions, current.directionRevisions) ||
    hasChangedProjectionRecords(snapshot.projectMemory.revisions, current.projectMemory.revisions, Object.values(projected.documents).map((document) => document.currentRevisionId)) ||
    hasChangedProjectionRecords(snapshot.projectMemory.stageRevisions, current.projectMemory.stageRevisions, Object.values(projected.stageRecords).map((record) => record.currentRevisionId)) ||
    hasChangedHistory(snapshot.decisionRecords, current.decisionRecords) ||
    hasChangedHistory(snapshot.directionLineage, current.directionLineage) ||
    hasChangedHistory(snapshot.projectContinuity.recordEntries, current.projectContinuity.recordEntries) ||
    hasChangedRuntimeObjectContent(snapshot, current)
  );
}

// A restore must preserve every present independent record's value, not just its ID.
// Without P6H ownership metadata, even manual revision/Decision changes fail closed.
function hasChangedRecords<T>(snapshot: Record<string, T>, current: Record<string, T>): boolean {
  return Object.entries(current).some(([id, record]) => !sameValue(snapshot[id], record));
}

function hasChangedHistory<T extends { id: string }>(snapshot: T[], current: T[]): boolean {
  return hasChangedRecords(Object.fromEntries(snapshot.map((record) => [record.id, record])), Object.fromEntries(current.map((record) => [record.id, record])));
}

function hasChangedRuntimeObjectContent(snapshot: MorphoWorkspace, current: MorphoWorkspace): boolean {
  return Object.values(current.objects).some((object) => {
    const previous = snapshot.objects[object.id];
    if (object.type === "file" && previous?.type === "file") {
      const runtimeFields = ["assetId", "extractedAssetId", "parseStatus", "parseError", "parsedAt", "extractedCharCount", "extractedPageCount", "sourcePageCount", "extractionTruncated"] as const;
      return runtimeFields.some((field) => !sameValue(previous[field], object[field]));
    }
    return object.type === "image" && previous?.type === "image" &&
      (!sameValue(previous.generation, object.generation) || previous.assetId !== object.assetId);
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  // Omitted optional fields and JSON's omitted undefined fields have the same persisted value.
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  return [...keys].every((key) => sameValue(leftRecord[key], rightRecord[key]));
}

function hasNewRecord(snapshotIds: string[], currentIds: string[]): boolean {
  const snapshotIdSet = new Set(snapshotIds);
  return currentIds.some((id) => !snapshotIdSet.has(id));
}

// Domain actions now produce their deterministic current projections before returning.
// Those new current revisions are not independent writes; their authority is guarded above.
// Existing historical edits and unrelated added historical revisions still block restore.
function hasChangedProjectionRecords<T>(snapshot: Record<string, T>, current: Record<string, T>, currentIds: Array<string | undefined>): boolean {
  const derivedCurrent = new Set(currentIds);
  return Object.entries(current).some(([id, record]) => id in snapshot ? !sameValue(snapshot[id], record) : !derivedCurrent.has(id));
}
