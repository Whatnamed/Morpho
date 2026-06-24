"use client";

import { ChevronLeft, Send, Sparkles } from "lucide-react";

import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
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
    };

type AiConversationPanelProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  suggestions: Suggestion[];
  draft: string;
  isOpen: boolean;
  isLocalEditMode: boolean;
  isStreaming: boolean;
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
  isStreaming,
  pendingConfirmation,
  showFailure,
  imageTaskStatus,
  contextWarning,
  migrationError,
  onToggleOpen,
  onDraftChange,
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
              <p>{message.body}</p>
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
              <strong>{pendingConfirmation.kind === "deleteObject" ? "确认删除对象" : "替换后续默认参考"}</strong>
              {pendingConfirmation.kind === "deleteObject" ? (
                <p>
                  将删除“{pendingConfirmation.targetTitle}”。它会从活动对象和画布实例中移除，并清理实时关系；不会改写已存在的交付引用快照和决策快照。
                  {pendingConfirmation.reasons.length > 0 ? ` 需要确认：${pendingConfirmation.reasons.join(" ")}` : ""}
                </p>
              ) : (
                <p>
                  用“{pendingConfirmation.targetTitle}”替换后续默认参考。之后相关生成会默认延续它的比例、结构、材质和视觉基线；已有图和交付内容不会被替换。
                </p>
              )}
              <div className="confirm-actions">
                <button className="brand-button" type="button" onClick={onConfirmPending}>
                  {pendingConfirmation.kind === "deleteObject" ? "确认删除" : "只替换默认参考"}
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
            <span>建议只会填入输入框；发送后才会执行当前任务。</span>
            <div className="mode-toggle" aria-label="执行模式">
              <span className={isLocalEditMode ? "" : "active"}>文本对话</span>
              <span className={isLocalEditMode ? "active" : ""}>图像任务</span>
            </div>
          </div>
          <div className="ai-input">
            <textarea
              rows={2}
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
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
