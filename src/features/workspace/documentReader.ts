import type { AssetId, AssetRecord, FileObject, MorphoObjectId, MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

export type DocumentReaderBlock = {
  id: string;
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
  kind: "heading" | "paragraph" | "preformatted";
};

export type DocumentSearchMatch = {
  id: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  matchStartInBlock: number;
  matchEndInBlock: number;
  snippet: string;
};

export type DocumentReaderAvailability =
  | {
      status: "ready";
      fileObjectId: MorphoObjectId;
      extractAssetId: AssetId;
      file: FileObject;
      asset: AssetRecord;
    }
  | {
      status: "blocked";
      reason:
        | "fileMissing"
        | "notFile"
        | "hidden"
        | "unparsed"
        | "parsing"
        | "failed"
        | "missingExtractAssetId"
        | "extractAssetMissing"
        | "invalidExtractAsset";
      message: string;
      file?: FileObject;
    };

export type DocumentReaderLoadResult =
  | {
      status: "loaded";
      fileObjectId: MorphoObjectId;
      asset: AssetRecord;
      text: string;
    }
  | {
      status: "blocked";
      fileObjectId: MorphoObjectId;
      message: string;
      reason: Extract<DocumentReaderAvailability, { status: "blocked" }>["reason"];
    }
  | {
      status: "error";
      fileObjectId: MorphoObjectId;
      message: string;
    };

export type DocumentReaderLoadGuardState = {
  openFileObjectId: MorphoObjectId | null;
  requestId: number;
};

export type DocumentReaderLoadIdentity = {
  fileObjectId: MorphoObjectId;
  requestId: number;
};

const DEFAULT_MAX_BLOCK_LENGTH = 2_400;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const DEFAULT_SNIPPET_CONTEXT = 32;

export function buildDocumentReaderBlocks(
  text: string,
  options: { maxBlockLength?: number } = {}
): DocumentReaderBlock[] {
  if (!text.trim()) {
    return [];
  }

  const maxBlockLength = Math.max(200, options.maxBlockLength ?? DEFAULT_MAX_BLOCK_LENGTH);
  const rawBlocks: Array<Omit<DocumentReaderBlock, "id" | "index">> = [];
  const lines = readLinesWithOffsets(text);
  let paragraphStart: number | null = null;
  let paragraphEnd: number | null = null;

  const flushParagraph = () => {
    if (paragraphStart === null || paragraphEnd === null || paragraphEnd <= paragraphStart) {
      paragraphStart = null;
      paragraphEnd = null;
      return;
    }

    rawBlocks.push({
      startOffset: paragraphStart,
      endOffset: paragraphEnd,
      text: text.slice(paragraphStart, paragraphEnd),
      kind: "paragraph"
    });
    paragraphStart = null;
    paragraphEnd = null;
  };

  for (const line of lines) {
    if (!line.text.trim()) {
      flushParagraph();
      continue;
    }

    if (isHeadingLine(line.text)) {
      flushParagraph();
      rawBlocks.push({
        startOffset: line.startOffset,
        endOffset: line.endOffset,
        text: text.slice(line.startOffset, line.endOffset),
        kind: "heading"
      });
      continue;
    }

    paragraphStart ??= line.startOffset;
    paragraphEnd = line.endOffset;
  }
  flushParagraph();

  const splitBlocks = rawBlocks.flatMap((block) => splitLongBlock(block, maxBlockLength));
  return splitBlocks.map((block, index) => ({
    ...block,
    id: `block-${index}-${block.startOffset}-${block.endOffset}`,
    index
  }));
}

export function searchDocumentReaderBlocks(
  blocks: DocumentReaderBlock[],
  query: string,
  options: { maxResults?: number; snippetContext?: number } = {}
): DocumentSearchMatch[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }

  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS);
  const snippetContext = Math.max(0, options.snippetContext ?? DEFAULT_SNIPPET_CONTEXT);
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches: DocumentSearchMatch[] = [];

  for (const block of blocks) {
    const normalizedText = block.text.toLocaleLowerCase();
    let cursor = 0;
    while (matches.length < maxResults) {
      const matchStartInBlock = normalizedText.indexOf(normalizedNeedle, cursor);
      if (matchStartInBlock < 0) {
        break;
      }

      const matchEndInBlock = matchStartInBlock + needle.length;
      const startOffset = block.startOffset + matchStartInBlock;
      const endOffset = block.startOffset + matchEndInBlock;
      matches.push({
        id: `match-${matches.length}-${block.id}-${matchStartInBlock}`,
        blockId: block.id,
        startOffset,
        endOffset,
        matchStartInBlock,
        matchEndInBlock,
        snippet: buildSnippet(block.text, matchStartInBlock, matchEndInBlock, snippetContext)
      });
      cursor = matchEndInBlock;
    }

    if (matches.length >= maxResults) {
      break;
    }
  }

  return matches;
}

export function resolveDocumentReaderAvailability(
  workspace: MorphoWorkspace,
  fileObjectId: MorphoObjectId
): DocumentReaderAvailability {
  const object = workspace.objects[fileObjectId];
  if (!object) {
    return {
      status: "blocked",
      reason: "fileMissing",
      message: "文件不存在，当前无法打开阅读面板。"
    };
  }

  if (object.type !== "file") {
    return {
      status: "blocked",
      reason: "notFile",
      message: "只有文件对象可以阅读本地解析文本。"
    };
  }

  if (object.visibility !== "active") {
    return {
      status: "blocked",
      reason: "hidden",
      message: "该文件已隐藏；请先恢复对象，再打开本地解析文本。",
      file: object
    };
  }

  if (object.parseStatus === "parsing") {
    return {
      status: "blocked",
      reason: "parsing",
      message: "正在解析，完成后可阅读。",
      file: object
    };
  }

  if (object.parseStatus === "failed") {
    return {
      status: "blocked",
      reason: "failed",
      message: object.parseError || "解析失败，当前没有可读的本地解析文本。",
      file: object
    };
  }

  if (object.parseStatus !== "parsed") {
    return {
      status: "blocked",
      reason: "unparsed",
      message: "该文件尚未生成可读的本地解析文本。",
      file: object
    };
  }

  if (!object.extractedAssetId) {
    return {
      status: "blocked",
      reason: "missingExtractAssetId",
      message: "本地解析文本资源不可用，当前无法阅读。",
      file: object
    };
  }

  const asset = workspace.assets[object.extractedAssetId];
  if (!asset) {
    return {
      status: "blocked",
      reason: "extractAssetMissing",
      message: "本地解析文本资源不可用，当前无法阅读。",
      file: object
    };
  }

  if (asset.sourceType !== "documentExtract") {
    return {
      status: "blocked",
      reason: "invalidExtractAsset",
      message: "本地解析文本资源不可用，当前无法阅读。",
      file: object
    };
  }

  return {
    status: "ready",
    fileObjectId,
    extractAssetId: asset.id,
    file: object,
    asset
  };
}

export async function loadDocumentReaderExtract(
  workspace: MorphoWorkspace,
  fileObjectId: MorphoObjectId,
  blobStore: BlobStore,
  signal?: AbortSignal
): Promise<DocumentReaderLoadResult> {
  const availability = resolveDocumentReaderAvailability(workspace, fileObjectId);
  if (availability.status === "blocked") {
    return {
      status: "blocked",
      fileObjectId,
      message: availability.message,
      reason: availability.reason
    };
  }

  if (signal?.aborted) {
    return {
      status: "error",
      fileObjectId,
      message: "阅读面板已关闭，已停止读取本地解析文本。"
    };
  }

  try {
    const blob = await blobStore.get(availability.asset.storageKey);
    if (signal?.aborted) {
      return {
        status: "error",
        fileObjectId,
        message: "阅读面板已关闭，已停止读取本地解析文本。"
      };
    }

    if (!blob) {
      return {
        status: "error",
        fileObjectId,
        message: "本地解析文本 Blob 缺失，当前无法阅读。"
      };
    }

    const text = await blob.text();
    if (signal?.aborted) {
      return {
        status: "error",
        fileObjectId,
        message: "阅读面板已关闭，已停止读取本地解析文本。"
      };
    }

    return {
      status: "loaded",
      fileObjectId,
      asset: availability.asset,
      text
    };
  } catch (error) {
    return {
      status: "error",
      fileObjectId,
      message: error instanceof Error ? `本地解析文本读取失败：${error.message}` : "本地解析文本读取失败。"
    };
  }
}

export function shouldAcceptDocumentReaderLoadResult(
  state: DocumentReaderLoadGuardState,
  result: DocumentReaderLoadIdentity
): boolean {
  return state.openFileObjectId === result.fileObjectId && state.requestId === result.requestId;
}

function readLinesWithOffsets(text: string): Array<{ text: string; startOffset: number; endOffset: number }> {
  const lines: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const lineText = match[1] ?? "";
    const startOffset = match.index;
    const endOffset = startOffset + lineText.length;
    if (lineText.length > 0 || match[2]) {
      lines.push({ text: lineText, startOffset, endOffset });
    }
    if (!match[2]) {
      break;
    }
  }

  return lines;
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trim());
}

function splitLongBlock(
  block: Omit<DocumentReaderBlock, "id" | "index">,
  maxBlockLength: number
): Array<Omit<DocumentReaderBlock, "id" | "index">> {
  if (block.text.length <= maxBlockLength) {
    return [block];
  }

  const chunks: Array<Omit<DocumentReaderBlock, "id" | "index">> = [];
  let chunkStartInBlock = 0;
  while (chunkStartInBlock < block.text.length) {
    const chunkEndInBlock = Math.min(chunkStartInBlock + maxBlockLength, block.text.length);
    const startOffset = block.startOffset + chunkStartInBlock;
    const endOffset = block.startOffset + chunkEndInBlock;
    chunks.push({
      startOffset,
      endOffset,
      text: block.text.slice(chunkStartInBlock, chunkEndInBlock),
      kind: block.kind
    });
    chunkStartInBlock = chunkEndInBlock;
  }
  return chunks;
}

function buildSnippet(text: string, matchStart: number, matchEnd: number, context: number): string {
  const start = Math.max(0, matchStart - context);
  const end = Math.min(text.length, matchEnd + context);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
