import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

export type DocumentSourcePreview =
  | {
      status: "ready";
      url: string;
      mimeType: string;
      fileName: string;
    }
  | {
      status: "unsupported" | "missing";
      fileName?: string;
      mimeType?: string;
      message: string;
    };

export async function loadDocumentSourcePreview(
  workspace: MorphoWorkspace,
  fileObjectId: string,
  blobStore: Pick<BlobStore, "get">,
  signal: AbortSignal
): Promise<DocumentSourcePreview> {
  const file = workspace.objects[fileObjectId];
  if (!file || file.type !== "file") {
    return { status: "missing", message: "源文件对象不可用。" };
  }

  const asset = file.assetId ? workspace.assets[file.assetId] : undefined;
  if (!asset || asset.sourceType !== "originalFile") {
    return {
      status: "missing",
      fileName: file.fileName ?? file.title,
      mimeType: file.mimeType,
      message: "源文件资产不可用；下方仍可查看已保存的解析文本。"
    };
  }

  const mimeType = asset.mimeType || file.mimeType || "";
  const fileName = file.fileName ?? asset.fileName;
  if (!canPreviewOriginalDocument(mimeType)) {
    return {
      status: "unsupported",
      fileName,
      mimeType,
      message: "当前文件类型暂不能在工作台内预览原版式；下方仍可查看已提取的解析文本。"
    };
  }

  const blob = await blobStore.get(asset.storageKey);
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (!blob) {
    return {
      status: "missing",
      fileName,
      mimeType,
      message: "源文件 Blob 缺失；下方仍可查看已保存的解析文本。"
    };
  }

  return {
    status: "ready",
    url: URL.createObjectURL(blob),
    mimeType,
    fileName
  };
}

export function revokeDocumentSourcePreview(preview: DocumentSourcePreview): void {
  if (preview.status === "ready") {
    URL.revokeObjectURL(preview.url);
  }
}

export function canPreviewOriginalDocument(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("text/") || mimeType === "application/pdf";
}
