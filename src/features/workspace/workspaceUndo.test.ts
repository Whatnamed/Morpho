import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { popDetailNavigation, pushDetailNavigation } from "./workspaceNavigation";
import {
  SNAPSHOT_HISTORY_LIMIT,
  createSnapshotHistory,
  pushSnapshotHistoryEntry,
  redoSnapshotHistory,
  shouldBlockSnapshotUndo,
  undoSnapshotHistory,
  type SnapshotHistory
} from "./workspaceUndo";

type TestEntry = {
  workspace: MorphoWorkspace;
  label: string;
};

function renameProject(workspace: MorphoWorkspace, title: string): MorphoWorkspace {
  return {
    ...workspace,
    project: {
      ...workspace.project,
      title
    }
  };
}

function appendAiMessage(workspace: MorphoWorkspace, messageId: string): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: messageId,
          role: "assistant",
          body: "AI 已生成新的分析。",
          status: "done"
        }
      ]
    }
  };
}

function historyWith(entries: TestEntry[]): SnapshotHistory<TestEntry> {
  return entries.reduce(
    (history, entry) => pushSnapshotHistoryEntry(history, entry),
    createSnapshotHistory<TestEntry>()
  );
}

describe("workspace object-operation undo history", () => {
  it("restores the latest manual snapshot and moves the current state onto the redo stack", () => {
    const before = createInitialWorkspace();
    const after = renameProject(before, "手动改名后的项目");
    const history = historyWith([{ workspace: before, label: "before" }]);

    const result = undoSnapshotHistory(history, after, () => ({ workspace: after, label: "after" }));

    expect(result.status).toBe("restored");
    if (result.status !== "restored") {
      throw new Error("Expected the manual snapshot to restore.");
    }
    expect(result.entry.label).toBe("before");
    expect(result.history.undo).toHaveLength(0);
    expect(result.history.redo.map((entry) => entry.label)).toEqual(["after"]);
  });

  it("keeps a protected snapshot on the stack instead of consuming it after an AI turn", () => {
    const before = createInitialWorkspace();
    const withAiContent = appendAiMessage(before, "ai-message-new");
    const history = historyWith([{ workspace: before, label: "before-ai" }]);

    const result = undoSnapshotHistory(history, withAiContent, () => ({
      workspace: withAiContent,
      label: "current"
    }));

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") {
      throw new Error("Expected the snapshot to be blocked.");
    }
    expect(result.history.undo.map((entry) => entry.label)).toEqual(["before-ai"]);
    expect(result.history.redo).toHaveLength(0);
  });

  it("does not burn history when undo is pressed repeatedly against a protected snapshot", () => {
    const before = createInitialWorkspace();
    const withAiContent = appendAiMessage(before, "ai-message-new");
    let history = historyWith([
      { workspace: before, label: "older" },
      { workspace: before, label: "newer" }
    ]);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = undoSnapshotHistory(history, withAiContent, () => ({
        workspace: withAiContent,
        label: "current"
      }));
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") {
        throw new Error("Expected the snapshot to stay blocked.");
      }
      history = result.history;
    }

    expect(history.undo.map((entry) => entry.label)).toEqual(["older", "newer"]);
    expect(history.redo).toHaveLength(0);
  });

  it("redoes a restored snapshot symmetrically", () => {
    const before = createInitialWorkspace();
    const after = renameProject(before, "手动改名后的项目");
    const history = historyWith([{ workspace: before, label: "before" }]);

    const undone = undoSnapshotHistory(history, after, () => ({ workspace: after, label: "after" }));
    if (undone.status !== "restored") {
      throw new Error("Expected the manual snapshot to restore.");
    }

    const redone = redoSnapshotHistory(undone.history, undone.entry.workspace, () => ({
      workspace: undone.entry.workspace,
      label: "before"
    }));

    expect(redone.status).toBe("restored");
    if (redone.status !== "restored") {
      throw new Error("Expected the redo snapshot to restore.");
    }
    expect(redone.entry.label).toBe("after");
    expect(redone.history.undo.map((entry) => entry.label)).toEqual(["before"]);
    expect(redone.history.redo).toHaveLength(0);
  });

  it("blocks redo without consuming it when new content appeared after the undo", () => {
    const before = createInitialWorkspace();
    const after = renameProject(before, "手动改名后的项目");
    const history = historyWith([{ workspace: before, label: "before" }]);

    const undone = undoSnapshotHistory(history, after, () => ({ workspace: after, label: "after" }));
    if (undone.status !== "restored") {
      throw new Error("Expected the manual snapshot to restore.");
    }

    const withAiContent = appendAiMessage(undone.entry.workspace, "ai-message-after-undo");
    const redone = redoSnapshotHistory(undone.history, withAiContent, () => ({
      workspace: withAiContent,
      label: "current"
    }));

    expect(redone.status).toBe("blocked");
    if (redone.status !== "blocked") {
      throw new Error("Expected the redo snapshot to be blocked.");
    }
    expect(redone.history.redo.map((entry) => entry.label)).toEqual(["after"]);
  });

  it("clears the redo stack when a new explicit operation starts a fresh forward path", () => {
    const before = createInitialWorkspace();
    const after = renameProject(before, "手动改名后的项目");
    const history = historyWith([{ workspace: before, label: "before" }]);

    const undone = undoSnapshotHistory(history, after, () => ({ workspace: after, label: "after" }));
    if (undone.status !== "restored") {
      throw new Error("Expected the manual snapshot to restore.");
    }
    expect(undone.history.redo).toHaveLength(1);

    const next = pushSnapshotHistoryEntry(undone.history, {
      workspace: undone.entry.workspace,
      label: "new-operation"
    });

    expect(next.redo).toHaveLength(0);
    expect(next.undo.map((entry) => entry.label)).toEqual(["new-operation"]);
  });

  it("caps the undo stack at the history limit", () => {
    const base = createInitialWorkspace();
    let history = createSnapshotHistory<TestEntry>();
    for (let index = 0; index < SNAPSHOT_HISTORY_LIMIT + 5; index += 1) {
      history = pushSnapshotHistoryEntry(history, { workspace: base, label: `entry-${index}` });
    }

    expect(history.undo).toHaveLength(SNAPSHOT_HISTORY_LIMIT);
    expect(history.undo[0].label).toBe("entry-5");
  });

  it("keeps detail-navigation undo and object-operation undo independent", () => {
    const before = createInitialWorkspace();
    const after = renameProject(before, "手动改名后的项目");
    const objectHistory = historyWith([{ workspace: before, label: "object-op" }]);
    const detailHistory = pushDetailNavigation([], {
      view: { x: 100, y: 200, zoom: 0.8 },
      selectedObjectIds: ["image-soft-rail-v2"]
    });

    // Detail navigation restores without touching the object-operation stack.
    const detailRestored = popDetailNavigation(detailHistory);
    expect(detailRestored?.snapshot.selectedObjectIds).toEqual(["image-soft-rail-v2"]);
    expect(objectHistory.undo).toHaveLength(1);

    // Object-operation undo restores without touching the detail-navigation stack.
    const result = undoSnapshotHistory(objectHistory, after, () => ({ workspace: after, label: "after" }));
    expect(result.status).toBe("restored");
    expect(detailHistory).toHaveLength(1);
  });

  it("blocks snapshot undo when project content was created after the snapshot", () => {
    const snapshot = createInitialWorkspace();
    const current = {
      ...snapshot,
      objects: {
        ...snapshot.objects,
        "research-generated": {
          id: "research-generated",
          type: "research" as const,
          title: "Generated research",
          summary: "AI generated research card",
          createdBy: "ai" as const,
          visibility: "active" as const,
          findings: ["发现：一句说明"],
          opportunities: [],
          constraints: [],
          openQuestions: [],
          evidence: []
        }
      },
      canvas: {
        ...snapshot.canvas,
        instances: [
          ...snapshot.canvas.instances,
          {
            id: "canvas-research-generated",
            objectId: "research-generated",
            position: { x: 100, y: 100 },
            size: { w: 320, h: 180 }
          }
        ]
      }
    };

    expect(shouldBlockSnapshotUndo(snapshot, current)).toBe(true);
  });

  it("allows snapshot undo when no project content was created after the snapshot", () => {
    const snapshot = createInitialWorkspace();
    const current = {
      ...snapshot,
      objects: {
        ...snapshot.objects,
        "image-soft-rail-v2": {
          ...snapshot.objects["image-soft-rail-v2"],
          visibility: "hidden" as const
        }
      }
    };

    expect(shouldBlockSnapshotUndo(snapshot, current)).toBe(false);
  });
});
