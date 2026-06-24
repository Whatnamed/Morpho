import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createDeliveryReference, createInitialWorkspace, hideObject } from "./workspace";
import { importUrlObject } from "./imports";
import { getWorkspaceAssetItems, searchWorkspace } from "./queries";

describe("Morpho workspace query helpers", () => {
  it("searches hidden objects and marks them without adding them to renderable canvas content", () => {
    const workspace = hideObject(createInitialWorkspace(), "image-soft-rail-v2");

    const results = searchWorkspace(workspace, "柔光轨道 v2");

    expect(results.some((result) => result.kind === "object" && result.objectId === "image-soft-rail-v2" && result.hidden)).toBe(
      true
    );
  });

  it("searches stable delivery reference snapshots after source changes", () => {
    const created = createDeliveryReference(createInitialWorkspace(), {
      deliveryObjectId: "delivery-board-a1",
      sourceObjectId: "insight-continuous-support",
      caption: "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    });

    if (created.status !== "updated") {
      throw new Error("Expected delivery reference creation.");
    }

    const results = searchWorkspace(created.workspace, "交付摘要");

    expect(results.some((result) => result.kind === "deliveryReference" && result.referenceId === created.deliveryReferenceId)).toBe(
      true
    );
  });

  it("lists original link assets without turning process objects into assets", () => {
    const imported = importUrlObject(createBlankWorkspace("project-assets"), {
      url: "https://example.com/reference",
      position: { x: 0, y: 0 }
    }).workspace;

    const items = getWorkspaceAssetItems(imported);

    expect(items).toHaveLength(1);
    expect(items[0]?.asset.sourceType).toBe("originalLink");
    expect(items[0]?.objects[0]?.type).toBe("link");
  });
});
