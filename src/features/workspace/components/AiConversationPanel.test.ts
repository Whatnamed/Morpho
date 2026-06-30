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
});
