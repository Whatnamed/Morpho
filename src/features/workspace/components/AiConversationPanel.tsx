"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronLeft, Send, Sparkles } from "lucide-react";

import type { AiTaskMode, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import {
  GRS_IMAGE_ASPECT_RATIOS,
  type ImageGenerationModelOption,
  type ImageGenerationSettings
} from "../imageGenerationSettings";
import type { Suggestion } from "../workspaceUi";

export type PendingAiConfirmation =
  | {
      kind: "setDefaultReference";
      targetObjectId: string;
      targetTitle: string;
    }
  | {
      kind: "deleteObject";
      targetObjectId: string;
      targetTitle: string;
      reasons: string[];
    }
  | {
      kind: "applyResearchProposal";
      proposalId: string;
      targetTitle: string;
    };

type AiConversationPanelProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  suggestions: Suggestion[];
  draft: string;
  isOpen: boolean;
  isLocalEditMode: boolean;
  taskMode: AiTaskMode;
  recommendedTaskMode: AiTaskMode;
  isStreaming: boolean;
  imageGenerationSettings: ImageGenerationSettings;
  imageGenerationModelOptions: ImageGenerationModelOption[];
  pendingConfirmation: PendingAiConfirmation | null;
  showFailure: boolean;
  imageTaskStatus?: {
    state: "preparing" | "submitting" | "waiting" | "downloading" | "succeeded" | "failed" | "cancelled";
    message: string;
  } | null;
  contextWarning?: string;
  migrationError?: string;
  onToggleOpen: () => void;
  onDraftChange: (draft: string) => void;
  onTaskModeChange: (taskMode: AiTaskMode) => void;
  onImageGenerationSettingsChange: (patch: {
    modelId?: string;
    aspectRatio?: GrsImageAspectRatio;
    sizeOption?: string;
  }) => void;
  onSuggestionClick: (suggestion: Suggestion) => void;
  onSendMessage: () => void;
  onCancelRequest: () => void;
  onRunLocalEdit: () => void;
  onConfirmPending: () => void;
  onCancelPending: () => void;
  onFailureRetry: () => void;
};

export function AiConversationPanel({
  workspace,
  selectedObjects,
  suggestions,
  draft,
  isOpen,
  isLocalEditMode,
  taskMode,
  recommendedTaskMode,
  isStreaming,
  imageGenerationSettings,
  imageGenerationModelOptions,
  pendingConfirmation,
  showFailure,
  imageTaskStatus,
  contextWarning,
  migrationError,
  onToggleOpen,
  onDraftChange,
  onTaskModeChange,
  onImageGenerationSettingsChange,
  onSuggestionClick,
  onSendMessage,
  onCancelRequest,
  onRunLocalEdit,
  onConfirmPending,
  onCancelPending,
  onFailureRetry
}: AiConversationPanelProps) {
  return (
    <>
      <section className={`ai-panel ${isOpen ? "" : "collapsed"}`} aria-label="AI 对话">
        <div className="ai-top">
          <div className="ai-title">
            <div className="ai-mark">
              <Sparkles size={16} />
            </div>
            <div>
              <strong>对话</strong>
              <span>连续 AI 工作面</span>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label="收起 AI 面板" onClick={onToggleOpen}>
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="ai-scroll">
          <div className="conversation-title">当前语境</div>
          <div className="context-tags">
            {selectedObjects.length === 0 ? (
              <span className="context-tag">未选择对象</span>
            ) : (
              selectedObjects.map((object) => (
                <span className="context-tag" key={object.id}>
                  正在讨论 · {object.title}
                </span>
              ))
            )}
          </div>

          {workspace.ai.messages.map((message) => (
            <div className="ai-message" key={message.id}>
              <MarkdownContent body={message.body} />
              {message.citationIds && message.citationIds.length > 0 ? (
                <div className="citation-list" aria-label="来源引用">
                  {message.citationIds
                    .map((citationId) => workspace.citationSnapshots[citationId])
                    .filter((citation) => Boolean(citation))
                    .map((citation) => (
                      <a
                        className="citation-link"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        key={citation.id}
                      >
                        <span>{citation.title}</span>
                        {citation.domain ? <small>{citation.domain}</small> : null}
                      </a>
                    ))}
                </div>
              ) : null}
            </div>
          ))}

          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <button
                className="suggestion-chip"
                type="button"
                key={suggestion.label}
                onClick={() => onSuggestionClick(suggestion)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>

          {migrationError ? (
            <div className="failure-card">
              <strong>本地项目数据暂未覆盖</strong>
              <p>旧数据迁移失败：{migrationError} 当前显示的是安全示例工作台，原始本地数据仍保留在浏览器中。</p>
            </div>
          ) : null}

          {contextWarning ? (
            <div className="failure-card">
              <strong>默认参考未进入本次语境</strong>
              <p>{contextWarning}</p>
            </div>
          ) : null}

          {imageTaskStatus ? (
            <div className="failure-card">
              <strong>图像任务 · {formatImageTaskState(imageTaskStatus.state)}</strong>
              <p>{imageTaskStatus.message}</p>
            </div>
          ) : null}

          {pendingConfirmation ? (
            <div className="confirm-card">
              <strong>
                {pendingConfirmation.kind === "deleteObject"
                  ? "确认删除对象"
                  : pendingConfirmation.kind === "applyResearchProposal"
                    ? "保存研究与分析"
                    : "替换后续默认参考"}
              </strong>
              {pendingConfirmation.kind === "deleteObject" ? (
                <p>
                  将删除“{pendingConfirmation.targetTitle}”。它会从活动对象和画布实例中移除，并清理实时关系；不会改写已存在的交付引用快照和决策快照。
                  {pendingConfirmation.reasons.length > 0 ? ` 需要确认：${pendingConfirmation.reasons.join(" ")}` : ""}
                </p>
              ) : pendingConfirmation.kind === "applyResearchProposal" ? (
                <p>
                  将“{pendingConfirmation.targetTitle}”保存为正式研究与分析对象，并创建来源关系；不会自动写入长期项目记忆、设计定义、方向状态或关键结论。
                </p>
              ) : (
                <p>
                  用“{pendingConfirmation.targetTitle}”替换后续默认参考。之后相关生成会默认延续它的比例、结构、材质和视觉基线；已有图和交付内容不会被替换。
                </p>
              )}
              <div className="confirm-actions">
                <button className="brand-button" type="button" onClick={onConfirmPending}>
                  {pendingConfirmation.kind === "deleteObject"
                    ? "确认删除"
                    : pendingConfirmation.kind === "applyResearchProposal"
                      ? "保存为研究与分析"
                      : "只替换默认参考"}
                </button>
                <button className="plain-button" type="button" onClick={onCancelPending}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {showFailure ? (
            <div className="failure-card">
              <strong>这次修改没有完成</strong>
              <p>原图与修改要求已保留。可以重试、修改后重试，或取消并保留原图。</p>
              <div className="failure-actions">
                <button className="plain-button" type="button" onClick={onFailureRetry}>
                  重试
                </button>
                <button className="plain-button" type="button" onClick={onFailureRetry}>
                  修改后重试
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="ai-input-wrap">
          <div className="mode-row">
            <span>
              当前任务：{formatTaskMode(taskMode)}
              {recommendedTaskMode !== taskMode ? ` · 建议 ${formatTaskMode(recommendedTaskMode)}` : ""}
            </span>
            <div className="mode-toggle" aria-label="执行模式">
              <button
                type="button"
                className={taskMode === "chatAnalysis" ? "active" : ""}
                onClick={() => onTaskModeChange("chatAnalysis")}
              >
                对话与分析
              </button>
              <button
                type="button"
                className={taskMode === "imageGeneration" ? "active" : ""}
                onClick={() => onTaskModeChange("imageGeneration")}
              >
                图像生成
              </button>
              <button
                type="button"
                className={taskMode === "researchOperation" ? "active" : ""}
                onClick={() => onTaskModeChange("researchOperation")}
              >
                研究任务
              </button>
            </div>
          </div>
          {isLocalEditMode ? (
            <div className="image-settings" aria-label="图像生成设置">
              <label>
                <span>模型</span>
                <select
                  value={imageGenerationSettings.modelId}
                  onChange={(event) => onImageGenerationSettingsChange({ modelId: event.currentTarget.value })}
                >
                  {imageGenerationModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} · {model.points} 积分/次
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>比例</span>
                <select
                  value={imageGenerationSettings.aspectRatio}
                  onChange={(event) =>
                    onImageGenerationSettingsChange({
                      aspectRatio: event.currentTarget.value as GrsImageAspectRatio
                    })
                  }
                >
                  {GRS_IMAGE_ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </label>
              {imageGenerationSettings.sizeOptions.length > 0 ? (
                <label>
                  <span>规格</span>
                  <select
                    value={imageGenerationSettings.sizeOption}
                    disabled={imageGenerationSettings.sizeOptions.length === 1}
                    onChange={(event) => onImageGenerationSettingsChange({ sizeOption: event.currentTarget.value })}
                  >
                    {imageGenerationSettings.sizeOptions.map((sizeOption) => (
                      <option key={sizeOption} value={sizeOption}>
                        {sizeOption}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="image-settings-note">
                <span>{formatCapabilities(imageGenerationSettings.capabilities)}</span>
                <span>费用以服务商控制台为准</span>
              </div>
            </div>
          ) : null}
          <div className="ai-input">
            <textarea
              rows={2}
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (shouldSubmitFromTextarea(event)) {
                  event.preventDefault();
                  if (isStreaming) {
                    return;
                  }

                  if (isLocalEditMode) {
                    onRunLocalEdit();
                    return;
                  }

                  onSendMessage();
                }
              }}
              placeholder="描述你想继续发展的内容…"
            />
            <button
              className="send-button"
              type="button"
              aria-label={isStreaming ? "取消当前请求" : isLocalEditMode ? "执行图像任务" : "发送"}
              onClick={isStreaming ? onCancelRequest : isLocalEditMode ? onRunLocalEdit : onSendMessage}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </section>

      <button className="ai-toggle" type="button" aria-label={isOpen ? "收起 AI" : "打开 AI"} onClick={onToggleOpen}>
        <div className="toggle-icon">
          <Sparkles size={16} />
        </div>
        <span>{isOpen ? "收起 AI" : "打开 AI"}</span>
      </button>
    </>
  );
}

function formatTaskMode(mode: AiTaskMode): string {
  switch (mode) {
    case "chatAnalysis":
      return "对话与分析";
    case "imageGeneration":
      return "图像生成";
    case "researchOperation":
      return "研究任务";
  }
}

function MarkdownContent({ body }: { body: string }) {
  const blocks = parseMarkdownBlocks(body);

  if (blocks.length === 0) {
    return <p className="markdown-paragraph" />;
  }

  return (
    <div className="markdown-message">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const HeadingTag = `h${Math.min(block.level + 2, 5)}` as "h3" | "h4" | "h5";
            return <HeadingTag key={index}>{renderInlineMarkdown(block.text)}</HeadingTag>;
          }
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                ))}
              </ListTag>
            );
          }
          case "table":
            return (
              <div className="markdown-table-wrap" key={index}>
                <table className="markdown-table">
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={headerIndex}>{renderInlineMarkdown(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "paragraph":
            return (
              <p className="markdown-paragraph" key={index}>
                {renderInlineMarkdown(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };

export function parseMarkdownBlocks(body: string): MarkdownBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const headers = splitMarkdownTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = orderedList ? /^\d+[.)]\s+(.+)$/.exec(current) : /^[-*]\s+(.+)$/.exec(current);
        if (!match) {
          break;
        }
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered: orderedList, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        /^(#{1,4})\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+[.)]\s+/.test(current) ||
        isMarkdownTableStart(lines, index)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.includes("|") &&
      lines[index + 1] &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function splitMarkdownTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={parts.length}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={parts.length}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        parts.push(
          <a key={parts.length} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function shouldSubmitFromTextarea(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

function formatCapabilities(capabilities: ImageGenerationSettings["capabilities"]): string {
  const labels = capabilities.map((capability) => {
    switch (capability) {
      case "textToImage":
        return "文生图";
      case "imageToImage":
        return "图生图";
    }
  });

  return labels.join(" / ");
}

function formatImageTaskState(state: NonNullable<AiConversationPanelProps["imageTaskStatus"]>["state"]): string {
  switch (state) {
    case "preparing":
      return "准备中";
    case "submitting":
      return "提交中";
    case "waiting":
      return "等待结果";
    case "downloading":
      return "保存中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}
