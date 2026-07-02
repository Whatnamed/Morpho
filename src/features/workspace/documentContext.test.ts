import { describe, expect, it } from "vitest";

import { createBlankWorkspace, attachDocumentExtractToFileObject } from "../../domain/morpho/workspace";
import { importAssetBackedObjects } from "../../domain/morpho/imports";
import type { AssetRecord } from "../../domain/morpho/types";
import type { BlobStore } from "../../infrastructure/assets/localAssetWorkflow";

import { collectDocumentExtractsForAi } from "./documentContext";

describe("AI document extract context", () => {
  it("reads only selected parsed files from documentExtract assets and keeps workspace JSON lightweight", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-brief",
      fileName: "brief.txt",
      mimeType: "text/plain",
      size: 18,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-file-brief",
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: "asset-extract-brief",
      fileName: "brief.extract.txt",
      mimeType: "text/plain",
      size: 18,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-extract-brief",
      sourceType: "documentExtract"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-doc-context"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset,
      extractedCharCount: 18,
      extractedPageCount: 1,
      parsedAt: "2026-06-26T00:00:00.000Z"
    });
    const store = new MemoryBlobStore({
      [extractAsset.storageKey]: new Blob(["真实资料进入 Morpho"], { type: "text/plain" })
    });

    const result = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);

    expect(result.extracts).toEqual([
      {
        objectId: fileObjectId,
        title: "brief.txt",
        fileName: "brief.txt",
        text: "真实资料进入 Morpho",
        charCount: 18,
        pageCount: 1,
        truncated: false
      }
    ]);
    expect(JSON.stringify(workspace)).not.toContain("真实资料进入 Morpho");
  });

  it("skips unparsed and failed files instead of pretending they were read", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-unparsed",
      fileName: "unparsed.pdf",
      mimeType: "application/pdf",
      size: 10,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-file-unparsed",
      sourceType: "originalFile"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-doc-context"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });

    const result = await collectDocumentExtractsForAi(imported.workspace, imported.objectIds, new MemoryBlobStore({}));

    expect(result.extracts).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("尚未成功解析");
  });
});

class MemoryBlobStore implements BlobStore {
  constructor(private readonly blobs: Record<string, Blob>) {}

  async put(storageKey: string, blob: Blob): Promise<void> {
    this.blobs[storageKey] = blob;
  }

  async get(storageKey: string): Promise<Blob | null> {
    return this.blobs[storageKey] ?? null;
  }

  async delete(storageKey: string): Promise<void> {
    delete this.blobs[storageKey];
  }
}
