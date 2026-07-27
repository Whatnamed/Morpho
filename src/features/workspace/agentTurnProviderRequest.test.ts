import { describe, expect, it } from "vitest";

import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type {
  AgentRouteStreamEvent,
  AgentStreamResult
} from "@/shared/agentStreamProtocol";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { agentStreamScript, textAnswerScript, turnErrorScript } from "./agentStreamScripts";
import { createRequiredAgentReadState } from "./agentTaskStrategy";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { createAgentTurnWorkLedger } from "./agentTurnMessages";
import {
  createAgentTurnProviderRequestAdapter,
  type AgentTurnProviderRequestAdapterInput
} from "./agentTurnProviderRequest";
import { createAgentTurnRuntimeState, createAgentTurnState } from "./agentTurnState";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

describe("Agent turn provider request adapter", () => {
  it("keeps initial, exact-continuation, and lease-continuation request bodies distinct", async () => {
    const initial = createFixture(textAnswerScript());
    await createAgentTurnProviderRequestAdapter(initial.input).request(["initial"]);
    expect(initial.requestBodies[0]).toMatchObject({
      input: ["initial"],
      continuation: false
    });
    expect(initial.requestBodies[0]).not.toHaveProperty("leaseContinuation");
    expect(initial.requestBodies[0]).not.toHaveProperty("leaseId");

    const exact = createFixture(textAnswerScript());
    exact.input.turnState.agentTurnLeaseId = "lease-exact";
    exact.input.turnState.nextAgentLeaseSequence = 4;
    exact.input.turnState.agentContinuationToken = "token-exact";
    await createAgentTurnProviderRequestAdapter(exact.input).request(["exact"], true);
    expect(exact.requestBodies[0]).toMatchObject({
      input: ["exact"],
      continuation: true,
      leaseId: "lease-exact",
      leaseSequence: 4,
      continuationToken: "token-exact"
    });
    expect(exact.requestBodies[0]).not.toHaveProperty("leaseContinuation");

    const lease = createFixture(textAnswerScript());
    lease.input.turnState.agentTurnLeaseId = "lease-reset";
    lease.input.turnState.nextAgentLeaseSequence = 7;
    lease.input.turnState.agentContinuationToken = "token-reset";
    lease.input.turnState.providerTranscriptReset = true;
    await createAgentTurnProviderRequestAdapter(lease.input).request(["lease"], true);
    expect(lease.requestBodies[0]).toMatchObject({
      input: ["lease"],
      continuation: false,
      leaseContinuation: true,
      leaseId: "lease-reset",
      leaseSequence: 7,
      continuationToken: "token-reset"
    });
    expect(lease.input.turnState.providerTranscriptReset).toBe(false);
  });

  it("sends a pending directive once and clears it after fetch resolves", async () => {
    const fixture = createFixture(textAnswerScript());
    fixture.input.runtimeState.pendingServerDirective = { kind: "finalize" };

    await createAgentTurnProviderRequestAdapter(fixture.input).request([]);

    expect(fixture.requestBodies[0]).toMatchObject({ directive: { kind: "finalize" } });
    expect(fixture.input.runtimeState.pendingServerDirective).toBeUndefined();
  });

  it("flushes and releases the stream slot when stream consumption throws", async () => {
    const fixture = createFixture(turnErrorScript("provider failed"));
    const slotWrites: Array<(() => void) | null> = [];
    let activeFlush: (() => void) | null = null;
    fixture.input.streamFlushSlot = {
      get: () => activeFlush,
      set: (value) => {
        activeFlush = value;
        slotWrites.push(value);
      }
    };

    await expect(
      createAgentTurnProviderRequestAdapter(fixture.input).request([])
    ).rejects.toThrow("provider failed");

    expect(slotWrites).toHaveLength(2);
    expect(slotWrites[0]).toBeTypeOf("function");
    expect(slotWrites[1]).toBeNull();
    expect(activeFlush).toBeNull();
  });

  it("drops reset-attempt text and uses the larger observed input-token count", async () => {
    const script = agentStreamScript([
      {
        type: "turn-start",
        agentTurnId: "turn-provider-unit",
        attemptId: "attempt-a",
        startedAt: "2026-07-27T00:00:00.000Z"
      },
      {
        type: "final-delta",
        partId: "final-a",
        delta: "discarded",
        attemptId: "attempt-a"
      },
      {
        type: "usage",
        usage: usage(240),
        attemptId: "attempt-a"
      },
      {
        type: "turn-attempt-reset",
        attemptId: "attempt-a",
        nextAttemptId: "attempt-b",
        message: "retry"
      },
      {
        type: "final-delta",
        partId: "final-b",
        delta: "kept",
        attemptId: "attempt-b"
      },
      {
        type: "usage",
        usage: usage(150),
        attemptId: "attempt-b"
      },
      {
        type: "turn-complete",
        attemptId: "attempt-b",
        result: streamResult("kept", 120)
      }
    ] satisfies AgentRouteStreamEvent[]);
    const fixture = createFixture(script);

    await createAgentTurnProviderRequestAdapter(fixture.input).request([]);

    expect([...fixture.input.runtimeState.streamedFinalTextByAttempt.entries()]).toEqual([
      ["attempt-b", "kept"]
    ]);
    expect(fixture.input.runtimeState.contextBudgetState.baselineInputTokens).toBe(150);
  });
});

function createFixture(script: { body: string }) {
  const workspace = createTestWorkspace();
  const requestBodies: Array<Record<string, unknown>> = [];
  const host = createAgentTurnHostFake({
    workspace,
    routes: {
      "/api/ai/agent": async (request) => {
        requestBodies.push((await request.json()) as Record<string, unknown>);
        return new Response(script.body, {
          headers: { "content-type": "text/event-stream" }
        });
      }
    }
  });
  const userInput = {
    role: "user",
    content: [{ type: "input_text", text: "测试消息" }]
  } satisfies ResponseMessageInput;
  const providerInputSnapshot = createProviderInputSnapshot({
    message: userInput,
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION
  });
  const context = buildTaskContext(workspace, {
    kind: "general",
    draft: "测试消息",
    selectedObjectIds: []
  });
  const turnState = createAgentTurnState(workspace);
  const runtimeState = createAgentTurnRuntimeState({
    conversationContext: {
      laneKey: "project",
      messages: [],
      rawMessageCount: 0,
      coveredMessageCount: 0,
      estimatedInputTokens: 10,
      pressure: "normal"
    },
    conversationInput: [],
    requiredReadState: createRequiredAgentReadState([]),
    contextBudgetState: createAgentContextBudgetState(10),
    agentWorkLedger: createAgentTurnWorkLedger()
  });
  const input: AgentTurnProviderRequestAdapterInput = {
    agentTurnId: "turn-provider-unit",
    userMessageId: "message-user",
    assistantMessageId: "message-assistant",
    agentTurnMode: "auto",
    allowStructuredComparison: false,
    draft: "测试消息",
    strategyKind: "discussion",
    context,
    conversationLaneKey: "project",
    providerInputSnapshot,
    providerFrameInput: {
      workspace,
      projectId: workspace.project.id,
      strategy: "discussion",
      mode: "auto",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      userMessageId: "message-user",
      context,
      providerTaskContext: buildProviderTaskContext(context),
      defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "discussion")
    },
    stableSystemPrompt: "Stable system prompt",
    userInput,
    initialTools: [],
    outputTokenReserve: 1_000,
    turnCreatedAt: "2026-07-27T00:00:00.000Z",
    signal: new AbortController().signal,
    turnState,
    runtimeState,
    commitWorkspace: host.commitWorkspace,
    readWorkspace: host.readWorkspace,
    streamFlushSlot: host.streamFlushSlot,
    fetch: host.fetch,
    nowIso: () => "2026-07-27T00:00:01.000Z"
  };
  return { host, input, requestBodies };
}

function usage(inputTokens: number) {
  return {
    inputTokens,
    outputTokens: 1,
    totalTokens: inputTokens + 1
  };
}

function streamResult(outputText: string, inputTokens: number): AgentStreamResult {
  return {
    responseId: "response-provider-unit",
    outputText,
    functionCalls: [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: [],
    usage: usage(inputTokens)
  };
}
