import { describe, expect, it } from "vitest";

import type { AssetRecord } from "./types";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "./imports";
import { createBlankWorkspace } from "./workspace";

describe("Morpho import helpers", () => {
  it("imports a single image with intrinsic placement and selection", () => {
    const workspace = createBlankWorkspace("project-import-test");
    const result = importAssetBackedObjects(workspace, {
      assets: [imageAsset("asset-wide", "wide.png", 1920, 1080)],
      position: { x: 10, y: 20 }
    });

    const object = result.workspace.objects[result.objectIds[0]!];
    const instance = result.workspace.canvas.instances.find((item) => item.objectId === result.objectIds[0]);

    expect(object).toMatchObject({ type: "image", assetId: "asset-wide" });
    expect(instance?.size).toEqual({ w: 320, h: 180 });
    expect(instance?.position).toEqual({ x: 10, y: 20 });
    expect(result.workspace.ui.lastSelectionIds).toEqual(result.objectIds);
  });

  it("imports an ordinary file as a file object without parsing it immediately", () => {
    const result = importAssetBackedObjects(createBlankWorkspace("project-file-import"), {
      assets: [fileAsset("asset-brief", "brief.pdf", "application/pdf")],
      position: { x: 30, y: 40 }
    });

    expect(result.objectIds).toHaveLength(1);
    expect(result.workspace.objects[result.objectIds[0]!]).toMatchObject({
      type: "file",
      assetId: "asset-brief",
      parseStatus: "unparsed",
      fileKind: "pdf"
    });
    expect(result.workspace.canvas.instances[0]?.position).toEqual({ x: 30, y: 40 });
  });

  it("keeps multiple images independent and adds an initially expanded collection", () => {
    const result = importAssetBackedObjects(createBlankWorkspace("project-image-batch"), {
      assets: [
        imageAsset("asset-one", "one.png", 800, 600),
        imageAsset("asset-two", "two.png", 600, 800)
      ],
      position: { x: 50, y: 60 }
    });

    const images = result.objectIds
      .map((objectId) => result.workspace.objects[objectId])
      .filter((object) => object?.type === "image");
    const collection = Object.values(result.workspace.objects).find((object) => object?.type === "imageCollection");

    expect(images).toHaveLength(2);
    expect(collection).toMatchObject({
      type: "imageCollection",
      expanded: true,
      memberObjectIds: images.map((object) => object.id)
    });
    expect(result.workspace.canvas.instances).toHaveLength(3);
  });

  it("keeps documents outside the image collection in a mixed import", () => {
    const result = importAssetBackedObjects(createBlankWorkspace("project-mixed-import"), {
      assets: [
        imageAsset("asset-mixed-image", "concept.png", 1200, 900),
        imageAsset("asset-mixed-image-two", "detail.png", 900, 1200),
        fileAsset("asset-mixed-file", "brief.pdf", "application/pdf")
      ],
      position: { x: 70, y: 80 }
    });

    const collection = Object.values(result.workspace.objects).find((object) => object?.type === "imageCollection");
    const file = Object.values(result.workspace.objects).find((object) => object?.type === "file");

    expect(collection?.type).toBe("imageCollection");
    expect(collection?.type === "imageCollection" ? collection.memberObjectIds : []).not.toContain(file?.id);
    expect(file).toMatchObject({ type: "file", assetId: "asset-mixed-file" });
  });

  it("imports URLs as link assets and plain text as text objects", () => {
    const workspace = createBlankWorkspace("project-text-and-url");
    const urlResult = importUrlObject(workspace, {
      url: "https://example.com/research?q=morpho",
      position: { x: 90, y: 100 }
    });
    const textResult = importTextObject(urlResult.workspace, {
      text: "  一段需要保留的资料  ",
      position: { x: 120, y: 130 }
    });

    const link = urlResult.workspace.objects[urlResult.objectIds[0]!];
    if (link?.type !== "link") {
      throw new Error("Expected a link object.");
    }
    if (!link.assetId) {
      throw new Error("Expected the link object to reference its asset.");
    }
    expect(urlResult.workspace.assets[link.assetId]).toMatchObject({
      sourceType: "originalLink",
      url: "https://example.com/research?q=morpho"
    });
    expect(link).toMatchObject({ type: "link", url: "https://example.com/research?q=morpho" });
    expect(textResult.workspace.objects[textResult.objectIds[0]!]).toMatchObject({
      type: "text",
      body: "一段需要保留的资料"
    });
  });
});

function imageAsset(id: string, fileName: string, width: number, height: number): AssetRecord {
  return {
    id,
    fileName,
    mimeType: "image/png",
    size: 1000,
    createdAt: "2026-06-24T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType: "originalImage",
    width,
    height,
    aspectRatio: width / height
  };
}

function fileAsset(id: string, fileName: string, mimeType: string): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    size: 1000,
    createdAt: "2026-06-24T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType: "originalFile"
  };
}
