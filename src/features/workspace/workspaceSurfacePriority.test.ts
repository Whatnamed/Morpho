import { describe, expect, it } from "vitest";

import { resolveTopWorkspaceSurface, type WorkspaceSurfacePriorityState } from "./workspaceSurfacePriority";

describe("workspace surface close priority", () => {
  it("returns canvas selection when no surface is open", () => {
    expect(resolveTopWorkspaceSurface(emptyPriority())).toBe("canvasSelection");
  });

  it("returns the first open surface in the complete priority order", () => {
    const order: Array<keyof WorkspaceSurfacePriorityState> = [
      "canvasContextMenuOpen",
      "proposalDetailOpen",
      "designDefinitionDetailOpen",
      "conceptDirectionDetailOpen",
      "researchDetailOpen",
      "documentReaderOpen",
      "deliveryPreparationOpen",
      "deliveryOutputOpen",
      "projectBundleOpen",
      "projectMenuOpen",
      "drawerOpen"
    ];

    order.forEach((key, index) => {
      const state = emptyPriority();
      for (const earlierKey of order.slice(0, index)) {
        state[earlierKey] = false;
      }
      state[key] = true;
      expect(resolveTopWorkspaceSurface(state)).toBe(
        [
          "canvasContextMenu",
          "proposalDetail",
          "designDefinitionDetail",
          "conceptDirectionDetail",
          "researchDetail",
          "documentReader",
          "deliveryPreparation",
          "deliveryOutput",
          "projectBundle",
          "projectMenu",
          "drawer"
        ][index]
      );
    });
  });

  it("keeps a higher surface ahead of every lower surface", () => {
    expect(
      resolveTopWorkspaceSurface({
        ...emptyPriority(),
        canvasContextMenuOpen: true,
        proposalDetailOpen: true,
        documentReaderOpen: true,
        drawerOpen: true
      })
    ).toBe("canvasContextMenu");
  });
});

function emptyPriority(): WorkspaceSurfacePriorityState {
  return {
    canvasContextMenuOpen: false,
    proposalDetailOpen: false,
    designDefinitionDetailOpen: false,
    conceptDirectionDetailOpen: false,
    researchDetailOpen: false,
    documentReaderOpen: false,
    deliveryPreparationOpen: false,
    deliveryOutputOpen: false,
    projectBundleOpen: false,
    projectMenuOpen: false,
    drawerOpen: false
  };
}
