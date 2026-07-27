import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { hasCanvasEditorSyncInputChange, type CanvasEditorSyncInputs } from "./canvasEditorSyncInputs";

describe("canvas editor sync inputs", () => {
  it("ignores conversation-only workspace updates", () => {
    const previous = createInputs();
    const workspace = previous.workspace;
    const message = workspace.ai.messages.at(-1);
    if (!message) {
      throw new Error("Expected the fixture to contain an AI message.");
    }
    const next: CanvasEditorSyncInputs = {
      ...previous,
      workspace: {
        ...workspace,
        ai: {
          ...workspace.ai,
          messages: workspace.ai.messages.map((candidate) =>
            candidate.id === message.id ? { ...candidate, body: `${candidate.body} stream` } : candidate
          )
        }
      }
    };

    expect(hasCanvasEditorSyncInputChange(previous, next)).toBe(false);
  });

  it("detects workspace fields and presentation state used by editor shapes", () => {
    const previous = createInputs();
    const workspace = previous.workspace;

    expect(hasCanvasEditorSyncInputChange(null, previous)).toBe(true);
    expect(hasCanvasEditorSyncInputChange(previous, {
      ...previous,
      workspace: {
        ...workspace,
        canvas: { ...workspace.canvas, instances: [...workspace.canvas.instances] }
      }
    })).toBe(true);
    expect(hasCanvasEditorSyncInputChange(previous, {
      ...previous,
      workspace: { ...workspace, objects: { ...workspace.objects } }
    })).toBe(true);
    expect(hasCanvasEditorSyncInputChange(previous, { ...previous, highlightedObjectId: "highlighted" })).toBe(true);
    expect(hasCanvasEditorSyncInputChange(previous, { ...previous, traceObjectIds: ["trace-object"] })).toBe(true);
    expect(hasCanvasEditorSyncInputChange(previous, { ...previous, assetUrls: { "asset-a": "blob:a" } })).toBe(true);
  });
});

function createInputs(): CanvasEditorSyncInputs {
  return {
    workspace: createTestWorkspace(),
    annotatedObjectId: null,
    highlightedObjectId: null,
    assetUrls: {},
    traceObjectIds: []
  };
}
