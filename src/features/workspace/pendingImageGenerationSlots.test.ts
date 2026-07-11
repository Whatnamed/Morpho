import { describe, expect, it } from "vitest";

import { buildPendingImageGenerationSlots, removePendingImageGenerationSlot } from "./pendingImageGenerationSlots";

describe("pending image generation slots", () => {
  it("creates one transient slot for every planned image with a resolved canvas position", () => {
    const slots = buildPendingImageGenerationSlots({
      operationId: "operation-image-1",
      items: [
        { id: "item-a", title: "概念图 A", role: "conceptImage" },
        { id: "item-b", title: "细节图 B", role: "detailStudy" }
      ],
      placements: new Map([
        ["item-a", { x: 120, y: 240 }],
        ["item-b", { x: 480, y: 240 }]
      ]),
      size: { w: 320, h: 220 }
    });

    expect(slots).toEqual([
      {
        id: "operation-image-1:item-a",
        operationId: "operation-image-1",
        planItemId: "item-a",
        title: "概念图 A",
        role: "conceptImage",
        position: { x: 120, y: 240 },
        size: { w: 320, h: 220 }
      },
      {
        id: "operation-image-1:item-b",
        operationId: "operation-image-1",
        planItemId: "item-b",
        title: "细节图 B",
        role: "detailStudy",
        position: { x: 480, y: 240 },
        size: { w: 320, h: 220 }
      }
    ]);
  });

  it("removes only the slot replaced by a completed image", () => {
    const slots = buildPendingImageGenerationSlots({
      operationId: "operation-image-1",
      items: [
        { id: "item-a", title: "概念图 A", role: "conceptImage" },
        { id: "item-b", title: "细节图 B", role: "detailStudy" }
      ],
      placements: new Map([
        ["item-a", { x: 120, y: 240 }],
        ["item-b", { x: 480, y: 240 }]
      ]),
      size: { w: 320, h: 220 }
    });

    expect(removePendingImageGenerationSlot(slots, "operation-image-1", "item-a")).toEqual([slots[1]]);
  });
});
