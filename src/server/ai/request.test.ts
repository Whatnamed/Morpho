import { describe, expect, it } from "vitest";

import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "./request";

describe("MiMo chat route request conversion", () => {
  it("states when no image pixels are sent", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "Analyze this image",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [
        {
          id: "image-a",
          type: "image",
          title: "Reference image",
          summary: "A local imported image."
        }
      ],
      defaultReferenceStatus: "notRelevant",
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          mimeType: "image/png",
          status: "metadataOnly"
        }
      ]
    });

    expect(prompt).toContain("本次没有发送图片像素");
    expect(prompt).toContain("不能声称完成真实视觉分析");
  });

  it("keeps a sanitized attachment boundary out of provider messages", () => {
    const result = validateAiRouteRequest({
      draft: "Analyze this image",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/png",
          representation: "single",
          status: "metadataOnly",
          apiKey: "must-not-survive"
        }
      ]
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.stringify(result.value.attachments)).not.toContain("must-not-survive");
      expect(result.value.attachments).toEqual([
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/png",
          representation: "single",
          status: "metadataOnly"
        }
      ]);
    }
  });

  it("converts ready image attachments to OpenAI-compatible image_url parts", () => {
    const messages = buildProviderMessages({
      draft: "Analyze this image",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,abc123",
          representation: "single",
          status: "ready"
        }
      ]
    });

    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Analyze this image" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc123" } }
    ]);
  });

  it("adds selected document extracts to provider user content without treating them as citations", () => {
    const messages = buildProviderMessages({
      draft: "基于资料做研究",
      task: "research",
      taskMode: "researchOperation",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: [],
      documentExtracts: [
        {
          objectId: "file-a",
          title: "真实资料",
          fileName: "brief.txt",
          text: "夜间起身路径风险",
          charCount: 8,
          truncated: false
        }
      ]
    });

    expect(messages[0]?.content).toContain("local project sources");
    expect(messages[0]?.content).toContain("file-a / 真实资料 / brief.txt");
    expect(messages[0]?.content).toContain("夜间起身路径风险");
  });

  it("keeps contact sheet metadata for diagnostics without sending it as text", () => {
    const result = validateAiRouteRequest({
      draft: "Compare these images",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "sheet-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a", "image-b", "image-c", "image-d"],
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,abc123",
          representation: "contactSheet",
          status: "ready"
        }
      ]
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.attachments[0]).toMatchObject({
        representation: "contactSheet",
        objectIds: ["image-a", "image-b", "image-c", "image-d"]
      });
      expect(buildMorphoSystemPrompt(result.value)).toContain("自动生成的总览图");
    }
  });

  it("normalizes web search options only for non-image modes", () => {
    const result = validateAiRouteRequest({
      draft: "Verify the latest source",
      taskMode: "researchOperation",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: [],
      webSearch: {
        enabled: true,
        forceSearch: true,
        maxKeyword: 99,
        limit: 99
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.webSearch).toEqual({
        enabled: true,
        forceSearch: true,
        maxKeyword: 8,
        limit: 10
      });
    }

    expect(
      validateAiRouteRequest({
        draft: "Generate image",
        taskMode: "imageGeneration",
        messages: [],
        objectSummaries: [],
        attachments: [],
        webSearch: { enabled: true, forceSearch: true }
      })
    ).toMatchObject({
      status: "ok",
      value: {
        webSearch: undefined
      }
    });
  });

  it("asks for a structured design definition proposal only for designDefinition tasks", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "整理当前设计定义",
      task: "designDefinition",
      taskMode: "chatAnalysis",
      workIntent: "createDesignDefinition",
      messages: [],
      objectSummaries: [],
      attachments: []
    });

    expect(prompt).toContain("morphoDesignDefinitionProposal");
    expect(prompt).toContain("不要自动声明已应用该定义");
  });

  it("asks for a structured concept direction proposal only for conceptDirection tasks", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "提出几个概念方向",
      task: "conceptDirection",
      taskMode: "chatAnalysis",
      workIntent: "createConceptDirections",
      messages: [],
      objectSummaries: [],
      attachments: []
    });

    expect(prompt).toContain("morphoConceptDirectionProposal");
    expect(prompt).toContain("不要自动指定主方向");
  });

  it("asks for a structured visual generation plan in image generation mode", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "给每个方向生成一张预览图",
      task: "directionPreview",
      taskMode: "imageGeneration",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: [],
      webSearch: { enabled: true, forceSearch: true }
    });

    expect(prompt).toContain("morphoVisualGenerationPlan");
    expect(prompt).not.toContain("morphoProjectContinuityPatch");
    expect(prompt).toContain("只负责形成受控图像生成计划");
    expect(validateAiRouteRequest({
      draft: "给每个方向生成一张预览图",
      taskMode: "imageGeneration",
      messages: [],
      objectSummaries: [],
      attachments: [],
      webSearch: { enabled: true, forceSearch: true }
    })).toMatchObject({
      status: "ok",
      value: {
        webSearch: undefined
      }
    });
  });

  it("keeps authorized imageGeneration context attachments and local document extracts for MiMo planning", () => {
    const result = validateAiRouteRequest({
      draft: "分别为这几个方向生成预览图",
      task: "directionPreview",
      taskMode: "imageGeneration",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [
        {
          id: "direction-a",
          type: "conceptDirection",
          title: "方向 A",
          summary: "柔和轨道方向"
        }
      ],
      attachments: [
        {
          id: "asset-image-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,abc123",
          representation: "single",
          status: "ready"
        }
      ],
      documentExtracts: [
        {
          objectId: "file-a",
          title: "访谈摘录",
          fileName: "interview.md",
          text: "老人夜间起身会寻找低眩光的连续扶手。",
          charCount: 20,
          truncated: false
        }
      ],
      webSearch: { enabled: true, forceSearch: true }
    });

    expect(result).toMatchObject({
      status: "ok",
      value: {
        taskMode: "imageGeneration",
        webSearch: undefined,
        attachments: [
          {
            status: "ready",
            objectId: "image-a"
          }
        ],
        documentExtracts: [
          {
            objectId: "file-a",
            title: "访谈摘录"
          }
        ]
      }
    });
    if (result.status === "ok") {
      const prompt = buildMorphoSystemPrompt(result.value);
      expect(prompt).toContain("本次已发送 1 个显式选择的 active 图片对象像素");
      expect(prompt).toContain("本次发送 1 个选中 parsed 文件的 documentExtract 文本");
      expect(prompt).toContain("本地来源 objectId");
    }
  });

  it("allows controlled conversation continuity patches only for chat and research tasks", () => {
    const chatPrompt = buildMorphoSystemPrompt({
      draft: "夜间识别感比造型复杂度更重要。",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: []
    });
    const researchPrompt = buildMorphoSystemPrompt({
      draft: "分析这些资料，材料成本必须控制在农村家庭可接受范围内。",
      task: "research",
      taskMode: "researchOperation",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: []
    });
    const imagePrompt = buildMorphoSystemPrompt({
      draft: "生成一张更温和的场景图。",
      task: "visualDevelopment",
      taskMode: "imageGeneration",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: []
    });

    expect(chatPrompt).toContain("morphoProjectContinuityPatch");
    expect(chatPrompt).toContain("provider 不得生成 summary");
    expect(chatPrompt).toContain("evidenceQuote 必须是当前用户消息中的直接原话");
    expect(chatPrompt).toContain("不得改变任何项目对象、方向状态、默认参考、revision、VisualBranch、交付引用或 Current Focus");
    expect(chatPrompt).toContain("设计定义或概念方向的待应用 Proposal JSON");
    expect(chatPrompt).toContain("结构化研究草案不会自动成立为长期项目事实，因此不作为全局抑制条件");
    expect(researchPrompt).toContain("morphoProjectContinuityPatch");
    expect(imagePrompt).not.toContain("morphoProjectContinuityPatch");
  });

  it("normalizes conversation checkpoint context without exposing lane or storage metadata", () => {
    const result = validateAiRouteRequest({
      draft: "继续讨论转角结构。",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [
        { role: "user", body: "之前讨论低位导光。" },
        { role: "assistant", body: "可以继续比较转角连续性。" }
      ],
      objectSummaries: [],
      attachments: [],
      conversationContext: {
        checkpoint: {
          threadGoal: "当前讨论聚焦于柔光轨道的转角连续性。",
          progress: ["已讨论到低位导光应比装饰光更连续。"],
          openThreads: ["仍待确认转角施工复杂度。"],
          nextTurnAnchor: "下一步比较转角结构。",
          laneKey: "internal-lane",
          sourceStartMessageId: "message-1",
          sourceEndMessageId: "message-8"
        },
        recentMessageCount: 2,
        checkpointRequested: true,
        laneKey: "internal-lane",
        sourceIds: ["message-1", "message-8"]
      }
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.value.conversationContext).toEqual({
      checkpoint: {
        threadGoal: "当前讨论聚焦于柔光轨道的转角连续性。",
        progress: ["已讨论到低位导光应比装饰光更连续。"],
        openThreads: ["仍待确认转角施工复杂度。"],
        nextTurnAnchor: "下一步比较转角结构。"
      },
      recentMessageCount: 2,
      checkpointRequested: true
    });
    expect(JSON.stringify(result.value.conversationContext)).not.toContain("internal-lane");
    expect(JSON.stringify(result.value.conversationContext)).not.toContain("sourceStartMessageId");
  });

  it("presents current checkpoints as non-authoritative discussion notes with explicit priority", () => {
    const result = validateAiRouteRequest({
      draft: "继续讨论转角结构。",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [{ role: "assistant", body: "上一轮只保留少量最近消息。" }],
      objectSummaries: [],
      attachments: [],
      conversationContext: {
        checkpoint: {
          threadGoal: "当前讨论聚焦于柔光轨道的转角连续性。",
          progress: ["已讨论到低位导光应比装饰光更连续。"],
          openThreads: ["仍待确认转角施工复杂度。"],
          nextTurnAnchor: "下一步比较转角结构。"
        },
        recentMessageCount: 1,
        checkpointRequested: true
      },
      taskContext: {
        kind: "general",
        objectIds: [],
        imageObjectIds: [],
        documentObjectIds: [],
        directions: [],
        visualBranches: [],
        projectContinuity: {
          currentFocus: {
            area: "directionAndVisual",
            updatedAt: "2026-07-01T08:00:00.000Z",
            sourceKind: "userAction",
            sourceObjectIds: [],
            note: "方向与视觉发展"
          },
          relevantStageRecords: [],
          relevantProjectMemoryViews: [],
          reviewRequiredItems: [],
          omitted: [],
          truncated: false
        },
        skipped: []
      }
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    const prompt = buildMorphoSystemPrompt(result.value);
    expect(prompt).toContain("Conversation checkpoint");
    expect(prompt).toContain("非权威的当前讨论笔记");
    expect(prompt).toContain("优先级：当前用户输入 > 真实项目事实与 projectContinuity Context > 当前 checkpoint > recent raw messages");
    expect(prompt).toContain("当前讨论聚焦于柔光轨道的转角连续性");
    expect(prompt).toContain("morphoConversationCheckpoint");
    expect(prompt).toContain("不要写项目事实、方向状态、默认参考、对象状态、设计定义");
    expect(prompt).toContain("morphoProjectContinuityPatch");
    expect(prompt).not.toContain("sourceStartMessageId");
    expect(prompt).not.toContain("laneKey");
  });

  it("does not add checkpoint output instructions for non-chat or proposal work intents", () => {
    const base = {
      draft: "继续讨论。",
      task: "general",
      messages: [],
      objectSummaries: [],
      attachments: [],
      conversationContext: {
        recentMessageCount: 8,
        checkpointRequested: true
      }
    };
    const research = buildMorphoSystemPrompt({
      ...base,
      taskMode: "researchOperation",
      workIntent: "discussion"
    });
    const image = buildMorphoSystemPrompt({
      ...base,
      taskMode: "imageGeneration",
      workIntent: "discussion"
    });
    const definition = buildMorphoSystemPrompt({
      ...base,
      taskMode: "chatAnalysis",
      workIntent: "createDesignDefinition"
    });

    expect(research).not.toContain("morphoConversationCheckpoint");
    expect(image).not.toContain("morphoConversationCheckpoint");
    expect(definition).not.toContain("morphoConversationCheckpoint");
    expect(definition).toContain("morphoDesignDefinitionProposal");
  });

  it("keeps bounded structured task context in the MiMo system prompt", () => {
    const result = validateAiRouteRequest({
      draft: "基于当前定义继续生成方向预览",
      task: "directionPreview",
      taskMode: "imageGeneration",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: [],
      taskContext: {
        kind: "directionPreview",
        objectIds: ["direction-soft-rail", "definition-current"],
        imageObjectIds: ["image-soft-rail-v2"],
        documentObjectIds: ["file-course-brief"],
        truncated: false,
        defaultReference: "included:image-soft-rail-v2",
        designDefinition: {
          objectId: "definition-current",
          revisionId: "definition-revision-current-1",
          revisionNumber: 1,
          title: "当前设计定义",
          summary: "低施工连续支撑",
          projectGoal: "为夜间起身建立连续辅助系统",
          targetUsers: ["独居老人"],
          primaryScenarios: ["夜间起身"],
          coreProblem: "路径辨认与支撑",
          designPrinciples: ["低施工"],
          constraints: ["不重布线"],
          avoidDirections: ["医疗器械感"],
          opportunities: ["低位导光"],
          openQuestions: ["转角如何处理"],
          sourceObjectIds: ["research-night-path"]
        },
        directions: [
          {
            objectId: "direction-soft-rail",
            revisionId: "direction-revision-soft-rail-1",
            revisionNumber: 1,
            title: "柔光轨道",
            summary: "连续墙面轨道",
            conceptStatement: "把导向、照明和支撑合成一个日常家具化元素",
            keywords: ["连续轨道"],
            strategy: "优先保持路径连续性",
            differentiators: ["支撑与光一体化"],
            visualSignals: ["暖灰轨道"],
            risks: ["转角安装复杂"],
            openQuestions: ["如何降低医疗感"],
            sourceObjectIds: ["definition-current"],
            basedOnDefinitionRevisionId: "definition-revision-current-1"
          }
        ],
        visualBranches: [
          {
            id: "visual-branch-soft-rail-core",
            directionId: "direction-soft-rail",
            label: "核心产品图",
            rootObjectId: "image-soft-rail-preview"
          }
        ],
        skipped: [{ objectId: "hidden-image", reason: "hidden" }]
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const prompt = buildMorphoSystemPrompt(result.value);
      expect(prompt).toContain("Structured task context");
      expect(prompt).toContain("definition-current / r1 / 当前设计定义");
      expect(prompt).toContain("projectGoal: 为夜间起身建立连续辅助系统");
      expect(prompt).toContain("direction-soft-rail / r1 / 柔光轨道");
      expect(prompt).toContain("visualSignals: 暖灰轨道");
      expect(prompt).toContain("visual-branch-soft-rail-core / direction-soft-rail / 核心产品图");
      expect(prompt).not.toContain("data:image");
    }
  });

  it("keeps message continuity source refs bounded in request context", () => {
    const result = validateAiRouteRequest({
      draft: "继续讨论",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [],
      taskContext: {
        kind: "general",
        objectIds: [],
        imageObjectIds: [],
        documentObjectIds: [],
        directions: [],
        visualBranches: [],
        projectContinuity: {
          currentFocus: {
            area: "directionAndVisual",
            updatedAt: "2026-06-30T09:00:00.000Z",
            sourceKind: "userAction",
            sourceObjectIds: [],
            note: "方向与视觉发展"
          },
          relevantStageRecords: [
            {
              id: "continuity-message",
              stage: "directionAndVisual",
              category: "preference",
              summary: "明确偏好：夜间识别感比造型复杂度更重要",
              validity: "current",
              sourceRefs: [
                {
                  kind: "message",
                  id: "ai-user-1",
                  snapshot: {
                    title: "用户表达",
                    summarySnippet: "夜间识别感比造型复杂度更重要".repeat(20),
                    createdAt: "2026-06-30T09:00:00.000Z"
                  },
                  sourceAvailability: "active"
                }
              ]
            }
          ],
          relevantProjectMemoryViews: [],
          reviewRequiredItems: [],
          omitted: [],
          truncated: false
        },
        skipped: []
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const source = result.value.taskContext?.projectContinuity?.relevantStageRecords[0]?.sourceRefs[0];
      expect(source).toMatchObject({ kind: "message", id: "ai-user-1", sourceAvailability: "active" });
      expect(source?.snapshot?.summarySnippet?.length).toBeLessThanOrEqual(220);
      expect(JSON.stringify(result.value.taskContext)).not.toContain("夜间识别感比造型复杂度更重要".repeat(20));
    }
  });

  it("drops unknown continuity source ref kinds during route validation", () => {
    const result = validateAiRouteRequest({
      draft: "继续讨论",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [],
      taskContext: {
        kind: "general",
        objectIds: [],
        imageObjectIds: [],
        documentObjectIds: [],
        directions: [],
        visualBranches: [],
        projectContinuity: {
          currentFocus: {
            area: "directionAndVisual",
            updatedAt: "2026-06-30T09:00:00.000Z",
            sourceKind: "userAction",
            sourceObjectIds: [],
            note: "方向与视觉发展"
          },
          relevantStageRecords: [
            {
              id: "continuity-sources",
              stage: "directionAndVisual",
              category: "preference",
              summary: "明确偏好：温和",
              validity: "current",
              sourceRefs: [
                {
                  kind: "message",
                  id: "ai-user-1",
                  snapshot: { title: "用户表达", summarySnippet: "温和" },
                  sourceAvailability: "active"
                },
                {
                  kind: "rawPayload",
                  id: "provider-raw",
                  snapshot: { title: "raw" },
                  sourceAvailability: "active"
                }
              ]
            }
          ],
          relevantProjectMemoryViews: [],
          reviewRequiredItems: [],
          omitted: [],
          truncated: false
        },
        skipped: []
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.taskContext?.projectContinuity?.relevantStageRecords[0]?.sourceRefs).toEqual([
        expect.objectContaining({ kind: "message", id: "ai-user-1" })
      ]);
    }
  });

  it("sanitizes oversized structured task context before prompt construction", () => {
    const result = validateAiRouteRequest({
      draft: "继续讨论",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [],
      taskContext: {
        kind: "general",
        objectIds: Array.from({ length: 40 }, (_, index) => `object-${index}`),
        imageObjectIds: [],
        documentObjectIds: [],
        directions: Array.from({ length: 12 }, (_, index) => ({
          objectId: `direction-${index}`,
          revisionId: `revision-${index}`,
          revisionNumber: index + 1,
          title: "x".repeat(400),
          summary: "summary",
          conceptStatement: "statement",
          keywords: ["a", "b", "c", "d", "e", "f"],
          strategy: "strategy",
          differentiators: [],
          visualSignals: [],
          risks: [],
          openQuestions: [],
          sourceObjectIds: []
        })),
        visualBranches: [],
        skipped: []
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.taskContext?.objectIds).toHaveLength(16);
      expect(result.value.taskContext?.directions).toHaveLength(6);
      expect(result.value.taskContext?.directions[0]?.title).toHaveLength(160);
      expect(result.value.taskContext?.directions[0]?.keywords).toHaveLength(5);
    }
  });

  it("does not ask for proposal JSON during ordinary discussion even when task stays general", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "继续讨论这条研究线索的风险",
      task: "general",
      taskMode: "chatAnalysis",
      workIntent: "discussion",
      messages: [],
      objectSummaries: [],
      attachments: []
    });

    expect(prompt).not.toContain("morphoDesignDefinitionProposal");
    expect(prompt).not.toContain("morphoConceptDirectionProposal");
    expect(prompt).toContain("本次工作意图");
  });
});
