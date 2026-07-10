import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "./workspace";
import { findAvailableCanvasPosition } from "./canvasPlacement";

describe("canvas placement", () => {
  it("moves a generated object below an occupied preferred position", () => {
    const workspace = createBlankWorkspace("placement-occupied");
    workspace.objects.existing = {
      id: "existing",
      type: "text",
      title: "Existing",
      summary: "Existing canvas object",
      body: "Existing canvas object",
      createdBy: "user",
      visibility: "active"
    };
    workspace.canvas.instances.push({
      id: "canvas-existing",
      objectId: "existing",
      position: { x: 400, y: 240 },
      size: { w: 320, h: 240 }
    });

    expect(
      findAvailableCanvasPosition(workspace, {
        preferred: { x: 400, y: 240 },
        size: { w: 320, h: 240 },
        gap: 32
      })
    ).toEqual({ x: 400, y: 512 });
  });

  it("reserves planned batch positions before objects are written", () => {
    const workspace = createBlankWorkspace("placement-reserved");
    const first = findAvailableCanvasPosition(workspace, {
      preferred: { x: 800, y: 200 },
      size: { w: 320, h: 240 }
    });
    const second = findAvailableCanvasPosition(workspace, {
      preferred: { x: 800, y: 200 },
      size: { w: 320, h: 240 },
      reserved: [{ position: first, size: { w: 320, h: 240 } }]
    });

    expect(first).toEqual({ x: 800, y: 200 });
    expect(second.y).toBeGreaterThanOrEqual(first.y + 240);
  });

  it("does not treat hidden objects as visible placement obstacles", () => {
    const workspace = createBlankWorkspace("placement-hidden");
    workspace.objects.hidden = {
      id: "hidden",
      type: "text",
      title: "Hidden",
      summary: "Hidden canvas object",
      body: "Hidden canvas object",
      createdBy: "user",
      visibility: "hidden"
    };
    workspace.canvas.instances.push({
      id: "canvas-hidden",
      objectId: "hidden",
      position: { x: 120, y: 160 },
      size: { w: 320, h: 240 }
    });

    expect(
      findAvailableCanvasPosition(workspace, {
        preferred: { x: 120, y: 160 },
        size: { w: 320, h: 240 }
      })
    ).toEqual({ x: 120, y: 160 });
  });

  it("uses the nearest open lane instead of drifting far downward", () => {
    const workspace = createBlankWorkspace("placement-nearest");
    workspace.objects.tall = {
      id: "tall",
      type: "text",
      title: "Tall obstacle",
      summary: "Tall obstacle",
      body: "Tall obstacle",
      createdBy: "user",
      visibility: "active"
    };
    workspace.canvas.instances.push({
      id: "canvas-tall",
      objectId: "tall",
      position: { x: 800, y: 200 },
      size: { w: 320, h: 1000 }
    });

    expect(
      findAvailableCanvasPosition(workspace, {
        preferred: { x: 800, y: 200 },
        size: { w: 240, h: 240 },
        flow: "nearest"
      })
    ).toEqual({ x: 1152, y: 200 });
  });
});
