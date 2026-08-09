import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

export type DocumentSourcePreview =
  | {
      status: "ready";
      kind: "image" | "pdf";
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

  const mimeType = normalizeMimeType(asset.mimeType || file.mimeType || "");
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

  const detected = await detectSafeDocumentPreview(blob, mimeType);
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (!detected) {
    return {
      status: "unsupported",
      fileName,
      mimeType,
      message: "源文件内容与可安全预览的格式不一致；下方仍可查看已保存的解析文本。"
    };
  }

  const previewBlob = new Blob([blob], { type: detected.mimeType });

  return {
    status: "ready",
    kind: detected.kind,
    url: URL.createObjectURL(previewBlob),
    mimeType: detected.mimeType,
    fileName
  };
}

export function revokeDocumentSourcePreview(preview: DocumentSourcePreview): void {
  if (preview.status === "ready") {
    URL.revokeObjectURL(preview.url);
  }
}

export function canPreviewOriginalDocument(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "application/pdf" || SAFE_RASTER_IMAGE_MIME_TYPES.has(normalized);
}

const SAFE_RASTER_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp"
]);

async function detectSafeDocumentPreview(
  blob: Blob,
  declaredMimeType: string
): Promise<{ kind: "image" | "pdf"; mimeType: string } | undefined> {
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  if (declaredMimeType === "application/pdf" && containsAscii(header, "%PDF-")) {
    return { kind: "pdf", mimeType: "application/pdf" };
  }

  if (!SAFE_RASTER_IMAGE_MIME_TYPES.has(declaredMimeType)) {
    return undefined;
  }
  const detectedMimeType = detectRasterImageMimeType(header);
  return detectedMimeType === declaredMimeType
    ? { kind: "image", mimeType: detectedMimeType }
    : undefined;
}

function detectRasterImageMimeType(bytes: Uint8Array): string | undefined {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) {
    return "image/gif";
  }
  if (startsWithAscii(bytes, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (asciiAt(bytes, 4, "ftypavif") || asciiAt(bytes, 4, "ftypavis")) {
    return "image/avif";
  }
  if (startsWithAscii(bytes, "BM")) {
    return "image/bmp";
  }
  return undefined;
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    if (startsWithBytes(bytes.subarray(offset), needle)) return true;
  }
  return false;
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  return asciiAt(bytes, 0, value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return startsWithBytes(bytes.subarray(offset), new TextEncoder().encode(value));
}

function startsWithBytes(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}
