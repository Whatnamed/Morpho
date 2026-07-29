import { afterEach, describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import type {
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent,
  APlusToolCall
} from "@/shared/agentTurnJournalProtocol";
import type {
  AgentTurnCoordinatorExecutionHandshake,
  AgentTurnCoordinatorHost
} from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  detachMorphoAgentTurnAPlusForPageUnload,
  cancelMorphoAgentTurnAPlus,
  recoverMorphoAgentTurnAPlus,
  resumeMorphoAgentTurnAPlus,
  runMorphoAgentTurnAPlus,
  type AgentTurnRunnerAPlusDependencies
} from "./agentTurnRunnerAPlus";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import type {
  AgentTurnRecoveryStore,
  APlusTurnRecoveryRecord
} from "./agentTurnRecoveryStore";
import type { WorkspacePersistenceState } from "./workspacePersistence";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const LOCAL_PROJECT_ID = createTestWorkspace().project.id;

afterEach(() => {
  detachMorphoAgentTurnAPlusForPageUnload(LOCAL_PROJECT_ID);
});

describe("A+ Agent turn runner", () => {
  it("runs the Workspace entry through Coordinator, display, persistence and reducer outcome", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "A+ 已完成当前讨论。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "A+ 已完成当前讨论。",
      status: "done",
      agentTurnOutcome: "success"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();
    expect(fixture.fake.getEvents().filter((event) => event.name === "persist").length).toBeGreaterThan(0);
  });

  it("keeps a successful local Tool effect when the Provider continuation fails", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先建立研究草案。",
        toolCalls: [researchToolCall("call-research")]
      },
      { status: "externallyFailed" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    const assistant = latestAssistant(fixture.fake.getWorkspace());
    expect(assistant).toMatchObject({
      status: "done",
      agentTurnOutcome: "partialSuccess"
    });
    expect(assistant?.agentTrace?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "toolActivity",
        toolCallId: "call-research",
        source: "local",
        state: "done"
      })
    ]));
    expect(Object.values(fixture.fake.getWorkspace().objects).some((object) =>
      object.type === "research"
    )).toBe(true);
    expect(fixture.coordinatorHost.executions.map((execution) => execution.stepSequence)).toEqual([1, 2]);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function_call", callId: "call-research" }),
        expect.objectContaining({ type: "function_call_output", callId: "call-research" })
      ])
    );
  });

  it("retries request_not_observed with the exact Request ID, Sequence and body", async () => {
    const fixture = createFixture([
      { status: "transportFailure" },
      { status: "externallyCompleted", outputText: "安全重试完成。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[1]).toEqual(fixture.coordinatorHost.executions[0]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "安全重试完成。",
      agentTurnOutcome: "success"
    });
  });

  it("restores a terminal Pending Confirmation card without reopening the old Turn", async () => {
    const fixture = createFixture([{
      status: "awaitingNextRequest",
      outputText: "这个写入需要确认。",
      toolCalls: [researchToolCall("call-confirm")]
    }]);
    fixture.input.agentTurnMode = "confirm";

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.store.record?.coordinator.lifecycle.phase).toBe("terminal");
    const before = fixture.fake.getEvents().filter((event) => event.name === "confirmation").length;

    await recoverMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(fixture.fake.getEvents().filter((event) => event.name === "confirmation").length).toBe(before + 1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("uses query-only reconciliation after refresh while Provider is still running", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.fake.getEvents().filter((event) => event.name === "streaming").at(-1)).toEqual(
      expect.objectContaining({ value: [false] })
    );
    detachMorphoAgentTurnAPlusForPageUnload(fixture.fake.getWorkspace().project.id);

    const recovered = await recoverMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(recovered).toBe("pending");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("resumes an active provider-running session on the same page and permits the next Turn", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "下一回合已完成。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    const resumed = await resumeMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "下一回合已完成。",
      agentTurnOutcome: "success"
    });
  });

  it("keeps the same-page recovery entry through repeated pending checks", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "检查后下一回合完成。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    const firstCheck = await resumeMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(firstCheck).toBe("pending");
    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    await expect(resumeMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    )).resolves.toBe("recovered");

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "检查后下一回合完成。",
      agentTurnOutcome: "success"
    });
  });

  it("replays a running Search Action from the Runner and executes it only once", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-running")]
      },
      { status: "externallyCompleted", outputText: "Search Receipt 已恢复。" }
    ]);
    let running = true;
    const requestBodies: string[] = [];
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      async (_request) => {
        requestBodies.push(_request.body ? await _request.clone().text() : "");
        if (running) {
          return Response.json({ replayed: true, action: { status: "running" } }, { status: 202 });
        }
        return Response.json({
          replayed: true,
          sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
          failedSourceCount: 0,
          timedOutSourceCount: 0
        });
      }
    );

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.pendingExternalAction).toMatchObject({
      status: "running",
      actionKind: "webSearch",
      callId: "call-search-running"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    running = false;
    const resumed = await resumeMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(new Set(requestBodies)).toHaveProperty("size", 1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "Search Receipt 已恢复。",
      agentTurnOutcome: "success"
    });
  });

  it("restores Search citations and Required Read facts before a later Research Tool", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-facts")]
      },
      {
        status: "providerRunning",
        outputText: "继续建立研究草案。",
        toolCalls: [researchToolCall("call-research-after-refresh")]
      },
      { status: "externallyCompleted", outputText: "研究草案已完成。" }
    ]);
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      () => Response.json({
        replayed: true,
        sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
        failedSourceCount: 0,
        timedOutSourceCount: 0
      })
    );

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.runtime.facts.hasWebSearchEvidence).toBe(true);
    expect(fixture.store.record?.metadata.runtime.facts.collectedCitations).toHaveLength(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);

    detachMorphoAgentTurnAPlusForPageUnload(fixture.fake.getWorkspace().project.id);
    const refreshed = await recoverMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(refreshed).toBe("pending");
    fixture.coordinatorHost.setJournalStatus("awaitingNextRequest");

    await expect(resumeMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    )).resolves.toBe("recovered");

    const research = Object.values(fixture.fake.getWorkspace().objects)
      .find((object) => object.type === "research" && object.provenance?.didUseWebSearch);
    expect(research).toMatchObject({
      type: "research",
      provenance: { didUseWebSearch: true }
    });
  });

  it("cancels local display, requests server cancellation, queries Journal, and never repeats Provider", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    const cancelled = await cancelMorphoAgentTurnAPlus(
      fixture.fake.getWorkspace().project.id,
      "用户停止了 Provider Stream。"
    );

    expect(cancelled).toBe(true);
    expect(fixture.coordinatorHost.cancelCalls).toBe(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      status: "cancelled",
      agentTurnOutcome: "cancelledDuringProvider"
    });
    expect(fixture.fake.getEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "streaming", value: [false] })
    ]));
  });

  it("gives every invalid Tool call one failed result and continues with bounded output", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [{
          callId: "call-invalid",
          name: "create_research_analysis",
          argumentsText: "{}"
        }]
      },
      { status: "externallyCompleted", outputText: "已说明无法执行该 Tool。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    const continuation = fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems;
    expect(continuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", callId: "call-invalid" }),
      expect.objectContaining({
        type: "function_call_output",
        callId: "call-invalid",
        output: expect.stringContaining("invalid_tool_arguments")
      })
    ]));
  });

  it("finalizes a mixed multi-Tool batch with exactly one terminal output per Call", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [
          {
            callId: "call-read",
            name: "read_project_memory",
            argumentsText: "{}"
          },
          {
            callId: "call-invalid",
            name: "create_research_analysis",
            argumentsText: "{}"
          }
        ]
      },
      { status: "externallyCompleted", outputText: "已综合可用结果。" }
    ]);

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    const continuation = fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems ?? [];
    expect(continuation.filter((item) => item.type === "function_call_output")).toEqual([
      expect.objectContaining({ callId: "call-read" }),
      expect.objectContaining({
        callId: "call-invalid",
        output: expect.stringContaining("invalid_tool_arguments")
      })
    ]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
  });

  it("keeps successful Image items and marks failed items as unresolved partial work", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [visualToolCall("call-visual")]
      },
      { status: "externallyCompleted", outputText: "已保留成功生成项。" }
    ], {
      visualGenerationResult: {
        createdObjectIds: ["image-created-a"],
        failedItems: [{ itemId: "visual-b", reason: "provider failed" }]
      }
    });
    fixture.input.draft = "生成两张方向图";
    fixture.input.directionPreviewCount = 2;

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          callId: "call-visual",
          output: expect.stringContaining("failedItems")
        })
      ])
    );
  });

  it("does not report full success when a local write happened but durable persistence failed", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "先写入研究草案。",
        toolCalls: [researchToolCall("call-persistence")]
      }
    ], {
      persistenceStates: [savedPersistence(), failedPersistence()]
    });

    await runMorphoAgentTurnAPlus(fixture.input, fixture.host, fixture.dependencies);

    expect(Object.values(fixture.fake.getWorkspace().objects).some((object) =>
      object.type === "research"
    )).toBe(true);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });
});

type Script =
  | Readonly<{ status: "transportFailure" }>
  | Readonly<{
      status: "providerRunning" | "awaitingNextRequest" | "externallyCompleted" | "externallyFailed";
      outputText?: string;
      toolCalls?: readonly APlusToolCall[];
    }>;

class CoordinatorHostFake implements AgentTurnCoordinatorHost {
  readonly executions: Array<Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0]> = [];
  cancelCalls = 0;
  private index = 0;
  private snapshot: AgentTurnJournalSnapshot = snapshotFor("created", null, 0, 0);

  constructor(private readonly scripts: readonly Script[]) {}

  async createServerTurn(input: { localProjectId: string }): Promise<{
    snapshot: AgentTurnJournalSnapshot;
    replayed: boolean;
  }> {
    this.snapshot = snapshotFor("created", null, 0, 0, input.localProjectId);
    return { snapshot: this.snapshot, replayed: false };
  }

  async executeExternalRequest(
    input: Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0],
    observer: (event: AgentTurnRequestStreamEvent) => void
  ): Promise<AgentTurnCoordinatorExecutionHandshake> {
    this.executions.push(structuredClone(input));
    const script = this.scripts[this.index++];
    if (!script) throw new Error("Unexpected A+ execution.");
    if (script.status === "transportFailure") throw new Error("headers unavailable");
    return {
      status: "started",
      complete: async () => {
        const toolCalls = script.toolCalls ?? [];
        if (
          script.status !== "externallyFailed" &&
          (script.status !== "providerRunning" || Boolean(script.outputText?.trim()) || toolCalls.length > 0)
        ) {
          observer({
            type: "providerOutput",
            requestId: input.requestId,
            stepSequence: input.stepSequence,
            outputText: script.outputText ?? "",
            producedUserVisibleEffect: Boolean(script.outputText?.trim()),
            toolCallIds: toolCalls.map((call) => call.callId),
            toolCalls
          });
        }
        this.snapshot = snapshotFor(
          script.status,
          input.requestId,
          input.stepSequence,
          this.snapshot.counters.provider + 1,
          input.localProjectId
        );
        return script.status === "providerRunning"
          ? { status: "interrupted", code: "display_detached" }
          : { status: "ended", finalFrameReceived: true };
      }
    };
  }

  async queryServerTurn(): Promise<AgentTurnJournalSnapshot> {
    return structuredClone(this.snapshot);
  }

  setJournalStatus(status: AgentTurnJournalSnapshot["status"]): void {
    this.snapshot = snapshotFor(
      status,
      this.snapshot.latestRequestId,
      this.snapshot.latestStepSequence,
      this.snapshot.counters.provider,
      this.snapshot.localProjectId
    );
  }

  async cancelExternalRequest(): Promise<void> {
    this.cancelCalls += 1;
    this.snapshot = snapshotFor(
      "externallyCancelled",
      this.snapshot.latestRequestId,
      this.snapshot.latestStepSequence,
      this.snapshot.counters.provider,
      this.snapshot.localProjectId
    );
  }
}

class MemoryRecoveryStore implements AgentTurnRecoveryStore {
  record: APlusTurnRecoveryRecord | undefined;

  async save(record: APlusTurnRecoveryRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async load(localProjectId: string): Promise<
    | { status: "none" }
    | { status: "ok"; record: APlusTurnRecoveryRecord }
  > {
    return this.record?.localProjectId === localProjectId
      ? { status: "ok", record: structuredClone(this.record) }
      : { status: "none" };
  }

  async clear(): Promise<void> {
    this.record = undefined;
  }
}

function createFixture(
  scripts: readonly Script[],
  options: {
    persistenceStates?: WorkspacePersistenceState[];
    visualGenerationResult?: Readonly<{
      createdObjectIds: string[];
      failedItems: unknown[];
    }>;
  } = {}
) {
  const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
  const persistenceStates = [...(options.persistenceStates ?? [])];
  const host: AgentTurnHost = {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    persistWorkspace: () => persistenceStates.shift() ?? fake.persistWorkspace(),
    ui: {
      setContextWarning: fake.createUiRecorder("warning"),
      clearPendingDeliveryDraftTarget: fake.createUiRecorder("clearDelivery"),
      setStreaming: fake.createUiRecorder("streaming"),
      setDraft: fake.createUiRecorder("draft"),
      setTaskMode: fake.createUiRecorder("taskMode"),
      openConversation: fake.createUiRecorder("openConversation"),
      showFailure: fake.createUiRecorder("failure"),
      showRecoveryPending: fake.createUiRecorder("recoveryPending"),
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
      createdObjectIds: options.visualGenerationResult?.createdObjectIds ?? [],
      failedItems: options.visualGenerationResult?.failedItems ?? []
    }),
    now: fake.now,
    randomSuffix: fake.randomSuffix
  };
  const coordinatorHost = new CoordinatorHostFake(scripts);
  const store = new MemoryRecoveryStore();
  const ids = ["creation-a", "request-1", "request-2", "request-3"];
  const dependencies: AgentTurnRunnerAPlusDependencies = {
    coordinatorHost,
    recoveryStore: store,
    createId: () => ids.shift() ?? "request-fallback"
  };
  const input: RunMorphoAgentTurnAPlusInput = {
    draft: "讨论当前项目",
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
  return { fake, host, input, coordinatorHost, store, dependencies };
}

function savedPersistence(): WorkspacePersistenceState {
  return {
    phase: "saved",
    isDirty: false,
    lastSavedAt: "2026-07-29T00:00:00.000Z"
  };
}

function failedPersistence(): WorkspacePersistenceState {
  return {
    phase: "error",
    isDirty: true,
    error: "simulated persistence failure"
  };
}

function snapshotFor(
  status: AgentTurnJournalSnapshot["status"],
  latestRequestId: string | null,
  latestStepSequence: number,
  providerCount: number,
  localProjectId = "project-test"
): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId,
    status,
    latestRequestId,
    latestStepSequence,
    counters: { provider: providerCount, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status.startsWith("externally") ? "2026-07-29T00:00:00.000Z" : null
  };
}

function latestAssistant(workspace: ReturnType<typeof createTestWorkspace>) {
  return [...workspace.ai.messages].reverse().find((message) => message.role === "assistant");
}

function researchToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "create_research_analysis",
    argumentsText: JSON.stringify({
      title: "研究草案",
      summary: "本地效果必须保留。",
      findings: [],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      evidence: []
    })
  };
}

function visualToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "generate_visuals",
    argumentsText: JSON.stringify({
      kind: "visualDevelopment",
      items: [
        {
          id: "visual-a",
          title: "方向图 A",
          purpose: "验证 A+ 图像生命周期",
          requestedReferenceObjectIds: [],
          changeGoals: [],
          preserve: [],
          allowToChange: [],
          productForm: [],
          materialsAndCmf: [],
          environmentAndLighting: [],
          avoid: [],
          role: "preview"
        },
        {
          id: "visual-b",
          title: "方向图 B",
          purpose: "验证部分失败",
          requestedReferenceObjectIds: [],
          changeGoals: [],
          preserve: [],
          allowToChange: [],
          productForm: [],
          materialsAndCmf: [],
          environmentAndLighting: [],
          avoid: [],
          role: "preview"
        }
      ]
    })
  };
}

function searchToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "search_web_evidence",
    argumentsText: JSON.stringify({
      reason: "验证 Search 恢复",
      queries: ["Morpho A+ runtime"]
    })
  };
}
