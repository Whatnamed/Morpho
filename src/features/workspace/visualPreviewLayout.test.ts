import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "../../domain/morpho/workspace";

import { planDirectionPreviewPlacements, planVisualDevelopmentPlacements } from "./visualPreviewLayout";

describe("direction preview layout planning", () => {
  it("places same-direction multi previews in a stable non-overlapping grid near the direction card", () => {
    const workspace = createInitialWorkspace();
    const placements = planDirectionPreviewPlacements(workspace, [
      { id: "soft-1", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-2", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-3", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-4", targetDirectionId: "direction-soft-rail", width: 240, height: 180 }
    ]);

    expect(placements.map((placement) => placement.planItemId)).toEqual(["soft-1", "soft-2", "soft-3", "soft-4"]);
    expect(new Set(placements.map((placement) => `${placement.position.x},${placement.position.y}`)).size).toBe(4);
    expect(hasOverlap(placements)).toBe(false);
    expect(placements.every((placement) => placement.position.y > 250)).toBe(true);
  });

  it("starts a new round below existing same-direction images instead of covering them", () => {
    const workspace = createInitialWorkspace();
    const placements = planDirectionPreviewPlacements(workspace, [
      { id: "soft-new-1", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-new-2", targetDirectionId: "direction-soft-rail", width: 240, height: 180 }
    ]);

    const existingSoftRailImages = workspace.canvas.instances.filter((instance) => {
      const object = workspace.objects[instance.objectId];
      return object?.type === "image" && object.directionId === "direction-soft-rail";
    });
    const lowestExistingY = Math.max(...existingSoftRailImages.map((instance) => instance.position.y + instance.size.h));

    expect(Math.min(...placements.map((placement) => placement.position.y))).toBeGreaterThan(lowestExistingY);
    expect(hasOverlap(placements)).toBe(false);
  });

  it("keeps a precomputed batch grid stable when generated previews are inserted sequentially", () => {
    const workspace = createInitialWorkspace();
    const items = [
      { id: "soft-1", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-2", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-3", targetDirectionId: "direction-soft-rail", width: 240, height: 180 },
      { id: "soft-4", targetDirectionId: "direction-soft-rail", width: 240, height: 180 }
    ];
    const precomputed = planDirectionPreviewPlacements(workspace, items);
    const sequentialWorkspace = precomputed.reduce<ReturnType<typeof createInitialWorkspace>>(
      (current, placement) => ({
        ...current,
        objects: {
          ...current.objects,
          [`generated-${placement.planItemId}`]: {
            id: `generated-${placement.planItemId}`,
            type: "image" as const,
            title: placement.planItemId,
            summary: "generated preview",
            createdBy: "ai" as const,
            visibility: "active" as const,
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            role: "conceptImage" as const,
            directionId: placement.targetDirectionId
          }
        },
        canvas: {
          ...current.canvas,
          instances: [
            ...current.canvas.instances,
            {
              id: `canvas-generated-${placement.planItemId}`,
              objectId: `generated-${placement.planItemId}`,
              position: placement.position,
              size: placement.size
            }
          ]
        }
      }),
      workspace
    );

    const recomputedAfterSequentialWrites = planDirectionPreviewPlacements(sequentialWorkspace, items);

    expect(precomputed.map((placement) => placement.position)).not.toEqual(
      recomputedAfterSequentialWrites.map((placement) => placement.position)
    );
    expect(hasOverlap(precomputed)).toBe(false);
  });

  it("places previews to the right of vertically stacked directions without covering any direction card", () => {
    const workspace = createBlankWorkspace("direction-preview-lanes");
    for (const [index, directionId] of ["direction-a", "direction-b", "direction-c"].entries()) {
      workspace.objects[directionId] = {
        id: directionId,
        type: "conceptDirection",
        title: directionId,
        summary: directionId,
        createdBy: "ai",
        visibility: "active",
        status: "pendingPreview",
        keywords: [],
        currentRevisionId: `revision-${directionId}`,
        revisionIds: [`revision-${directionId}`],
        lineageRootId: directionId
      };
      workspace.canvas.instances.push({
        id: `canvas-${directionId}`,
        objectId: directionId,
        position: { x: 600, y: 120 + index * 272 },
        size: { w: 320, h: 240 }
      });
    }

    const placements = planDirectionPreviewPlacements(workspace, [
      { id: "preview-a", targetDirectionId: "direction-a", width: 320, height: 320 },
      { id: "preview-b", targetDirectionId: "direction-b", width: 320, height: 320 },
      { id: "preview-c", targetDirectionId: "direction-c", width: 320, height: 320 }
    ]);

    expect(placements.every((placement) => placement.position.x >= 1012)).toBe(true);
    expect(hasOverlap(placements)).toBe(false);
    expect(
      placements.every((placement) =>
        workspace.canvas.instances.every((instance) => {
          const separated =
            placement.position.x + placement.size.w <= instance.position.x ||
            instance.position.x + instance.size.w <= placement.position.x ||
            placement.position.y + placement.size.h <= instance.position.y ||
            instance.position.y + instance.size.h <= placement.position.y;
          return separated;
        })
      )
    ).toBe(true);
  });

  it("places image iterations to the right of the selected source image instead of in the direction preview lane", () => {
    const workspace = createBlankWorkspace("visual-development-source-lane");
    workspace.objects["direction-a"] = {
      id: "direction-a",
      type: "conceptDirection",
      title: "Direction A",
      summary: "Direction A",
      createdBy: "ai",
      visibility: "active",
      status: "pendingPreview",
      keywords: [],
      currentRevisionId: "revision-direction-a",
      revisionIds: ["revision-direction-a"],
      lineageRootId: "direction-a"
    };
    workspace.objects["source-image"] = {
      id: "source-image",
      type: "image",
      title: "Source preview",
      summary: "Source preview",
      createdBy: "ai",
      visibility: "active",
      role: "conceptImage",
      directionId: "direction-a"
    };
    workspace.canvas.instances.push(
      {
        id: "canvas-direction-a",
        objectId: "direction-a",
        position: { x: 600, y: 200 },
        size: { w: 320, h: 240 }
      },
      {
        id: "canvas-source-image",
        objectId: "source-image",
        position: { x: 1100, y: 200 },
        size: { w: 240, h: 240 }
      }
    );

    const placements = planVisualDevelopmentPlacements(workspace, [
      {
        id: "iteration-a",
        referenceObjectIds: ["direction-a", "source-image"],
        targetDirectionId: "direction-a",
        width: 240,
        height: 240
      },
      {
        id: "iteration-b",
        referenceObjectIds: ["direction-a", "source-image"],
        targetDirectionId: "direction-a",
        width: 240,
        height: 240
      }
    ]);

    expect(placements.map((placement) => placement.position)).toEqual([
      { x: 1432, y: 200 },
      { x: 1704, y: 200 }
    ]);
  });
});

function hasOverlap(placements: ReturnType<typeof planDirectionPreviewPlacements>): boolean {
  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      const left = placements[leftIndex];
      const right = placements[rightIndex];
      if (!left || !right) {
        continue;
      }
      const separated =
        left.position.x + left.size.w <= right.position.x ||
        right.position.x + right.size.w <= left.position.x ||
        left.position.y + left.size.h <= right.position.y ||
        right.position.y + right.size.h <= left.position.y;
      if (!separated) {
        return true;
      }
    }
  }
  return false;
}
