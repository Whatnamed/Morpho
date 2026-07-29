import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import { createRequiredAgentReadState } from "./agentTaskStrategy";
import {
  AGENT_TOOL_EXECUTORS,
  executeAgentTool,
  type AgentToolExecutorInput
} from "./agentToolExecutors";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { createAgentTurnWorkLedger } from "./agentTurnMessages";
import { createAgentTurnRuntimeState } from "./agentTurnState";
import { buildAgentVisualGenerationBatch } from "./agentVisualGenerationBatch";
import { MORPHO_AGENT_TOOL_EFFECT_MATRIX } from "./morphoAgent";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

describe("Agent tool executors", () => {
  it("registers exactly the tools described by the effect matrix", () => {
    expect(Object.keys(AGENT_TOOL_EXECUTORS).sort()).toEqual(
      Object.keys(MORPHO_AGENT_TOOL_EFFECT_MATRIX).sort()
    );
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
      laneKey: "project",
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
