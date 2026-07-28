import { describe, expect, it } from "vitest";

import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { createProviderContextFrame } from "@/domain/morpho/providerContextFrame";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type {
  AgentRouteStreamEvent,
  AgentStreamResult
} from "@/shared/agentStreamProtocol";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import {
  bindAgentContextStateMarker,
  buildAgentCompactionDescriptor,
  buildConversationSummaryRevisionId,
  createAgentContextStateMarker,
  hashAgentProtocolValue,
  hashConversationSummaryForReceipt,
  type AgentCompactionReceipt
} from "@/shared/agentCompactionProtocol";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { agentStreamScript, textAnswerScript, turnErrorScript } from "./agentStreamScripts";
import { createRequiredAgentReadState } from "./agentTaskStrategy";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { createAgentTurnWorkLedger } from "./agentTurnMessages";
import {
  createAgentTurnProviderRequestAdapter,
  buildAgentCompactionContextMarkers,
  buildAgentCompactionFreshContextFrames,
  classifyCompactionProgress,
  rebuildAgentPostCompactionTranscript,
  type AgentTurnProviderRequestAdapterInput
} from "./agentTurnProviderRequest";
import { createAgentTurnRuntimeState, createAgentTurnState } from "./agentTurnState";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

describe("Agent turn provider request adapter", () => {
  it("persists the current user as the first trusted transcript boundary for an unsigned workspace", async () => {
    const fixture = createFixture(textAnswerScript());

    await createAgentTurnProviderRequestAdapter(fixture.input).request(["initial"]);

    expect(fixture.requestBodies[0]).toMatchObject({
      currentUserMessageId: "message-user",
      diagnostics: {
        requestState: {
          transcriptStartMessageId: "message-user"
        }
      }
    });
  });

  it("refreshes a 25-hour durable checkpoint before the next ordinary Provider request", async () => {
    const refreshedToken = clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 });
    const fixture = createFixture(textAnswerScript(), {
      snapshotRefresh: () => Response.json({
        transcriptSnapshotToken: refreshedToken,
        transcriptManifestHash: "b".repeat(64),
        expiresAt: Date.now() + 60_000
      })
    });
    fixture.input.turnState.latestProviderRequestState = {
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      transcriptManifestHash: "a".repeat(64),
      transcriptSnapshotToken: clientSnapshotToken({ v: 3, exp: Date.now() - 1 })
    };

    await createAgentTurnProviderRequestAdapter(fixture.input).request(["initial"]);

    expect(fixture.routeCalls).toEqual([
      "/api/ai/agent/snapshot/refresh",
      "/api/ai/agent"
    ]);
    expect(fixture.requestBodies[0]).toMatchObject({
      currentUserMessageId: "message-user",
      diagnostics: {
        previousRequestState: {
          transcriptSnapshotToken: refreshedToken,
          transcriptManifestHash: "b".repeat(64)
        }
      }
    });
  });

  it("does not send an ordinary Provider request when checkpoint refresh fails", async () => {
    const fixture = createFixture(textAnswerScript(), {
      snapshotRefresh: () => Response.json({ error: "refresh rejected" }, { status: 400 })
    });
    fixture.input.turnState.latestProviderRequestState = {
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      transcriptManifestHash: "a".repeat(64),
      transcriptSnapshotToken: clientSnapshotToken({ v: 3, exp: Date.now() - 1 })
    };

    await expect(
      createAgentTurnProviderRequestAdapter(fixture.input).request(["initial"])
    ).rejects.toThrow("refresh rejected");

    expect(fixture.routeCalls).toEqual(["/api/ai/agent/snapshot/refresh"]);
    expect(fixture.requestBodies).toEqual([]);
  });

  it.each([
    {
      name: "token and item count both decrease",
      before: { totalInputTokens: 500, projectedInputItemCount: 200 },
      after: { totalInputTokens: 400, projectedInputItemCount: 180 },
      expected: { status: "progress" }
    },
    {
      name: "only tokens decrease",
      before: { totalInputTokens: 500, projectedInputItemCount: 200 },
      after: { totalInputTokens: 400, projectedInputItemCount: 200 },
      expected: { status: "progress" }
    },
    {
      name: "only item count decreases",
      before: { totalInputTokens: 500, projectedInputItemCount: 200 },
      after: { totalInputTokens: 500, projectedInputItemCount: 180 },
      expected: { status: "progress" }
    },
    {
      name: "token increase fails closed",
      before: { totalInputTokens: 500, projectedInputItemCount: 200 },
      after: { totalInputTokens: 501, projectedInputItemCount: 200 },
      expected: { status: "blocked", reasonFragment: "token" }
    },
    {
      name: "no metric progress fails closed",
      before: { totalInputTokens: 500, projectedInputItemCount: 200 },
      after: { totalInputTokens: 500, projectedInputItemCount: 200 },
      expected: { status: "blocked", reasonFragment: "均没有下降" }
    }
  ])("requires strict compaction progress: $name", ({ before, after, expected }) => {
    const result = classifyCompactionProgress(before, after);
    expect(result).toMatchObject({ status: expected.status });
    if (expected.reasonFragment) {
      expect(result).toMatchObject({ reason: expect.stringContaining(expected.reasonFragment) });
    }
  });

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

  it("compacts the frame event log to the current effective context timeline", () => {
    const workspace = createTestWorkspace();
    const visibleMessages = workspace.ai.messages.filter((message) => message.contextVisibility !== "uiOnly");
    const oldAnchor = "message-old-covered";
    const currentAnchor = visibleMessages.at(-1)?.id;
    if (!currentAnchor) {
      throw new Error("Expected one fixture message.");
    }
    const frame = (input: {
      kind: "projectState" | "runtimeConfiguration" | "turnContext";
      sequence: number;
      renderedText: string;
      anchorMessageId?: string;
    }) => createProviderContextFrame({
      projectId: workspace.project.id,
      kind: input.kind,
      createdAt: "2026-07-28T00:00:00.000Z",
      sequence: input.sequence,
      placement: input.anchorMessageId ? "beforeUser" : "conversationBaseline",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      ...(input.kind === "turnContext" ? { taskStrategy: "research" as const } : {}),
      projectMemoryRevisionIds: [],
      stageRecordRevisionIds: [],
      directionRevisionIds: [],
      selectedObjectIds: [],
      relatedObjectIds: [],
      renderedText: input.renderedText,
      sourceRefs: [],
      reason: "context compaction test",
      ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {})
    });
    const withFrames = {
      ...workspace,
      ai: {
        ...workspace.ai,
        providerContextFrames: [
          frame({ kind: "projectState", sequence: 1, renderedText: "旧项目状态" }),
          frame({ kind: "turnContext", sequence: 2, renderedText: "旧回合上下文", anchorMessageId: oldAnchor }),
          frame({ kind: "runtimeConfiguration", sequence: 3, renderedText: "旧运行配置" }),
          frame({ kind: "projectState", sequence: 4, renderedText: "当前项目状态" }),
          frame({ kind: "runtimeConfiguration", sequence: 5, renderedText: "当前运行配置" }),
          frame({ kind: "turnContext", sequence: 6, renderedText: "当前回合上下文", anchorMessageId: currentAnchor })
        ]
      }
    };
    const markers = buildAgentCompactionContextMarkers(withFrames, {
      sourceMessageIds: [oldAnchor]
    });

    expect(markers.map((marker) => marker.dataText)).toEqual([
      "当前项目状态",
      "当前运行配置",
      "当前回合上下文"
    ]);
  });

  it("keeps an unbound current-turn frame in the retained data tail instead of authorizing a marker", () => {
    const workspace = createTestWorkspace();
    const currentAnchor = workspace.ai.messages.find(
      (message) => message.contextVisibility !== "uiOnly"
    )?.id;
    if (!currentAnchor) {
      throw new Error("Expected one fixture message.");
    }
    const freshFrame = createProviderContextFrame({
      projectId: workspace.project.id,
      kind: "turnContext",
      createdAt: "2026-07-28T00:00:00.000Z",
      sequence: 1,
      placement: "beforeUser",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      taskStrategy: "research",
      projectMemoryRevisionIds: [],
      stageRecordRevisionIds: [],
      directionRevisionIds: [],
      selectedObjectIds: [],
      relatedObjectIds: [],
      renderedText: "当前海洋浮标回合上下文",
      sourceRefs: [],
      reason: "fresh context compaction test",
      anchorMessageId: currentAnchor
    });
    const withFrame = {
      ...workspace,
      ai: {
        ...workspace.ai,
        providerContextFrames: [freshFrame]
      }
    };
    const options = {
      sourceMessageIds: [] as string[],
      freshAnchorMessageIds: [currentAnchor]
    };

    expect(buildAgentCompactionContextMarkers(withFrame, options)).toEqual([]);
    expect(buildAgentCompactionFreshContextFrames(withFrame, options)).toEqual([freshFrame]);
  });

  it("places a tool-causal state marker after the compacted terminal output", () => {
    const workspace = createTestWorkspace();
    const frame = createProviderContextFrame({
      projectId: workspace.project.id,
      kind: "projectState",
      createdAt: "2026-07-28T02:00:00.000Z",
      sequence: 7,
      placement: "afterAssistant",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      projectMemoryRevisionIds: ["memory-after-tool"],
      stageRecordRevisionIds: [],
      directionRevisionIds: [],
      selectedObjectIds: [],
      relatedObjectIds: [],
      renderedText: "工具完成后的海洋浮标状态",
      sourceRefs: [],
      reason: "tool causal order"
    });
    const marker = bindAgentContextStateMarker({
      marker: createAgentContextStateMarker(frame),
      outputHash: hashAgentProtocolValue("provider-call"),
      callIds: ["call-buoy-write"],
      terminalOutputHash: hashAgentProtocolValue("terminal-output")
    });
    const tail = [{
      type: "function_call_output",
      call_id: "call-buoy-write",
      output: "{\"status\":\"executed\"}"
    }];
    const descriptor = buildAgentCompactionDescriptor({
      sourceStartMessageId: "message-1",
      sourceEndMessageId: "message-2",
      sourceMessageCount: 2,
      sourceMessageIdsHash: hashAgentProtocolValue(["message-1", "message-2"]),
      retainedTail: tail,
      contextMarkers: [marker],
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION
    });
    const summary = {
      threadGoal: "保持海洋浮标工具状态的因果顺序",
      establishedContext: [],
      decisionsAndReasons: [],
      activeWork: [],
      unresolvedQuestions: [],
      referencedObjects: [],
      nextTurnAnchor: "继续"
    };
    const summaryHash = hashConversationSummaryForReceipt(summary);
    const receipt: AgentCompactionReceipt = {
      ...descriptor,
      receiptVersion: 4,
      summaryHash,
      summaryRevisionId: buildConversationSummaryRevisionId({
        sourceMessageIdsHash: descriptor.sourceMessageIdsHash,
        summaryHash
      }),
      leaseId: "lease-order",
      agentTurnId: "turn-order",
      sequence: 2,
      expiresAt: Date.now() + 60_000
    };

    const rebuilt = rebuildAgentPostCompactionTranscript({
      contextMarkers: [marker],
      receipt,
      summary,
      retainedTailItems: tail
    });
    expect(rebuilt[0]).toMatchObject({ type: "morpho_compaction_transcript" });
    expect(JSON.stringify(rebuilt[0])).toContain("call-buoy-write");
    expect(rebuilt[1]).toEqual(marker);
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

  it("persists server-verified image references on the originating user message", async () => {
    const contentHash = "a".repeat(64);
    const script = agentStreamScript([
      {
        type: "turn-start",
        agentTurnId: "turn-provider-unit",
        startedAt: "2026-07-27T00:00:00.000Z",
        providerCallCount: 1,
        nextProviderSequence: 2
      },
      {
        type: "turn-complete",
        verifiedImageReferences: [{
          messageId: "message-user",
          attachmentRefs: [{
            objectId: "image-buoy-reference",
            assetId: "asset-buoy-reference",
            contentHash,
            mimeType: "image/png"
          }]
        }],
        result: streamResult("完成", 20)
      }
    ] satisfies AgentRouteStreamEvent[]);
    const fixture = createFixture(script);
    fixture.host.commitWorkspace((workspace) => ({
      workspace: {
        ...workspace,
        ai: {
          ...workspace.ai,
          messages: [{
            ...workspace.ai.messages[0]!,
            id: "message-user",
            role: "user",
            body: "分析海洋浮标参考图",
            providerInputSnapshot: fixture.input.providerInputSnapshot
          }, ...workspace.ai.messages]
        }
      },
      value: undefined
    }));

    await createAgentTurnProviderRequestAdapter(fixture.input).request([]);

    expect(fixture.host.readWorkspace().ai.messages.find((message) => message.id === "message-user")
      ?.providerInputSnapshot?.attachmentRefs).toEqual([expect.objectContaining({
        objectId: "image-buoy-reference",
        contentHash,
        mimeType: "image/png"
      })]);
  });
});

function createFixture(
  script: { body: string },
  options: { snapshotRefresh?: () => Response | Promise<Response> } = {}
) {
  const workspace = createTestWorkspace();
  const requestBodies: Array<Record<string, unknown>> = [];
  const routeCalls: string[] = [];
  const host = createAgentTurnHostFake({
    workspace,
    routes: {
      "/api/ai/agent": async (request) => {
        routeCalls.push("/api/ai/agent");
        requestBodies.push((await request.json()) as Record<string, unknown>);
        return new Response(script.body, {
          headers: { "content-type": "text/event-stream" }
        });
      },
      "/api/ai/agent/snapshot/refresh": async () => {
        routeCalls.push("/api/ai/agent/snapshot/refresh");
        return options.snapshotRefresh?.() ?? Response.json({ error: "unexpected refresh" }, { status: 500 });
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
  return { host, input, requestBodies, routeCalls };
}

function clientSnapshotToken(claims: { v: number; exp: number }): string {
  return `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;
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
