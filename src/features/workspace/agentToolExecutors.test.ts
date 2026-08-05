import { describe, expect, it } from "vitest";

import { createInitialWorkspace, createTestWorkspace } from "@/domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "@/domain/operations/operations";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import { createRequiredAgentReadState } from "./agentTaskStrategy";
import {
  AGENT_TOOL_EXECUTORS,
  executeAgentTool,
  type AgentToolExecutorInput
} from "./agentToolExecutors";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { createAgentTurnWorkLedger } from "./agentTurnMessages";
import { createAgentTurnRuntimeState } from "./agentTurnRuntimeState";
import { buildAgentVisualGenerationBatch } from "./agentVisualGenerationBatch";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { getAgentToolEffect, MORPHO_AGENT_TOOL_EFFECT_MATRIX } from "./morphoAgent";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

describe("Agent tool executors", () => {
  it("registers exactly the tools described by the effect matrix", () => {
    expect(Object.keys(AGENT_TOOL_EXECUTORS).sort()).toEqual(
      Object.keys(MORPHO_AGENT_TOOL_EFFECT_MATRIX).sort()
    );
  });

  it("keeps an explicit idempotency strategy for every local-write Tool effect", () => {
    const strategies: Record<string, string> = {
      create_research_analysis: "stable operation record",
      create_design_definition_proposal: "stable operation record",
      create_concept_direction_proposal: "stable operation record",
      revise_selected_proposal_draft: "final-value comparison",
      generate_visuals: "stable image request identity",
      create_comparison_analysis: "stable analysis id overwrite",
      prepare_delivery_section_draft: "stable draft id",
      submit_memory_update: "semantic patch dedupe"
    };

    const allWriteTools = Object.entries(MORPHO_AGENT_TOOL_EFFECT_MATRIX)
      .filter(([, effect]) =>
        effect.pendingDraftWrite || effect.reversibleWorkspaceWrite || effect.memoryWrite
      )
      .map(([name]) => name)
      .sort();
    expect(Object.keys(strategies).sort()).toEqual(allWriteTools);
    for (const [name, _strategy] of Object.entries(strategies)) {
      const effect = getAgentToolEffect(name as keyof typeof MORPHO_AGENT_TOOL_EFFECT_MATRIX);
      expect(effect.pendingDraftWrite || effect.reversibleWorkspaceWrite || effect.memoryWrite).toBe(true);
    }
  });

  it("reads selected context without committing workspace state", async () => {
    const fixture = createFixture();

    const output = await executeAgentTool({
      ...fixture.input,
      callId: "call-read-selection",
      parsed: { name: "read_selected_context", args: {} }
    });

    expect(output).toMatchObject({ objectIds: fixture.input.context.objectIds });
    expect(fixture.host.getEvents()).toEqual([]);
  });

  it("completes a required project-memory read only after producing its result", async () => {
    const fixture = createFixture();
    fixture.input.runtimeState.requiredReadState = createRequiredAgentReadState([
      "read_project_memory"
    ]);

    const output = await executeAgentTool({
      ...fixture.input,
      callId: "call-read-memory",
      parsed: {
        name: "read_project_memory",
        args: { keys: ["projectOverview"], includeHistory: false }
      }
    });

    expect(output).toMatchObject({
      documents: [{ key: "projectOverview" }]
    });
    expect(
      fixture.input.runtimeState.requiredReadState.completedTools.has("read_project_memory")
    ).toBe(true);
  });

  it("merges web-search citations into the turn runtime", async () => {
    const fixture = createFixture();
    fixture.input.requestWebSearch = async () => ({
      sources: [
        {
          title: "Morpho evidence",
          url: "https://example.com/evidence",
          domain: "example.com",
          snippet: "A bounded source excerpt"
        }
      ]
    });

    const output = await executeAgentTool({
      ...fixture.input,
      callId: "call-search",
      parsed: {
        name: "search_web_evidence",
        args: { queries: ["morpho evidence"], reason: "验证来源" }
      }
    });

    expect(output).toMatchObject({ reason: "验证来源", failedSourceCount: 0 });
    expect(fixture.input.runtimeState.hasWebSearchEvidence).toBe(true);
    expect(fixture.input.runtimeState.collectedCitations).toHaveLength(1);
  });

  it("executes one validated visual batch at most once", async () => {
    const fixture = createFixture();
    const visualBatch = buildAgentVisualGenerationBatch({
      expected: { totalItems: 1, source: "explicitTotal" },
      calls: [
        {
          callId: "call-visual-a",
          plan: {
            kind: "visualDevelopment",
            items: [
              {
                id: "visual-item-a",
                title: "方向图 A",
                purpose: "验证路径",
                prompt: "生成方向图 A",
                referenceObjectIds: [],
                role: "preview"
              }
            ]
          }
        }
      ]
    });
    expect(visualBatch.status).toBe("ok");
    if (visualBatch.status !== "ok") {
      throw new Error("Expected a valid visual batch.");
    }
    fixture.input.batchState.visualBatch = visualBatch;
    let executionCount = 0;
    fixture.input.executeVisualGenerationPlan = async ({ workspaceSnapshot }) => {
      executionCount += 1;
      return {
        workspace: workspaceSnapshot,
        createdObjectIds: ["image-created-a"],
        failedItems: []
      };
    };
    const parsed = {
      name: "generate_visuals" as const,
      args: {
        kind: "visualDevelopment" as const,
        items: [
          {
            id: "visual-item-a",
            title: "方向图 A",
            purpose: "验证路径",
            requestedReferenceObjectIds: [],
            changeGoals: [],
            preserve: [],
            allowToChange: [],
            productForm: [],
            materialsAndCmf: [],
            environmentAndLighting: [],
            avoid: [],
            role: "preview" as const
          }
        ]
      }
    };

    const first = await executeAgentTool({
      ...fixture.input,
      callId: "call-visual-a",
      parsed
    });
    const second = await executeAgentTool({
      ...fixture.input,
      callId: "call-visual-b",
      parsed
    });

    expect(first).toEqual({
      status: "created",
      objectIds: ["image-created-a"],
      failedItems: [],
      batched: true
    });
    expect(second).toEqual(first);
    expect(executionCount).toBe(1);
  });

  it("replays a delivery draft write without creating a second draft", async () => {
    const fixture = createFixture();
    const workspace = fixture.host.getWorkspace();
    const delivery = Object.values(workspace.objects).find((object) => object.type === "delivery");
    if (!delivery || delivery.type !== "delivery") throw new Error("Fixture 缺少 delivery object。");
    const section = delivery.sections.find((candidate) => candidate.referenceIds.length > 0);
    if (!section) throw new Error("Fixture 缺少带引用的 delivery section。");
    fixture.input.deliverySectionContext = buildDeliverySectionContext(workspace, delivery, section.id);
    if (!fixture.input.deliverySectionContext) throw new Error("Delivery section context 未构建。");

    const parsed = {
      name: "prepare_delivery_section_draft" as const,
      args: {
        title: "章节草案",
        narrative: "这是一份可安全重放的章节草案。",
        captions: section.referenceIds.slice(0, 1).map((referenceId) => ({
          referenceId,
          caption: "核心参考"
        })),
        suggestedGaps: []
      }
    };
    const first = await executeAgentTool({
      ...fixture.input,
      callId: "call-delivery-draft",
      stableOperationId: "a-plus-effect-turn-delivery-call-delivery-draft",
      parsed
    });
    const second = await executeAgentTool({
      ...fixture.input,
      callId: "call-delivery-draft",
      stableOperationId: "a-plus-effect-turn-delivery-call-delivery-draft",
      parsed
    });

    expect(first).toMatchObject({ status: "draftCreated" });
    expect(second).toMatchObject({ status: "draftCreated", recovered: true });
    expect(Object.keys(fixture.host.getWorkspace().deliverySectionDrafts)).toHaveLength(1);
  });

  it("replays a proposal revision by recognizing the already-applied final values", async () => {
    const fixture = createFixture();
    const proposed = recordDesignDefinitionProposal(createInitialWorkspace(), {
      proposalId: "proposal-replay-revision",
      operationId: "operation-replay-revision",
      workIntent: "createDesignDefinition",
      title: "原始定义",
      summary: "原始摘要",
      projectGoal: "原始目标",
      targetUsers: ["Designer"],
      primaryScenarios: ["Review"],
      coreProblem: "原始问题",
      designPrinciples: ["原始原则"],
      constraints: ["原始约束"],
      avoidDirections: ["原始避免"],
      opportunities: ["原始机会"],
      openQuestions: ["原始问题"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 120, y: 160 }
    });
    fixture.host.commitWorkspace(() => ({ workspace: proposed.workspace, value: undefined }));
    fixture.input.selectedObjectIds = ["proposal-replay-revision"];
    const parsed = {
      name: "revise_selected_proposal_draft" as const,
      args: {
        proposalId: "proposal-replay-revision",
        proposalType: "designDefinition" as const,
        title: "重放后的定义",
        summary: "重放后的摘要",
        projectGoal: "重放后的目标",
        targetUsers: ["Designer", "Reviewer"],
        primaryScenarios: ["Review"],
        coreProblem: "重放后的问题",
        designPrinciples: ["重放后的原则"],
        constraints: ["重放后的约束"],
        avoidDirections: ["重放后的避免"],
        opportunities: ["重放后的机会"],
        openQuestions: ["重放后的问题"],
        changeNote: "稳定重放"
      }
    };
    const first = await executeAgentTool({ ...fixture.input, callId: "call-revise", parsed });
    const second = await executeAgentTool({ ...fixture.input, callId: "call-revise", parsed });

    expect(first).toMatchObject({ status: "updated", proposalId: "proposal-replay-revision" });
    expect(second).toMatchObject({ status: "updated", proposalId: "proposal-replay-revision", recovered: true });
    expect(Object.keys(fixture.host.getWorkspace().artifactProposals)).toEqual(["proposal-replay-revision"]);
  });

  it("dedupes repeated Memory Update effects after a crash window", async () => {
    const fixture = createFixture();
    const draft = "后续项目必须保持低饱和风格";
    fixture.input.draft = draft;
    fixture.host.commitWorkspace((current) => ({
      workspace: {
        ...current,
        ai: {
          ...current.ai,
          messages: [
            ...current.ai.messages,
            { id: "message-user", role: "user", body: draft, createdAt: "2026-07-29T00:00:00.000Z" }
          ]
        }
      },
      value: undefined
    }));
    fixture.input.requiredMemoryUpdates = [{
      kind: "constraint",
      reason: "用户明确要求保持项目规则。",
      evidenceQuote: draft,
      evidenceStart: 0,
      evidenceEnd: draft.length
    }];
    const parsed = {
      name: "submit_memory_update" as const,
      args: {
        items: [{
          kind: "constraint" as const,
          scope: "project" as const,
          evidenceQuote: draft,
          relatedObjectIds: [],
          relatedRevisionIds: []
        }]
      }
    };
    const first = await executeAgentTool({ ...fixture.input, callId: "call-memory", parsed });
    const entriesAfterFirst = fixture.host.getWorkspace().projectContinuity.recordEntries.length;
    const second = await executeAgentTool({ ...fixture.input, callId: "call-memory", parsed });

    expect(first).toMatchObject({ status: "recorded" });
    expect(second).toMatchObject({ status: "skipped" });
    expect(fixture.host.getWorkspace().projectContinuity.recordEntries).toHaveLength(entriesAfterFirst);
  });

  it("overwrites one stable Comparison analysis instead of accumulating duplicates", async () => {
    const fixture = createFixture();
    const workspace = fixture.host.getWorkspace();
    const sources = Object.values(workspace.objects)
      .filter((object) => object.visibility === "active" && (object.type === "image" || object.type === "research"))
      .slice(0, 2);
    if (sources.length !== 2) throw new Error("Fixture 缺少两个可 Compare 对象。");
    fixture.input.selectedObjectIds = sources.map((object) => object.id);
    fixture.input.selectedObjects = sources;
    fixture.input.allowStructuredComparison = true;
    const parsed = {
      name: "create_comparison_analysis" as const,
      args: {
        comparisonGoal: "比较目标与风险",
        conclusionSummary: "保持当前可验证方向。",
        objectComparisons: sources.map((object) => ({
          objectId: object.id,
          title: object.title,
          evidenceBasis: "objectSummary" as const,
          summary: "对象摘要",
          strengths: ["清晰"],
          risks: ["待验证"],
          evidence: []
        })),
        recommendedQuestions: [],
        evidenceLimits: ["比较仅基于当前已附加对象摘要。"]
      }
    };
    const first = await executeAgentTool({ ...fixture.input, callId: "call-compare", parsed });
    const second = await executeAgentTool({ ...fixture.input, callId: "call-compare", parsed });

    expect(first).toMatchObject({ status: "created", analysisId: "comparison-message-assistant" });
    expect(second).toEqual(first);
    expect(Object.keys(fixture.host.getWorkspace().ai.comparisonAnalyses ?? {})).toEqual(["comparison-message-assistant"]);
  });

  it("routes explicit confirmation through the UI port and stops the batch", async () => {
    const fixture = createFixture();
    const confirmationCalls: unknown[] = [];
    fixture.input.ui.requestConfirmation = (...args) => {
      confirmationCalls.push(args);
    };
    fixture.input.modelOutputText = "  请确认这项操作。  ";

    const output = await executeAgentTool({
      ...fixture.input,
      callId: "call-confirm",
      parsed: {
        name: "request_confirmation",
        args: {
          action: "setDefaultReference",
          targetObjectId: "image-a",
          reason: "需要用户决定",
          impact: "会更新后续默认参考"
        }
      }
    });

    expect(output).toMatchObject({
      status: "pendingConfirmation",
      action: "setDefaultReference"
    });
    expect(confirmationCalls).toHaveLength(1);
    expect(fixture.input.runtimeState.finalText).toBe("请确认这项操作。");
    expect(fixture.input.runtimeState.pendingConfirmationCreated).toBe(true);
    expect(fixture.input.batchState.pendingAgentActionCreated).toBe(true);
  });
});

function createFixture() {
  const workspace = createTestWorkspace();
  const host = createAgentTurnHostFake({ workspace });
  const context = buildTaskContext(workspace, {
    kind: "general",
    draft: "讨论当前项目",
    selectedObjectIds: []
  });
  const runtimeState = createAgentTurnRuntimeState({
    conversationContext: {
      messages: [],
      rawMessageCount: 0,
      coveredMessageCount: 0,
      estimatedInputTokens: 0,
      pressure: "normal"
    },
    conversationInput: [],
    requiredReadState: createRequiredAgentReadState([]),
    contextBudgetState: createAgentContextBudgetState(0),
    agentWorkLedger: createAgentTurnWorkLedger()
  });
  const input: AgentToolExecutorInput = {
    callId: "call-fixture",
    stableOperationId: "a-plus-effect-turn-fixture-call-fixture",
    context,
    providerTaskContext: buildProviderTaskContext(context),
    runtimeState,
    batchState: { visualBatch: null, pendingAgentActionCreated: false },
    commitWorkspace: host.commitWorkspace,
    readWorkspace: host.readWorkspace,
    draft: "讨论当前项目",
    modelOutputText: "",
    userMessageId: "message-user",
    assistantMessageId: "message-assistant",
    userMessageCreatedAt: "2026-07-27T00:00:00.000Z",
    selectedObjectIds: [],
    selectedObjects: [],
    allowStructuredComparison: false,
    imageAttachmentObjectIds: [],
    documentExtractObjectIds: [],
    requiredMemoryUpdates: [],
    imageGenerationModelId: "test-image-model",
    signal: new AbortController().signal,
    requestWebSearch: async () => ({ sources: [] }),
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: [],
      failedItems: []
    }),
    ui: {
      selectObjects: () => undefined,
      focusObject: () => undefined,
      openProposal: () => undefined,
      clearPendingDeliveryDraftTarget: () => undefined,
      requestConfirmation: () => undefined
    }
  };
  return { host, input };
}
