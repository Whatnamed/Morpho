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
    extracts.push({
      objectId,
      title: object.title,
      fileName: object.fileName,
      text,
      charCount: object.extractedCharCount ?? rawText.length,
      pageCount: object.extractedPageCount,
      truncated: text.length < rawText.length
    });
  }

  const truncatedCount = extracts.filter((extract) => extract.truncated).length;
  const skippedCount = skipped.length;
  const warning =
    truncatedCount > 0 || skippedCount > 0
      ? [
          truncatedCount > 0 ? `有 ${truncatedCount} 个文档按上下文长度截断。` : "",
          skippedCount > 0 ? `有 ${skippedCount} 个文件未进入文本上下文。` : ""
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;

  return {
    extracts,
    skipped,
    warning
  };
}
