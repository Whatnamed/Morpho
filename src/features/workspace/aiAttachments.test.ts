import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "../../domain/morpho/types";
import { createBlankWorkspace } from "../../domain/morpho/workspace";
import {
  buildWebSearchOptions,
  planImageAttachmentCompression,
  resolveAiProviderImageObjectIds,
  selectAiProviderImageAttachmentCandidates,
  shouldAttachImagesForAiProvider
} from "./aiAttachments";

describe("workspace AI provider attachment planning", () => {
  it("selects all active image assets without silently truncating hidden or unreadable images", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));

    expect(
      selectAiProviderImageAttachmentCandidates(workspace, [
        "image-active-a",
        "image-hidden",
        "text-a",
        "image-active-b",
        "image-missing-asset",
        "image-active-c",
        "image-active-d",
        "image-active-e"
      ])
    ).toEqual(["image-active-a", "image-active-b", "image-active-c", "image-active-d", "image-active-e"]);
  });

  it("uses selected active images for chat, research, and imageGeneration planning", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));
    const selectedObjects = ["image-active-a"].map((id) => workspace.objects[id]);

    expect(
      shouldAttachImagesForAiProvider({
        draft: "hello",
        taskMode: "chatAnalysis",
        selectedObjects
      })
    ).toBe(true);
    expect(
      shouldAttachImagesForAiProvider({
        draft: "research these materials",
        taskMode: "researchOperation",
        selectedObjects
      })
    ).toBe(true);
    expect(
      shouldAttachImagesForAiProvider({
        draft: "generate a new image",
        taskMode: "imageGeneration",
        selectedObjects
      })
    ).toBe(true);
  });

  it("keeps explicitly selected image ids even when task context image ids are empty", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));
    const selectedObjects = [workspace.objects["image-active-a"], workspace.objects["text-a"]];

    expect(
      resolveAiProviderImageObjectIds({
        contextImageObjectIds: [],
        selectedObjects
      })
    ).toEqual(["image-active-a"]);
  });

  it("prioritizes selected image ids before context-expanded images without duplicates", () => {
    const workspace = withImages(createBlankWorkspace("project-test"));
    const selectedObjects = [workspace.objects["image-active-b"]];

    expect(
      resolveAiProviderImageObjectIds({
        contextImageObjectIds: ["image-active-a", "image-active-b", "image-active-c"],
        selectedObjects
      })
    ).toEqual(["image-active-b", "image-active-a", "image-active-c"]);
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

  it("offers web search only for explicit search or verification intent", () => {
    expect(buildWebSearchOptions({ draft: "ordinary question", taskMode: "chatAnalysis" })).toBeUndefined();
    expect(buildWebSearchOptions({ draft: "please verify latest source", taskMode: "researchOperation" })).toEqual({
      enabled: true,
      forceSearch: true,
      maxKeyword: 2,
      limit: 3
    });
    expect(buildWebSearchOptions({ draft: "please verify latest source", taskMode: "imageGeneration" })).toBeUndefined();
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
      "asset-active-e": imageAsset("asset-active-e"),
      "asset-hidden": imageAsset("asset-hidden")
    },
    objects: {
      "image-active-a": imageObject("image-active-a", "asset-active-a", "active"),
      "image-active-b": imageObject("image-active-b", "asset-active-b", "active"),
      "image-active-c": imageObject("image-active-c", "asset-active-c", "active"),
      "image-active-d": imageObject("image-active-d", "asset-active-d", "active"),
      "image-active-e": imageObject("image-active-e", "asset-active-e", "active"),
      "image-hidden": imageObject("image-hidden", "asset-hidden", "hidden"),
      "image-missing-asset": imageObject("image-missing-asset", "asset-missing", "active"),
      "text-a": {
        id: "text-a",
        type: "text",
        title: "Text",
        summary: "Text object",
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
    assetId
  };
}
