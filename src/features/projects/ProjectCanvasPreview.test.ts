import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { getProjectCanvasPreviewNodes, getProjectPreviewAssets } from "./ProjectCanvasPreview";

describe("project canvas preview", () => {
  it("keeps the active canvas layout and image asset references without loading a canvas editor", () => {
    const workspace = createInitialWorkspace();
    const nodes = getProjectCanvasPreviewNodes(workspace);

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "canvas-image-preview-a", type: "image" }),
        expect.objectContaining({ id: "canvas-definition", type: "designDefinition" })
      ])
    );
    expect(nodes.every((node) => node.x >= 0 && node.y >= 0 && node.w > 0 && node.h > 0)).toBe(true);
  });

  it("collects only image assets represented in the preview", () => {
    const workspace = createInitialWorkspace();
    const previewImage = workspace.objects["image-soft-rail-preview"];
    if (!previewImage || previewImage.type !== "image") {
      throw new Error("Expected seeded preview image.");
    }
    const previewWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [previewImage.id]: { ...previewImage, assetId: "asset-preview" }
      },
      assets: {
        ...workspace.assets,
        "asset-preview": {
          id: "asset-preview",
          fileName: "preview.png",
          mimeType: "image/png",
          size: 120,
          createdAt: "2026-07-10T00:00:00.000Z",
          storageKey: "blob:preview",
          sourceType: "aiGeneratedImage" as const
        }
      }
    };
    const assets = getProjectPreviewAssets({ [workspace.project.id]: previewWorkspace });

    expect(assets["asset-preview"]).toBeDefined();
    expect(Object.values(assets).every((asset) => asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage")).toBe(true);
  });
});
