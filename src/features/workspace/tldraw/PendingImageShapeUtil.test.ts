import { describe, expect, it, vi } from "vitest";

import {
  createPendingImageShapePartial,
  isPendingImageShape,
  PENDING_IMAGE_SHAPE_TYPE,
  pendingImageShapeId,
  pendingSlotRoleLabel,
  syncPendingImageSlotsToEditor
} from "./PendingImageShapeUtil";

describe("PendingImageShapeUtil", () => {
  it("builds page-space pending shapes from generation slots", () => {
    const partial = createPendingImageShapePartial({
      id: "op1:item-a",
      operationId: "op1",
      planItemId: "item-a",
      title: "守望塔修订",
      role: "sceneVisual",
      position: { x: 120, y: 240 },
      size: { w: 320, h: 320 }
    });

    expect(partial.id).toBe(pendingImageShapeId("op1:item-a"));
    expect(partial.type).toBe(PENDING_IMAGE_SHAPE_TYPE);
    expect(partial.x).toBe(120);
    expect(partial.y).toBe(240);
    expect(partial.isLocked).toBe(true);
    expect(partial.props).toMatchObject({
      w: 320,
      h: 320,
      slotId: "op1:item-a",
      title: "守望塔修订",
      roleLabel: "正在生成场景图"
    });
    expect(pendingSlotRoleLabel("detailStudy")).toBe("正在生成细节图");
  });

  it("type-guards only pending image shapes", () => {
    expect(isPendingImageShape({ type: PENDING_IMAGE_SHAPE_TYPE } as never)).toBe(true);
    expect(isPendingImageShape({ type: "morpho-object" } as never)).toBe(false);
  });

  it("syncs create, update, and delete without touching other shapes", () => {
    const existing = {
      id: pendingImageShapeId("op1:item-a"),
      type: PENDING_IMAGE_SHAPE_TYPE,
      x: 10,
      y: 20,
      props: {
        w: 100,
        h: 100,
        slotId: "op1:item-a",
        title: "旧标题",
        roleLabel: "正在生成"
      }
    };
    const stale = {
      id: pendingImageShapeId("op1:item-stale"),
      type: PENDING_IMAGE_SHAPE_TYPE,
      x: 0,
      y: 0,
      props: {
        w: 100,
        h: 100,
        slotId: "op1:item-stale",
        title: "gone",
        roleLabel: "正在生成"
      }
    };

    const createShapes = vi.fn();
    const updateShapes = vi.fn();
    const deleteShapes = vi.fn();
    const run = vi.fn((fn: () => void) => fn());

    syncPendingImageSlotsToEditor(
      {
        getCurrentPageShapes: () => [existing, stale, { type: "morpho-object" }] as never,
        createShapes,
        updateShapes,
        deleteShapes,
        run
      },
      [
        {
          id: "op1:item-a",
          operationId: "op1",
          planItemId: "item-a",
          title: "新标题",
          role: "preview",
          position: { x: 50, y: 60 },
          size: { w: 200, h: 200 }
        },
        {
          id: "op1:item-b",
          operationId: "op1",
          planItemId: "item-b",
          title: "新增",
          role: "conceptImage",
          position: { x: 300, y: 60 },
          size: { w: 200, h: 200 }
        }
      ],
      { history: "ignore" }
    );

    expect(run).toHaveBeenCalled();
    expect(deleteShapes).toHaveBeenCalledWith([stale.id]);
    expect(createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: pendingImageShapeId("op1:item-b"),
        props: expect.objectContaining({ slotId: "op1:item-b", title: "新增" })
      })
    ]);
    expect(updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: existing.id,
        x: 50,
        y: 60,
        props: expect.objectContaining({ title: "新标题", w: 200, h: 200 })
      })
    ]);
  });
});
