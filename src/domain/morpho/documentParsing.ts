import { strFromU8 } from "fflate";

import { BoundedZipError, unzipWithBudget } from "@/shared/boundedZip";
import { IMPORT_RESOURCE_POLICY } from "./importResourcePolicy";

import type { AssetSourceType } from "./types";

export type DocumentParseResult =
  | {
      status: "parsed";
      text: string;
      pageCount?: number;
      sourcePageCount?: number;
      truncated?: boolean;
      mimeType: string;
      extractFileName: string;
    }
  | {
      status: "failed";
      reason: string;
    };

const SUPPORTED_TEXT_EXTENSIONS = new Set(["md", "txt"]);
const MAX_EXTRACT_CHARS = IMPORT_RESOURCE_POLICY.maxPdfExtractedChars;
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
  if (file.size > IMPORT_RESOURCE_POLICY.maxBytesByKind.text) {
    return {
      status: "failed",
      reason: "文本文件超过 8 MiB 解析上限。"
    };
  }
  const { text, truncated } = limitExtractText(normalizeExtractText(await file.text()));
  if (!text) {
    return {
      status: "failed",
      reason: "文件中没有可读取的文本内容。"
    };
  }

  return {
    status: "parsed",
    text,
    truncated,
    mimeType,
    extractFileName: makeExtractFileName(file)
  };
}

async function parsePdfDocument(file: File): Promise<DocumentParseResult> {
  try {
    if (file.size > IMPORT_RESOURCE_POLICY.maxBytesByKind.pdf) {
      return {
        status: "failed",
        reason: "PDF 文件超过 64 MiB 解析上限。"
      };
    }
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
    try {
      const pdf = await loadingTask.promise;
      const sourcePageCount = pdf.numPages;
      const pageLimit = Math.min(sourcePageCount, IMPORT_RESOURCE_POLICY.maxPdfPagesToParse);
      let text = "";
      let processedPageCount = 0;
      let truncated = sourcePageCount > pageLimit;

      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          processedPageCount = pageNumber;
          const pagePrefix = `${text ? "\n\n" : ""}--- PDF 第 ${pageNumber} 页 ---\n`;
          let hasPageText = false;
          for (const item of content.items) {
            const itemText = "str" in item ? normalizePdfTextItem(item.str) : "";
            if (!itemText) continue;
            const chunk = `${hasPageText ? " " : pagePrefix}${itemText}`;
            const remaining = IMPORT_RESOURCE_POLICY.maxPdfExtractedChars - text.length;
            if (chunk.length > remaining) {
              text += chunk.slice(0, Math.max(0, remaining));
              truncated = true;
              break;
            }
            text += chunk;
            hasPageText = true;
          }
        } finally {
          page.cleanup();
        }
        if (text.length >= IMPORT_RESOURCE_POLICY.maxPdfExtractedChars) {
          if (pageNumber < sourcePageCount) truncated = true;
          break;
        }
      }

      text = normalizeExtractText(text);
      if (truncated && text) text = appendTruncationMarker(text);
      if (!text) {
        return {
          status: "failed",
          reason: "当前仅支持文本型 PDF；扫描件或图片型 PDF 没有可提取文字。"
        };
      }

      return {
        status: "parsed",
        text,
        pageCount: processedPageCount,
        sourcePageCount,
        truncated,
        mimeType: "application/pdf",
        extractFileName: makeExtractFileName(file)
      };
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    return {
      status: "failed",
      reason: "PDF 解析失败，源文件已保留。"
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
      include: (entry) => {
        const normalized = entry.name.toLowerCase().replace(/\\/g, "/");
        return (
          normalized === "ppt/presentation.xml" ||
          normalized === "ppt/_rels/presentation.xml.rels" ||
          /^ppt\/slides\/[a-z0-9_\-.]+\.xml$/i.test(normalized)
        );
      }
    });

    const fileMap = new Map<string, Uint8Array>();
    for (const [name, bytes] of Object.entries(files)) {
      fileMap.set(name.toLowerCase().replace(/\\/g, "/"), bytes);
    }

    let orderedSlidePaths: string[] = [];
    const presentationBytes = fileMap.get("ppt/presentation.xml");

    if (presentationBytes) {
      const presentationXml = strFromU8(presentationBytes);
      const sldIdLstMatch = presentationXml.match(/<(?:\w+:)?sldIdLst\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sldIdLst>/i);
      if (!sldIdLstMatch) {
        return {
          status: "failed",
          reason: "PPTX 中没有可读取的幻灯片文本。"
        };
      }

      const sldIdEntries = Array.from(sldIdLstMatch[1].matchAll(/<(?:\w+:)?sldId\b([^>]*?)\/?>/gi));
      if (sldIdEntries.length === 0) {
        return {
          status: "failed",
          reason: "PPTX 中没有可读取的幻灯片文本。"
        };
      }

      const relIds: string[] = [];
      for (const entry of sldIdEntries) {
        const attrs = entry[1] ?? "";
        const relIdMatch =
          attrs.match(/\b(?:\w+:id)\s*=\s*["']([^"']+)["']/i) ??
          attrs.match(/\bid\s*=\s*["'](rId[^"']+)["']/i) ??
          attrs.match(/\br:id\s*=\s*["']([^"']+)["']/i);
        if (!relIdMatch?.[1]) {
          return {
            status: "failed",
            reason: "PPTX 解析失败：幻灯片顺序定义缺失或损坏。"
          };
        }
        relIds.push(relIdMatch[1]);
      }

      const relsBytes = fileMap.get("ppt/_rels/presentation.xml.rels");
      if (!relsBytes) {
        return {
          status: "failed",
          reason: "PPTX 解析失败：幻灯片关系文件缺失。"
        };
      }

      const relsXml = strFromU8(relsBytes);
      const relationships = new Map<string, { target: string; targetMode?: string }>();
      for (const match of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/gi)) {
        const attrs = match[1] ?? "";
        const id = attrs.match(/\bId\s*=\s*["']([^"']+)["']/i)?.[1];
        const target = attrs.match(/\bTarget\s*=\s*["']([^"']+)["']/i)?.[1];
        const targetMode = attrs.match(/\bTargetMode\s*=\s*["']([^"']+)["']/i)?.[1];
        if (id && target) {
          relationships.set(id, { target, targetMode });
        }
      }

      for (const relId of relIds) {
        const rel = relationships.get(relId);
        if (!rel) {
          return {
            status: "failed",
            reason: "PPTX 解析失败：幻灯片关系缺失或损坏。"
          };
        }
        if (rel.targetMode?.toLowerCase() === "external") {
          return {
            status: "failed",
            reason: "PPTX 解析失败：不支持外部幻灯片引用。"
          };
        }
        const resolvedPath = resolvePartPath("ppt", rel.target);
        if (!resolvedPath || !fileMap.has(resolvedPath)) {
          return {
            status: "failed",
            reason: "PPTX 解析失败：幻灯片目标文件缺失或路径无效。"
          };
        }
        orderedSlidePaths.push(resolvedPath);
      }
    } else {
      orderedSlidePaths = Array.from(fileMap.keys())
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
        .sort(compareSlidePaths);
    }

    if (orderedSlidePaths.length === 0) {
      return {
        status: "failed",
        reason: "PPTX 中没有可读取的幻灯片文本。"
      };
    }

    const slides = orderedSlidePaths
      .map((path, index) => {
        const bytes = fileMap.get(path);
        if (!bytes) return "";
        const xml = strFromU8(bytes);
        const textRuns = extractPptxTextRuns(xml);
        return textRuns.length > 0 ? `--- PPTX 第 ${index + 1} 页 ---\n${textRuns.join("\n")}` : "";
      })
      .filter(Boolean);

    const rawText = normalizeExtractText(slides.join("\n\n"));
    const { text, truncated } = limitExtractText(rawText);

    if (!text) {
      return {
        status: "failed",
        reason: "PPTX 中没有可读取的文本内容。"
      };
    }

    return {
      status: "parsed",
      text,
      pageCount: orderedSlidePaths.length,
      sourcePageCount: orderedSlidePaths.length,
      truncated,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extractFileName: makeExtractFileName(file)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof BoundedZipError
        ? `PPTX 解析失败：文件超过安全解压预算（${error.message}）`
        : "PPTX 解析失败，源文件已保留。"
    };
  }
}

function resolvePartPath(baseDir: string, target: string): string | null {
  if (target.includes("://") || target.startsWith("//")) {
    return null;
  }
  const cleanTarget = target.replace(/\\/g, "/");
  const rawPath = cleanTarget.startsWith("/")
    ? cleanTarget.slice(1)
    : `${baseDir}/${cleanTarget}`;

  const segments = rawPath.split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return resolved.join("/").toLowerCase();
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

function limitExtractText(value: string): { text: string; truncated: boolean } {
  if (value.length > MAX_EXTRACT_CHARS) {
    return {
      text: appendTruncationMarker(value.slice(0, MAX_EXTRACT_CHARS)),
      truncated: true
    };
  }
  return { text: value, truncated: false };
}

function normalizePdfTextItem(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function appendTruncationMarker(value: string): string {
  const marker = "\n\n[已截断]";
  return value.length + marker.length <= MAX_EXTRACT_CHARS
    ? `${value}${marker}`
    : `${value.slice(0, Math.max(0, MAX_EXTRACT_CHARS - marker.length))}${marker}`;
}

function getFileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function makeExtractFileName(file: File): string {
  return `${file.name.replace(/\.[^.]+$/, "") || "document"}.extract.txt`;
}
