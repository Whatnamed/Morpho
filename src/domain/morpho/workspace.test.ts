import { describe, expect, it } from "vitest";

import {
  createAiDraftFromSuggestion,
  createInitialWorkspace,
  updateCanvasInstancePosition
} from "./workspace";

describe("Morpho workspace domain boundaries", () => {
  it("moves a canvas instance without changing object type, status, or relations", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances[0];
    const objectBefore = workspace.objects[instance.objectId];

    const updated = updateCanvasInstancePosition(workspace, instance.id, {
      x: instance.position.x + 320,
      y: instance.position.y + 80
    });

    expect(updated.canvas.instances[0].position).toEqual({
      x: instance.position.x + 320,
      y: instance.position.y + 80
    });
    expect(updated.objects[instance.objectId]).toEqual(objectBefore);
    expect(updated.relations).toEqual(workspace.relations);
  });

  it("turns an AI suggestion into an editable draft without mutating project state", () => {
    const workspace = createInitialWorkspace();
    const selectedObjectId = "image-soft-rail-v2";

    const result = createAiDraftFromSuggestion(workspace, {
      selectedObjectIds: [selectedObjectId],
      suggestion: "继续发展这张图，保留低位导向与暖光氛围。"
    });

    expect(result.workspace).toBe(workspace);
    expect(result.draft).toBe("继续发展这张图，保留低位导向与暖光氛围。");
    expect(result.contextObjectIds).toEqual([selectedObjectId]);
  });
});
