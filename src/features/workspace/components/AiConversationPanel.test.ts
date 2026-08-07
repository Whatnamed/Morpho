import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { PendingAiConfirmation } from "../workspaceConfirmation";
import type { PendingComparisonConfirmation } from "../comparisonDecision";

import { AiConversationPanel, getVisibleAiMessageBody, parseMarkdownBlocks } from "./AiConversationPanel";
import { buildAiConversationPanelProps } from "./aiConversationPanelProps";
import { createInitialWorkspace, hideObject } from "../../../domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "../../../domain/operations/operations";

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

  it("renders restored AI messages without proposal technical blocks", () => {
    const workspace = createInitialWorkspace();
    const rawBody = [
      "这里是用户应该看到的说明。",
      "```json",
      JSON.stringify({
        morphoConceptDirectionProposal: {
          title: "内部草案",
          summary: "不应该显示",
          directions: []
        }
      }),
      "```"
    ].join("\n");

    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "ai-assistant-restored-technical",
                role: "assistant",
                body: rawBody,
                status: "done"
              }
            ]
          }
        }
      }))
    );

    expect(getVisibleAiMessageBody(rawBody)).toBe("这里是用户应该看到的说明。");
    expect(html).toContain("这里是用户应该看到的说明。");
    expect(html).not.toContain("morphoConceptDirectionProposal");
    expect(html).not.toContain("内部草案");
    expect(
      getVisibleAiMessageBody(
        ["可见研究说明。", "```json", JSON.stringify({ morphoResearchProposal: { title: "内部研究" } }), "```"].join("\n")
      )
    ).toBe("可见研究说明。");
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

    expect(html).toContain("已保存为项目记录");
    expect(html).toContain("2 条");
  });

  it("renders research citations with the selected left-rule source style", () => {
    const workspace = createInitialWorkspace();
    const citationIds = ["citation-a", "citation-b", "citation-c", "citation-d", "citation-e"];
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          citationSnapshots: Object.fromEntries(
            citationIds.map((id, index) => [
              id,
              {
                id,
                operationId: "operation-citations",
                title: `Source ${index + 1}`,
                url: `https://example.com/${index + 1}`,
                domain: `example-${index + 1}.com`,
                retrievedAt: "2026-07-07T08:00:00.000Z"
              }
            ])
          ),
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-with-citations",
                role: "assistant",
                body: "这轮调研有 5 个来源。",
                status: "done",
                citationIds
              }
            ]
          }
        }
      }))
    );

    expect(html.match(/citation-link citation-link-line/g)).toHaveLength(citationIds.length);
    expect(html).not.toContain("citation-link-index");
    expect(html).not.toContain("citation-link-biblio");
    expect(html).not.toContain("citation-link-rule");
    expect(html).not.toContain("citation-link-minimal");
  });

  it("does not expose deprecated conversation checkpoint feedback", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "ai-assistant-checkpoint-feedback",
                role: "assistant",
                body: "继续从转角连续性说。",
                status: "done"
              }
            ]
          }
        }
      }))
    );

    expect(html).not.toContain("已整理当前讨论脉络");
    expect(html).not.toContain("后续同一工作重点的对话会使用这份讨论整理与最近消息保持连续");
    expect(html).not.toContain("当前讨论聚焦在柔光轨道方向的转角连续性");
  });

  it("keeps canvas-placed proposals out of the chat editor surface", () => {
    const workspace = createInitialWorkspace();
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-on-canvas",
      title: "Definition draft on canvas",
      summary: "This draft should be reviewed from the canvas, not as a long chat card.",
      projectGoal: "Keep proposal review close to the canvas.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Reviewing proposals"],
      coreProblem: "Long proposal editors block the conversation.",
      designPrinciples: ["Canvas first"],
      constraints: ["Do not hide the chat"],
      avoidDirections: ["Long chat forms"],
      opportunities: ["Discuss the selected draft"],
      openQuestions: ["Which draft should be applied?"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 420, y: 260 }
    });
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: proposed.workspace,
        activeProposal: proposed.proposal
      }))
    );

    expect(html).toContain("proposal-chat-note");
    expect(html).toContain("Definition draft on canvas");
    expect(html).not.toContain("proposal-card");
    expect(html).not.toContain("proposal-editor");
    expect(html).not.toContain("Long proposal editors block the conversation.");
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
                  category: "finding",
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

  it("renders compare object details and recommended questions before decision actions", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            comparisonAnalyses: {
              "comparison-ai-assistant-compare-detail": {
                id: "comparison-ai-assistant-compare-detail",
                assistantMessageId: "ai-assistant-compare-detail",
                userMessageId: "ai-user-compare-detail",
                createdAt: "2026-07-01T10:00:00.000Z",
                updatedAt: "2026-07-01T10:00:00.000Z",
                sourceObjectIds: ["direction-soft-rail", "direction-support-island"],
                sourceRefs: [
                  {
                    objectId: "direction-soft-rail",
                    objectType: "conceptDirection",
                    title: "Direction A",
                    summary: "Source A snapshot",
                    availability: "active"
                  },
                  {
                    objectId: "direction-support-island",
                    objectType: "conceptDirection",
                    title: "Direction B",
                    summary: "Source B snapshot",
                    availability: "active"
                  }
                ],
                comparisonGoal: "Compare continuation value.",
                conclusionSummary: "Direction A is stronger for continuous support.",
                objectComparisons: [
                  {
                    objectId: "direction-soft-rail",
                    title: "Direction A",
                    summary: "Direction A keeps the path continuous.",
                    strengths: ["Continuous hand support"],
                    risks: ["Corner installation complexity"],
                    evidence: []
                  },
                  {
                    objectId: "direction-support-island",
                    title: "Direction B",
                    summary: "Direction B is easier to install but less continuous.",
                    strengths: ["Lower installation scope"],
                    risks: ["Weak route continuity"],
                    evidence: []
                  }
                ],
                recommendedQuestions: ["Validate corner transitions."],
                evidenceLimits: ["No visual evidence in this turn."],
                keyConclusionCandidate: undefined
              }
            },
            messages: [
              {
                id: "ai-assistant-compare-detail",
                role: "assistant",
                body: "Compare complete.",
                status: "done",
                comparisonAnalysisId: "comparison-ai-assistant-compare-detail"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("比较对象");
    expect(html).toContain("Direction A keeps the path continuous.");
    expect(html).toContain("Continuous hand support");
    expect(html).toContain("Corner installation complexity");
    expect(html).toContain("待继续验证");
    expect(html).toContain("Validate corner transitions.");
    expect(html.indexOf("Direction A keeps the path continuous.")).toBeLessThan(html.indexOf("设为主方向"));
  });

  it("only offers restore for eliminated directions in compare decisions", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"];
    if (!direction || direction.type !== "conceptDirection") {
      throw new Error("missing direction fixture");
    }
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          objects: {
            ...workspace.objects,
            "direction-soft-rail": { ...direction, status: "eliminated" }
          },
          ai: {
            ...workspace.ai,
            comparisonAnalyses: {
              "comparison-ai-assistant-eliminated": {
                id: "comparison-ai-assistant-eliminated",
                assistantMessageId: "ai-assistant-eliminated",
                userMessageId: "ai-user-eliminated",
                createdAt: "2026-07-01T10:00:00.000Z",
                updatedAt: "2026-07-01T10:00:00.000Z",
                sourceObjectIds: ["direction-soft-rail", "image-soft-rail-v2"],
                sourceRefs: [
                  {
                    objectId: "direction-soft-rail",
                    objectType: "conceptDirection",
                    title: "Eliminated direction",
                    summary: "Eliminated snapshot",
                    availability: "active"
                  },
                  {
                    objectId: "image-soft-rail-v2",
                    objectType: "image",
                    title: "Reference image",
                    summary: "Image snapshot",
                    availability: "active"
                  }
                ],
                comparisonGoal: "Compare restore value.",
                conclusionSummary: "Restore only if user gives a reason.",
                objectComparisons: [
                  {
                    objectId: "direction-soft-rail",
                    title: "Eliminated direction",
                    summary: "Can be restored only as alternative first.",
                    strengths: [],
                    risks: [],
                    evidence: []
                  },
                  {
                    objectId: "image-soft-rail-v2",
                    title: "Reference image",
                    summary: "Reference snapshot.",
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
                id: "ai-assistant-eliminated",
                role: "assistant",
                body: "Compare complete.",
                status: "done",
                comparisonAnalysisId: "comparison-ai-assistant-eliminated"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("恢复为备选");
    expect(html).not.toContain("设为主方向");
    expect(html).not.toContain("设为备选");
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
        category: "finding",
        confidence: "partial"
      }
    };

    const html = renderToStaticMarkup(createElement(AiConversationPanel, makeProps({ pendingConfirmation })));

    expect(html).toContain("确认 Compare 决策");
    expect(html).toContain("来源对象：direction-soft-rail、direction-support-island、image-soft-rail-v2");
  });

  it("requires an assignable category before confirming a new key conclusion", () => {
    const pendingConfirmation: PendingAiConfirmation = {
      kind: "createKeyConclusion",
      sourceObjectIds: ["text-a"],
      sourceTitle: "文本来源",
      conclusionTitle: "待分类结论",
      body: "需要用户明确归类。",
      summary: "需要用户明确归类。",
      category: null,
      citationIds: [],
      confidence: "needsVerification",
      state: "needsVerification",
      note: "等待用户分类。"
    };
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({ pendingConfirmation }))
    );

    expect(html).toContain("请选择类别");
    expect(html).toContain('value=""');
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain(">待分类<");
  });

  it("shows the normal send action when no AI work is active", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        draft: "继续分析这个方向"
      }))
    );

    expect(html).toContain('aria-label="发送"');
    expect(html).not.toContain("停止当前任务");
    expect(html).not.toContain("当前任务正在进行");
  });

  it("turns only the primary input action into a stop action while streaming", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        isStreaming: true,
        draft: ""
      }))
    );

    expect(html).toContain('aria-label="停止当前任务"');
    expect(html).toContain("停止当前任务");
    expect(html).not.toContain("ai-activity-strip");
    expect(html).not.toContain("当前任务正在进行");
  });

  it("renders context warnings as compact notes instead of failure cards", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        contextWarning: "Some selected context was shortened."
      }))
    );

    expect(html).toContain("context-note");
    expect(html).toContain("Some selected context was shortened.");
    expect(html).toContain("不会改变原文件");
    expect(html).not.toContain("默认参考未进入本次语境");
  });

  it("uses a user bubble and assistant prose without the same bubble chrome", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "user-1",
                role: "user",
                body: "请比较这两张图",
                createdAt: "2026-07-07T08:00:00.000Z"
              },
              {
                id: "assistant-1",
                role: "assistant",
                body: "可以，我会先看结构差异。",
                createdAt: "2026-07-07T08:00:01.000Z",
                status: "done"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain('class="ai-message user"');
    expect(html).toContain('class="ai-message assistant"');
  });

  it("shows a thinking indicator for an empty streaming assistant message", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-streaming",
                role: "assistant",
                body: "",
                createdAt: "2026-07-07T08:00:01.000Z",
                status: "streaming"
              }
            ]
          }
        },
        isStreaming: true
      }))
    );

    expect(html).toContain("thinking-row");
    expect(html).toContain("Thinking");
  });

  it("renders ordered Agent process parts above independently streamed final body", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-agent-trace",
                role: "assistant",
                body: "最终回答在过程区下方。",
                status: "streaming",
                agentTrace: {
                  startedAt: "2026-07-13T00:00:00.000Z",
                  status: "streaming",
                  parts: [
                    {
                      id: "reasoning-1",
                      type: "reasoning",
                      text: "先确认当前选择范围。",
                      state: "done",
                      createdAt: "2026-07-13T00:00:00.000Z"
                    },
                    {
                      id: "tool-1",
                      type: "toolActivity",
                      toolCallId: "call-1",
                      toolName: "read_selected_context",
                      activityKind: "contextRead",
                      label: "读取当前选择的对象",
                      state: "running",
                      startedAt: "2026-07-13T00:00:01.000Z"
                    },
                    {
                      id: "commentary-1",
                      type: "commentary",
                      text: "资料足以继续。",
                      state: "streaming",
                      createdAt: "2026-07-13T00:00:02.000Z"
                    }
                  ]
                }
              }
            ]
          }
        },
        isStreaming: true
      }))
    );

    expect(html).toContain("agent-process");
    expect(html).toContain("处理中…");
    expect(html).toContain("读取当前选择的对象");
    expect(html).toContain("agent-process-activity is-running");
    expect(html.indexOf("先确认当前选择范围。")).toBeLessThan(html.indexOf("最终回答在过程区下方。"));
  });

  it("keeps image progress inside Agent Process without a duplicate Thinking row", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-image-trace",
                role: "assistant",
                body: "",
                status: "streaming",
                agentTrace: {
                  startedAt: "2026-07-13T00:00:00.000Z",
                  status: "streaming",
                  parts: [
                    {
                      id: "tool-image",
                      type: "toolActivity",
                      toolCallId: "call-image",
                      toolName: "generate_visuals",
                      activityKind: "imageGeneration",
                      label: "生成图像 2/3",
                      state: "running",
                      startedAt: "2026-07-13T00:00:01.000Z"
                    }
                  ]
                }
              }
            ]
          }
        },
        isStreaming: true
      }))
    );

    expect(html).toContain("生成图像 2/3");
    expect(html).toContain("agent-process-activity is-running");
    expect(html).not.toContain("thinking-row");
    expect(html).not.toContain(">Thinking<");
  });

  it("shows specific project-memory feedback only when a persisted update exists", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-memory-update",
                role: "assistant",
                body: "已按你的明确偏好继续。",
                status: "done",
                continuityEntryIds: ["continuity-preference"],
                memoryUpdateKeys: ["userPreferences"]
              },
              {
                id: "assistant-no-memory-update",
                role: "assistant",
                body: "这只是一次普通讨论。",
                status: "done"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("已更新项目偏好");
    expect(html.match(/continuity-feedback/g)).toHaveLength(1);
  });

  it("collapses completed historical Agent trace by default and keeps its duration title", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "assistant-finished-trace",
                role: "assistant",
                body: "完成。",
                status: "done",
                agentTrace: {
                  startedAt: "2026-07-13T00:00:00.000Z",
                  completedAt: "2026-07-13T00:01:12.000Z",
                  status: "done",
                  parts: [
                    {
                      id: "reasoning-1",
                      type: "reasoning",
                      text: "核对完成。",
                      state: "done",
                      createdAt: "2026-07-13T00:00:00.000Z"
                    }
                  ]
                }
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("思考了 1m 12s");
    expect(html).toContain('class="agent-process-collapse is-closed"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("核对完成。");
  });

  it("uses the primary input action to stop an unfinished operation without adding a second stop control", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace,
        activeOperation: {
          id: "operation-image-stale",
          type: "imageGeneration",
          projectId: workspace.project.id,
          createdAt: "2026-07-03T10:00:00.000Z",
          updatedAt: "2026-07-03T10:00:00.000Z",
          status: "running",
          userInput: "生成方向预览",
          inputSnapshot: {
            userInput: "生成方向预览",
            selectedObjectIds: [],
            sourceSnapshots: [],
            objectSnapshots: []
          },
          allowedCapabilities: {
            webSearch: false,
            imagePixels: true
          },
          steps: [],
          events: [],
          sourceIds: [],
          proposalIds: [],
          retryable: true
        }
      }))
    );

    expect(html).toContain('aria-label="停止当前任务"');
    expect(html).not.toContain("ai-activity-strip");
    expect(html).not.toContain("停止当前任务</button></div>");
  });

  it("renders a compact status surface separate from the chat stream", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace,
        activeOperation: {
          id: "operation-image-queue",
          type: "imageGeneration",
          projectId: workspace.project.id,
          createdAt: "2026-07-04T10:00:00.000Z",
          updatedAt: "2026-07-04T10:00:01.000Z",
          status: "running",
          userInput: "生成一张使用场景",
          inputSnapshot: {
            userInput: "生成一张使用场景",
            selectedObjectIds: [],
            sourceSnapshots: [],
            objectSnapshots: []
          },
          allowedCapabilities: {
            webSearch: false,
            imagePixels: true
          },
          steps: [],
          events: [],
          sourceIds: [],
          proposalIds: [],
          retryable: true
        }
      }))
    );

    expect(html).toContain("状态");
    expect(html).toContain("处理中");
    expect(html).toContain("ai-queue-pill");
    expect(html).not.toContain("图像任务 ·");
  });

  it("keeps the collapsed AI trigger icon-only and provides a scroll-to-bottom affordance", () => {
    const html = renderToStaticMarkup(createElement(AiConversationPanel, makeProps({ isOpen: false })));

    expect(html).toContain("ai-scroll-bottom-button");
    expect(html).toContain('aria-label="滚动到最新消息"');
    expect(html).toContain("ai-top-handle");
    expect(html).not.toContain("ai-panel-logo");
    expect(html).not.toContain(">打开 AI<");
    expect(html).not.toContain(">收起 AI<");
  });

  it("keeps selected context compact near the input instead of flooding the chat scroll", () => {
    const workspace = createInitialWorkspace();
    const selectedObjects = Object.values(workspace.objects).slice(0, 6);
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace,
        selectedObjects
      }))
    );

    expect(html).toContain("input-context-strip");
    expect(html).toContain(`已选 ${selectedObjects.length}`);
    expect(html).toContain(`+${selectedObjects.length - 3}`);
    expect(html).not.toContain("conversation-title\">当前语境");
  });
  it("does not expose automatic routing as a forced mode switch after suggestions fill the draft", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        draft: "基于当前图片继续发展一张新图",
        turnMode: "auto"
      }))
    );

    expect(html).toContain("自动执行");
    expect(html).not.toContain("Agent 会自动判断研究、提案、比较和出图");
    expect(html).not.toContain("图像生成（自动判断）");
  });

  it("uses generic failure copy for failed chat or Compare turns", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        showFailure: true,
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "ai-assistant-failed-chat",
                role: "assistant",
                body: "AI 额度服务暂时不可用，请稍后重试。",
                status: "failed",
                taskMode: "chatAnalysis"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("这次 AI 回复没有完成");
    expect(html).toContain("项目对象未被自动更改");
    expect(html).not.toContain("原图和修改要求已保留");
  });

  it("keeps a query-only recovery entry visible while an external action is pending", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({ showRecoveryPending: true }))
    );

    expect(html).toContain("外部任务仍在执行");
    expect(html).toContain("服务端还没有报告终态");
    expect(html).toContain(">再次检查<");
    expect(html).not.toContain(">重试<");
  });

  it("keeps image-generation failure copy specific to image tasks", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        showFailure: true,
        workspace: {
          ...workspace,
          ai: {
            ...workspace.ai,
            messages: [
              {
                id: "ai-assistant-failed-image",
                role: "assistant",
                body: "今日生图额度已用完，请明天再试。",
                status: "failed",
                taskMode: "imageGeneration"
              }
            ]
          }
        }
      }))
    );

    expect(html).toContain("这次图像任务没有完成");
    expect(html).toContain("来源图、参考对象和生成要求已保留");
  });

  it("only exposes the two turn strategies instead of work-intent toggles", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        turnMode: "confirm"
      }))
    );

    expect(html).toContain("先确认");
    expect(html).toContain(">自动执行<");
    expect(html).toContain(">先确认<");
  });

  it("keeps 1/2/4/6 direction-count shortcuts without exposing model routing", () => {
    const workspace = createInitialWorkspace();
    const selectedObjects = Object.values(workspace.objects).filter((object) => object.type === "conceptDirection");
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        workspace,
        selectedObjects,
        isImageTaskContext: true,
        directionPreviewCount: 4
      }))
    );

    expect(html).toContain("每方向预览数");
    expect(html).toContain(`${selectedObjects.length} 个方向 × 每方向 4 张 = 总计 ${selectedObjects.length * 4} 张`);
    for (const count of [1, 2, 4, 6]) {
      expect(html).toContain(`<option value="${count}"`);
    }
    expect(html).not.toContain(">模型<");
  });

  it("offers both replacement options when replacing an existing default reference", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        pendingConfirmation: {
          kind: "setDefaultReference",
          targetObjectId: "image-night-scenario",
          targetTitle: "夜间场景",
          previousReferenceObjectId: "image-soft-rail-v2",
          previousReferenceTitle: "软轨方案 v2",
          reviewImageCount: 3,
          reviewCollectionCount: 1
        },
        onConfirmPendingSecondary: () => undefined
      }))
    );

    expect(html).toContain("替换后续默认参考");
    expect(html).toContain("软轨方案 v2");
    expect(html).toContain("只替换默认参考");
    expect(html).toContain("替换并标记相关素材待复核");
    expect(html).toContain("3 张图");
    expect(html).toContain("1 个合集");
    expect(html).toContain("不会删除、重排或重新生成");
  });

  it("hides the review-mark option when the old anchor has no direct derivatives", () => {
    const html = renderToStaticMarkup(
      createElement(AiConversationPanel, makeProps({
        pendingConfirmation: {
          kind: "setDefaultReference",
          targetObjectId: "image-night-scenario",
          targetTitle: "夜间场景",
          previousReferenceObjectId: "image-soft-rail-v2",
          previousReferenceTitle: "软轨方案 v2",
          reviewImageCount: 0,
          reviewCollectionCount: 0
        },
        onConfirmPendingSecondary: () => undefined
      }))
    );

    expect(html).toContain("只替换默认参考");
    expect(html).not.toContain("替换并标记相关素材待复核");
    expect(html).toContain("当前没有可标记的直接延展素材");
  });
});

function makeProps(overrides: Partial<ComponentProps<typeof AiConversationPanel>>) {
  return buildAiConversationPanelProps(overrides);
}
