import { describe, expect, it } from "vitest";

import { attachDocumentExtractToFileObject, createBlankWorkspace } from "../../domain/morpho/workspace";
import { importAssetBackedObjects } from "../../domain/morpho/imports";
import type { AssetRecord, MorphoWorkspace } from "../../domain/morpho/types";
import type { BlobStore } from "../../infrastructure/assets/localAssetWorkflow";

import { collectDocumentExtractsForAi } from "./documentContext";
import { loadDocumentReaderExtractWithRecovery } from "./documentReaderRecovery";

describe("document reader recovery", () => {
  it("repairs an unparsed markdown file so the reader and AI context use the same extracted text", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-brief",
      fileName: "brief.md",
      mimeType: "text/markdown",
      size: 34,
      createdAt: "2026-07-05T00:00:00.000Z",
      storageKey: "blob:asset-file-brief",
      sourceType: "originalFile"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-reader-recovery"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const store = new MemoryBlobStore({
      [sourceAsset.storageKey]: new Blob(["# Brief\n\nNightrail cabin notes"], { type: "text/markdown" })
    });
    let workspace: MorphoWorkspace = imported.workspace;

    const result = await loadDocumentReaderExtractWithRecovery(
      workspace,
      fileObjectId,
      store,
      new AbortController().signal,
      (updater) => {
        workspace = updater(workspace);
      }
    );

    expect(result).toMatchObject({
      status: "loaded",
      fileObjectId,
      text: "# Brief\n\nNightrail cabin notes"
    });

    const file = workspace.objects[fileObjectId];
    expect(file?.type).toBe("file");
    expect(file?.type === "file" ? file.parseStatus : undefined).toBe("parsed");
    expect(file?.type === "file" ? file.extractedAssetId : undefined).toBe(result.status === "loaded" ? result.asset.id : undefined);

    const aiContext = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);
    expect(aiContext.extracts).toEqual([
      {
        objectId: fileObjectId,
        title: "brief.md",
        fileName: "brief.md",
        text: "# Brief\n\nNightrail cabin notes",
        charCount: 30,
        pageCount: undefined,
        truncated: false
      }
    ]);
    expect(aiContext.skipped).toEqual([]);
  });

  it("rebuilds a parsed markdown extract when the stored extract blob is missing", async () => {
    const sourceAsset: AssetRecord = {
      id: "asset-file-brief",
      fileName: "brief.md",
      mimeType: "text/markdown",
      size: 34,
      createdAt: "2026-07-05T00:00:00.000Z",
      storageKey: "blob:asset-file-brief",
      sourceType: "originalFile"
    };
    const staleExtractAsset: AssetRecord = {
      id: "asset-extract-stale",
      fileName: "brief.extract.txt",
      mimeType: "text/plain",
      size: 0,
      createdAt: "2026-07-05T00:00:00.000Z",
      storageKey: "blob:asset-extract-stale",
      sourceType: "documentExtract"
    };
    const imported = importAssetBackedObjects(createBlankWorkspace("project-reader-recovery"), {
      assets: [sourceAsset],
      position: { x: 100, y: 100 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    let workspace: MorphoWorkspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset: staleExtractAsset,
      extractedCharCount: 0,
      parsedAt: "2026-07-05T00:00:00.000Z"
    });
    const store = new MemoryBlobStore({
      [sourceAsset.storageKey]: new Blob(["# Recovered\n\nBlob was missing."], { type: "text/markdown" })
    });

    const result = await loadDocumentReaderExtractWithRecovery(
      workspace,
      fileObjectId,
      store,
      new AbortController().signal,
      (updater) => {
        workspace = updater(workspace);
      }
    );

    expect(result).toMatchObject({
      status: "loaded",
      fileObjectId,
      text: "# Recovered\n\nBlob was missing."
    });
    expect(result.status === "loaded" ? result.asset.id : undefined).not.toBe(staleExtractAsset.id);

    const aiContext = await collectDocumentExtractsForAi(workspace, [fileObjectId], store);
    expect(aiContext.extracts[0]?.text).toBe("# Recovered\n\nBlob was missing.");
    expect(aiContext.skipped).toEqual([]);
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
