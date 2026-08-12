import type { ImageAssetDimensions } from "@/infrastructure/assets/localAssetWorkflow";

const MIB = 1024 * 1024;

export const IMPORT_RESOURCE_POLICY = Object.freeze({
  maxFilesPerBatch: 32,
  maxRawBytesPerBatch: 128 * MIB,
  maxBytesByKind: Object.freeze({
    image: 64 * MIB,
    pdf: 64 * MIB,
    text: 8 * MIB,
    other: 64 * MIB
  }),
  maxDecodedPixelsPerImage: 40_000_000,
  maxDecodedPixelsPerBatch: 100_000_000,
  maxPdfPagesToParse: 200,
  maxPdfExtractedChars: 120_000
});

export type ImportResourceKind = keyof typeof IMPORT_RESOURCE_POLICY.maxBytesByKind;

export type ImportResourceDescriptor = Readonly<{
  file: File;
  kind: ImportResourceKind;
}>;

export type ImportResourcePolicyError = Error & {
  code: "import_resource_policy_rejected";
};

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"]);
const TEXT_EXTENSIONS = new Set(["csv", "md", "rtf", "text", "txt"]);

export function createImportResourcePolicyError(message: string): ImportResourcePolicyError {
  return Object.assign(new Error(message), {
    code: "import_resource_policy_rejected" as const
  });
}

export function isImportResourcePolicyError(value: unknown): value is ImportResourcePolicyError {
  return isRecord(value) && value.code === "import_resource_policy_rejected";
}

export function preflightImportResourceMetadata(files: readonly File[]): ImportResourceDescriptor[] {
  if (files.length > IMPORT_RESOURCE_POLICY.maxFilesPerBatch) {
    throw createImportResourcePolicyError(`一次最多导入 ${IMPORT_RESOURCE_POLICY.maxFilesPerBatch} 个文件。`);
  }

  let batchBytes = 0;
  return files.map((file) => {
    const kind = classifyImportResource(file);
    const maxBytes = IMPORT_RESOURCE_POLICY.maxBytesByKind[kind];
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) {
      const label = kind === "pdf" ? "PDF 文件" : kind === "image" ? "图片" : kind === "text" ? "文本文件" : "文件";
      throw createImportResourcePolicyError(`${label}“${boundedFileName(file.name)}”超过导入上限，未导入。`);
    }

    batchBytes += file.size;
    if (!Number.isSafeInteger(batchBytes) || batchBytes > IMPORT_RESOURCE_POLICY.maxRawBytesPerBatch) {
      throw createImportResourcePolicyError("本次文件总大小超过 Morpho 的导入上限，未导入。");
    }
    return { file, kind };
  });
}

export function validateImportImageDimensions(
  file: File,
  dimensions: ImageAssetDimensions,
  decodedPixelsBefore: number
): number {
  const { width, height, aspectRatio } = dimensions;
  const pixels = width * height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(aspectRatio) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(pixels) ||
    pixels > IMPORT_RESOURCE_POLICY.maxDecodedPixelsPerImage
  ) {
    throw createImportResourcePolicyError(`图片“${boundedFileName(file.name)}”分辨率过高或无法读取，未导入。`);
  }

  const batchPixels = decodedPixelsBefore + pixels;
  if (!Number.isSafeInteger(batchPixels) || batchPixels > IMPORT_RESOURCE_POLICY.maxDecodedPixelsPerBatch) {
    throw createImportResourcePolicyError("本次图片总分辨率超过 Morpho 的导入上限，未导入。");
  }
  return batchPixels;
}

export function classifyImportResource(file: File): ImportResourceKind {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) return "text";
  return "other";
}

function boundedFileName(fileName: string): string {
  const normalized = fileName.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "未命名文件";
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
