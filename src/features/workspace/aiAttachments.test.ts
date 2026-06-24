import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "../../domain/morpho/types";
import { createBlankWorkspace } from "../../domain/morpho/workspace";
import {
  buildWebSearchOptions,
  planImageAttachmentCompression,
  selectMiMoImageAttachmentCandidates,
  shouldAttachImagesForMiMo
} from "./aiAttachments";

describe("workspace MiMo attachment planning", () => {
  it("selects only active image assets and limits hidden/unreadable images", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));

    expect(
      selectMiMoImageAttachmentCandidates(workspace, [
        "image-active-a",
        "image-hidden",
        "text-a",
        "image-active-b",
        "image-missing-asset",
        "image-active-c",
        "image-active-d"
      ])
    ).toEqual(["image-active-a", "image-active-b", "image-active-c"]);
  });

  it("requires explicit image-understanding intent before sending pixels to MiMo", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));
    const selectedObjects = ["image-active-a"].map((id) => workspace.objects[id]);

    expect(
      shouldAttachImagesForMiMo({
        draft: "你好，继续聊一下项目",
        taskMode: "chatAnalysis",
        selectedObjects
      })
    ).toBe(false);
    expect(
      shouldAttachImagesForMiMo({
        draft: "分析这张图的比例和结构问题",
        taskMode: "chatAnalysis",
        selectedObjects
      })
    ).toBe(true);
    expect(
      shouldAttachImagesForMiMo({
        draft: "分析这张图的比例和结构问题",
        taskMode: "imageGeneration",
        selectedObjects
      })
    ).toBe(false);
  });

  it("plans image compression with max side and target bytes", () => {
    expect(planImageAttachmentCompression({ width: 3200, height: 1800, byteSize: 800_000 })).toMatchObject({
      width: 1600,
      height: 900,
      shouldResize: true,
      shouldCompress: false
    });
    expect(planImageAttachmentCompression({ width: 1000, height: 800, byteSize: 3_000_000 })).toMatchObject({
      width: 1000,
      height: 800,
      shouldResize: false,
      shouldCompress: true
    });
  });

  it("keeps web search explicit and disabled for image generation", () => {
    expect(buildWebSearchOptions({ draft: "请联网核实这个案例来源", taskMode: "researchOperation" })).toEqual({
      enabled: true,
      maxKeyword: 2,
      forceSearch: true,
      limit: 3
    });
    expect(buildWebSearchOptions({ draft: "请联网核实这个案例来源", taskMode: "imageGeneration" })).toBeUndefined();
    expect(buildWebSearchOptions({ draft: "普通解释一下", taskMode: "chatAnalysis" })).toBeUndefined();
  });
});

function withImages(workspace: MorphoWorkspace): MorphoWorkspace {
  return {
    ...workspace,
    assets: {
      "asset-active-a": imageAsset("asset-active-a"),
      "asset-active-b": imageAsset("asset-active-b"),
      "asset-active-c": imageAsset("asset-active-c"),
      "asset-active-d": imageAsset("asset-active-d"),
      "asset-hidden": imageAsset("asset-hidden")
    },
    objects: {
      "image-active-a": imageObject("image-active-a", "asset-active-a", "active"),
      "image-active-b": imageObject("image-active-b", "asset-active-b", "active"),
      "image-active-c": imageObject("image-active-c", "asset-active-c", "active"),
      "image-active-d": imageObject("image-active-d", "asset-active-d", "active"),
      "image-hidden": imageObject("image-hidden", "asset-hidden", "hidden"),
      "image-missing-asset": imageObject("image-missing-asset", "asset-missing", "active"),
      "text-a": {
        id: "text-a",
        type: "text",
        title: "文字",
        summary: "文字对象",
        createdBy: "user",
        visibility: "active",
        body: "hello"
      }
    }
  };
}

function imageAsset(id: string) {
  return {
    id,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 100,
    createdAt: "2026-06-25T00:00:00.000Z",
    storageKey: id,
    sourceType: "originalImage" as const
  };
}

function imageObject(id: string, assetId: string, visibility: "active" | "hidden") {
  return {
    id,
    type: "image" as const,
    title: id,
    summary: id,
    createdBy: "user" as const,
    visibility,
    role: "reference" as const,
    imageVariant: "path" as const,
    assetId
  };
}
