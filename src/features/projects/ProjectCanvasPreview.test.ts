import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/test/createTestWorkspace";
import {
  extractProjectPreviewSnapshot,
  getProjectCanvasPreviewNodes,
  getProjectPreviewAssets
} from "./ProjectCanvasPreview";

describe("project canvas preview", () => {
  it("keeps the active canvas layout and image asset storageKey references without loading a canvas editor", () => {
    const workspace = createTestWorkspace();
    const nodes = getProjectCanvasPreviewNodes(workspace);

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "canvas-image-preview-a", type: "image" }),
        expect.objectContaining({ id: "canvas-definition", type: "designDefinition" })
      ])
    );
    expect(nodes.every((node) => node.x >= 0 && node.y >= 0 && node.w > 0 && node.h > 0)).toBe(true);
  });

  it("collects only image assets represented in the preview keyed by storageKey", () => {
    const workspace = createTestWorkspace();
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

    expect(assets["blob:preview"]).toBeDefined();
    expect(assets["blob:preview"]?.id).toBe("asset-preview");
    expect(Object.values(assets).every((asset) => asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage")).toBe(true);
  });

  it("keeps distinct preview binaries isolated across projects even when assetId collides", () => {
    const base = createTestWorkspace();
    const previewImage = base.objects["image-soft-rail-preview"];
    if (!previewImage || previewImage.type !== "image") {
      throw new Error("Expected seeded preview image.");
    }

    const projectA = {
      ...base,
      project: { ...base.project, id: "proj-original" },
      objects: {
        ...base.objects,
        [previewImage.id]: { ...previewImage, assetId: "asset-shared-id" }
      },
      assets: {
        ...base.assets,
        "asset-shared-id": {
          id: "asset-shared-id",
          fileName: "a.png",
          mimeType: "image/png",
          size: 100,
          createdAt: "2026-07-10T00:00:00.000Z",
          storageKey: "blob:proj-original:shared",
          sourceType: "originalImage" as const
        }
      }
    };

    const projectB = {
      ...base,
      project: { ...base.project, id: "proj-restored-copy" },
      objects: {
        ...base.objects,
        [previewImage.id]: { ...previewImage, assetId: "asset-shared-id" }
      },
      assets: {
        ...base.assets,
        "asset-shared-id": {
          id: "asset-shared-id",
          fileName: "b.png",
          mimeType: "image/png",
          size: 200,
          createdAt: "2026-07-11T00:00:00.000Z",
          storageKey: "blob:proj-restored-copy:shared",
          sourceType: "originalImage" as const
        }
      }
    };

    const combinedAssets = getProjectPreviewAssets({
      [projectA.project.id]: projectA,
      [projectB.project.id]: projectB
    });

    expect(combinedAssets["blob:proj-original:shared"]?.fileName).toBe("a.png");
    expect(combinedAssets["blob:proj-restored-copy:shared"]?.fileName).toBe("b.png");

    const snapA = extractProjectPreviewSnapshot(projectA);
    const snapB = extractProjectPreviewSnapshot(projectB);
    expect(snapA.nodes.find((node) => node.assetId === "asset-shared-id")?.storageKey).toBe(
      "blob:proj-original:shared"
    );
    expect(snapB.nodes.find((node) => node.assetId === "asset-shared-id")?.storageKey).toBe(
      "blob:proj-restored-copy:shared"
    );
  });
});
