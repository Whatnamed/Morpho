import { strFromU8 } from "fflate";

import { BoundedZipError, unzipWithBudget } from "@/shared/boundedZip";

import type { AssetSourceType } from "./types";

export type DocumentParseResult =
  | {
      status: "parsed";
      text: string;
      pageCount?: number;
      mimeType: string;
      extractFileName: string;
    }
  | {
      status: "failed";
      reason: string;
    };

const SUPPORTED_TEXT_EXTENSIONS = new Set(["md", "txt"]);
const MAX_EXTRACT_CHARS = 120_000;
const MAX_PPTX_COMPRESSED_BYTES = 64 * 1024 * 1024;

export function shouldAttemptDocumentParse(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return false;
  }

  const extension = getFileExtension(file.name);
  return (
    SUPPORTED_TEXT_EXTENSIONS.has(extension) ||
    extension === "pdf" ||
    extension === "pptx" ||
    extension === "ppt" ||
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

export async function parseDocumentFile(file: File): Promise<DocumentParseResult> {
  const extension = getFileExtension(file.name);

  if (SUPPORTED_TEXT_EXTENSIONS.has(extension) || file.type === "text/plain" || file.type === "text/markdown") {
    return parsePlainTextDocument(file, extension === "md" ? "text/markdown" : file.type || "text/plain");
  }

  if (extension === "pdf" || file.type === "application/pdf") {
    return parsePdfDocument(file);
  }

  if (
    extension === "pptx" ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return parsePptxDocument(file);
  }

  if (extension === "ppt") {
    return {
      status: "failed",
      reason: "当前只支持 .pptx；旧版 .ppt 不能可靠解析。"
    };
  }

  return {
    status: "failed",
    reason: "当前文件类型暂不支持文本解析。"
  };
}

export function createDocumentExtractFile(originalFile: File, text: string): File {
  const baseName = originalFile.name.replace(/\.[^.]+$/, "") || "document";
  return new File([text], `${baseName}.extract.txt`, {
    type: "text/plain"
  });
}

export function isDocumentExtractAssetSource(sourceType: AssetSourceType): boolean {
  return sourceType === "documentExtract";
}

async function parsePlainTextDocument(file: File, mimeType: string): Promise<DocumentParseResult> {
  const text = limitExtractText(normalizeExtractText(await file.text()));
  if (!text) {
    return {
      status: "failed",
      reason: "文件中没有可读取的文本内容。"
    };
  }

  return {
    status: "parsed",
    text,
    mimeType,
    extractFileName: makeExtractFileName(file)
  };
}

async function parsePdfDocument(file: File): Promise<DocumentParseResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.mjs",
        import.meta.url
      ).toString();
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push(`--- PDF 第 ${pageNumber} 页 ---\n${text}`);
      }
      page.cleanup();
    }

    await loadingTask.destroy();

    const text = limitExtractText(normalizeExtractText(pages.join("\n\n")));
    if (!text) {
      return {
        status: "failed",
        reason: "当前仅支持文本型 PDF；扫描件或图片型 PDF 没有可提取文字。"
      };
    }

    return {
      status: "parsed",
      text,
      pageCount: pdf.numPages,
      mimeType: "application/pdf",
      extractFileName: makeExtractFileName(file)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? `PDF 解析失败：${error.message}` : "PDF 解析失败。"
    };
  }
}

async function parsePptxDocument(file: File): Promise<DocumentParseResult> {
  try {
    if (file.size > MAX_PPTX_COMPRESSED_BYTES) {
      throw new BoundedZipError("compressed_size_limit", "PPTX 文件超过 64 MiB 上限。");
    }
    const files = await unzipWithBudget(new Uint8Array(await file.arrayBuffer()), {
      maxCompressedBytes: MAX_PPTX_COMPRESSED_BYTES,
      maxEntries: 2_048,
      maxIncludedEntries: 512,
      maxEntryUncompressedBytes: 2 * 1024 * 1024,
      maxTotalUncompressedBytes: 32 * 1024 * 1024,
      maxCompressionRatio: 200,
      timeoutMs: 10_000,
      include: (entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name)
    });
    const slideEntries = Object.keys(files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort(compareSlidePaths);

    if (slideEntries.length === 0) {
      return {
        status: "failed",
        reason: "PPTX 中没有可读取的幻灯片文本。"
      };
    }

    const slides = slideEntries
      .map((path, index) => {
        const xml = strFromU8(files[path]);
        const textRuns = extractPptxTextRuns(xml);
        return textRuns.length > 0 ? `--- PPTX 第 ${index + 1} 页 ---\n${textRuns.join("\n")}` : "";
      })
      .filter(Boolean);
    const text = limitExtractText(normalizeExtractText(slides.join("\n\n")));

    if (!text) {
      return {
        status: "failed",
        reason: "PPTX 中没有可读取的文本内容。"
      };
    }

    return {
      status: "parsed",
      text,
      pageCount: slideEntries.length,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extractFileName: makeExtractFileName(file)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof BoundedZipError
        ? `PPTX 解析失败：文件超过安全解压预算（${error.message}）`
        : error instanceof Error
          ? `PPTX 解析失败：${error.message}`
          : "PPTX 解析失败。"
    };
  }
}

function extractPptxTextRuns(xml: string): string[] {
  return Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function compareSlidePaths(left: string, right: string): number {
  return getSlideNumber(left) - getSlideNumber(right);
}

function getSlideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function normalizeExtractText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
}

function limitExtractText(value: string): string {
  return value.length > MAX_EXTRACT_CHARS ? `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[已截断]` : value;
}

function getFileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function makeExtractFileName(file: File): string {
  return `${file.name.replace(/\.[^.]+$/, "") || "document"}.extract.txt`;
}
