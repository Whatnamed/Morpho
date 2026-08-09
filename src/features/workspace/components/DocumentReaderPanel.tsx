"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import type { AssetRecord, FileObject } from "@/domain/morpho/types";
import {
  buildDocumentReaderBlocks,
  searchDocumentReaderBlocks,
  type DocumentReaderBlock,
  type DocumentSearchMatch
} from "../documentReader";
import { DOCUMENT_FRAGMENT_LIMITS, type DocumentReaderInitialLocation } from "../documentFragments";
import type { DocumentSourcePreview } from "../documentSourcePreview";
import type { DocumentReaderExtractFragmentResult } from "../useDocumentReaderController";

export type { DocumentReaderExtractFragmentResult } from "../useDocumentReaderController";

type DocumentReaderPanelProps = {
  file: FileObject;
  extractAsset?: AssetRecord;
  sourcePreview?: DocumentSourcePreview;
  text: string;
  status: "loading" | "loaded" | "blocked" | "error";
  message?: string;
  initialLocation?: DocumentReaderInitialLocation | null;
  createdFragmentId?: string;
  onExtractFragment?: (input: { blockIds: string[]; title: string; summary: string }) => DocumentReaderExtractFragmentResult | Promise<DocumentReaderExtractFragmentResult>;
  onViewCreatedFragment?: (fragmentId: string) => void;
  onClose: () => void;
};

const SEARCH_RESULT_LIMIT = 100;
const VISIBLE_RESULT_LIMIT = 50;

export function DocumentReaderPanel({
  file,
  extractAsset,
  sourcePreview,
  text,
  status,
  message,
  initialLocation,
  createdFragmentId,
  onExtractFragment,
  onViewCreatedFragment,
  onClose
}: DocumentReaderPanelProps) {
  const readerStateKey = `${file.id}:${file.extractedAssetId ?? "none"}:${initialLocation?.startOffset ?? "none"}:${initialLocation?.endOffset ?? "none"}`;
  return (
    <DocumentReaderPanelContent
      key={readerStateKey}
      file={file}
      extractAsset={extractAsset}
      sourcePreview={sourcePreview}
      text={text}
      status={status}
      message={message}
      initialLocation={initialLocation}
      createdFragmentId={createdFragmentId}
      onExtractFragment={onExtractFragment}
      onViewCreatedFragment={onViewCreatedFragment}
      onClose={onClose}
    />
  );
}

function DocumentReaderPanelContent({
  file,
  extractAsset,
  sourcePreview,
  text,
  status,
  message,
  initialLocation,
  createdFragmentId,
  onExtractFragment,
  onViewCreatedFragment,
  onClose
}: DocumentReaderPanelProps) {
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [fragmentTitle, setFragmentTitle] = useState(() => initialLocation?.label ?? "");
  const [localExtractMessage, setLocalExtractMessage] = useState<string | undefined>();
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const blocks = useMemo(() => buildDocumentReaderBlocks(text), [text]);
  const matches = useMemo(
    () => searchDocumentReaderBlocks(blocks, query, { maxResults: SEARCH_RESULT_LIMIT }),
    [blocks, query]
  );
  const normalizedActiveMatchIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1);
  const activeMatch = matches[normalizedActiveMatchIndex];
  const resultCountLabel = buildResultCountLabel(query, matches.length);
  const selectedBlocks = useMemo(
    () => blocks.filter((block) => selectedBlockIds.includes(block.id)).sort((left, right) => left.index - right.index),
    [blocks, selectedBlockIds]
  );
  const selectedCharCount = selectedBlocks.reduce((total, block) => total + block.text.length, 0);
  const defaultTitle = useMemo(() => buildDefaultFragmentTitle(file.title, selectedBlocks), [file.title, selectedBlocks]);
  const fragmentTitleValue = fragmentTitle.trim() || defaultTitle;
  const selectionWarning = buildSelectionWarning(selectedBlocks, selectedCharCount);
  const canExtract = Boolean(onExtractFragment) && selectedBlocks.length > 0 && !selectionWarning;
  const visibleMessage = message ?? localExtractMessage;

  useEffect(() => {
    if (!activeMatch) {
      return;
    }

    blockRefs.current[activeMatch.blockId]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch]);

  useEffect(() => {
    if (!initialLocation) {
      return;
    }

    const block = blocks.find(
      (candidate) => candidate.startOffset < initialLocation.endOffset && candidate.endOffset > initialLocation.startOffset
    );
    if (block) {
      blockRefs.current[block.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [blocks, initialLocation]);

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) {
      return;
    }
    setActiveMatchIndex((index) => (index + direction + matches.length) % matches.length);
  };

  return (
    <section className="document-reader-panel" aria-label="文档阅读面板">
      <div className="document-reader-head">
        <div>
          <span className="document-reader-kicker">源文件与解析文本</span>
          <h2>{file.title}</h2>
        </div>
        <button className="icon-button" type="button" aria-label="关闭阅读面板" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="document-reader-meta" aria-label="文件解析信息">
        <span>原始文件名：{file.fileName || file.title}</span>
        <span>类型：{file.mimeType || extractAsset?.mimeType || "未知类型"}</span>
        <span>解析状态：{formatParseStatus(file.parseStatus)}</span>
        <span>字符数：{formatCount(file.extractedCharCount ?? text.length)}</span>
        {file.extractedPageCount ? <span>解析器计数：{file.extractedPageCount} 页/张</span> : null}
      </div>

      <p className="document-reader-warning">
        当前阅读的是本地解析文本，不代表原 PDF / PPTX / Office 文档的完整排版、原页视觉或原 slide 布局。
      </p>
      <p className="document-reader-precision">{buildLocationPrecisionNote(file)}</p>

      <SourcePreview preview={sourcePreview} />

      {initialLocation ? (
        <div className="document-reader-location-banner">
          <strong>文档片段来源范围</strong>
          <span>{initialLocation.label}</span>
        </div>
      ) : null}

      {status === "loading" ? <div className="document-reader-state">正在读取本地解析文本…</div> : null}
      {status === "blocked" || status === "error" ? <div className="document-reader-state">{message}</div> : null}

      {status === "loaded" ? (
        <>
          <div className="document-reader-search">
            <div className="document-reader-search-box">
              <Search size={14} />
              <input
                value={query}
                aria-label="搜索本地解析文本"
                placeholder="搜索关键词，只在当前本地解析文本中查询"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveMatchIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    goToMatch(event.shiftKey ? -1 : 1);
                  }
                }}
              />
            </div>
            <span>{resultCountLabel}</span>
            <button className="plain-button" type="button" disabled={matches.length === 0} onClick={() => goToMatch(-1)}>
              <ChevronUp size={13} />
              上一个
            </button>
            <button className="plain-button" type="button" disabled={matches.length === 0} onClick={() => goToMatch(1)}>
              <ChevronDown size={13} />
              下一个
            </button>
          </div>

          <div className="document-reader-extract-bar">
            <div>
              <strong>已选 {selectedBlocks.length} 个解析片段</strong>
              <span>{selectedCharCount.toLocaleString("zh-CN")} 个字符</span>
              {selectionWarning ? <span>{selectionWarning}</span> : null}
            </div>
            <input
              value={fragmentTitle}
              aria-label="文档片段标题"
              placeholder={defaultTitle}
              onChange={(event) => setFragmentTitle(event.currentTarget.value)}
            />
            <button
              className="plain-button"
              type="button"
              disabled={!canExtract}
              title={selectionWarning ?? undefined}
              onClick={async () => {
                if (!onExtractFragment || !canExtract) {
                  return;
                }
                const result = await onExtractFragment({
                  blockIds: selectedBlocks.map((block) => block.id),
                  title: fragmentTitleValue,
                  summary: buildFragmentSummary(selectedBlocks)
                });
                if (result.status === "created") {
                  setSelectedBlockIds([]);
                  setFragmentTitle("");
                  setLocalExtractMessage(undefined);
                  return;
                }
                setLocalExtractMessage(result.reason);
              }}
            >
              提取到画布
            </button>
            <button className="plain-button" type="button" onClick={() => setSelectedBlockIds([])}>
              清空选择
            </button>
          </div>

          {visibleMessage ? (
            <div className="document-reader-state">
              <span>{visibleMessage}</span>
              {createdFragmentId && onViewCreatedFragment ? (
                <button className="plain-button" type="button" onClick={() => onViewCreatedFragment(createdFragmentId)}>
                  在画布中查看
                </button>
              ) : null}
            </div>
          ) : null}

          {query.trim() && matches.length === 0 ? <div className="document-reader-state">没有找到匹配内容。</div> : null}

          {matches.length > 0 ? (
            <div className="document-reader-results" aria-label="搜索定位结果">
              {matches.slice(0, VISIBLE_RESULT_LIMIT).map((match, index) => (
                <button
                  type="button"
                  className={index === normalizedActiveMatchIndex ? "active" : ""}
                  key={match.id}
                  onClick={() => setActiveMatchIndex(index)}
                >
                  <strong>解析片段 {blockIndexLabel(blocks, match.blockId)}</strong>
                  <span>
                    字符 {match.startOffset}-{match.endOffset} · {match.snippet}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="document-reader-body" aria-label="本地解析文本正文">
            {blocks.length > 0 ? (
              blocks.map((block) => (
                <DocumentReaderBlockView
                  block={block}
                  match={activeMatch?.blockId === block.id ? activeMatch : undefined}
                  isSelected={selectedBlockIds.includes(block.id)}
                  isSourceRange={Boolean(
                    initialLocation && block.startOffset < initialLocation.endOffset && block.endOffset > initialLocation.startOffset
                  )}
                  onToggleSelected={() => {
                    setLocalExtractMessage(undefined);
                    setSelectedBlockIds((current) =>
                      current.includes(block.id) ? current.filter((blockId) => blockId !== block.id) : [...current, block.id]
                    );
                  }}
                  key={block.id}
                  setRef={(node) => {
                    blockRefs.current[block.id] = node;
                  }}
                />
              ))
            ) : (
              <div className="document-reader-state">本地解析文本为空。</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SourcePreview({ preview }: { preview?: DocumentSourcePreview }) {
  if (!preview) {
    return null;
  }

  if (preview.status !== "ready") {
    return (
      <div className="document-source-preview blocked" aria-label="源文件预览">
        <strong>源文件视窗</strong>
        <span>{preview.message}</span>
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <div className="document-source-preview" aria-label="源文件预览">
        <strong>源文件视窗 · {preview.fileName}</strong>
        {/* Browser-local object URLs cannot be optimized by next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={preview.fileName} />
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <div className="document-source-preview" aria-label="源文件预览">
        <strong>源文件视窗 · {preview.fileName}</strong>
        <iframe
          src={preview.url}
          title={`源文件预览：${preview.fileName}`}
          sandbox=""
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div className="document-source-preview blocked" aria-label="源文件预览">
      <strong>源文件视窗</strong>
      <span>当前文件类型暂不能在工作台内预览原版式；下方仍可查看已提取的解析文本。</span>
    </div>
  );
}

export function buildLocationPrecisionNote(file: FileObject): string {
  const counted = file.extractedPageCount ? `解析器提供了 ${file.extractedPageCount} 页/张计数，` : "";
  return `${counted}当前未保留可靠页级 / slide 级 source map；定位只精确到解析片段、段落和字符范围，不显示伪造页码。`;
}

function DocumentReaderBlockView({
  block,
  match,
  isSelected,
  isSourceRange,
  onToggleSelected,
  setRef
}: {
  block: DocumentReaderBlock;
  match?: DocumentSearchMatch;
  isSelected: boolean;
  isSourceRange: boolean;
  onToggleSelected: () => void;
  setRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <article className={`document-reader-block ${block.kind} ${isSelected ? "selected" : ""} ${isSourceRange ? "source-range" : ""}`} ref={setRef}>
      <div className="document-reader-block-meta">
        解析片段 {block.index + 1} · 字符 {block.startOffset}-{block.endOffset}
      </div>
      <div className="document-reader-block-actions">
        <button className="document-reader-block-select" type="button" onClick={onToggleSelected}>
          {isSelected ? "取消选择" : "选择此片段"}
        </button>
      </div>
      <div className="document-reader-block-text">{renderSafeHighlightedText(block, match)}</div>
    </article>
  );
}

function renderSafeHighlightedText(block: DocumentReaderBlock, match?: DocumentSearchMatch) {
  if (!match) {
    return block.text;
  }

  return (
    <>
      {block.text.slice(0, match.matchStartInBlock)}
      <mark>{block.text.slice(match.matchStartInBlock, match.matchEndInBlock)}</mark>
      {block.text.slice(match.matchEndInBlock)}
    </>
  );
}

function formatParseStatus(status: FileObject["parseStatus"]): string {
  switch (status) {
    case "parsed":
      return "已解析";
    case "parsing":
      return "解析中";
    case "failed":
      return "解析失败";
    case "unparsed":
    default:
      return "未解析";
  }
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "0";
}

function buildResultCountLabel(query: string, matchCount: number): string {
  if (!query.trim()) {
    return "输入关键词后显示结果";
  }

  const resultLimitNote =
    matchCount > VISIBLE_RESULT_LIMIT ? `，仅显示前 ${VISIBLE_RESULT_LIMIT} 条` : "";
  const searchLimitNote = matchCount >= SEARCH_RESULT_LIMIT ? `，最多检索 ${SEARCH_RESULT_LIMIT} 条` : "";
  return `${matchCount} 条结果${resultLimitNote}${searchLimitNote}`;
}

function buildDefaultFragmentTitle(fileTitle: string, selectedBlocks: DocumentReaderBlock[]): string {
  const firstHeading = selectedBlocks.find((block) => block.kind === "heading")?.text.replace(/^#{1,6}\s+/, "").trim();
  if (firstHeading) {
    return firstHeading.slice(0, 80);
  }

  return `${fileTitle} 片段`;
}

function buildFragmentSummary(selectedBlocks: DocumentReaderBlock[]): string {
  return selectedBlocks.map((block) => block.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function buildSelectionWarning(selectedBlocks: DocumentReaderBlock[], selectedCharCount: number): string | null {
  if (!areConsecutiveReaderBlocks(selectedBlocks)) {
    return "一次只能提取连续的解析片段，请缩小范围后重试。";
  }
  if (selectedBlocks.length > DOCUMENT_FRAGMENT_LIMITS.maxBlocks) {
    return "一次最多提取 8 个解析片段，请缩小选择范围。";
  }
  if (selectedCharCount > DOCUMENT_FRAGMENT_LIMITS.maxBodyChars) {
    return "一次最多提取 6,000 个字符，请缩小选择范围。";
  }
  return null;
}

export function areConsecutiveReaderBlocks(selectedBlocks: DocumentReaderBlock[]): boolean {
  if (selectedBlocks.length <= 1) {
    return true;
  }
  const sortedBlocks = [...selectedBlocks].sort((left, right) => left.index - right.index);
  return sortedBlocks.every((block, index) => index === 0 || block.index === sortedBlocks[index - 1].index + 1);
}

function blockIndexLabel(blocks: DocumentReaderBlock[], blockId: string): string {
  const block = blocks.find((candidate) => candidate.id === blockId);
  return block ? String(block.index + 1) : "?";
}
