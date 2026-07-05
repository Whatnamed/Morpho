import { createDocumentExtractFile, parseDocumentFile, shouldAttemptDocumentParse } from "@/domain/morpho/documentParsing";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  attachDocumentExtractToFileObject,
  markFileObjectParseFailed,
  markFileObjectParsing
} from "@/domain/morpho/workspace";
import { saveBlobAsLocalAsset, type BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import { loadDocumentReaderExtract, type DocumentReaderLoadResult } from "./documentReader";

export type ApplyWorkspaceUpdate = (updater: (current: MorphoWorkspace) => MorphoWorkspace) => void;

export async function loadDocumentReaderExtractWithRecovery(
  workspace: MorphoWorkspace,
  fileObjectId: string,
  blobStore: BlobStore,
  signal: AbortSignal,
  applyWorkspaceUpdate: ApplyWorkspaceUpdate
): Promise<DocumentReaderLoadResult> {
  const initial = await loadDocumentReaderExtract(workspace, fileObjectId, blobStore, signal);
  if (initial.status === "loaded" || signal.aborted) {
    return initial;
  }

  const file = workspace.objects[fileObjectId];
  if (!file || file.type !== "file" || file.visibility !== "active") {
    return initial;
  }

  const canAttemptRecovery =
    file.parseStatus === "unparsed" ||
    file.parseStatus === "failed" ||
    file.parseStatus === "parsed";
  if (!canAttemptRecovery || !file.assetId) {
    return initial;
  }

  const originalAsset = workspace.assets[file.assetId];
  if (!originalAsset || originalAsset.sourceType !== "originalFile") {
    return initial;
  }

  const originalBlob = await blobStore.get(originalAsset.storageKey);
  if (!originalBlob || signal.aborted) {
    return initial;
  }

  const originalFile = new File([originalBlob], file.fileName ?? originalAsset.fileName, {
    type: originalAsset.mimeType || file.mimeType
  });
  if (!shouldAttemptDocumentParse(originalFile)) {
    return initial;
  }

  applyWorkspaceUpdate((current) => markFileObjectParsing(current, fileObjectId));
  const parsed = await parseDocumentFile(originalFile);
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (parsed.status === "failed") {
    applyWorkspaceUpdate((current) =>
      markFileObjectParseFailed(current, {
        fileObjectId,
        reason: parsed.reason
      })
    );
    return {
      status: "blocked",
      fileObjectId,
      reason: "failed",
      message: parsed.reason
    };
  }

  const extractFile = createDocumentExtractFile(originalFile, parsed.text);
  const saved = await saveBlobAsLocalAsset(blobStore, extractFile, "documentExtract");
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (saved.status === "failed") {
    applyWorkspaceUpdate((current) =>
      markFileObjectParseFailed(current, {
        fileObjectId,
        reason: saved.reason
      })
    );
    return {
      status: "error",
      fileObjectId,
      message: saved.reason
    };
  }

  applyWorkspaceUpdate((current) =>
    attachDocumentExtractToFileObject(current, {
      fileObjectId,
      extractAsset: saved.asset,
      extractedCharCount: parsed.text.length,
      extractedPageCount: parsed.pageCount
    })
  );

  return {
    status: "loaded",
    fileObjectId,
    asset: saved.asset,
    text: parsed.text
  };
}
