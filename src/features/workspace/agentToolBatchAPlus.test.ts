import { describe, expect, it, vi } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { AgentTurnJournalSnapshot, APlusToolCall } from "@/shared/agentTurnJournalProtocol";
import { executeAgentToolBatchAPlus } from "./agentToolBatchAPlus";
import {
  AgentTurnCoordinator,
  type AgentTurnCoordinatorHost,
  type AgentTurnCoordinatorRecoverySnapshot
} from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  createAgentTurnLifecycleState,
  reduceAgentTurnLifecycle,
  type AgentTurnEvent,
  type AgentTurnLifecycleState
} from "./agentTurnLifecycle";
import {
  prepareAgentTurnProductAPlus,
  type RunMorphoAgentTurnAPlusInput
} from "./agentTurnProductPreparationAPlus";
import {
  APlusExternalActionRunningError,
  createAPlusExternalActionRunningError,
  hashAPlusExternalActionBody
} from "./agentExternalActionClientAPlus";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const REQUEST = { requestId: "request-1", stepSequence: 1 } as const;

describe("A+ Tool Batch integration", () => {
  it("fails closed when the confirmation slot is already occupied", async () => {
    const call = researchCall("call-slot-occupied");
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    const host: AgentTurnHost = {
      ...baseHost,
      ui: {
        ...baseHost.ui,
        requestPendingConfirmation: () => ({
          status: "rejected" as const,
          code: "confirmation_slot_occupied" as const,
          origin: "agent" as const
        })
      }
    };
    const turnInput = { ...standardInput(), agentTurnMode: "confirm" as const };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(result.pendingConfirmation).toBeUndefined();
    expect(result.terminalResults).toEqual([
      expect.objectContaining({
        callId: call.callId,
        status: "failed",
        error: expect.objectContaining({ code: "confirmation_slot_occupied" })
      })
    ]);
    expect(result.status).toBe("failed");
  });

  it("restores an executing batch, skips completed Calls, and finalizes only missing Calls", async () => {
    const calls: APlusToolCall[] = [
      researchCall("call-completed"),
      {
        callId: "call-invalid",
        name: "create_research_analysis",
        argumentsText: "{}"
      }
    ];
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const host = hostFromFake(fake);
    const turnInput = standardInput();
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot(calls),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);
    const persistenceBefore = fake.getEvents().filter((event) => event.name === "persist").length;
    const persistedOutputs: string[] = [];

    const result = await executeAgentToolBatchAPlus({
      toolCalls: calls,
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] }),
      onCallTerminal: async ({ continuationItem }) => {
        if (continuationItem?.type === "function_call_output") {
          persistedOutputs.push(continuationItem.output);
        }
        return true;
      }
    });

    expect(result.terminalResults).toEqual([
      expect.objectContaining({ callId: "call-completed", status: "executed" }),
      expect.objectContaining({ callId: "call-invalid", status: "failed" })
    ]);
    expect(persistedOutputs[0]).toContain('"recovered":true');
    expect(persistedOutputs[1]).toContain("invalid_tool_arguments");
    expect(fake.getEvents().filter((event) => event.name === "persist")).toHaveLength(
      persistenceBefore
    );
    const lifecycle = restored.coordinator.getLifecycleSnapshot();
    expect(lifecycle?.phase).toBe("continuing");
    expect(lifecycle?.toolBatches.at(-1)?.outcome.kind).toBe("partiallyCompleted");
  });

  it("does not terminate a Tool Call while its external Search Action is still running", async () => {
    const call: APlusToolCall = {
      callId: "call-search-running",
      name: "search_web_evidence",
      argumentsText: JSON.stringify({
        reason: "验证运行中的 Search",
        queries: ["Morpho A+"]
      })
    };
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const host = hostFromFake(fake);
    const turnInput = standardInput();
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => {
        throw new APlusExternalActionRunningError({
          actionId: call.callId,
          actionKind: "webSearch",
          requestBody: "{\"actionId\":\"call-search-running\"}",
          requestHash: "a".repeat(64)
        }, "Search 仍在执行。");
      }
    });

    expect(result.status).toBe("externalActionRunning");
    expect(result.terminalResults).toEqual([]);
    expect(restored.coordinator.getLifecycleSnapshot()?.phase).toBe("executingTools");
  });

  it("does not turn an Image 202 Action into a failed Tool terminal", async () => {
    const call = visualCall("call-image-running");
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    const host: AgentTurnHost = {
      ...baseHost,
      executeVisualGenerationPlan: async () => {
        throw await createAPlusExternalActionRunningError({
          actionId: call.callId,
          actionKind: "image",
          requestBody: "{\"actionId\":\"call-image-running\"}",
          message: "Image 仍在服务器执行。"
        });
      }
    };
    const turnInput = visualInput();
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(result.status).toBe("externalActionRunning");
    expect(result.externalAction).toMatchObject({
      actionKind: "image",
      callId: call.callId
    });
    expect(result.terminalResults).toEqual([]);
    expect(restored.coordinator.getLifecycleSnapshot()?.phase).toBe("executingTools");
  });

  it("passes the persisted Image body through recovery instead of rebuilding it from current inputs", async () => {
    const call = visualCall("call-image-restored-body");
    const originalBody = JSON.stringify({
      localProjectId: "project-test",
      requestId: REQUEST.requestId,
      stepSequence: REQUEST.stepSequence,
      actionId: "img:restored-child",
      claimCallId: call.callId,
      input: {
        modelId: "original-image-model",
        prompt: "original prompt",
        images: ["data:image/png;base64,original"],
        referenceObjectIds: ["reference-before-refresh"]
      }
    });
    const persistedAction = {
      actionId: "img:restored-child",
      actionKind: "image" as const,
      requestBody: originalBody,
      requestHash: await hashAPlusExternalActionBody(originalBody),
      callId: call.callId
    };
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    let observedBody: string | undefined;
    const host: AgentTurnHost = {
      ...baseHost,
      executeVisualGenerationPlan: async (input) => {
        observedBody = input.restoredExternalAction?.requestBody;
        return {
          workspace: input.workspaceSnapshot,
          createdObjectIds: ["image-restored"],
          failedItems: []
        };
      }
    };
    const turnInput = { ...visualInput(), imageGenerationModelId: "model-changed-after-refresh" };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] }),
      restoredPendingExternalAction: persistedAction
    });

    expect(result.status).toBe("completed");
    expect(observedBody).toBe(originalBody);
  });

  it("reconstructs a persisted local effect when the Tool terminal was lost", async () => {
    const call = researchCall("call-crash-window");
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const host = hostFromFake(fake);
    const turnInput = standardInput();
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const first = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (first.status !== "ok") throw new Error(first.reason);

    await expect(executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: first.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] }),
      onCallTerminal: async () => false
    })).rejects.toThrow("Recovery Record");

    const before = Object.values(fake.getWorkspace().objects)
      .filter((object) => object.type === "research").length;
    const second = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (second.status !== "ok") throw new Error(second.reason);
    const recovered = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: second.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(recovered.terminalResults).toEqual([
      expect.objectContaining({ callId: call.callId, status: "executed" })
    ]);
    expect(Object.values(fake.getWorkspace().objects)
      .filter((object) => object.type === "research")).toHaveLength(before);
    expect(recovered.continuationItems.at(-1)).toEqual(expect.objectContaining({
      type: "function_call_output",
      callId: call.callId,
      output: expect.stringContaining('"recovered":true')
    }));
  });

  it("requires visible confirmation when untrusted context causes an unrequested paid image Tool Call", async () => {
    const call = visualCall("call-unrequested-image");
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    const executeVisualGenerationPlan = vi.fn(baseHost.executeVisualGenerationPlan);
    const host: AgentTurnHost = { ...baseHost, executeVisualGenerationPlan };
    const turnInput = {
      ...standardInput(),
      draft: "分析我选中的资料并总结约束",
      taskMode: "researchOperation" as const,
      recommendedTaskMode: "researchOperation" as const
    };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(result.status).toBe("pendingConfirmation");
    expect(result.pendingConfirmation?.value).toMatchObject({ kind: "agentGenerateVisuals" });
    expect(executeVisualGenerationPlan).not.toHaveBeenCalled();
  });

  it("requires visible confirmation when the current user explicitly rejects image generation", async () => {
    const call = visualCall("call-negated-image");
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    const executeVisualGenerationPlan = vi.fn(baseHost.executeVisualGenerationPlan);
    const host: AgentTurnHost = { ...baseHost, executeVisualGenerationPlan };
    const turnInput = {
      ...standardInput(),
      draft: "不要生成预览图，只分析我选中的资料",
      taskMode: "chatAnalysis" as const,
      recommendedTaskMode: "chatAnalysis" as const
    };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(result.status).toBe("pendingConfirmation");
    expect(result.pendingConfirmation?.value).toMatchObject({ kind: "agentGenerateVisuals" });
    expect(executeVisualGenerationPlan).not.toHaveBeenCalled();
  });

  it("does not treat a quoted image command as paid-action authority", async () => {
    const firstCall = visualCall("call-quoted-image-command");
    const firstArguments = JSON.parse(firstCall.argumentsText) as { items: Array<Record<string, unknown>> };
    const call: APlusToolCall = {
      ...firstCall,
      argumentsText: JSON.stringify({
        ...firstArguments,
        items: [
          firstArguments.items[0],
          { ...firstArguments.items[0], id: "visual-quoted-second", title: "引用命令中的第二张图" }
        ]
      })
    };
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const baseHost = hostFromFake(fake);
    const executeVisualGenerationPlan = vi.fn(baseHost.executeVisualGenerationPlan);
    const host: AgentTurnHost = { ...baseHost, executeVisualGenerationPlan };
    const turnInput = {
      ...standardInput(),
      draft: "请解释文档里的‘生成两张预览图’是什么意思，只做分析。",
      taskMode: "chatAnalysis" as const,
      recommendedTaskMode: "imageGeneration" as const
    };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const restored = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (restored.status !== "ok") throw new Error(restored.reason);

    const result = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: restored.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(prepared.executionTaskMode).toBe("imageGeneration");
    expect(result.status).toBe("pendingConfirmation");
    expect(result.pendingConfirmation?.value).toMatchObject({ kind: "agentGenerateVisuals" });
    expect(executeVisualGenerationPlan).not.toHaveBeenCalled();
  });

  it("treats a delivery draft as a completed local write and replays it without a second draft", async () => {
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const host = hostFromFake(fake);
    const delivery = Object.values(fake.getWorkspace().objects)
      .find((object) => object.type === "delivery");
    if (!delivery || delivery.type !== "delivery") throw new Error("Fixture 缺少 delivery object。");
    const section = delivery.sections.find((candidate) => candidate.referenceIds.length > 0);
    if (!section) throw new Error("Fixture 缺少带引用的 delivery section。");
    const call: APlusToolCall = {
      callId: "call-delivery-draft",
      name: "prepare_delivery_section_draft",
      argumentsText: JSON.stringify({
        title: "交付章节草案",
        narrative: "这份草案先保存在本地，等待用户在交付面板中应用或放弃。",
        captions: section.referenceIds.slice(0, 1).map((referenceId) => ({
          referenceId,
          caption: "核心参考"
        })),
        suggestedGaps: []
      })
    };
    const turnInput: RunMorphoAgentTurnAPlusInput = {
      ...standardInput(),
      draft: "为当前交付章节准备草案",
      pendingDeliveryDraftTarget: {
        deliveryObjectId: delivery.id,
        sectionId: section.id
      }
    };
    const prepared = await prepareAgentTurnProductAPlus(turnInput, host);
    const first = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (first.status !== "ok") throw new Error(first.reason);

    await expect(executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: first.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] }),
      onCallTerminal: async () => false
    })).rejects.toThrow("Recovery Record");
    expect(Object.keys(fake.getWorkspace().deliverySectionDrafts)).toHaveLength(1);

    const second = AgentTurnCoordinator.restore({
      snapshot: executingSnapshot([call]),
      host: coordinatorHost(),
      createRequestId: () => "unused"
    });
    if (second.status !== "ok") throw new Error(second.reason);
    const recovered = await executeAgentToolBatchAPlus({
      toolCalls: [call],
      providerOutputText: "",
      coordinator: second.coordinator,
      host,
      turnInput,
      prepared,
      externalRequest: {
        serverTurnId: TURN_ID,
        localProjectId: fake.getWorkspace().project.id,
        ...REQUEST
      },
      requestWebSearch: async () => ({ sources: [] })
    });

    expect(recovered.status).toBe("completed");
    expect(recovered.terminalResults).toEqual([
      expect.objectContaining({
        callId: call.callId,
        status: "executed",
        localEffect: "produced",
        persistence: "succeeded"
      })
    ]);
    expect(recovered.continuationItems.at(-1)).toEqual(expect.objectContaining({
      type: "function_call_output",
      callId: call.callId,
      output: expect.stringContaining('"status":"draftCreated"')
    }));
    expect(Object.keys(fake.getWorkspace().deliverySectionDrafts)).toHaveLength(1);
    expect(fake.getEvents().filter((event) => event.name === "confirmation")).toHaveLength(0);
  });

});

function executingSnapshot(calls: readonly APlusToolCall[]): AgentTurnCoordinatorRecoverySnapshot {
  let lifecycle = apply(createAgentTurnLifecycleState(TURN_ID), { type: "PREPARATION_COMPLETED" });
  lifecycle = apply(lifecycle, { type: "PROVIDER_REQUEST_STARTED", ...REQUEST });
  lifecycle = apply(lifecycle, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    ...REQUEST,
    producedUserVisibleEffect: false
  });
  lifecycle = apply(lifecycle, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    ...REQUEST,
    status: "awaitingNextRequest"
  });
  lifecycle = apply(lifecycle, {
    type: "TOOL_BATCH_STARTED",
    declaredCallIds: calls.map((call) => call.callId)
  });
  if (calls.some((call) => call.callId === "call-completed")) {
    lifecycle = apply(lifecycle, {
    type: "TOOL_CALL_TERMINATED",
    result: {
      status: "executed",
      callId: "call-completed",
      localEffect: "produced",
      persistence: "succeeded",
      unresolvedWorkIds: []
    }
    });
  }
  return {
    recordVersion: 1,
    localProjectId: "project-test",
    creationIdempotencyKey: "creation-1",
    lifecycle,
    serverSnapshot: journalSnapshot(),
    latestProviderOutput: {
      type: "providerOutput",
      ...REQUEST,
      outputText: "",
      producedUserVisibleEffect: false,
      toolCallIds: calls.map((call) => call.callId),
      toolCalls: calls
    },
    lastRequest: REQUEST
  };
}

type EventWithoutTurnId<T> = T extends { turnId: string } ? Omit<T, "turnId"> : never;

function apply(
  state: AgentTurnLifecycleState,
  event: EventWithoutTurnId<AgentTurnEvent>
): AgentTurnLifecycleState {
  const result = reduceAgentTurnLifecycle(state, { ...event, turnId: TURN_ID } as AgentTurnEvent);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function coordinatorHost(): AgentTurnCoordinatorHost {
  return {
    createServerTurn: async () => ({ snapshot: journalSnapshot(), replayed: false }),
    executeExternalRequest: async () => {
      throw new Error("Recovered Tool Batch must not execute Provider.");
    },
    queryServerTurn: async () => journalSnapshot()
  };
}

function journalSnapshot(): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId: "project-test",
    status: "awaitingNextRequest",
    latestRequestId: REQUEST.requestId,
    latestStepSequence: REQUEST.stepSequence,
    counters: { provider: 1, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:01.000Z",
    terminalAt: null
  };
}

function standardInput(): RunMorphoAgentTurnAPlusInput {
  return {
    draft: "记录研究草案",
    taskMode: "chatAnalysis",
    recommendedTaskMode: "chatAnalysis",
    workIntent: "discussion",
    recommendedWorkIntent: "discussion",
    selectedObjectIds: [],
    selectedObjects: [],
    pendingDeliveryDraftTarget: null,
    directionPreviewCount: 1,
    agentTurnMode: "auto",
    imageGenerationModelId: "test-image-model",
    readConversationTokenLimits: () => undefined
  };
}

function visualInput(): RunMorphoAgentTurnAPlusInput {
  return {
    ...standardInput(),
    draft: "生成一张产品预览图",
    taskMode: "imageGeneration",
    recommendedTaskMode: "imageGeneration"
  };
}

function researchCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "create_research_analysis",
    argumentsText: JSON.stringify({
      title: "研究草案",
      summary: "已经在刷新前写入。",
      findings: [],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      evidence: []
    })
  };
}

function visualCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "generate_visuals",
    argumentsText: JSON.stringify({
      kind: "visualDevelopment",
      items: [{
        id: "visual-running",
        title: "运行中的图像",
        purpose: "验证 Image running 不进入 Tool 终态",
        requestedReferenceObjectIds: [],
        changeGoals: [],
        preserve: [],
        allowToChange: [],
        productForm: [],
        materialsAndCmf: [],
        environmentAndLighting: [],
        avoid: [],
        role: "preview"
      }]
    })
  };
}

function hostFromFake(fake: ReturnType<typeof createAgentTurnHostFake>): AgentTurnHost {
  return {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    persistWorkspace: fake.persistWorkspace,
    ui: {
      setContextWarning: fake.createUiRecorder("warning"),
      clearPendingDeliveryDraftTarget: fake.createUiRecorder("clearDelivery"),
      setStreaming: fake.createUiRecorder("streaming"),
      setDraft: fake.createUiRecorder("draft"),
      setTaskMode: fake.createUiRecorder("taskMode"),
      openConversation: fake.createUiRecorder("openConversation"),
      showFailure: fake.createUiRecorder("failure"),
      requestPendingConfirmation: (value) => {
        fake.createUiRecorder("confirmation")(value);
        return { status: "accepted", origin: "agent" };
      },
      selectObjects: fake.createUiRecorder("selection"),
      focusObject: fake.createUiRecorder("focus"),
      openProposal: fake.createUiRecorder("proposal")
    },
    abortSlot: fake.abortSlot,
    streamFlushSlot: fake.streamFlushSlot,
    fetch: fake.fetch,
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: [],
      failedItems: []
    }),
    now: fake.now,
    randomSuffix: fake.randomSuffix
  };
}
