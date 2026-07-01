import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { PendingComparisonConfirmation } from "./AiConversationPanel";

import { AiConversationPanel, parseMarkdownBlocks } from "./AiConversationPanel";
import { createInitialWorkspace, hideObject } from "../../../domain/morpho/workspace";

describe("AiConversationPanel", () => {
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
      createElement(AiConversationPanel, makeProps({
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
        }
      }))
    );

    expect(html).toContain("已补入项目记录");
    expect(html).toContain("2 条");
  });

  it("renders lightweight conversation checkpoint feedback without exposing checkpoint content", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
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
                threadGoal: "当前讨论聚焦在柔光轨道方向的转角连续性。",
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
        }
      }))
    );

    expect(html).toContain("已整理当前讨论脉络");
    expect(html).toContain("后续同一工作重点的对话会使用这份讨论整理与最近消息保持连续");
    expect(html).not.toContain("当前讨论聚焦在柔光轨道方向的转角连续性");
    expect(html).not.toContain("morphoConversationCheckpoint");
  });

  it("renders compare analysis actions only after analysis is saved", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            comparisonAnalyses: {
              "comparison-ai-assistant-compare": {
                id: "comparison-ai-assistant-compare",
                assistantMessageId: "ai-assistant-compare",
                userMessageId: "ai-user-compare",
                createdAt: "2026-07-01T10:00:00.000Z",
                updatedAt: "2026-07-01T10:00:00.000Z",
                sourceObjectIds: ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2"],
                sourceRefs: [
                  {
                    objectId: "direction-soft-rail",
                    objectType: "conceptDirection",
                    title: "柔光轨道",
                    summary: "连续墙面轨道",
                    availability: "active"
                  },
                  {
                    objectId: "direction-support-island",
                    objectType: "conceptDirection",
                    title: "支撑岛",
                    summary: "低位独立支撑点",
                    availability: "active"
                  },
                  {
                    objectId: "image-soft-rail-v2",
                    objectType: "image",
                    title: "柔光轨道预览",
                    summary: "当前默认参考图",
                    availability: "active"
                  }
                ],
                comparisonGoal: "比较这几个对象在当前项目中的延续价值。",
                conclusionSummary: "柔光轨道更适合作为主方向，图片可继续作为默认参考。",
                objectComparisons: [
                  {
                    objectId: "direction-soft-rail",
                    title: "柔光轨道",
                    summary: "连续性最强。",
                    strengths: ["路径连续"],
                    risks: ["转角施工"],
                    evidence: []
                  },
                  {
                    objectId: "direction-support-island",
                    title: "支撑岛",
                    summary: "更轻量但识别连续性弱。",
                    strengths: ["施工更轻"],
                    risks: ["路径连续性弱"],
                    evidence: []
                  },
                  {
                    objectId: "image-soft-rail-v2",
                    title: "柔光轨道预览",
                    summary: "可继续作为视觉基线。",
                    strengths: ["已有视觉基线"],
                    risks: [],
                    evidence: []
                  }
                ],
                recommendedQuestions: [],
                evidenceLimits: ["本轮未自动写回真实状态。"],
                keyConclusionCandidate: {
                  title: "夜间连续导向优先于装饰复杂度",
                  summary: "优先保留连续导向。",
                  body: "夜间连续导向优先于装饰复杂度。",
                  sourceObjectIds: ["direction-soft-rail"],
                  evidence: [
                    {
                      objectId: "direction-soft-rail",
                      label: "方向摘要",
                      evidence: "连续墙面轨道更稳。"
                    }
                  ],
                  confidence: "partial"
                }
              }
            },
            messages: [
              {
                id: "ai-assistant-compare",
                role: "assistant",
                body: "已完成 Compare。",
                status: "done",
                comparisonAnalysisId: "comparison-ai-assistant-compare"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("Compare 分析");
    expect(html).toContain("设为主方向");
    expect(html).toContain("取消后续默认参考");
    expect(html).toContain("保存候选关键结论");
    expect(html).toContain("<button class=\"plain-button\" type=\"button\">方向 A：柔光轨道</button>");
  });

  it("keeps saved compare snapshots visible when a source becomes hidden", () => {
    const hiddenWorkspace = hideObject(createInitialWorkspace(), "direction-support-island");
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...hiddenWorkspace,
          ai: {
            ...hiddenWorkspace.ai,
            comparisonAnalyses: {
              "comparison-ai-assistant-compare": {
                id: "comparison-ai-assistant-compare",
                assistantMessageId: "ai-assistant-compare",
                userMessageId: "ai-user-compare",
                createdAt: "2026-07-01T10:00:00.000Z",
                updatedAt: "2026-07-01T10:00:00.000Z",
                sourceObjectIds: ["direction-soft-rail", "direction-support-island"],
                sourceRefs: [
                  {
                    objectId: "direction-soft-rail",
                    objectType: "conceptDirection",
                    title: "柔光轨道",
                    summary: "连续墙面轨道",
                    availability: "active"
                  },
                  {
                    objectId: "direction-support-island",
                    objectType: "conceptDirection",
                    title: "支撑岛",
                    summary: "低位独立支撑点",
                    availability: "active"
                  }
                ],
                comparisonGoal: "比较两个方向。",
                conclusionSummary: "保留比较快照。",
                objectComparisons: [
                  {
                    objectId: "direction-soft-rail",
                    title: "柔光轨道",
                    summary: "更连续。",
                    strengths: [],
                    risks: [],
                    evidence: []
                  },
                  {
                    objectId: "direction-support-island",
                    title: "支撑岛",
                    summary: "已隐藏。",
                    strengths: [],
                    risks: [],
                    evidence: []
                  }
                ],
                recommendedQuestions: [],
                evidenceLimits: [],
                keyConclusionCandidate: undefined
              }
            },
            messages: [
              {
                id: "ai-assistant-compare",
                role: "assistant",
                body: "保留 Compare 快照。",
                status: "done",
                comparisonAnalysisId: "comparison-ai-assistant-compare"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("支撑岛（已隐藏）");
    expect(html).toContain("Compare 分析");
  });

  it("renders compare key conclusion confirmation with candidate-only source subset metadata", () => {
    const pendingConfirmation: PendingComparisonConfirmation = {
      kind: "compareCreateKeyConclusion",
      targetTitle: "夜间连续导向优先于装饰复杂度",
      comparisonAnalysisId: "comparison-ai-assistant-compare",
      comparisonAssistantMessageId: "ai-assistant-compare",
      comparisonSourceObjectIds: ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2"],
      keyConclusionSourceObjectIds: ["direction-soft-rail"],
      summary: "柔光轨道更适合作为主方向。",
      userReason: "",
      reasonRequired: false,
      keyConclusionDraft: {
        title: "夜间连续导向优先于装饰复杂度",
        body: "夜间连续导向优先于装饰复杂度。",
        summary: "优先保留连续导向。",
        confidence: "partial"
      }
    };

    const html = renderToStaticMarkup(createElement(AiConversationPanel, makeProps({ pendingConfirmation })));

    expect(html).toContain("确认 Compare 决策");
    expect(html).toContain("来源对象：direction-soft-rail、direction-support-island、image-soft-rail-v2");
  });
});

function makeProps(overrides: Partial<ComponentProps<typeof AiConversationPanel>>) {
  const workspace = createInitialWorkspace();
  return {
    workspace,
    selectedObjects: [],
    suggestions: [],
    draft: "",
    isOpen: true,
    isLocalEditMode: false,
    taskMode: "chatAnalysis" as const,
    recommendedTaskMode: "chatAnalysis" as const,
    workIntent: "discussion" as const,
    recommendedWorkIntent: "discussion" as const,
    availableWorkIntents: ["discussion" as const],
    isStreaming: false,
    imageGenerationSettings: {
      modelId: "nano-banana-fast",
      modelLabel: "Nano Banana Fast",
      points: 1,
      aspectRatio: "1:1" as const,
      sizeOption: undefined,
      sizeOptions: [],
      capabilities: ["textToImage" as const]
    },
    imageGenerationModelOptions: [],
    directionPreviewCount: 2 as const,
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
    onUpdatePendingComparison: () => undefined,
    onRequestComparisonAction: () => undefined,
    onLocateObject: () => undefined,
    onConfirmPending: () => undefined,
    onCancelPending: () => undefined,
    onFailureRetry: () => undefined,
    onOpenProjectRecords: () => undefined,
    ...overrides
  };
}
