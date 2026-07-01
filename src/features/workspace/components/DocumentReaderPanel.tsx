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

type DocumentReaderPanelProps = {
  file: FileObject;
  extractAsset?: AssetRecord;
  text: string;
  status: "loading" | "loaded" | "blocked" | "error";
  message?: string;
  onClose: () => void;
};

const SEARCH_RESULT_LIMIT = 100;
const VISIBLE_RESULT_LIMIT = 50;

export function DocumentReaderPanel({
  file,
  extractAsset,
  text,
  status,
  message,
  onClose
}: DocumentReaderPanelProps) {
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const blocks = useMemo(() => buildDocumentReaderBlocks(text), [text]);
  const matches = useMemo(
    () => searchDocumentReaderBlocks(blocks, query, { maxResults: SEARCH_RESULT_LIMIT }),
    [blocks, query]
  );
  const normalizedActiveMatchIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1);
  const activeMatch = matches[normalizedActiveMatchIndex];
  const resultCountLabel = buildResultCountLabel(query, matches.length);

  useEffect(() => {
    if (!activeMatch) {
      return;
    }
    blockRefs.current[activeMatch.blockId]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch]);

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) {
      return;
    }
    setActiveMatchIndex((index) => (index + direction + matches.length) % matches.length);
  };

  return (
    <section className="document-reader-panel" aria-label="文档解析内容阅读面板">
      <div className="document-reader-head">
        <div>
          <span className="document-reader-kicker">本地解析文本</span>
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

          {query.trim() && matches.length === 0 ? (
            <div className="document-reader-state">没有找到匹配内容。</div>
          ) : null}

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

export function buildLocationPrecisionNote(file: FileObject): string {
  const counted = file.extractedPageCount ? `解析器提供了 ${file.extractedPageCount} 页/张计数，` : "";
  return `${counted}当前未保留可靠页级 / slide 级 source map；定位只精确到解析片段、段落和字符范围，不显示伪造页码。`;
}

function DocumentReaderBlockView({
  block,
  match,
  setRef
}: {
  block: DocumentReaderBlock;
  match?: DocumentSearchMatch;
  setRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <article className={`document-reader-block ${block.kind}`} ref={setRef}>
      <div className="document-reader-block-meta">
        解析片段 {block.index + 1} · 字符 {block.startOffset}-{block.endOffset}
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
      return "正在解析";
    case "failed":
      return "解析失败";
    case "unparsed":
    default:
      return "尚未解析";
  }
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "未知";
}

function buildResultCountLabel(query: string, matchCount: number): string {
  if (!query.trim()) {
    return "未输入关键词";
  }

  const resultLimitNote =
    matchCount > VISIBLE_RESULT_LIMIT ? `，显示前 ${VISIBLE_RESULT_LIMIT} 条定位结果，可用上一个/下一个切换其余命中` : "";
  const searchLimitNote = matchCount >= SEARCH_RESULT_LIMIT ? `，搜索最多计算前 ${SEARCH_RESULT_LIMIT} 个命中` : "";
  return `${matchCount} 个命中${resultLimitNote}${searchLimitNote}`;
}

function blockIndexLabel(blocks: DocumentReaderBlock[], blockId: string): string {
  const block = blocks.find((candidate) => candidate.id === blockId);
  return block ? String(block.index + 1) : "未知";
}
