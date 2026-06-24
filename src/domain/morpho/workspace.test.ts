import { describe, expect, it } from "vitest";

import {
  assembleAiContext,
  createAiDraftFromSuggestion,
  createDeliveryReference,
  createInitialWorkspace,
  deleteObject,
  getRenderableCanvasInstances,
  hideObject,
  migrateWorkspaceToCurrentSchema,
  setDefaultReference,
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

  it("hides objects without deleting objects, relations, or creating decision records", () => {
    const workspace = createInitialWorkspace();
    const hidden = hideObject(workspace, "image-soft-rail-v2");

    expect(hidden.objects["image-soft-rail-v2"]?.visibility).toBe("hidden");
    expect(hidden.relations).toEqual(workspace.relations);
    expect(hidden.decisionRecords).toEqual(workspace.decisionRecords);
    expect(getRenderableCanvasInstances(hidden).some((instance) => instance.objectId === "image-soft-rail-v2")).toBe(
      false
    );
  });

  it("keeps a hidden default reference as state but excludes it from visual AI context", () => {
    const workspace = hideObject(createInitialWorkspace(), "image-soft-rail-v2");

    expect(workspace.objects["image-soft-rail-v2"]?.type).toBe("image");
    expect(workspace.objects["image-soft-rail-v2"]?.visibility).toBe("hidden");

    const context = assembleAiContext(workspace, {
      draft: "继续发展主方向的视觉细节。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "visualDevelopment"
    });

    expect(context.objectIds).not.toContain("image-soft-rail-v2");
    expect(context.defaultReferenceStatus).toEqual({
      status: "hidden",
      objectId: "image-soft-rail-v2",
      message: "当前后续默认参考已隐藏，请先恢复或替换后再用于相关生成。"
    });
  });

  it("requires confirmation before deleting an object that still has active references", () => {
    const workspace = createInitialWorkspace();
    const result = deleteObject(workspace, "image-soft-rail-v2");

    expect(result.status).toBe("requiresConfirmation");
    if (result.status !== "requiresConfirmation") {
      throw new Error("Expected deleteObject to require confirmation.");
    }
    expect(result.workspace).toBe(workspace);
    expect(result.reasons).toContain("对象是当前后续默认参考。");
  });

  it("confirmed deletion removes live references without damaging delivery reference snapshots", () => {
    const workspace = createInitialWorkspace();
    const deliveryReferenceBefore = workspace.deliveryReferences["delivery-ref-board-main"];

    const result = deleteObject(workspace, "image-soft-rail-v2", {
      confirmed: true,
      reason: "用户明确删除默认参考源图。"
    });

    expect(result.status).toBe("updated");
    expect(result.workspace.objects["image-soft-rail-v2"]).toBeUndefined();
    expect(result.workspace.canvas.instances.some((instance) => instance.objectId === "image-soft-rail-v2")).toBe(
      false
    );
    expect(
      result.workspace.relations.some(
        (relation) => relation.fromObjectId === "image-soft-rail-v2" || relation.toObjectId === "image-soft-rail-v2"
      )
    ).toBe(false);
    expect(result.workspace.deliveryReferences["delivery-ref-board-main"].snapshot).toEqual(
      deliveryReferenceBefore.snapshot
    );
    expect(result.workspace.decisionRecords.at(-1)?.objectSnapshot).toEqual({
      id: "image-soft-rail-v2",
      type: "image",
      title: "柔光轨道 v2"
    });
  });

  it("keeps delivery reference snapshots stable after the source object changes or disappears", () => {
    const workspace = createInitialWorkspace();
    const created = createDeliveryReference(workspace, {
      deliveryObjectId: "delivery-board-a1",
      sourceObjectId: "insight-continuous-support",
      caption: "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    });

    expect(created.status).toBe("updated");
    if (created.status !== "updated") {
      throw new Error("Expected createDeliveryReference to update the workspace.");
    }

    const sourceChanged = {
      ...created.workspace,
      objects: {
        ...created.workspace.objects,
        "insight-continuous-support": {
          ...created.workspace.objects["insight-continuous-support"],
          title: "已改名的源对象",
          visibility: "hidden" as const
        }
      }
    };
    const deleted = deleteObject(sourceChanged, "insight-continuous-support", {
      confirmed: true,
      reason: "用户明确删除源结论。"
    });

    expect(deleted.status).toBe("updated");
    expect(deleted.workspace.deliveryReferences[created.deliveryReferenceId].snapshot.title).toBe(
      "连续支持比单点扶手更符合真实动作路径"
    );
    expect(deleted.workspace.deliveryReferences[created.deliveryReferenceId].snapshot.caption).toBe(
      "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    );
  });

  it("sets exactly one active image as the default reference without touching delivery references", () => {
    const workspace = createInitialWorkspace();
    const deliveryReferenceBefore = structuredClone(workspace.deliveryReferences);

    const updated = setDefaultReference(workspace, "image-night-scenario", {
      reason: "用户选择夜间场景作为下一轮视觉生成基线。"
    });

    const defaultImages = Object.values(updated.objects).filter(
      (object) => object.type === "image" && object.isDefaultReference
    );

    expect(defaultImages.map((object) => object.id)).toEqual(["image-night-scenario"]);
    expect(updated.deliveryReferences).toEqual(deliveryReferenceBefore);
    expect(updated.decisionRecords.at(-1)?.kind).toBe("setDefaultReference");
  });

  it("migrates v1 workspace data to schema v2 without mutating the source object", () => {
    const legacyWorkspace = {
      schemaVersion: 1,
      project: {
        id: "legacy-project",
        title: "Legacy",
        subtitle: "旧数据",
        currentFocus: "direction_visual_development"
      },
      objects: {
        "image-a": {
          id: "image-a",
          type: "image",
          title: "旧主图",
          summary: "旧版本图片",
          createdBy: "ai",
          role: "main",
          imageVariant: "rail",
          isDefaultReference: true
        },
        "delivery-a": {
          id: "delivery-a",
          type: "delivery",
          title: "旧交付模块",
          summary: "旧版本交付",
          createdBy: "user",
          format: "board",
          references: ["image-a"],
          gaps: []
        }
      },
      relations: [],
      canvas: {
        view: { x: 0, y: 0, zoom: 1 },
        instances: []
      },
      ai: {
        messages: []
      }
    };
    const before = structuredClone(legacyWorkspace);

    const result = migrateWorkspaceToCurrentSchema(legacyWorkspace);

    expect(result.status).toBe("ok");
    expect(legacyWorkspace).toEqual(before);
    if (result.status === "ok") {
      expect(result.workspace.schemaVersion).toBe(2);
      expect(result.workspace.objects["image-a"]?.visibility).toBe("active");
      expect(Object.values(result.workspace.deliveryReferences)).toHaveLength(1);
      expect(result.workspace.objects["delivery-a"]?.type).toBe("delivery");
      const deliveryObject = result.workspace.objects["delivery-a"];
      expect(deliveryObject?.type).toBe("delivery");
      if (deliveryObject?.type !== "delivery") {
        throw new Error("Expected migrated object to be a delivery object.");
      }
      expect(deliveryObject.references).toEqual(["delivery-ref-delivery-a-image-a"]);
    }
  });

  it("reports migration failure without producing replacement seed data", () => {
    const result = migrateWorkspaceToCurrentSchema({ schemaVersion: 99, objects: {} });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected migration to fail.");
    }
    expect(result.reason).toBe("Unsupported Morpho workspace schema version.");
  });
});
