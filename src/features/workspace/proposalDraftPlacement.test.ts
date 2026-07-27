import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  getPlacementNearObjects,
  getProposalPlacement,
  getSiblingProposalPlacement
} from "./proposalDraftPlacement";

describe("proposal draft placement", () => {
  it("stacks sibling proposal drafts vertically with a stable gap", () => {
    const origin = { x: 640, y: 320 };

    expect(getSiblingProposalPlacement(origin, 0)).toEqual({ x: 640, y: 320 });
    expect(getSiblingProposalPlacement(origin, 1)).toEqual({ x: 640, y: 520 });
    expect(getSiblingProposalPlacement(origin, 2)).toEqual({ x: 640, y: 720 });
  });

  it("places work to the right of its source objects", () => {
    const workspace = createInitialWorkspace();
    const source = workspace.canvas.instances[0];
    expect(source).toBeDefined();

    expect(getPlacementNearObjects(workspace, [source!.objectId], { x: 1, y: 2 })).toEqual({
      x: source!.position.x + source!.size.w + 92,
      y: source!.position.y
    });
    expect(getPlacementNearObjects(workspace, ["missing"], { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2
    });
  });

  it("keeps proposal fallbacks tied to the current canvas view", () => {
    const workspace = createInitialWorkspace();
    expect(getProposalPlacement(workspace, [], "definition")).toEqual({
      x: workspace.canvas.view.x + 280,
      y: workspace.canvas.view.y + 180
    });
    expect(getProposalPlacement(workspace, [], "direction")).toEqual({
      x: workspace.canvas.view.x + 420,
      y: workspace.canvas.view.y + 220
    });
  });
});
