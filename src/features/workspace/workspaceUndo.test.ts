import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";

import { shouldBlockSnapshotUndo } from "./workspaceUndo";

describe("workspaceUndo", () => {
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
