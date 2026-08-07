import { describe, expect, it } from "vitest";

import { applyConversationSummaryRevision } from "@/domain/morpho/conversationCompaction";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import { runAgentCompaction } from "./agentCompactionOrchestrator";
import {
  hashAPlusExternalActionBody,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";
import { AgentTurnCoordinator, type AgentTurnCoordinatorHost } from "./agentTurnCoordinator";
import {
  createAgentTurnHostSessionDetachedError,
  type AgentTurnHost
} from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import type { AgentTurnCompactionMode } from "./agentTurnLifecycle";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ unified Compaction orchestrator", () => {
  it.each<AgentTurnCompactionMode>(["automatic", "preContinuation", "manual"])(
    "runs %s through the same lifecycle and one Summary apply boundary",
    async (mode) => {
      const fixture = await createFixture();
      const beforeIds = fixture.host.readWorkspace().ai.messages.map((message) => message.id);

      const result = await runAgentCompaction({
        mode,
        actionId: `compact:${mode}:1`,
        coordinator: fixture.coordinator,
        host: fixture.host,
        localProjectId: "project-test",
        force: true,
        signal: new AbortController().signal
      });

      expect(result).toMatchObject({ status: "applied" });
      expect(fixture.coordinator.getLifecycleSnapshot()).toMatchObject({
        phase: "requestingProvider",
        compactions: [expect.objectContaining({
          mode,
          completion: expect.objectContaining({ kind: "applied" })
        })]
      });
      const workspace = fixture.host.readWorkspace();
      expect(workspace.ai.messages.map((message) => message.id)).toEqual(beforeIds);
      expect(Object.keys(workspace.ai.conversationSummaryRevisions)).toHaveLength(1);
      expect(fixture.fake.getEvents().some((event) => event.name === "persist")).toBe(true);
    }
  );

  it("cancels without applying a half Summary Revision or deleting raw chat", async () => {
    const fixture = await createFixture({ abortRoute: true });
    const controller = new AbortController();
    controller.abort();
    const before = fixture.host.readWorkspace();

    const result = await runAgentCompaction({
      mode: "manual",
      actionId: "compact:manual:cancel",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: controller.signal
    });

    expect(result).toEqual({ status: "cancelled", actionId: "compact:manual:cancel" });
    expect(fixture.host.readWorkspace().ai.messages).toEqual(before.ai.messages);
    expect(fixture.host.readWorkspace().ai.conversationSummaryRevisions).toEqual({});
    expect(fixture.coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "cancelled" },
      compactions: []
    });
  });

  it("does not turn a detached Compaction recovery into server cancellation", async () => {
    const fixture = await createFixture({ runningOnce: true });
    const first = await runAgentCompaction({
      mode: "manual",
      actionId: "compact:manual:detached",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal
    });
    if (first.status !== "running") throw new Error("Expected a durable running Compaction action.");

    const controller = new AbortController();
    controller.abort(createAgentTurnHostSessionDetachedError());
    const host: AgentTurnHost = {
      ...fixture.host,
      fetch: async (input, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("detached", "AbortError");
        }
        return fixture.host.fetch(input, init);
      }
    };

    await expect(runAgentCompaction({
      mode: "manual",
      actionId: "compact:manual:detached",
      coordinator: fixture.coordinator,
      host,
      localProjectId: "project-test",
      signal: controller.signal,
      restoredExternalAction: first.externalAction
    })).rejects.toMatchObject({ code: "agent_turn_host_session_detached" });

    expect(fixture.cancelCalls).toBe(0);
    expect(fixture.requestBodies).toHaveLength(1);
    expect(fixture.coordinator.getLifecycleSnapshot()?.phase).toBe("compacting");
  });

  it("records the applied Summary Revision in Recovery before durable Workspace save", async () => {
    const fixture = await createFixture();
    const order: string[] = [];
    const persistWorkspace = fixture.host.persistWorkspace;
    if (!persistWorkspace) throw new Error("Fixture 缺少 Workspace persistence host。");

    const result = await runAgentCompaction({
      mode: "preContinuation",
      actionId: "compact:pre-continuation:recovery-order",
      coordinator: fixture.coordinator,
      host: {
        ...fixture.host,
        persistWorkspace: () => {
          order.push("workspace-persisted");
          return persistWorkspace();
        }
      },
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      onSummaryApplied: ({ revisionId }) => {
        order.push(`recovery:${revisionId}`);
        return true;
      }
    });

    expect(result.status).toBe("applied");
    expect(order).toHaveLength(2);
    expect(order[0]).toMatch(/^recovery:/);
    expect(order[1]).toBe("workspace-persisted");
  });

  it("keeps an applied Revision and reports failure when its Recovery Record cannot persist", async () => {
    const fixture = await createFixture();

    const result = await runAgentCompaction({
      mode: "manual",
      actionId: "compact:manual:recovery-failure",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      onSummaryApplied: () => false
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(Object.keys(fixture.host.readWorkspace().ai.conversationSummaryRevisions)).toHaveLength(1);
    expect(fixture.coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "partiallyCompleted" },
      persistence: "failed"
    });
  });

  it("keeps Compaction pending on a 202 replay and converges on the same Action", async () => {
    const fixture = await createFixture({ runningOnce: true });
    const first = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:running",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal
    });

    expect(first.status).toBe("running");
    expect(fixture.coordinator.getLifecycleSnapshot()?.phase).toBe("compacting");
    if (first.status !== "running") throw new Error("Expected an ambiguous Compaction Action.");
    expect(first.externalAction.requestHash).toBe(await hashAPlusExternalActionBody(fixture.requestBodies[0]!));

    const resumed = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:running",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      signal: new AbortController().signal,
      restoredExternalAction: first.externalAction
    });

    expect(resumed.status).toBe("applied");
    expect(fixture.requestBodies[1]).toBe(fixture.requestBodies[0]);
    if (resumed.status !== "applied") throw new Error("Expected restored Compaction to apply.");
    expect(fixture.host.readWorkspace().ai.conversationSummaryRevisions[resumed.revisionId])
      .toMatchObject({
        sourceStartMessageId: "u1",
        sourceEndMessageId: "a1",
        estimatedInputTokens: first.externalAction.compactionApplyBoundary?.estimatedInputTokens
      });
    expect(fixture.coordinator.getLifecycleSnapshot()?.phase).toBe("requestingProvider");
  });

  it("rejects a restored Summary when an original source message changed", async () => {
    const fixture = await createFixture({ ambiguousOnce: true });
    const order: string[] = [];
    let persistedAction: APlusExternalActionDescriptor | undefined;
    const host: AgentTurnHost = {
      ...fixture.host,
      fetch: async (url, init) => {
        order.push("fetch");
        return fixture.host.fetch(url, init);
      }
    };
    const first = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:ambiguous",
      coordinator: fixture.coordinator,
      host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      onExternalActionIntent: (action) => {
        order.push("persist");
        persistedAction = action;
        return true;
      }
    });

    expect(first.status).toBe("running");
    expect(fixture.coordinator.getLifecycleSnapshot()?.phase).toBe("compacting");
    expect(fixture.externalExecutionCount).toBe(1);
    expect(order.slice(0, 2)).toEqual(["persist", "fetch"]);
    if (!persistedAction) throw new Error("Expected the Compaction descriptor to persist before fetch.");
    fixture.host.commitWorkspace((current) => ({
      workspace: {
        ...current,
        ai: {
          ...current.ai,
          messages: current.ai.messages.map((message, index) =>
            index === 0 ? { ...message, body: `${message.body}（刷新后被本地修改）` } : message
          )
        }
      },
      value: undefined
    }));

    const resumed = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:ambiguous",
      coordinator: fixture.coordinator,
      host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      restoredExternalAction: persistedAction
    });

    expect(resumed).toMatchObject({
      status: "failed",
      code: "compaction_source_changed"
    });
    expect(Object.keys(fixture.host.readWorkspace().ai.conversationSummaryRevisions)).toHaveLength(0);
    expect(fixture.externalExecutionCount).toBe(1);
    expect(fixture.requestBodies).toHaveLength(2);
    expect(fixture.requestBodies[0]).toBe(fixture.requestBodies[1]);
  });

  it("applies the original source range and preserves append-only tail messages", async () => {
    const fixture = await createFixture({ ambiguousOnce: true });
    let persistedAction: APlusExternalActionDescriptor | undefined;
    const first = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:append-tail",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      onExternalActionIntent: (action) => {
        persistedAction = action;
        return true;
      }
    });
    expect(first.status).toBe("running");
    if (!persistedAction) throw new Error("Expected the Compaction descriptor to persist before fetch.");
    fixture.host.commitWorkspace((current) => ({
      workspace: {
        ...current,
        ai: {
          ...current.ai,
          messages: [
            ...current.ai.messages,
            { id: "u3", role: "user", body: "追加问题", createdAt: "2026-07-29T00:00:04.000Z" },
            { id: "a3", role: "assistant", body: "追加回答", status: "done", createdAt: "2026-07-29T00:00:05.000Z" }
          ]
        }
      },
      value: undefined
    }));

    const resumed = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:append-tail",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      signal: new AbortController().signal,
      restoredExternalAction: persistedAction
    });

    expect(resumed.status).toBe("applied");
    if (resumed.status !== "applied") throw new Error("Expected append-only recovery to apply.");
    const workspace = fixture.host.readWorkspace();
    expect(workspace.ai.messages.map((message) => message.id)).toEqual([
      "u1", "a1", "u2", "a2", "u3", "a3"
    ]);
    expect(workspace.ai.conversationSummaryRevisions[resumed.revisionId]).toMatchObject({
      sourceStartMessageId: "u1",
      sourceEndMessageId: "a1",
      sourceMessageCount: 2
    });
    expect(fixture.requestBodies[1]).toBe(fixture.requestBodies[0]);
  });

  it("rejects a restored Summary when the base Summary Revision changed", async () => {
    const fixture = await createFixture({ ambiguousOnce: true });
    let persistedAction: APlusExternalActionDescriptor | undefined;
    const first = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:revision-conflict",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal,
      onExternalActionIntent: (action) => {
        persistedAction = action;
        return true;
      }
    });
    expect(first.status).toBe("running");
    if (!persistedAction) throw new Error("Expected the Compaction descriptor to persist before fetch.");
    fixture.host.commitWorkspace((current) => {
      const applied = applyConversationSummaryRevision(current, {
        summary: summaryFixture(),
        sourceMessageIds: ["u1", "a1"],
        estimatedInputTokens: 10,
        now: "2026-07-29T00:00:06.000Z"
      });
      if (applied.status !== "applied") throw new Error(applied.reason);
      return { workspace: applied.workspace, value: undefined };
    });

    const resumed = await runAgentCompaction({
      mode: "automatic",
      actionId: "compact:automatic:revision-conflict",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      signal: new AbortController().signal,
      restoredExternalAction: persistedAction
    });

    expect(resumed).toMatchObject({
      status: "failed",
      code: "summary_revision_conflict"
    });
    expect(Object.keys(fixture.host.readWorkspace().ai.conversationSummaryRevisions)).toHaveLength(1);
  });
});

async function createFixture(options: {
  abortRoute?: boolean;
  runningOnce?: boolean;
  ambiguousOnce?: boolean;
} = {}) {
  const fake = createAgentTurnHostFake({ workspace: conversationWorkspace() });
  let running = options.runningOnce === true;
  let ambiguous = options.ambiguousOnce === true;
  let externalExecutionCount = 0;
  let cancelCalls = 0;
  const requestBodies: string[] = [];
  fake.setFetchRoute(
    `/api/ai/agent/turns/${TURN_ID}/actions/compaction`,
    async (request) => {
      if (options.abortRoute) throw new DOMException("cancelled", "AbortError");
      requestBodies.push(await request.clone().text());
      if (ambiguous) {
        ambiguous = false;
        externalExecutionCount += 1;
        throw new TypeError("connection reset after acquire");
      }
      if (running) {
        running = false;
        return Response.json({
          code: "external_action_running",
          error: "Compaction 仍在服务器执行。"
        }, { status: 202 });
      }
      return Response.json({
        summary: {
          threadGoal: "收敛产品方向",
          establishedContext: ["项目保持连续画布"],
          decisionsAndReasons: ["保留 local-first 边界"],
          activeWork: ["验证 A+ Runtime"],
          unresolvedQuestions: ["等待独立审计"],
          referencedObjects: []
        }
      });
    }
  );
  const host: AgentTurnHost = {
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
  const coordinatorHost: AgentTurnCoordinatorHost = {
    createServerTurn: async ({ localProjectId }) => ({
      snapshot: createdSnapshot(localProjectId),
      replayed: false
    }),
    executeExternalRequest: async () => {
      throw new Error("Provider should not run during this compaction test.");
    },
    queryServerTurn: async ({ localProjectId }) => createdSnapshot(localProjectId),
    cancelExternalRequest: async () => {
      cancelCalls += 1;
    }
  };
  const coordinator = new AgentTurnCoordinator({
    localProjectId: "project-test",
    creationIdempotencyKey: "creation-compaction",
    host: coordinatorHost,
    createRequestId: () => "request-unused"
  });
  const initialized = await coordinator.initialize();
  if (initialized.status === "denied") throw new Error(initialized.error);
  return {
    fake,
    host,
    coordinator,
    requestBodies,
    get cancelCalls() {
      return cancelCalls;
    },
    get externalExecutionCount() {
      return externalExecutionCount;
    }
  };
}

function conversationWorkspace(): MorphoWorkspace {
  const workspace = createTestWorkspace();
  return {
    ...workspace,
    project: { ...workspace.project, id: "project-test" },
    ai: {
      ...workspace.ai,
      messages: [
        { id: "u1", role: "user", body: "我们要做什么？", createdAt: "2026-07-29T00:00:00.000Z" },
        { id: "a1", role: "assistant", body: "收敛产品方向。", status: "done", createdAt: "2026-07-29T00:00:01.000Z" },
        { id: "u2", role: "user", body: "边界是什么？", createdAt: "2026-07-29T00:00:02.000Z" },
        { id: "a2", role: "assistant", body: "保持 local-first。", status: "done", createdAt: "2026-07-29T00:00:03.000Z" }
      ]
    }
  };
}

function summaryFixture() {
  return {
    threadGoal: "收敛产品方向",
    establishedContext: ["项目保持连续画布"],
    decisionsAndReasons: ["保留 local-first 边界"],
    activeWork: ["验证 A+ Runtime"],
    unresolvedQuestions: ["等待独立审计"],
    referencedObjects: []
  };
}

function createdSnapshot(localProjectId: string): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId,
    status: "created",
    latestRequestId: null,
    latestStepSequence: 0,
    counters: { provider: 0, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: null
  };
}
