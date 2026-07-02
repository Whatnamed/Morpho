import { describe, expect, it } from "vitest";

import { addObjectsToDeliverySection } from "@/domain/morpho/deliveryPreparation";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { DeliveryObject } from "@/domain/morpho/types";
import {
  getDeliveryReferenceLocationTarget,
  getDeliveryReferencePreview
} from "./deliveryPreparationUi";

describe("delivery preparation UI helpers", () => {
  it("returns document reader location data for available document fragment references", () => {
    const initialWorkspace = createInitialWorkspace();
    const file = initialWorkspace.objects["file-course-brief"];
    if (!file || file.type !== "file") {
      throw new Error("Expected source file.");
    }
    const workspace = {
      ...initialWorkspace,
      objects: {
        ...initialWorkspace.objects,
        [file.id]: {
          ...file,
          parseStatus: "parsed" as const,
          extractedAssetId: "asset-course-brief-extract"
        }
      }
    };
    const delivery = workspace.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["fragment-course-goal"]
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const reference = added.workspace.deliveryReferences[added.createdReferenceIds[0] ?? ""];
    if (!reference) {
      throw new Error("Expected delivery reference.");
    }

    expect(getDeliveryReferenceLocationTarget(added.workspace, reference)).toMatchObject({
      kind: "documentFragmentSource",
      fileObjectId: "file-course-brief",
      label: "查看原文定位",
      initialLocation: {
        startOffset: reference.snapshot.sourceFile?.startOffset,
        endOffset: reference.snapshot.sourceFile?.endOffset,
        label: reference.snapshot.title
      }
    });
  });

  it("resolves image preview from the stable snapshot asset instead of the live source", () => {
    const workspace = createInitialWorkspace();
    const delivery = workspace.objects["delivery-board-a1"] as DeliveryObject;
    const sectionId = delivery.sections[0]?.id ?? "";
    const added = addObjectsToDeliverySection(workspace, {
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-soft-rail-v2"]
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const reference = added.workspace.deliveryReferences[added.createdReferenceIds[0] ?? ""];
    if (!reference) {
      throw new Error("Expected delivery reference.");
    }
    const snapshotAssetId = "asset-stable-preview";
    const referenceWithAsset = {
      ...reference,
      snapshot: {
        ...reference.snapshot,
        previewAsset: {
          assetId: snapshotAssetId,
          alt: "稳定快照预览"
        }
      }
    };

    expect(getDeliveryReferencePreview(referenceWithAsset, { [snapshotAssetId]: "blob:stable-preview" })).toEqual({
      status: "ready",
      url: "blob:stable-preview",
      alt: "稳定快照预览"
    });
    expect(getDeliveryReferencePreview(referenceWithAsset, {})).toEqual({
      status: "assetMissing",
      label: "原始资产当前不可用"
    });
  });
});
