import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";
import {
  buildAgentConversationPromptBlock,
  buildAgentHistoryMessages,
  buildMorphoAgentToolArgumentRepairOutputs,
  buildMorphoAgentToolArgumentRepairReminder,
  buildMorphoAgentSystemPrompt,
  buildMorphoAgentTools,
  getComparisonToolExecutionBlockReason,
  MORPHO_AGENT_TOOL_EFFECT_MATRIX,
  getDesignDefinitionDrafts,
  isExplicitComparisonRequest,
  normalizeGenerateVisualsForSelectedDirections,
  parseMorphoAgentToolCallBatch,
  parseMorphoAgentToolArguments,
  resolveAgentToolExecutionPolicy,
  type AgentFunctionCall
} from "./morphoAgent";

describe("agent conversation context", () => {
  it("defines an effect and registry boundary for every server-registered tool", () => {
    const tools = buildMorphoAgentTools(true);
    const functionTools = tools.filter((tool) => tool.type === "function");
    const registeredNames = functionTools.map((tool) => tool.name).sort();
    const effectNames = Object.keys(MORPHO_AGENT_TOOL_EFFECT_MATRIX).sort();

    expect(registeredNames).toEqual(effectNames);
    expect(functionTools.every((tool) => tool.description.includes("Tool effect:"))).toBe(true);
    for (const effect of Object.values(MORPHO_AGENT_TOOL_EFFECT_MATRIX)) {
      expect(Object.keys(effect).sort()).toEqual([
        "externalCost",
        "externalEvidence",
        "highImpactStateChange",
        "memoryWrite",
        "pendingDraftWrite",
        "readOnly",
        "reversibleWorkspaceWrite"
      ]);
      expect(Object.values(effect).every((value) => typeof value === "boolean")).toBe(true);
    }
  });

  it("derives auto, confirm, explicit-memory, paid, and high-impact policy from the effect matrix", () => {
    expect(resolveAgentToolExecutionPolicy({
      name: "read_project_memory",
      mode: "confirm",
      explicitUserCommand: false
    })).toBe("execute");
    expect(resolveAgentToolExecutionPolicy({
      name: "generate_visuals",
      mode: "auto",
      explicitUserCommand: false
    })).toBe("requireConfirmation");
    expect(resolveAgentToolExecutionPolicy({
      name: "generate_visuals",
      mode: "auto",
      explicitUserCommand: true
    })).toBe("execute");
    expect(resolveAgentToolExecutionPolicy({
      name: "generate_visuals",
      mode: "confirm",
      explicitUserCommand: true
    })).toBe("requireConfirmation");
    expect(resolveAgentToolExecutionPolicy({
      name: "submit_memory_update",
      mode: "auto",
      explicitUserCommand: false
    })).toBe("requireExplicitUserCommand");
    expect(resolveAgentToolExecutionPolicy({
      name: "submit_memory_update",
      mode: "auto",
      explicitUserCommand: true
    })).toBe("execute");
    expect(resolveAgentToolExecutionPolicy({
      name: "request_confirmation",
      mode: "auto",
      explicitUserCommand: false
    })).toBe("confirmationOnly");
  });

  it("places a source-bounded conversation summary behind real project state", () => {
    const prompt = buildAgentConversationPromptBlock({
      summaryRevision: {
        id: "summary-1",
        sourceStartMessageId: "message-1",
        sourceEndMessageId: "message-8",
        sourceMessageCount: 8,
        sourceMessageIdsHash: "hash-1",
        createdAt: "2026-07-10T00:00:00.000Z",
        summary: {
          threadGoal: "继续收敛当前浮标概念方向",
          establishedContext: ["已经确定需要保持高可见性"],
          decisionsAndReasons: [],
          activeWork: ["根据新图继续调整结构"],
          unresolvedQuestions: ["仍需确认维护方式"],
          referencedObjects: []
        }
      },
      messages: [],
      rawMessageCount: 0,
      coveredMessageCount: 8,
      estimatedInputTokens: 2400,
      pressure: "normal"
    });

    expect(prompt).toContain("当前用户输入 > 真实项目状态与 Memory Kernel");
    expect(prompt).toContain("继续收敛当前浮标概念方向");
    expect(prompt).not.toContain("summarySourceRange: message-1..message-8");
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

  it("returns retryable outputs for a mixed batch instead of partially executing invalid tool calls", () => {
    const batch = parseMorphoAgentToolCallBatch([
      makeCall("read_selected_context", {}),
      makeCall("generate_visuals", {
        kind: "visualDevelopment",
        items: [
          {
            id: "visual-1",
            title: "Structural study",
            purpose: "Refine the selected product.",
            requestedReferenceObjectIds: [],
            changeGoals: ["Clarify the load path"],
            preserve: ["Product identity"],
            allowToChange: ["Shell transitions"],
            productForm: ["Marine buoy"],
            materialsAndCmf: ["Marine coating"],
            environmentAndLighting: ["Studio lighting"],
            avoid: ["Scene"],
            role: "conceptImage",
            visualSignals: ["Continuous shell"]
          }
        ]
      })
    ]);
    const outputs = buildMorphoAgentToolArgumentRepairOutputs(batch).map((output) => JSON.parse(output.output));

    expect(batch.map((entry) => entry.status)).toEqual(["valid", "invalid"]);
    expect(outputs).toEqual([
      expect.objectContaining({ status: "skippedDueToEarlierGuard", outcome: "not_executed", retryable: true }),
      expect.objectContaining({ status: "failed", outcome: "invalid_arguments", retryable: true })
    ]);
    expect(buildMorphoAgentToolArgumentRepairReminder(batch)).toContain("visualSignals");
    expect(buildMorphoAgentToolArgumentRepairReminder(batch)).toContain("重新调用本批仍需执行的全部工具");
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
      strategy: "research",
      workspace,
      selectedObjects,
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });

    expect(prompt).toContain("研究输出先广泛分析，再评估筛选");
    expect(prompt).toContain("短标题：一句说明");
  });

  it("keeps dynamic project memory out of the stable Agent prompt", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "基于当前方向继续讨论",
      selectedObjectIds: []
    });
    const prompt = buildMorphoAgentSystemPrompt({
      mode: "auto",
      strategy: "discussion",
      workspace,
      selectedObjects: [],
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });

    const otherPrompt = buildMorphoAgentSystemPrompt({
      mode: "auto",
      strategy: "research",
      workspace,
      selectedObjects: [],
      context: buildTaskContext(workspace, {
        kind: "research",
        draft: "完全不同的研究输入和选择",
        selectedObjectIds: ["research-night-path"]
      }),
      providerTaskContext: buildProviderTaskContext(
        buildTaskContext(workspace, {
          kind: "research",
          draft: "完全不同的研究输入和选择",
          selectedObjectIds: ["research-night-path"]
        })
      )
    });

    expect(prompt).toBe(otherPrompt);
    expect(prompt).toContain("通过追加 Context Frame 提供");
    expect(prompt).not.toContain("基于当前方向继续讨论");
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
      strategy: "research",
      workspace,
      selectedObjects: [],
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });
    const tools = JSON.stringify(buildMorphoAgentTools(true));

    expect(prompt).toContain("当用户要求一批并列图像时，generate_visuals.items[] 必须覆盖完整数量");
    expect(prompt).not.toContain("全面搜索后生成六张视觉素材");
    expect(prompt).toContain("当用户要求一批并列图像时，generate_visuals.items[] 必须覆盖完整数量");
    expect(tools).toContain("全面研究可用不同查询继续补充");
    expect(tools).toContain("提交完整的结构化视觉意图");
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
      strategy: "discussion",
      workspace,
      selectedObjects,
      context,
      providerTaskContext: buildProviderTaskContext(context)
    });
    const tools = buildMorphoAgentTools(false);

    expect(prompt).toContain("当用户多选草案或设计定义并要求分析但未明确要求比较时，读取完整选择内容后直接在对话中回答");
    expect(JSON.stringify(tools)).toContain("create_comparison_analysis");
    expect(isExplicitComparisonRequest("分析这三个方案")).toBe(false);
    expect(isExplicitComparisonRequest("不要做对比卡片，只根据内容分析")).toBe(false);
    expect(isExplicitComparisonRequest("对比这三个方案")).toBe(true);
  });

  it("blocks an unsolicited or selection-free Compare tool call locally", () => {
    expect(getComparisonToolExecutionBlockReason({
      explicitComparisonRequested: false,
      selectedObjectCount: 3
    })).toContain("用户未明确要求比较");
    expect(getComparisonToolExecutionBlockReason({
      explicitComparisonRequested: true,
      selectedObjectCount: 1
    })).toContain("至少两个");
    expect(getComparisonToolExecutionBlockReason({
      explicitComparisonRequested: true,
      selectedObjectCount: 2
    })).toBeUndefined();
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
          requestedReferenceObjectIds: [],
          changeGoals: ["让架构更轻、更模块化"],
          preserve: ["夜间识别"],
          allowToChange: ["比例与支撑结构"],
          productForm: ["模块化扶手"],
          materialsAndCmf: ["温暖低反光材料"],
          environmentAndLighting: ["夜间家居环境"],
          avoid: ["医疗器械感"],
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
            requestedReferenceObjectIds: [],
            changeGoals: ["让架构更轻、更模块化"],
            preserve: ["夜间识别"],
            allowToChange: ["比例与支撑结构"],
            productForm: ["模块化扶手"],
            materialsAndCmf: ["温暖低反光材料"],
            environmentAndLighting: ["夜间家居环境"],
            avoid: ["医疗器械感"],
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

  it("accepts only canonical concept-direction lineage kinds at the Agent tool boundary", () => {
    const direction = {
      title: "Soft rail",
      summary: "Continuous support language.",
      conceptStatement: "A warmer continuous support rail.",
      keywords: ["warm", "continuous"],
      strategy: "Keep the route legible.",
      differentiators: ["Quieter visual hierarchy"],
      visualSignals: ["Low glowing rail"],
      risks: ["Corner complexity"],
      openQuestions: ["How should corners resolve?"],
      basedOnDirectionId: "direction-source"
    };
    const parsed = parseMorphoAgentToolArguments(makeCall("create_concept_direction_proposal", {
      title: "Split direction",
      summary: "Create a traceable split.",
      directions: [{ ...direction, lineageKind: "splitFromDirection" }]
    }));

    expect(parsed).toMatchObject({
      name: "create_concept_direction_proposal",
      args: { directions: [{ lineageKind: "splitFromDirection" }] }
    });
    expect(() => parseMorphoAgentToolArguments(makeCall("create_concept_direction_proposal", {
      title: "Legacy split",
      summary: "Do not persist the retired alias.",
      directions: [{ ...direction, lineageKind: "split" }]
    }))).toThrow("lineageKind");
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

  it("accepts a structured skipped memory update acknowledgement and rejects mixed writes", () => {
    expect(
      parseMorphoAgentToolArguments(
        makeCall("submit_memory_update", {
          items: [],
          skippedReason: "本轮表达只针对当前对象，不能授权为项目级记忆。"
        })
      )
    ).toMatchObject({
      name: "submit_memory_update",
      args: { items: [], skippedReason: expect.stringContaining("当前对象") }
    });
    expect(() =>
      parseMorphoAgentToolArguments(
        makeCall("submit_memory_update", {
          items: [
            {
              kind: "preference",
              scope: "project",
              evidenceQuote: "以后保持低眩光",
              relatedObjectIds: [],
              relatedRevisionIds: []
            }
          ],
          skippedReason: "同时跳过"
        })
      )
    ).toThrow("不能同时提供 skippedReason");
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
            targetDirectionId: "direction-soft-rail",
            requestedReferenceObjectIds: [],
            changeGoals: ["Explore the direction"],
            preserve: ["Product identity"],
            allowToChange: ["Form language"],
            productForm: ["Support rail"],
            materialsAndCmf: ["Warm matte finish"],
            environmentAndLighting: ["Night interior"],
            avoid: ["Clinical expression"],
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

  it("treats targetless visual variants as visual development instead of invalid direction previews", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("generate_visuals", {
      kind: "directionPreview",
      items: [
        {
          id: "variant-a",
          title: "Visual variant A",
          purpose: "Explore a selected image.",
          requestedReferenceObjectIds: ["image-a"],
          changeGoals: ["Refine the shell"],
          preserve: ["Product identity"],
          allowToChange: ["Surface transitions"],
          productForm: ["Marine buoy"],
          materialsAndCmf: ["Marine coating"],
          environmentAndLighting: ["Studio lighting"],
          avoid: ["Scene"],
          role: "preview"
        }
      ]
    }));

    expect(parsed).toMatchObject({
      name: "generate_visuals",
      args: { kind: "visualDevelopment", items: [{ id: "variant-a", role: "preview" }] }
    });
  });

  it("uses visual development when direction-like variants start from an image rather than selected directions", () => {
    const args = {
      kind: "directionPreview" as const,
      items: [
        {
          id: "variant-a",
          title: "Visual variant A",
          purpose: "Explore a selected image.",
          targetDirectionId: "direction-a",
          requestedReferenceObjectIds: ["image-a"],
          changeGoals: ["Refine the shell"],
          preserve: ["Product identity"],
          allowToChange: ["Surface transitions"],
          productForm: ["Marine buoy"],
          materialsAndCmf: ["Marine coating"],
          environmentAndLighting: ["Studio lighting"],
          avoid: ["Scene"],
          role: "conceptImage" as const
        }
      ]
    };

    expect(normalizeGenerateVisualsForSelectedDirections(args, 0).kind).toBe("visualDevelopment");
    expect(normalizeGenerateVisualsForSelectedDirections(args, 1).kind).toBe("directionPreview");
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
