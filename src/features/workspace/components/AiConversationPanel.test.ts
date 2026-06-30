import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AiConversationPanel, parseMarkdownBlocks } from "./AiConversationPanel";
import { createInitialWorkspace } from "../../../domain/morpho/workspace";

describe("AiConversationPanel markdown parsing", () => {
  it("parses headings, paragraphs, lists, and markdown tables", () => {
    const blocks = parseMarkdownBlocks(`# 方案比较

这是 **摘要**。

| 方案 | 成本 | 备注 |
| --- | --- | --- |
| A | 低 | 推荐 |
| B | 高 | 备选 |

- 保留输入
- 不自动执行`);

    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "方案比较" },
      { kind: "paragraph", text: "这是 **摘要**。" },
      {
        kind: "table",
        headers: ["方案", "成本", "备注"],
        rows: [
          ["A", "低", "推荐"],
          ["B", "高", "备选"]
        ]
      },
      { kind: "list", ordered: false, items: ["保留输入", "不自动执行"] }
    ]);
  });

  it("renders a jumpable feedback action for saved continuity records", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, {
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "ai-assistant-semantic-feedback",
                role: "assistant",
                body: "Preference noted.",
                status: "done",
                continuityEntryIds: ["continuity-a", "continuity-b"]
              }
            ]
          }
        },
        selectedObjects: [],
        suggestions: [],
        draft: "",
        isOpen: true,
        isLocalEditMode: false,
        taskMode: "chatAnalysis",
        recommendedTaskMode: "chatAnalysis",
        workIntent: "discussion",
        recommendedWorkIntent: "discussion",
        availableWorkIntents: ["discussion"],
        isStreaming: false,
        imageGenerationSettings: {
          modelId: "nano-banana-fast",
          modelLabel: "Nano Banana Fast",
          points: 1,
          aspectRatio: "1:1",
          sizeOption: undefined,
          sizeOptions: [],
          capabilities: ["textToImage"]
        },
        imageGenerationModelOptions: [],
        directionPreviewCount: 2,
        pendingConfirmation: null,
        showFailure: false,
        onToggleOpen: () => undefined,
        onDraftChange: () => undefined,
        onTaskModeChange: () => undefined,
        onWorkIntentChange: () => undefined,
        onImageGenerationSettingsChange: () => undefined,
        onDirectionPreviewCountChange: () => undefined,
        onSuggestionClick: () => undefined,
        onSendMessage: () => undefined,
        onCancelRequest: () => undefined,
        onRunLocalEdit: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onRegenerateProposal: () => undefined,
        onSaveResearchProposalDraft: () => undefined,
        onSaveDesignDefinitionProposalDraft: () => undefined,
        onSaveConceptDirectionProposalDraft: () => undefined,
        onUpdatePendingKeyConclusion: () => undefined,
        onConfirmPending: () => undefined,
        onCancelPending: () => undefined,
        onFailureRetry: () => undefined,
        onOpenProjectRecords: () => undefined
      })
    );

    expect(html).toContain("已补入项目记录");
    expect(html).toContain("2 条");
  });

  it("renders lightweight conversation checkpoint feedback without exposing checkpoint content", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, {
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            conversationCheckpoints: [
              {
                id: "conversation-checkpoint-1",
                laneKey: "lane-direction",
                focusArea: "directionAndVisual",
                focusUpdatedAt: "2026-07-01T08:00:00.000Z",
                taskKind: "general",
                anchorObjectIds: [],
                targetDirectionIds: [],
                sourceStartMessageId: "ai-user-1",
                sourceEndMessageId: "ai-assistant-1",
                sourceMessageCount: 8,
                createdAt: "2026-07-01T08:05:00.000Z",
                updatedAt: "2026-07-01T08:05:00.000Z",
                threadGoal: "当前讨论聚焦于柔光轨道方向的转角连续性。",
                progress: ["已讨论到低位导光需要保持连续。"],
                openThreads: ["仍待确认转角施工复杂度。"],
                nextTurnAnchor: "下一步比较转角结构。"
              }
            ],
            messages: [
              {
                id: "ai-assistant-checkpoint-feedback",
                role: "assistant",
                body: "继续从转角连续性说。",
                status: "done",
                conversationCheckpointId: "conversation-checkpoint-1"
              }
            ]
          }
        },
        selectedObjects: [],
        suggestions: [],
        draft: "",
        isOpen: true,
        isLocalEditMode: false,
        taskMode: "chatAnalysis",
        recommendedTaskMode: "chatAnalysis",
        workIntent: "discussion",
        recommendedWorkIntent: "discussion",
        availableWorkIntents: ["discussion"],
        isStreaming: false,
        imageGenerationSettings: {
          modelId: "nano-banana-fast",
          modelLabel: "Nano Banana Fast",
          points: 1,
          aspectRatio: "1:1",
          sizeOption: undefined,
          sizeOptions: [],
          capabilities: ["textToImage"]
        },
        imageGenerationModelOptions: [],
        directionPreviewCount: 2,
        pendingConfirmation: null,
        showFailure: false,
        onToggleOpen: () => undefined,
        onDraftChange: () => undefined,
        onTaskModeChange: () => undefined,
        onWorkIntentChange: () => undefined,
        onImageGenerationSettingsChange: () => undefined,
        onDirectionPreviewCountChange: () => undefined,
        onSuggestionClick: () => undefined,
        onSendMessage: () => undefined,
        onCancelRequest: () => undefined,
        onRunLocalEdit: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onRegenerateProposal: () => undefined,
        onSaveResearchProposalDraft: () => undefined,
        onSaveDesignDefinitionProposalDraft: () => undefined,
        onSaveConceptDirectionProposalDraft: () => undefined,
        onUpdatePendingKeyConclusion: () => undefined,
        onConfirmPending: () => undefined,
        onCancelPending: () => undefined,
        onFailureRetry: () => undefined,
        onOpenProjectRecords: () => undefined
      })
    );

    expect(html).toContain("已整理当前讨论脉络");
    expect(html).toContain("后续同一工作重点的对话会使用这份讨论整理与最近消息保持连续。");
    expect(html).not.toContain("当前讨论聚焦于柔光轨道方向的转角连续性");
    expect(html).not.toContain("morphoConversationCheckpoint");
    expect(html).not.toContain("项目记录");
  });
});
