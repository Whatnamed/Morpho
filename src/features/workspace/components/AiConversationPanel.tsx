"use client";

import { memo, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, Send, Square } from "lucide-react";

import {
  ASSIGNABLE_KEY_CONCLUSION_CATEGORIES,
  isAssignableKeyConclusionCategory
} from "@/domain/morpho/types";
import type {
  AssignableKeyConclusionCategory,
  AiMessage,
  ComparisonAnalysis,
  ComparisonSourceRef,
  MorphoObject,
  MorphoWorkspace
} from "@/domain/morpho/types";
import type {
  ArtifactProposal,
  ConceptDirectionProposal,
  DesignDefinitionProposal,
  OperationRecord,
  ResearchAnalysisProposal,
  VisualGenerationPlan
} from "@/domain/operations/types";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import {
  GRS_IMAGE_ASPECT_RATIOS,
  type ImageGenerationSettings
} from "../imageGenerationSettings";
import { resolveStoredComparisonSourceRefs } from "@/domain/morpho/comparisonAnalysis";
import { sanitizeStructuredStreamForDisplay } from "@/domain/morpho/structuredBlocks";
import type { Suggestion } from "../workspaceUi";
import type {
  CreateComparisonAnalysisArgs,
  CreateConceptDirectionProposalArgs,
  CreateDesignDefinitionProposalArgs,
  CreateResearchAnalysisArgs,
  MorphoAgentTurnMode,
  RequestConfirmationArgs
} from "../morphoAgent";
import type { ProviderCitation } from "@/server/ai/types";
import { AgentProcessDisclosure } from "./AgentProcessDisclosure";
import { getKeyConclusionCategoryLabel } from "../workspaceUi";
import type {
  ComparisonActionRequest,
  PendingComparisonConfirmation
} from "../comparisonDecision";
import type { PendingAiConfirmation } from "../workspaceConfirmation";
import { isComparisonPendingConfirmation } from "../workspaceConfirmation";

type AiConversationPanelProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  suggestions: Suggestion[];
  draft: string;
  isOpen: boolean;
  isImageTaskContext: boolean;
  turnMode: MorphoAgentTurnMode;
  activeProposal?: ArtifactProposal;
  activeOperation?: OperationRecord | null;
  isStreaming: boolean;
  imageGenerationSettings: ImageGenerationSettings;
  directionPreviewCount: 1 | 2 | 4 | 6;
  pendingConfirmation: PendingAiConfirmation | null;
  showFailure: boolean;
  showRecoveryPending: boolean;
  imageTaskStatus?: {
    state: "preparing" | "submitting" | "waiting" | "downloading" | "succeeded" | "failed" | "cancelled";
    message: string;
  } | null;
  contextWarning?: string;
  migrationError?: string;
  focusInputRequestNonce?: number;
  onToggleOpen: () => void;
  onDraftChange: (draft: string) => void;
  onTurnModeChange: (mode: MorphoAgentTurnMode) => void;
  onImageGenerationSettingsChange: (patch: {
    modelId?: string;
    aspectRatio?: GrsImageAspectRatio;
    sizeOption?: string;
  }) => void;
  onDirectionPreviewCountChange: (count: 1 | 2 | 4 | 6) => void;
  onSuggestionClick: (suggestion: Suggestion) => void;
  onSendMessage: () => void;
  onCancelRequest: () => void;
  onApplyProposal: (allowSourceChanged?: boolean) => void;
  onRejectProposal: (proposalId: string) => void;
  onContinueProposalDiscussion: (proposalId: string) => void;
  onRegenerateProposal: (proposalId: string) => void;
  onSaveResearchProposalDraft: (
    proposalId: string,
    input: Pick<
      ResearchAnalysisProposal,
      "title" | "summary" | "findings" | "opportunities" | "constraints" | "openQuestions" | "evidence"
    >
  ) => void;
  onSaveDesignDefinitionProposalDraft: (
    proposalId: string,
    input: Pick<
      DesignDefinitionProposal,
      | "title"
      | "summary"
      | "projectGoal"
      | "targetUsers"
      | "primaryScenarios"
      | "coreProblem"
      | "designPrinciples"
      | "constraints"
      | "avoidDirections"
      | "opportunities"
      | "openQuestions"
      | "changeNote"
    >
  ) => void;
  onSaveConceptDirectionProposalDraft: (
    proposalId: string,
    input: Pick<ConceptDirectionProposal, "title" | "summary" | "directions">
  ) => void;
  onUpdatePendingKeyConclusion: (patch: Partial<Extract<PendingAiConfirmation, { kind: "createKeyConclusion" }>>) => void;
  onUpdatePendingComparison?: (patch: { userReason: string }) => void;
  onRequestComparisonAction?: (analysisId: string, action: ComparisonActionRequest, objectId?: string) => void;
  onLocateObject?: (objectId: string) => void;
  onConfirmPending: () => void;
  onConfirmPendingSecondary?: () => void;
  onCancelPending: () => void;
  onFailureRetry: () => void;
  onOpenProjectRecords: (entryIds?: string[]) => void;
};

export function AiConversationPanel({
  workspace,
  selectedObjects,
  suggestions,
  draft,
  isOpen,
  isImageTaskContext,
  turnMode,
  activeProposal,
  activeOperation,
  isStreaming,
  imageGenerationSettings,
  directionPreviewCount,
  pendingConfirmation,
  showFailure,
  showRecoveryPending,
  imageTaskStatus,
  contextWarning,
  migrationError,
  focusInputRequestNonce = 0,
  onToggleOpen,
  onDraftChange,
  onTurnModeChange,
  onImageGenerationSettingsChange,
  onDirectionPreviewCountChange,
  onSuggestionClick,
  onSendMessage,
  onCancelRequest,
  onUpdatePendingKeyConclusion,
  onUpdatePendingComparison,
  onRequestComparisonAction,
  onLocateObject,
  onConfirmPending,
  onConfirmPendingSecondary,
  onCancelPending,
  onFailureRetry,
  onOpenProjectRecords
}: AiConversationPanelProps) {
  const confirmationTitle = pendingConfirmation ? getPendingConfirmationTitle(pendingConfirmation) : null;
  const confirmationBody = pendingConfirmation ? getPendingConfirmationBody(pendingConfirmation) : null;
  const confirmationActionLabel = pendingConfirmation ? getPendingConfirmationActionLabel(pendingConfirmation) : null;
  const confirmationSecondaryActionLabel = pendingConfirmation
    ? getPendingConfirmationSecondaryActionLabel(pendingConfirmation)
    : null;
  const isKeyConclusionCategoryMissing = pendingConfirmation?.kind === "createKeyConclusion" && !pendingConfirmation.category;
  const selectedDirectionCount = selectedObjects.filter((object) => object.type === "conceptDirection").length;
  const showDirectionPreviewCount = selectedDirectionCount > 0 && isImageTaskContext;
  const directionPreviewTotal = selectedDirectionCount * directionPreviewCount;
  const isAiBusy = isStreaming || Boolean(activeOperation);
  const hasDraftContent = draft.trim().length > 0;
  const canSubmitDraft = hasDraftContent;
  const isImageTaskActive = Boolean(
    !isStreaming &&
    imageTaskStatus && !["succeeded", "failed", "cancelled"].includes(imageTaskStatus.state)
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const didInitializeScrollRef = useRef(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [dismissedContextWarning, setDismissedContextWarning] = useState<string | null>(null);
  const activeTaskCount = isAiBusy || isImageTaskActive ? 1 : 0;
  const statusLabel = activeTaskCount > 0 ? "处理中" : "空闲";
  const visibleContextObjects = selectedObjects.slice(0, 3);
  const hiddenContextCount = Math.max(0, selectedObjects.length - visibleContextObjects.length);
  const modeSummary = turnMode === "auto" ? "自动执行" : "先确认";
  const failureCopy = showFailure ? getFailureCopy(getLatestFailedAssistantMessage(workspace)) : null;
  const visibleContextWarning = contextWarning && dismissedContextWarning !== contextWarning ? contextWarning : undefined;
  const updateScrollBottomVisibility = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShowScrollBottom(distanceFromBottom > 96);
  };
  const scrollToLatest = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    setShowScrollBottom(false);
  };
  const resizeDraftTextarea = (element = draftTextareaRef.current) => {
    if (!element) {
      return;
    }

    element.style.height = "auto";
    const maxHeight = Number.parseFloat(window.getComputedStyle(element).maxHeight) || 104;
    const nextHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  };
  const handleCopy = (event: ClipboardEvent<HTMLElement>) => {
    if (isEditableCopyTarget(event.target)) {
      return;
    }

    const selectedText = window.getSelection()?.toString() ?? "";
    if (selectedText.trim()) {
      event.clipboardData.setData("text/plain", selectedText);
      event.preventDefault();
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    const messageId = target?.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const message = messageId ? workspace.ai.messages.find((entry) => entry.id === messageId) : undefined;
    const visibleMessageBody = message ? getVisibleAiMessageBody(message.body) : "";
    if (!visibleMessageBody.trim()) {
      return;
    }

    event.clipboardData.setData("text/plain", visibleMessageBody);
    event.preventDefault();
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    if (isOpen && !didInitializeScrollRef.current) {
      didInitializeScrollRef.current = true;
      window.requestAnimationFrame(() => {
        element.scrollTo({ top: element.scrollHeight });
        setShowScrollBottom(false);
      });
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom < 120) {
      element.scrollTo({ top: element.scrollHeight });
      setShowScrollBottom(false);
    } else {
      setShowScrollBottom(true);
    }
  }, [isOpen, workspace.ai.messages, activeProposal?.id, pendingConfirmation?.kind, showFailure, showRecoveryPending]);

  useEffect(() => {
    resizeDraftTextarea();
  }, [draft, isOpen]);

  useEffect(() => {
    if (!isOpen || focusInputRequestNonce <= 0) {
      return;
    }

    draftTextareaRef.current?.focus();
  }, [focusInputRequestNonce, isOpen]);

  return (
    <>
      <section className={`ai-panel ${isOpen ? "" : "collapsed"}`} aria-label="AI 对话" onCopyCapture={handleCopy}>
        <div className="ai-top">
          <div className="ai-top-handle" aria-hidden="true" />
          <button className="icon-button" type="button" aria-label="收起 AI 面板" onClick={onToggleOpen}>
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="ai-scroll-shell">
          <div className="ai-scroll" ref={scrollRef} onScroll={updateScrollBottomVisibility}>
            {workspace.ai.messages.map((message) => {
              const projectRecordFeedback = getProjectRecordFeedback(message);

              return (
              <div className={`ai-message ${message.role}`} key={message.id} data-message-id={message.id}>
                <AiMessageContent message={message} />
                {message.comparisonAnalysisId ? (
                  <ComparisonAnalysisCard
                    analysis={workspace.ai.comparisonAnalyses?.[message.comparisonAnalysisId]}
                    sourceRefs={workspace.ai.comparisonAnalyses?.[message.comparisonAnalysisId] ? resolveStoredComparisonSourceRefs(workspace, workspace.ai.comparisonAnalyses[message.comparisonAnalysisId]) : []}
                    workspace={workspace}
                    onRequestAction={onRequestComparisonAction}
                    onLocateObject={onLocateObject}
                  />
                ) : null}
                {projectRecordFeedback ? (
                  <button
                    className="continuity-feedback"
                    type="button"
                    onClick={() => onOpenProjectRecords(message.continuityEntryIds)}
                  >
                    {projectRecordFeedback}
                  </button>
                ) : null}
                {message.citationIds && message.citationIds.length > 0 ? (
                  <div className="citation-list" aria-label="来源引用">
                    {message.citationIds
                      .map((citationId) => workspace.citationSnapshots[citationId])
                      .filter((citation) => Boolean(citation))
                      .map((citation, citationIndex) => (
                        <a
                          className="citation-link citation-link-line"
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer"
                          key={citation.id}
                        >
                          <span className="citation-index">{citationIndex + 1}</span>
                          <span className="citation-copy">
                            <span className="citation-title">{citation.title}</span>
                            {citation.domain ? <small>{citation.domain}</small> : null}
                          </span>
                        </a>
                      ))}
                  </div>
                ) : null}
              </div>
              );
            })}

          {suggestions.length > 0 ? (
            <div className="suggestions" aria-label="可选建议">
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
          ) : null}

          {migrationError ? (
            <div className="failure-card">
              <strong>本地项目数据暂未覆盖</strong>
              <p>
                旧数据迁移失败：{migrationError}。当前显示的是安全示例工作台，原始本地数据仍保留在浏览器中。
              </p>
            </div>
          ) : null}

          {visibleContextWarning ? (
            <div className="context-note">
              <div>
                <strong>本轮语境提示</strong>
                <p>{visibleContextWarning} 仅影响本轮发送给 AI 的上下文，不会改变原文件、画布对象或本地数据。</p>
              </div>
              <button
                className="context-note-close"
                type="button"
                aria-label="关闭语境提示"
                onClick={() => setDismissedContextWarning(visibleContextWarning)}
              >
                ×
              </button>
            </div>
          ) : null}

          {activeProposal ? <ProposalChatNote proposal={activeProposal} /> : null}

          {pendingConfirmation && confirmationTitle && confirmationBody && confirmationActionLabel ? (
            <div className="confirm-card">
              <strong>{confirmationTitle}</strong>
              <p>{confirmationBody}</p>
              {pendingConfirmation.kind === "createKeyConclusion" ? (
                <div className="confirm-editor" aria-label="关键结论草稿编辑">
                  <label>
                    <span>标题</span>
                    <input
                      value={pendingConfirmation.conclusionTitle}
                      onChange={(event) => onUpdatePendingKeyConclusion({ conclusionTitle: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    <span>正文</span>
                    <textarea
                      rows={4}
                      value={pendingConfirmation.body}
                      onChange={(event) => onUpdatePendingKeyConclusion({ body: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    <span>类别</span>
                    <select
                      value={pendingConfirmation.category ?? ""}
                      onChange={(event) => {
                        const category = event.currentTarget.value;
                        if (!category) {
                          onUpdatePendingKeyConclusion({ category: null });
                        } else if (isAssignableKeyConclusionCategory(category)) {
                          onUpdatePendingKeyConclusion({ category });
                        }
                      }}
                    >
                      <option value="">请选择类别</option>
                      {ASSIGNABLE_KEY_CONCLUSION_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {getKeyConclusionCategoryLabel(category)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>备注</span>
                    <textarea
                      rows={2}
                      value={pendingConfirmation.note}
                      onChange={(event) => onUpdatePendingKeyConclusion({ note: event.currentTarget.value })}
                    />
                  </label>
                  <span className="confirm-meta">
                    类别：{pendingConfirmation.category ? getKeyConclusionCategoryLabel(pendingConfirmation.category) : "请选择类别"} · 来源：{pendingConfirmation.sourceObjectIds.join("、") || "无"} · 引用：
                    {pendingConfirmation.citationIds.join("、") || "无"} · 置信度：{pendingConfirmation.confidence}
                  </span>
                </div>
              ) : isComparisonConfirmation(pendingConfirmation) ? (
                <div className="confirm-editor" aria-label="Compare 决策确认">
                  <label>
                    <span>比较摘要</span>
                    <textarea rows={4} value={pendingConfirmation.summary} readOnly />
                  </label>
                  <label>
                    <span>{pendingConfirmation.reasonRequired ? "用户理由（必填）" : "用户理由（可选）"}</span>
                    <textarea
                      rows={3}
                      value={pendingConfirmation.userReason}
                      onChange={(event) => onUpdatePendingComparison?.({ userReason: event.currentTarget.value })}
                    />
                  </label>
                  <span className="confirm-meta">
                    来源对象：{pendingConfirmation.comparisonSourceObjectIds.join("、") || "无"}
                  </span>
                </div>
              ) : null}
              <div className="confirm-actions">
                <button
                  className="brand-button"
                  type="button"
                  disabled={isKeyConclusionCategoryMissing}
                  onClick={onConfirmPending}
                >
                  {confirmationActionLabel}
                </button>
                {confirmationSecondaryActionLabel && onConfirmPendingSecondary ? (
                  <button className="plain-button" type="button" onClick={onConfirmPendingSecondary}>
                    {confirmationSecondaryActionLabel}
                  </button>
                ) : null}
                <button className="plain-button" type="button" onClick={onCancelPending}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {showRecoveryPending ? (
            <div className="failure-card recovery-pending-card" role="status" aria-live="polite">
              <strong>外部任务仍在执行</strong>
              <p>服务端还没有报告终态。再次检查只会查询同一个任务，不会重复执行或重复计费。</p>
              <div className="failure-actions">
                <button className="plain-button" type="button" onClick={onFailureRetry}>
                  再次检查
                </button>
              </div>
            </div>
          ) : null}

          {showFailure ? (
            <div className="failure-card">
              <strong>{failureCopy?.title}</strong>
              <p>{failureCopy?.body}</p>
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
          <button
            className={`ai-scroll-bottom-button${isStreaming ? " has-new-content" : ""}`}
            type="button"
            aria-label="滚动到最新消息"
            hidden={!showScrollBottom}
            onClick={scrollToLatest}
          >
            <ChevronDown size={22} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>

        <div
          className={[
            "ai-input-wrap",
            isAiBusy ? "is-busy" : "",
            isImageTaskContext ? "is-image-task" : "",
            selectedObjects.length > 0 ? "has-selection" : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="input-context-strip" aria-label="当前输入语境">
            <span className={`input-context-count${selectedObjects.length > 0 ? " has-items" : ""}`}>
              {selectedObjects.length > 0 ? `已选 ${selectedObjects.length}` : "无选择"}
            </span>
            {visibleContextObjects.map((object) => (
              <span className="input-context-chip" title={object.title} key={object.id}>
                {object.title}
              </span>
            ))}
            {hiddenContextCount > 0 ? <span className="input-context-more">+{hiddenContextCount}</span> : null}
          </div>

          <details className="mode-disclosure">
            <summary>
              <span>{modeSummary}</span>
            </summary>
            <div className="mode-row">
              <div className="mode-toggle" role="group" aria-label="执行策略">
                <button
                  type="button"
                  className={turnMode === "auto" ? "active" : ""}
                  aria-pressed={turnMode === "auto"}
                  onClick={() => onTurnModeChange("auto")}
                >
                  自动执行
                </button>
                <button
                  type="button"
                  className={turnMode === "confirm" ? "active" : ""}
                  aria-pressed={turnMode === "confirm"}
                  onClick={() => onTurnModeChange("confirm")}
                >
                  先确认
                </button>
              </div>
            </div>
          </details>

          {isImageTaskContext ? (
            <div className="image-settings" aria-label="图像生成设置">
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
              {showDirectionPreviewCount ? (
                <label>
                  <span>每方向预览数</span>
                  <select
                    value={directionPreviewCount}
                    onChange={(event) =>
                      onDirectionPreviewCountChange(Number(event.currentTarget.value) as 1 | 2 | 4 | 6)
                    }
                  >
                    {[1, 2, 4, 6].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="image-settings-note">
                <span>{formatCapabilities(imageGenerationSettings.capabilities)}</span>
                <span>费用以服务商控制台为准</span>
              </div>
              {showDirectionPreviewCount ? (
                <div className="image-settings-note">
                  {selectedDirectionCount} 个方向 × 每方向 {directionPreviewCount} 张 = 总计 {directionPreviewTotal} 张
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`ai-input${hasDraftContent ? " has-content" : ""}`}>
            <textarea
              ref={draftTextareaRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                onDraftChange(event.currentTarget.value);
                resizeDraftTextarea(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (shouldSubmitFromTextarea(event)) {
                  event.preventDefault();
                  if (isAiBusy || !canSubmitDraft) {
                    return;
                  }

                  onSendMessage();
                }
              }}
              placeholder="描述你想继续发展的内容…"
              aria-busy={isAiBusy}
            />
            <button
              className={`send-button ${isAiBusy ? "stop" : ""}`}
              type="button"
              aria-label={isAiBusy ? "停止当前任务" : "发送"}
              disabled={!isAiBusy && !canSubmitDraft}
              onClick={isAiBusy ? onCancelRequest : onSendMessage}
            >
              {isAiBusy ? <Square size={13} fill="currentColor" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </section>

      <div className={`ai-queue${activeTaskCount > 0 ? " is-active" : ""}`}>
        <button
          className="ai-queue-pill"
          type="button"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen((open) => !open)}
        >
          <span>状态</span>
          <strong data-state={activeTaskCount > 0 ? "busy" : "idle"}>{statusLabel}</strong>
        </button>
        {queueOpen ? (
          <div className="ai-queue-popover" role="status">
            {activeTaskCount === 0 ? (
              <span>当前没有正在执行的任务</span>
            ) : (
              <>
                <strong>{activeOperation ? formatOperationType(activeOperation.type) : "当前输出"}</strong>
                {imageTaskStatus && !isStreaming ? <p>{formatImageTaskState(imageTaskStatus.state)} · {imageTaskStatus.message}</p> : null}
                <button className="plain-button" type="button" onClick={onCancelRequest}>
                  停止
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <button className="ai-toggle" type="button" aria-label={isOpen ? "收起 AI" : "打开 AI"} onClick={onToggleOpen}>
        <div className="toggle-icon morpho-toggle-mark" aria-hidden="true">
          M
        </div>
      </button>
    </>
  );
}

function formatOperationType(type: OperationRecord["type"]): string {
  switch (type) {
    case "imageGeneration":
      return "图像生成";
    case "research":
      return "研究任务";
    case "designDefinition":
      return "设计定义";
    case "conceptDirection":
      return "概念方向";
    default:
      return "当前任务";
  }
}

function ThinkingIndicator() {
  return (
    <div className="thinking-row" aria-label="AI 正在思考">
      <span>Thinking</span>
      <i />
      <i />
      <i />
    </div>
  );
}

// Stream updates replace only the active message object. Keeping the expensive
// trace and Markdown subtree behind that identity boundary avoids reparsing history.
const AiMessageContent = memo(function AiMessageContent({ message }: { message: AiMessage }) {
  const isPlaceholderThinking =
    message.role === "assistant" &&
    message.status === "streaming" &&
    (!message.body.trim() || isAgentThinkingPlaceholder(message.body));

  return (
    <>
      {message.agentTrace ? (
        <AgentProcessDisclosure trace={message.agentTrace} renderText={renderAgentProcessText} />
      ) : null}
      {message.agentTrace ? (
        message.body.trim() ? <MarkdownContent body={getVisibleAiMessageBody(message.body)} /> : null
      ) : isPlaceholderThinking ? (
        <ThinkingIndicator />
      ) : (
        <MarkdownContent body={getVisibleAiMessageBody(message.body)} />
      )}
    </>
  );
});

function renderAgentProcessText(text: string): ReactNode {
  return <MarkdownContent body={text} />;
}

function ProposalChatNote({ proposal }: { proposal: ArtifactProposal }) {
  return (
    <div className="proposal-chat-note" aria-label="画布草案提示">
      <span>{proposalTypeSummary(proposal)}</span>
      <strong>{proposal.title}</strong>
      <p>草案已放到画布。选中画布上的草案卡片后，可以继续讨论、修改同一草案，或应用为正式项目内容。</p>
    </div>
  );
}

function proposalTypeSummary(proposal: ArtifactProposal): string {
  switch (proposal.type) {
    case "researchAnalysis":
      return "研究草案";
    case "designDefinition":
      return "设计定义草案";
    case "conceptDirection":
      return `方向草案${proposal.directions.length > 1 ? ` · ${proposal.directions.length} 个方向` : ""}`;
    case "deliveryPlan":
      return "交付草案";
  }
}

function getProjectRecordFeedback(message: AiMessage): string | undefined {
  if (!message.continuityEntryIds?.length) {
    return undefined;
  }
  if (message.memoryUpdateKeys?.includes("userPreferences")) {
    return "已更新项目偏好";
  }
  if (message.memoryUpdateKeys?.includes("decisionLog")) {
    return "已记录设计决定";
  }
  if (message.stageRecordUpdateKeys?.includes("directionAndVisual")) {
    return "已更新方向与视觉发展记录";
  }
  if (message.stageRecordUpdateKeys?.length) {
    return "已更新项目记忆与阶段记录";
  }
  return `已保存为项目记录 · ${message.continuityEntryIds.length} 条`;
}

function isAgentThinkingPlaceholder(body: string): boolean {
  return (
    body.includes("正在理解") ||
    body.includes("正在进行") ||
    body.includes("姝ｅ湪鐞嗚В") ||
    body.includes("姝ｅ湪杩涜")
  );
}

function getLatestFailedAssistantMessage(workspace: MorphoWorkspace): AiMessage | undefined {
  return [...workspace.ai.messages].reverse().find((message) => message.role === "assistant" && message.status === "failed");
}

function getFailureCopy(message: AiMessage | undefined): { title: string; body: string } {
  if (message?.taskMode === "imageGeneration") {
    return {
      title: "这次图像任务没有完成",
      body: "来源图、参考对象和生成要求已保留。可以重试、修改后重试，或取消并保留现有内容。"
    };
  }

  if (message?.taskMode === "researchOperation") {
    return {
      title: "这次研究任务没有完成",
      body: "本轮资料范围和问题已保留。可以重试，或先修改要求再重新发送。"
    };
  }

  return {
    title: "这次 AI 回复没有完成",
    body: "本轮输入已保留，项目对象未被自动更改。可以重试，或先修改要求再重新发送。"
  };
}

function getPendingConfirmationTitle(confirmation: PendingAiConfirmation): string {
  switch (confirmation.kind) {
    case "setDefaultReference":
      return "替换后续默认参考";
    case "deleteObject":
      return "确认删除对象";
    case "batchGenerateVisuals":
      return "确认批量生成";
    case "createKeyConclusion":
      return "保存关键结论";
    case "agentCreateResearchAnalysis":
      return "确认创建研究卡";
    case "agentCreateDesignDefinitionProposal":
      return "确认创建设计定义草稿";
    case "agentCreateConceptDirectionProposal":
      return "确认创建概念方向草稿";
    case "agentCreateComparisonAnalysis":
      return "确认创建 Compare 分析";
    case "agentGenerateVisuals":
      return "确认生成视觉结果";
    case "agentRequestedAction":
      return getAgentRequestedActionTitle(confirmation.action);
    case "compareSetPrimary":
    case "compareSetAlternative":
    case "compareEliminate":
    case "compareRestoreAlternative":
    case "compareSetDefaultReference":
    case "compareClearDefaultReference":
    case "compareCreateKeyConclusion":
      return "确认 Compare 决策";
  }
}

function getPendingConfirmationBody(confirmation: PendingAiConfirmation): string {
  switch (confirmation.kind) {
    case "setDefaultReference": {
      const reviewScopeText = describeReviewScope(confirmation);
      return `用“${confirmation.targetTitle}”替换当前后续默认参考“${confirmation.previousReferenceTitle}”。之后相关生成将以它为默认基线；已有素材不会被删除或替换。也可以同时把旧默认参考的直接延展素材标记为待复核${reviewScopeText}，标记不会删除、重排或重新生成任何内容。`;
    }
    case "deleteObject": {
      const reasonText =
        confirmation.reasons.length > 0 ? ` 需要确认：${confirmation.reasons.join(" ")}` : "";
      return `将删除“${confirmation.targetTitle}”。它会从活动对象和画布实例中移除，并清理实时关系；已有交付引用快照和决策快照不会被改写。${reasonText}`;
    }
    case "batchGenerateVisuals":
      return `将基于当前语境批量生成 ${confirmation.itemCount} 张新图像。${confirmation.reason} ${confirmation.impact} 这只会创建新的图像对象，不会覆盖来源图、默认参考、交付引用或已有版本链。`;
    case "createKeyConclusion": {
      const categoryLabel = confirmation.category ? getKeyConclusionCategoryLabel(confirmation.category) : "待选择类别";
      return `将从“${confirmation.sourceTitle}”保存一条用户确认的${categoryLabel}：“${confirmation.conclusionTitle}”。它会创建新的关键结论对象、来源关系和决策记录；不会自动改写设计定义、概念方向、默认参考、交付引用或长期项目记忆。`;
    }
    case "agentCreateResearchAnalysis":
    case "agentCreateDesignDefinitionProposal":
    case "agentCreateConceptDirectionProposal":
    case "agentCreateComparisonAnalysis":
    case "agentGenerateVisuals":
      return `将执行“${confirmation.targetTitle}”。基于当前显式语境和本回合已获得的来源执行。${confirmation.reason} ${confirmation.impact} 未确认前不会创建、修改或生成任何项目对象；取消不会改变项目状态。`;
    case "agentRequestedAction":
      return `Agent 请求执行“${getAgentRequestedActionTitle(confirmation.action)}”。基于当前显式语境和目标对象执行。${confirmation.reason} ${confirmation.impact} 未确认前不会改变项目状态；取消不会改写设计定义、方向状态、默认参考、图像或交付引用。`;
    case "compareSetPrimary":
    case "compareSetAlternative":
    case "compareEliminate":
    case "compareRestoreAlternative":
    case "compareSetDefaultReference":
    case "compareClearDefaultReference":
    case "compareCreateKeyConclusion":
      return `本次 Compare 决策将针对“${confirmation.targetTitle}”写入真实状态；AI 比较摘要只读展示，不能自动成为用户理由。`;
  }
}

function describeReviewScope(
  confirmation: Extract<PendingAiConfirmation, { kind: "setDefaultReference" }>
): string {
  const parts: string[] = [];
  if (confirmation.reviewImageCount > 0) {
    parts.push(`${confirmation.reviewImageCount} 张图`);
  }
  if (confirmation.reviewCollectionCount > 0) {
    parts.push(`${confirmation.reviewCollectionCount} 个合集`);
  }
  return parts.length > 0 ? `（${parts.join("、")}）` : "（当前没有可标记的直接延展素材）";
}

export function getPendingConfirmationSecondaryActionLabel(confirmation: PendingAiConfirmation): string | null {
  if (confirmation.kind !== "setDefaultReference") {
    return null;
  }

  return confirmation.reviewImageCount + confirmation.reviewCollectionCount > 0
    ? "替换并标记相关素材待复核"
    : null;
}

function getPendingConfirmationActionLabel(confirmation: PendingAiConfirmation): string {
  switch (confirmation.kind) {
    case "setDefaultReference":
      return "只替换默认参考";
    case "deleteObject":
      return "确认删除";
    case "batchGenerateVisuals":
      return "确认生成";
    case "createKeyConclusion":
      return "确认保存结论";
    case "agentCreateResearchAnalysis":
    case "agentCreateDesignDefinitionProposal":
    case "agentCreateConceptDirectionProposal":
    case "agentCreateComparisonAnalysis":
    case "agentGenerateVisuals":
    case "agentRequestedAction":
      return "确认执行";
    case "compareSetPrimary":
    case "compareSetAlternative":
    case "compareEliminate":
    case "compareRestoreAlternative":
    case "compareSetDefaultReference":
    case "compareClearDefaultReference":
    case "compareCreateKeyConclusion":
      return "确认决定";
  }
}

function getAgentRequestedActionTitle(action: RequestConfirmationArgs["action"]): string {
  switch (action) {
    case "applyDesignDefinition":
      return "应用设计定义";
    case "setDirectionPrimary":
      return "设为主方向";
    case "setDirectionAlternative":
      return "设为备选方向";
    case "eliminateDirection":
      return "淘汰方向";
    case "setDefaultReference":
      return "替换后续默认参考";
    case "batchGenerateVisuals":
      return "批量生成视觉结果";
  }
}

function isComparisonConfirmation(confirmation: PendingAiConfirmation): confirmation is PendingComparisonConfirmation {
  return (
    confirmation.kind === "compareSetPrimary" ||
    confirmation.kind === "compareSetAlternative" ||
    confirmation.kind === "compareEliminate" ||
    confirmation.kind === "compareRestoreAlternative" ||
    confirmation.kind === "compareSetDefaultReference" ||
    confirmation.kind === "compareClearDefaultReference" ||
    confirmation.kind === "compareCreateKeyConclusion"
  );
}

function ComparisonAnalysisCard({
  analysis,
  sourceRefs,
  workspace,
  onRequestAction,
  onLocateObject
}: {
  analysis?: ComparisonAnalysis;
  sourceRefs: ComparisonSourceRef[];
  workspace: MorphoWorkspace;
  onRequestAction?: (analysisId: string, action: ComparisonActionRequest, objectId?: string) => void;
  onLocateObject?: (objectId: string) => void;
}) {
  if (!analysis) {
    return null;
  }

  const directionSources = sourceRefs.filter((source) => workspace.objects[source.objectId]?.type === "conceptDirection");
  const imageSources = sourceRefs.filter((source) => workspace.objects[source.objectId]?.type === "image");
  const hasKeyConclusionCandidate = Boolean(analysis.keyConclusionCandidate);

  return (
    <div className="confirm-card" aria-label="Compare 分析结果">
      <strong>Compare 分析</strong>
      {analysis.objectComparisons.length > 0 ? (
        <div className="confirm-editor" aria-label="比较对象">
          <span className="confirm-meta">比较对象</span>
          {analysis.objectComparisons.map((entry) => (
            <div className="compare-object-detail" key={entry.objectId}>
              <strong>{entry.title}</strong>
              <p>{entry.summary}</p>
              {entry.strengths.length > 0 ? <p>优势 / 可继续发展：{entry.strengths.join("；")}</p> : null}
              {entry.risks.length > 0 ? <p>风险 / 代价：{entry.risks.join("；")}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <p>跨对象结论：{analysis.conclusionSummary}</p>
      {analysis.recommendedQuestions.length > 0 ? <p>待继续验证：{analysis.recommendedQuestions.join("；")}</p> : null}
      {analysis.evidenceLimits.length > 0 ? <p>证据边界：{analysis.evidenceLimits.join("；")}</p> : null}
      <div className="confirm-editor">
        <span className="confirm-meta">来源对象：</span>
        <div className="failure-actions">
          {sourceRefs.map((source) =>
            source.availability === "active" ? (
              <button className="plain-button" type="button" key={source.objectId} onClick={() => onLocateObject?.(source.objectId)}>
                {source.title}
              </button>
            ) : (
              <span className="confirm-meta" key={source.objectId}>
                {source.title}
                {formatSourceAvailability(source.availability)}
              </span>
            )
          )}
        </div>
      </div>
      <div className="failure-actions">
        {directionSources.map((source) => {
          const object = workspace.objects[source.objectId];
          if (!object || object.type !== "conceptDirection") {
            return null;
          }
          const disabled = source.availability !== "active";
          const isEliminated = object.status === "eliminated";

          return (
            <div key={source.objectId}>
              <span>{source.title}</span>
              {isEliminated ? (
                <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "restoreAlternative", source.objectId)}>
                  恢复为备选
                </button>
              ) : (
                <>
                  <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "setPrimary", source.objectId)}>
                    设为主方向
                  </button>
                  <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "setAlternative", source.objectId)}>
                    设为备选
                  </button>
                  <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "eliminate", source.objectId)}>
                    淘汰方向
                  </button>
                </>
              )}
            </div>
          );
        })}
        {imageSources.map((source) => {
          const object = workspace.objects[source.objectId];
          if (!object || object.type !== "image") {
            return null;
          }
          const disabled = source.availability !== "active";

          return (
            <div key={source.objectId}>
              <span>{source.title}</span>
              {object.isDefaultReference ? (
                <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "clearDefaultReference", source.objectId)}>
                  取消后续默认参考
                </button>
              ) : (
                <button className="plain-button" type="button" disabled={disabled} onClick={() => onRequestAction?.(analysis.id, "setDefaultReference", source.objectId)}>
                  设为后续默认参考
                </button>
              )}
            </div>
          );
        })}
        {hasKeyConclusionCandidate ? (
          <button className="brand-button" type="button" onClick={() => onRequestAction?.(analysis.id, "createKeyConclusion")}>
            保存候选关键结论
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatSourceAvailability(availability: ComparisonSourceRef["availability"]): string {
  switch (availability) {
    case "active":
      return "";
    case "hidden":
      return "（已隐藏）";
    case "missing":
      return "（已缺失）";
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

export function getVisibleAiMessageBody(body: string): string {
  return sanitizeStructuredStreamForDisplay(body, AI_MESSAGE_TECHNICAL_MARKERS);
}

const AI_MESSAGE_TECHNICAL_MARKERS = [
  "morphoProjectContinuityPatch",
  "morphoDesignDefinitionProposal",
  "morphoConceptDirectionProposal",
  "morphoComparisonAnalysis",
  "morphoDeliverySectionDraft",
  "morphoResearchProposal"
] as const;

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

function isEditableCopyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("textarea, input, [contenteditable='true']"));
}

function formatCapabilities(capabilities: ImageGenerationSettings["capabilities"]): string {
  const labels = capabilities.map((capability) => {
    switch (capability) {
      case "textToImage":
        return "文生图";
      case "imageToImage":
        return "图生图";
      case "directedEdit":
        return "定向修改";
      case "maskedLocalEdit":
        return "蒙版局部编辑";
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
