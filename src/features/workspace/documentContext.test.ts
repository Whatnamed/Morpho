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

  it("preserves parser-level extraction truncation in AI extract context", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-large",
      fileName: "large.pdf",
      mimeType: "application/pdf",
      size: 100,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-file-large",
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: "asset-extract-large",
      fileName: "large.extract.txt",
      mimeType: "text/plain",
      size: 100,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-extract-large",
      sourceType: "documentExtract"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-doc-context-2"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset,
      extractedCharCount: 5_000,
      extractedPageCount: 10,
      extractionTruncated: true,
      parsedAt: "2026-06-26T00:00:00.000Z"
    });
    const store = new MemoryBlobStore({
      [extractAsset.storageKey]: new Blob(["已截断的PDF文字提取内容"], { type: "text/plain" })
    });

    const result = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);

    expect(result.extracts).toHaveLength(1);
    expect(result.extracts[0]).toMatchObject({
      objectId: fileObjectId,
      truncated: true,
      extractionTruncated: true,
      charCount: 5_000
    });
    expect(result.extracts[0]?.contextTruncated).toBeUndefined();
    expect(result.warning).toContain("在解析提取阶段已截断");
    expect(result.warning).not.toContain("按上下文长度截断");
  });

  it("marks context-only truncation when extract text exceeds per-document budget without parser truncation", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-long",
      fileName: "long.txt",
      mimeType: "text/plain",
      size: 9_000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-file-long",
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: "asset-extract-long",
      fileName: "long.extract.txt",
      mimeType: "text/plain",
      size: 9_000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-extract-long",
      sourceType: "documentExtract"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-doc-context-3"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset,
      extractedCharCount: 9_000,
      extractedPageCount: 1,
      extractionTruncated: false,
      parsedAt: "2026-06-26T00:00:00.000Z"
    });
    const longContent = "长文档文本".repeat(1_800); // 9,000 chars > 8,000
    const store = new MemoryBlobStore({
      [extractAsset.storageKey]: new Blob([longContent], { type: "text/plain" })
    });

    const result = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);

    expect(result.extracts).toHaveLength(1);
    expect(result.extracts[0]).toMatchObject({
      objectId: fileObjectId,
      truncated: true,
      contextTruncated: true,
      charCount: 9_000
    });
    expect(result.extracts[0]?.extractionTruncated).toBeUndefined();
    expect(result.warning).toContain("按上下文长度截断");
    expect(result.warning).not.toContain("在解析提取阶段已截断");
  });

  it("reports both parser and context truncation when a document is cut at both boundaries", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-dual",
      fileName: "dual.pdf",
      mimeType: "application/pdf",
      size: 9_000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-file-dual",
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: "asset-extract-dual",
      fileName: "dual.extract.txt",
      mimeType: "text/plain",
      size: 9_000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-extract-dual",
      sourceType: "documentExtract"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-doc-context-4"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset,
      extractedCharCount: 15_000,
      extractedPageCount: 15,
      extractionTruncated: true,
      parsedAt: "2026-06-26T00:00:00.000Z"
    });
    const longContent = "双重截断文本".repeat(1_500); // 9,000 chars > 8,000
    const store = new MemoryBlobStore({
      [extractAsset.storageKey]: new Blob([longContent], { type: "text/plain" })
    });

    const result = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);

    expect(result.extracts).toHaveLength(1);
    expect(result.extracts[0]).toMatchObject({
      objectId: fileObjectId,
      truncated: true,
      contextTruncated: true,
      extractionTruncated: true,
      charCount: 15_000
    });
    expect(result.warning).toContain("按上下文长度截断");
    expect(result.warning).toContain("在解析提取阶段已截断");
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
