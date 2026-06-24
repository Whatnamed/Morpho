import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";
import { inferGenerationAspectRatio, resolveGenerationSettings } from "./imageGenerationSettings";

describe("workspace image generation settings", () => {
  it("uses the selected image asset ratio before the default reference", () => {
    const workspace = createInitialWorkspace();
    const withAssets = {
      ...workspace,
      objects: {
        ...workspace.objects,
        "image-path-reference": {
          ...workspace.objects["image-path-reference"],
          assetId: "asset-selected-wide"
        }
      },
      assets: {
        ...workspace.assets,
        "asset-selected-wide": {
          id: "asset-selected-wide",
          fileName: "selected-wide.png",
          mimeType: "image/png",
          size: 1000,
          createdAt: "2026-06-24T00:00:00.000Z",
          storageKey: "blob:asset-selected-wide",
          sourceType: "originalImage" as const,
          width: 1920,
          height: 1080,
          aspectRatio: 16 / 9
        }
      }
    };

    expect(inferGenerationAspectRatio(withAssets, ["image-path-reference"])).toBe("16:9");
  });

  it("uses the active default reference image ratio when no selected image has dimensions", () => {
    const workspace = createInitialWorkspace();
    const withDefaultReferenceAsset = {
      ...workspace,
      objects: {
        ...workspace.objects,
        "image-soft-rail-v2": {
          ...workspace.objects["image-soft-rail-v2"],
          assetId: "asset-default-portrait"
        }
      },
      assets: {
        ...workspace.assets,
        "asset-default-portrait": {
          id: "asset-default-portrait",
          fileName: "default-portrait.png",
          mimeType: "image/png",
          size: 1000,
          createdAt: "2026-06-24T00:00:00.000Z",
          storageKey: "blob:asset-default-portrait",
          sourceType: "aiGeneratedImage" as const,
          width: 900,
          height: 1600,
          aspectRatio: 9 / 16
        }
      }
    };

    expect(inferGenerationAspectRatio(withDefaultReferenceAsset, [])).toBe("9:16");
  });

  it("falls back to square when no image dimensions are available", () => {
    expect(inferGenerationAspectRatio(createInitialWorkspace(), [])).toBe("1:1");
  });

  it("only exposes size options supported by the selected model", () => {
    expect(resolveGenerationSettings({ modelId: "nano-banana-fast" }).sizeOptions).toEqual([]);
    expect(resolveGenerationSettings({ modelId: "nano-banana-2" }).sizeOptions).toEqual(["1K", "2K", "4K"]);
    expect(resolveGenerationSettings({ modelId: "nano-banana-2-4k-cl", sizeOption: "1K" })).toMatchObject({
      sizeOption: "4K",
      sizeOptions: ["4K"]
    });
  });
});
