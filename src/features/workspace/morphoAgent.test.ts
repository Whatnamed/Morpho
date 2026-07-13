import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";

import { buildProviderTaskContext, buildTaskContext } from "./taskContext";
import {
  buildAgentCheckpointCompactionInput,
  buildAgentConversationPromptBlock,
  buildAgentHistoryMessages,
  buildMorphoAgentSystemPrompt,
  buildMorphoAgentTools,
  getDesignDefinitionDrafts,
  isExplicitComparisonRequest,
  parseMorphoAgentToolArguments,
  type AgentFunctionCall
} from "./morphoAgent";

describe("agent conversation context", () => {
  it("places the checkpoint behind real project state and asks for a refreshed checkpoint when requested", () => {
    const prompt = buildAgentConversationPromptBlock({
      checkpoint: {
        id: "checkpoint-1",
        laneKey: "lane-1",
        focusArea: "directionAndVisual",
        focusUpdatedAt: "2026-07-10T00:00:00.000Z",
        taskKind: "general",
        anchorObjectIds: [],
        targetDirectionIds: [],
        sourceStartMessageId: "message-1",
        sourceEndMessageId: "message-8",
        sourceMessageCount: 8,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
        threadGoal: "继续收敛当前浮标概念方向",
        progress: ["已经确定需要保持高可见性"],
        openThreads: ["仍需确认维护方式"],
        nextTurnAnchor: "根据新图继续调整结构"
      },
      recentMessages: [],
      rawMessageCount: 0,
      omittedMessageCount: 0,
      checkpointRequested: true,
      laneKey: "lane-1"
    });

    expect(prompt).toContain("当前用户输入 > 真实项目状态");
    expect(prompt).toContain("继续收敛当前浮标概念方向");
    expect(prompt).toContain("morphoConversationCheckpoint");
  });

  it("builds a bounded checkpoint-only continuation without tools or image inputs", () => {
    const input = buildAgentCheckpointCompactionInput({
      conversationContext: {
        laneKey: "lane-1",
        recentMessages: [
          { role: "user", body: "先保持高可见性" },
          { role: "assistant", body: "可以从轮廓和颜色开始" }
        ],
        rawMessageCount: 2,
        omittedMessageCount: 0,
        checkpointRequested: true
      },
      draft: "继续迭代这个方向",
      assistantReply: "已经生成两张新的预览，并保留原有产品架构。"
    });

    expect(input).toHaveLength(2);
    expect(JSON.stringify(input)).toContain("morphoConversationCheckpoint");
    expect(JSON.stringify(input)).toContain("继续迭代这个方向");
    expect(JSON.stringify(input)).toContain("已经生成两张新的预览");
    expect(JSON.stringify(input)).not.toContain("input_image");
  });

  it("builds a rolling compaction request from the complete supplied chunk instead of the recent-message cap", () => {
    const messages = Array.from({ length: 9 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      body: `完整分块消息 ${index + 1}`
    }));
    const input = buildAgentCheckpointCompactionInput({
      checkpoint: {
        threadGoal: "继续收敛完整讨论",
        progress: ["此前分块已经完成整理"],
        openThreads: ["继续吸收当前分块内容"]
      },
      messages,
      draft: "/compact",
      assistantReply: "正在滚动压缩当前讨论。",
      chunkIndex: 1,
      chunkCount: 3
    });
    const serialized = JSON.stringify(input);

    expect(serialized).toContain("完整分块消息 1");
    expect(serialized).toContain("完整分块消息 9");
    expect(serialized).toContain("第 2 / 3 块");
  });
});

describe("Morpho agent tool argument validation", () => {
  it("serializes historical assistant messages as Responses output text", () => {
    expect(
      buildAgentHistoryMessages([
        { role: "user", body: "旧问题" },
        { role: "assistant", body: "旧回答" }
      ])
    ).toEqual([
      { role: "user", content: [{ type: "input_text", text: "旧问题" }] },
      { role: "assistant", content: [{ type: "output_text", text: "旧回答" }] }
    ]);
  });

  it("keeps provider strict mode disabled while retaining local argument validation", () => {
    const strictValues = buildMorphoAgentTools(true).flatMap((tool) =>
      tool.type === "function" ? [tool.strict] : []
    );

    expect(strictValues).not.toHaveLength(0);
    expect(strictValues.every((strict) => strict === false)).toBe(true);
    expect(() =>
      parseMorphoAgentToolArguments(makeCall("request_confirmation", {
        action: "setDefaultReference",
        targetObjectId: "image-a",
        reason: "用户要求替换后续默认参考。",
        impact: "后续生成会默认参考该图。",
        unexpectedField: true
      }))
    ).toThrow("未声明参数");
  });

  it("instructs research tools to output evaluated scannable points", () => {
    const tools = buildMorphoAgentTools(false);
    const serializedTools = JSON.stringify(tools);

    expect(serializedTools).toContain("短标题：一句说明");
    expect(serializedTools).toContain("筛选真正有价值");
  });

  it("keeps the agent research contract focused on evaluated candidates", () => {
    const workspace = createInitialWorkspace();
    const selectedObjects = [workspace.objects["research-night-path"]].filter(Boolean);
    const context = buildTaskContext(workspace, {
      kind: "research",
      draft: "继续分析这张研究卡，筛出可保留的点。",
      selectedObjectIds: ["research-night-path"]
    });
    const prompt = buildMorphoAgentSystemPrompt({
      mode: "auto",
      workspace,
      selectedObjects,
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });

    expect(prompt).toContain("研究输出先广泛分析，再评估筛选");
    expect(prompt).toContain("短标题：一句说明");
  });

  it("guides broad evidence search and validated image counts without low fixed gates", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "全面搜索后生成六张视觉素材",
      selectedObjectIds: []
    });
    const prompt = buildMorphoAgentSystemPrompt({
      mode: "auto",
      workspace,
      selectedObjects: [],
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });
    const tools = JSON.stringify(buildMorphoAgentTools(true));

    expect(prompt).toContain("证据充分后自然停止");
    expect(prompt).toContain("不得重复完全相同的搜索");
    expect(prompt).toContain("图片数量本身不构成确认理由");
    expect(prompt).toContain("后续基于新结果产生新的明确需求时，可以再次调用 generate_visuals");
    expect(tools).toContain("全面研究可用不同查询继续补充");
    expect(tools).toContain("数量遵循用户请求和通过校验的计划");
    expect(prompt).not.toMatch(/最多\s*[24]\s*张|超过\s*[24]\s*张/);
  });

  it("keeps ordinary multi-draft analysis in conversation instead of forcing Compare", () => {
    const workspace = createInitialWorkspace();
    const selectedObjects = [workspace.objects["definition-current"]].filter(Boolean);
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "分析这些方案并给我一些建议",
      selectedObjectIds: ["definition-current"]
    });
    const prompt = buildMorphoAgentSystemPrompt({
      mode: "auto",
      workspace,
      selectedObjects,
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });
    const tools = buildMorphoAgentTools(false, { allowComparisonAnalysis: false });

    expect(prompt).toContain("没有明确说“比较”“对比”或 Compare");
    expect(JSON.stringify(tools)).not.toContain("create_comparison_analysis");
    expect(isExplicitComparisonRequest("分析这三个方案")).toBe(false);
    expect(isExplicitComparisonRequest("不要做对比卡片，只根据内容分析")).toBe(false);
    expect(isExplicitComparisonRequest("对比这三个方案")).toBe(true);
  });

  it("normalizes direction preview visual roles before operation validation", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("generate_visuals", {
      kind: "directionPreview",
      items: [
        {
          id: "preview-1",
          targetDirectionId: "direction-soft-rail",
          title: "轻量家居化预览",
          purpose: "验证更轻、更模块化的表达",
          prompt: "A warm product design preview for a modular night support rail.",
          referenceObjectIds: ["direction-soft-rail"],
          role: "preview"
        }
      ]
    }));

    expect(parsed).toEqual({
      name: "generate_visuals",
      args: {
        kind: "directionPreview",
        items: [
          {
            id: "preview-1",
            targetDirectionId: "direction-soft-rail",
            title: "轻量家居化预览",
            purpose: "验证更轻、更模块化的表达",
            prompt: "A warm product design preview for a modular night support rail.",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage"
          }
        ]
      }
    });
  });

  it("tolerates optional research notes without blocking research card creation", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("create_research_analysis", {
      title: "海洋噪声研究",
      summary: "筛出可用于定义阶段的候选点。",
      findings: ["证据边界：现有资料能支持问题重要性，但还不足以证明完整工业产品定义。"],
      opportunities: ["管理动作：把风险识别结果转译成港航管理可执行的避让建议。"],
      constraints: [],
      openQuestions: [],
      evidence: [],
      changeNote: "本轮只创建研究卡，不应用为稳定结论。"
    }));

    expect(parsed).toMatchObject({
      name: "create_research_analysis",
      args: {
        title: "海洋噪声研究",
        changeNote: "本轮只创建研究卡，不应用为稳定结论。"
      }
    });
  });

  it("accepts multiple design-definition draft alternatives in one tool call", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("create_design_definition_proposal", {
      title: "Definition A",
      summary: "Primary definition route.",
      projectGoal: "Clarify the project.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Concept review"],
      coreProblem: "The project needs a stable definition.",
      designPrinciples: ["Clear scope"],
      constraints: ["Low complexity"],
      avoidDirections: ["Vague intent"],
      opportunities: ["Better decisions"],
      openQuestions: ["What should be verified?"],
      alternatives: [
        {
          title: "Definition B",
          summary: "Alternative definition route.",
          projectGoal: "Frame the project from validation.",
          targetUsers: ["Designer"],
          primaryScenarios: ["Concept review"],
          coreProblem: "The riskiest assumption needs to be explicit.",
          designPrinciples: ["Verification first"],
          constraints: ["Low complexity"],
          avoidDirections: ["Vague intent"],
          opportunities: ["Better decisions"],
          openQuestions: ["What should be verified?"]
        }
      ]
    }));

    expect(parsed).toMatchObject({
      name: "create_design_definition_proposal",
      args: {
        title: "Definition A",
        alternatives: [
          {
            title: "Definition B",
            coreProblem: "The riskiest assumption needs to be explicit."
          }
        ]
      }
    });
  });

  it("parses a full selected design-definition draft revision", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("revise_selected_proposal_draft", {
      proposalId: "proposal-definition-a",
      proposalType: "designDefinition",
      title: "Definition A revised",
      summary: "A tighter definition summary.",
      projectGoal: "Clarify the product direction.",
      targetUsers: ["Industrial designer"],
      primaryScenarios: ["Reviewing concept options"],
      coreProblem: "The original draft is too broad.",
      designPrinciples: ["Make the hierarchy explicit"],
      constraints: ["Avoid adding new scope"],
      avoidDirections: ["Generic AI wording"],
      opportunities: ["Use clearer decision language"],
      openQuestions: ["Which risk needs validation first?"],
      changeNote: "Tightened language."
    }));

    expect(parsed).toMatchObject({
      name: "revise_selected_proposal_draft",
      args: {
        proposalId: "proposal-definition-a",
        proposalType: "designDefinition",
        title: "Definition A revised",
        projectGoal: "Clarify the product direction."
      }
    });
  });

  it("parses a full selected concept-direction draft revision", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("revise_selected_proposal_draft", {
      proposalId: "proposal-direction-a",
      proposalType: "conceptDirection",
      title: "Direction revised",
      summary: "A clearer set of concept directions.",
      directions: [
        {
          title: "Soft rail",
          summary: "Continuous support language.",
          conceptStatement: "A warmer continuous support rail.",
          keywords: ["warm", "continuous"],
          strategy: "Keep the route legible.",
          differentiators: ["Quieter visual hierarchy"],
          visualSignals: ["Low glowing rail"],
          risks: ["Corner complexity"],
          openQuestions: ["How should corners resolve?"]
        }
      ]
    }));

    expect(parsed).toMatchObject({
      name: "revise_selected_proposal_draft",
      args: {
        proposalId: "proposal-direction-a",
        proposalType: "conceptDirection",
        directions: [{ title: "Soft rail" }]
      }
    });
  });

  it("parses a selected research draft revision without accepting evidence rewrites", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("revise_selected_proposal_draft", {
      proposalId: "proposal-research-a",
      proposalType: "researchAnalysis",
      title: "Research revised",
      summary: "Sharper research framing.",
      findings: ["Finding: one useful point."],
      opportunities: ["Opportunity: one useful opening."],
      constraints: ["Constraint: one real boundary."],
      openQuestions: ["Question: one thing to verify."]
    }));

    expect(parsed).toMatchObject({
      name: "revise_selected_proposal_draft",
      args: {
        proposalId: "proposal-research-a",
        proposalType: "researchAnalysis",
        findings: ["Finding: one useful point."]
      }
    });

    expect(() =>
      parseMorphoAgentToolArguments(makeCall("revise_selected_proposal_draft", {
        proposalId: "proposal-research-a",
        proposalType: "researchAnalysis",
        title: "Research revised",
        summary: "Sharper research framing.",
        findings: ["Finding: one useful point."],
        opportunities: ["Opportunity: one useful opening."],
        constraints: ["Constraint: one real boundary."],
        openQuestions: ["Question: one thing to verify."],
        evidence: []
      }))
    ).toThrow("未声明参数");
  });

  it("expands design-definition alternatives as separate drafts with a safe limit", () => {
    const base = makeDefinitionArgs("Definition A");
    const drafts = getDesignDefinitionDrafts({
      ...base,
      alternatives: [
        makeDefinitionArgs("Definition B"),
        makeDefinitionArgs("Definition C"),
        makeDefinitionArgs("Definition D")
      ]
    });

    expect(drafts.map((draft) => draft.title)).toEqual([
      "方案 A｜Definition A",
      "方案 B｜Definition B",
      "方案 C｜Definition C"
    ]);
    expect(drafts.every((draft) => !("alternatives" in draft))).toBe(true);
  });

  it("keeps a single design-definition draft title unchanged", () => {
    expect(getDesignDefinitionDrafts(makeDefinitionArgs("Dynamic refuge network"))[0]?.title).toBe(
      "Dynamic refuge network"
    );
  });

  it("rejects undeclared arguments before execution", () => {
    expect(() =>
      parseMorphoAgentToolArguments(makeCall("request_confirmation", {
        action: "setDefaultReference",
        targetObjectId: "image-a",
        reason: "用户要求替换后续默认参考。",
        impact: "后续生成会默认参考该图。",
        hiddenWrite: true
      }))
    ).toThrow("未声明参数");
  });

  it("rejects invalid bounded search queries", () => {
    expect(() =>
      parseMorphoAgentToolArguments(makeCall("search_web_evidence", {
        queries: ["a", "b", "c", "d"],
        reason: "补充现实限制。"
      }))
    ).toThrow("最多允许 3 项");
  });

  it("accepts a request confirmation with an executable visual plan", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("request_confirmation", {
      action: "batchGenerateVisuals",
      reason: "Batch needs confirmation.",
      impact: "Creates new image objects.",
      visualPlan: {
        kind: "directionPreview",
        items: [
          {
            id: "preview-1",
            title: "Preview",
            purpose: "Explore a direction.",
            prompt: "Warm product render.",
            referenceObjectIds: ["direction-soft-rail"],
            role: "preview"
          }
        ]
      }
    }));

    expect(parsed).toMatchObject({
      name: "request_confirmation",
      args: {
        action: "batchGenerateVisuals",
        visualPlan: {
          kind: "directionPreview",
          items: [{ role: "conceptImage" }]
        }
      }
    });
  });

  it("rejects unsupported tool names", () => {
    expect(() => parseMorphoAgentToolArguments(makeCall("delete_everything", {}))).toThrow("未支持的 Agent 工具");
  });
});

function makeCall(name: string, args: unknown): AgentFunctionCall {
  return {
    id: `fc-${name}`,
    callId: `call-${name}`,
    name,
    argumentsText: JSON.stringify(args)
  };
}

function makeDefinitionArgs(title: string) {
  return {
    title,
    summary: `${title} summary`,
    projectGoal: "Clarify the project.",
    targetUsers: ["Designer"],
    primaryScenarios: ["Concept review"],
    coreProblem: "The project needs a stable definition.",
    designPrinciples: ["Clear scope"],
    constraints: ["Low complexity"],
    avoidDirections: ["Vague intent"],
    opportunities: ["Better decisions"],
    openQuestions: ["What should be verified?"]
  };
}
