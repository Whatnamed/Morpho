import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";

import { planDirectionPreviewPlacements } from "./visualPreviewLayout";

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
            imageVariant: "rail" as const,
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
