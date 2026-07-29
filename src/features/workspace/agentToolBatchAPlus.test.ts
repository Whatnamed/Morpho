import { describe, expect, it } from "vitest";

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

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const REQUEST = { requestId: "request-1", stepSequence: 1 } as const;

describe("A+ Tool Batch integration", () => {
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
      setPendingConfirmation: fake.createUiRecorder("confirmation"),
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
