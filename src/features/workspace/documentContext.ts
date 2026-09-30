import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import type { MorphoObjectId, MorphoWorkspace } from "@/domain/morpho/types";

export type AiDocumentExtract = {
  objectId: MorphoObjectId;
  title: string;
  fileName?: string;
  text: string;
  charCount: number;
  pageCount?: number;
  truncated: boolean;
  contextTruncated?: boolean;
  extractionTruncated?: boolean;
};

export type CollectDocumentExtractsResult = {
  extracts: AiDocumentExtract[];
  skipped: Array<{
    objectId: MorphoObjectId;
    reason: string;
  }>;
  warning?: string;
};

const MAX_CHARS_PER_DOCUMENT = 8_000;
const MAX_TOTAL_DOCUMENT_CHARS = 24_000;

export async function collectDocumentExtractsForAi(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  blobStore: BlobStore,
  signal?: AbortSignal
): Promise<CollectDocumentExtractsResult> {
  const extracts: AiDocumentExtract[] = [];
  const skipped: CollectDocumentExtractsResult["skipped"] = [];
  let remaining = MAX_TOTAL_DOCUMENT_CHARS;

  for (const objectId of objectIds) {
    if (signal?.aborted || remaining <= 0) {
      break;
    }

    const object = workspace.objects[objectId];
    if (!object || object.type !== "file") {
      continue;
    }

    if (object.visibility !== "active") {
      skipped.push({ objectId, reason: "文件已隐藏，默认不进入 AI Context。" });
      continue;
    }

    if (object.parseStatus !== "parsed" || !object.extractedAssetId) {
      skipped.push({ objectId, reason: object.parseError ?? "文件尚未成功解析，不能作为已读文本进入 AI Context。" });
      continue;
    }

    const asset = workspace.assets[object.extractedAssetId];
    if (!asset || asset.sourceType !== "documentExtract") {
      skipped.push({ objectId, reason: "解析文本资产缺失。" });
      continue;
    }

    const blob = await blobStore.get(asset.storageKey);
    if (!blob) {
      skipped.push({ objectId, reason: "解析文本 Blob 缺失。" });
      continue;
    }

    const rawText = (await blob.text()).trim();
    if (!rawText) {
      skipped.push({ objectId, reason: "解析文本为空。" });
      continue;
    }

    const allowed = Math.min(MAX_CHARS_PER_DOCUMENT, remaining);
    const text = rawText.slice(0, allowed);
    remaining -= text.length;
    const parserTruncated = Boolean(object.extractionTruncated);
    const collectorTruncated = text.length < rawText.length;
    extracts.push({
      objectId,
      title: object.title,
      fileName: object.fileName,
      text,
      charCount: object.extractedCharCount ?? rawText.length,
      pageCount: object.extractedPageCount,
      truncated: collectorTruncated || parserTruncated,
      ...(collectorTruncated ? { contextTruncated: true } : {}),
      ...(parserTruncated ? { extractionTruncated: true } : {})
    });
  }

  const contextTruncatedCount = extracts.filter((extract) => extract.contextTruncated).length;
  const extractionTruncatedCount = extracts.filter((extract) => extract.extractionTruncated).length;
  const skippedCount = skipped.length;
  const warningParts: string[] = [];
  if (contextTruncatedCount > 0) {
    warningParts.push(`有 ${contextTruncatedCount} 个文档按上下文长度截断。`);
  }
  if (extractionTruncatedCount > 0) {
    warningParts.push(`有 ${extractionTruncatedCount} 个文档在解析提取阶段已截断。`);
  }
  if (skippedCount > 0) {
    warningParts.push(`有 ${skippedCount} 个文件未进入文本上下文。`);
  }
  const warning = warningParts.length > 0 ? warningParts.join(" ") : undefined;
  return {
    extracts,
    skipped,
    warning
  };
}
