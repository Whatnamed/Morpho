import { unzip, type UnzipFileInfo } from "fflate";

export type ZipExtractionBudget = Readonly<{
  maxCompressedBytes: number;
  maxEntries: number;
  maxIncludedEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  timeoutMs: number;
  include: (entry: Readonly<UnzipFileInfo>) => boolean;
}>;

export class BoundedZipError extends Error {
  constructor(
    readonly code:
      | "compressed_size_limit"
      | "entry_limit"
      | "entry_size_limit"
      | "expanded_size_limit"
      | "compression_ratio_limit"
      | "unsafe_path"
      | "timeout"
      | "invalid_zip",
    message: string
  ) {
    super(message);
    this.name = "BoundedZipError";
  }
}

/**
 * fflate exposes central-directory sizes to `filter` before it allocates an
 * output buffer. Enforce every expansion budget there and extract only the
 * caller's declared paths.
 */
export function unzipWithBudget(
  data: Uint8Array,
  budget: ZipExtractionBudget
): Promise<Record<string, Uint8Array>> {
  if (data.byteLength > budget.maxCompressedBytes) {
    return Promise.reject(new BoundedZipError(
      "compressed_size_limit",
      "ZIP 压缩包超过允许大小。"
    ));
  }

  return new Promise((resolve, reject) => {
    let entryCount = 0;
    let includedEntryCount = 0;
    let includedExpandedBytes = 0;
    let budgetError: BoundedZipError | undefined;
    let settled = false;
    let terminate: (() => void) | undefined;

    const finish = (
      result: { files: Record<string, Uint8Array> } | { error: Error }
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if ("error" in result) reject(result.error);
      else resolve(result.files);
    };
    const timeout = setTimeout(() => {
      terminate?.();
      finish({ error: new BoundedZipError("timeout", "ZIP 解压超过允许时间。") });
    }, budget.timeoutMs);

    try {
      terminate = unzip(data, {
        filter: (entry) => {
          entryCount += 1;
          if (entryCount > budget.maxEntries) {
            budgetError ??= new BoundedZipError("entry_limit", "ZIP 条目数超过允许上限。");
            return false;
          }
          if (!isSafeZipPath(entry.name)) {
            budgetError ??= new BoundedZipError("unsafe_path", "ZIP 包含不安全路径。");
            return false;
          }
          if (!isSafeSize(entry.size) || !isSafeSize(entry.originalSize)) {
            budgetError ??= new BoundedZipError("invalid_zip", "ZIP 中央目录大小无效。");
            return false;
          }
          if (!budget.include(entry)) return false;

          includedEntryCount += 1;
          includedExpandedBytes += entry.originalSize;
          if (includedEntryCount > budget.maxIncludedEntries) {
            budgetError ??= new BoundedZipError("entry_limit", "需要解压的 ZIP 条目数超过允许上限。");
            return false;
          }
          if (entry.originalSize > budget.maxEntryUncompressedBytes) {
            budgetError ??= new BoundedZipError("entry_size_limit", "ZIP 单个条目展开后超过允许大小。");
            return false;
          }
          if (includedExpandedBytes > budget.maxTotalUncompressedBytes) {
            budgetError ??= new BoundedZipError("expanded_size_limit", "ZIP 累计展开大小超过允许上限。");
            return false;
          }
          if (exceedsCompressionRatio(entry, budget.maxCompressionRatio)) {
            budgetError ??= new BoundedZipError("compression_ratio_limit", "ZIP 条目压缩比超过允许上限。");
            return false;
          }
          return !budgetError;
        }
      }, (error, files) => {
        if (budgetError) {
          finish({ error: budgetError });
          return;
        }
        if (error) {
          finish({ error: new BoundedZipError("invalid_zip", "ZIP 文件损坏或格式无效。") });
          return;
        }
        finish({ files });
      });
    } catch {
      finish({ error: budgetError ?? new BoundedZipError("invalid_zip", "ZIP 文件损坏或格式无效。") });
    }
  });
}

function isSafeZipPath(path: string): boolean {
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((segment, index) =>
    segment !== "." && segment !== ".." && (segment.length > 0 || index === segments.length - 1)
  );
}

function isSafeSize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function exceedsCompressionRatio(entry: Readonly<UnzipFileInfo>, maximum: number): boolean {
  if (entry.originalSize === 0) return false;
  if (entry.size === 0) return true;
  return entry.originalSize / entry.size > maximum;
}
