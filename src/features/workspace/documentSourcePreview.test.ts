// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetRecord, FileObject, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import {
  canPreviewOriginalDocument,
  loadDocumentSourcePreview,
  revokeDocumentSourcePreview
} from "./documentSourcePreview";

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  createObjectURL.mockReturnValue("blob:document-source");
  vi.stubGlobal("URL", {
    createObjectURL,
    revokeObjectURL
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("document source preview", () => {
  it.each([
    ["image/png", "image"],
    ["text/markdown", "text"],
    ["application/pdf", "PDF"]
  ])("creates a browser-local preview for %s", async (mimeType, label) => {
    const workspace = workspaceWithOriginalFile(mimeType);
    const blob = new Blob([`${label} source`], { type: mimeType });
    const store = new TrackingBlobStore({ "blob:original": blob });

    const result = await loadDocumentSourcePreview(
      workspace,
      "file-1",
      store,
      new AbortController().signal
    );

    expect(result).toEqual({
      status: "ready",
      url: "blob:document-source",
      mimeType,
      fileName: "brief.source"
    });
    expect(store.get).toHaveBeenCalledWith("blob:original");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("reports unsupported Office MIME without reading the Blob or creating a URL", async () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const workspace = workspaceWithOriginalFile(mimeType);
    const store = new TrackingBlobStore({
      "blob:original": new Blob(["deck"], { type: mimeType })
    });

    const result = await loadDocumentSourcePreview(
      workspace,
      "file-1",
      store,
      new AbortController().signal
    );

    expect(result).toMatchObject({ status: "unsupported", fileName: "brief.source", mimeType });
    expect(store.get).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(canPreviewOriginalDocument(mimeType)).toBe(false);
  });

  it("reports a missing original asset without reading the Blob", async () => {
    const workspace = workspaceWithOriginalFile("application/pdf", { includeOriginalAsset: false });
    const store = new TrackingBlobStore({});

    const result = await loadDocumentSourcePreview(
      workspace,
      "file-1",
      store,
      new AbortController().signal
    );

    expect(result).toMatchObject({ status: "missing", fileName: "brief.source" });
    expect(store.get).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("reports a missing original Blob without creating a URL", async () => {
    const workspace = workspaceWithOriginalFile("application/pdf");
    const store = new TrackingBlobStore({});

    const result = await loadDocumentSourcePreview(
      workspace,
      "file-1",
      store,
      new AbortController().signal
    );

    expect(result).toMatchObject({ status: "missing", message: expect.stringContaining("Blob") });
    expect(store.get).toHaveBeenCalledWith("blob:original");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("throws AbortError after the Blob read and does not create a URL", async () => {
    const workspace = workspaceWithOriginalFile("application/pdf");
    const controller = new AbortController();
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const store: BlobStore = {
      async put() {},
      get: vi.fn(async () => {
        controller.abort();
        return blob;
      }),
      async delete() {}
    };

    await expect(
      loadDocumentSourcePreview(workspace, "file-1", store, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("revokes ready previews and ignores unsupported or missing previews", () => {
    revokeDocumentSourcePreview({
      status: "ready",
      url: "blob:ready",
      mimeType: "application/pdf",
      fileName: "brief.pdf"
    });
    revokeDocumentSourcePreview({
      status: "unsupported",
      message: "unsupported"
    });
    revokeDocumentSourcePreview({
      status: "missing",
      message: "missing"
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ready");
  });
});

function workspaceWithOriginalFile(
  mimeType: string,
  options: { includeOriginalAsset?: boolean } = {}
): MorphoWorkspace {
  const workspace = createBlankWorkspace("document-source-preview");
  const file: FileObject = {
    id: "file-1",
    type: "file",
    title: "Source brief",
    summary: "Imported source",
    createdBy: "user",
    visibility: "active",
    fileKind: "document",
    sourceLabel: "用户导入",
    assetId: "asset-original",
    fileName: "brief.source",
    mimeType,
    size: 64,
    parseStatus: "parsed",
    extractedAssetId: "asset-extract"
  };
  const originalAsset: AssetRecord = {
    id: "asset-original",
    fileName: "brief.source",
    mimeType,
    size: 64,
    createdAt: "2026-08-05T00:00:00.000Z",
    storageKey: "blob:original",
    sourceType: "originalFile"
  };

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [file.id]: file
    },
    assets:
      options.includeOriginalAsset === false
        ? workspace.assets
        : {
            ...workspace.assets,
            [originalAsset.id]: originalAsset
          }
  };
}

class TrackingBlobStore implements BlobStore {
  readonly get = vi.fn(async (storageKey: string) => this.blobs[storageKey] ?? null);

  constructor(private readonly blobs: Record<string, Blob>) {}

  async put(storageKey: string, blob: Blob): Promise<void> {
    this.blobs[storageKey] = blob;
  }

  async delete(storageKey: string): Promise<void> {
    delete this.blobs[storageKey];
  }
}
