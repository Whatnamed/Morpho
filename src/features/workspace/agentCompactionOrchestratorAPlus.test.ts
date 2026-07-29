import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import { runAgentCompactionAPlus } from "./agentCompactionOrchestratorAPlus";
import { AgentTurnCoordinator, type AgentTurnCoordinatorHost } from "./agentTurnCoordinator";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import type { AgentTurnCompactionMode } from "./agentTurnLifecycle";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ unified Compaction orchestrator", () => {
  it.each<AgentTurnCompactionMode>(["automatic", "preContinuation", "manual"])(
    "runs %s through the same lifecycle and one Summary apply boundary",
    async (mode) => {
      const fixture = await createFixture();
      const beforeIds = fixture.host.readWorkspace().ai.messages.map((message) => message.id);

      const result = await runAgentCompactionAPlus({
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

    const result = await runAgentCompactionAPlus({
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

  it("records the applied Summary Revision in Recovery before durable Workspace save", async () => {
    const fixture = await createFixture();
    const order: string[] = [];
    const persistWorkspace = fixture.host.persistWorkspace;
    if (!persistWorkspace) throw new Error("Fixture 缺少 Workspace persistence host。");

    const result = await runAgentCompactionAPlus({
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

    const result = await runAgentCompactionAPlus({
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
    const first = await runAgentCompactionAPlus({
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

    const resumed = await runAgentCompactionAPlus({
      mode: "automatic",
      actionId: "compact:automatic:running",
      coordinator: fixture.coordinator,
      host: fixture.host,
      localProjectId: "project-test",
      force: true,
      signal: new AbortController().signal
    });

    expect(resumed.status).toBe("applied");
    expect(fixture.coordinator.getLifecycleSnapshot()?.phase).toBe("requestingProvider");
  });
});

async function createFixture(options: { abortRoute?: boolean; runningOnce?: boolean } = {}) {
  const fake = createAgentTurnHostFake({ workspace: conversationWorkspace() });
  let running = options.runningOnce === true;
  fake.setFetchRoute(
    `/api/ai/agent/turns/${TURN_ID}/actions/compaction`,
    () => {
      if (options.abortRoute) throw new DOMException("cancelled", "AbortError");
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
    queryServerTurn: async ({ localProjectId }) => createdSnapshot(localProjectId)
  };
  const coordinator = new AgentTurnCoordinator({
    localProjectId: "project-test",
    creationIdempotencyKey: "creation-compaction",
    host: coordinatorHost,
    createRequestId: () => "request-unused"
  });
  const initialized = await coordinator.initialize();
  if (initialized.status === "denied") throw new Error(initialized.error);
  return { fake, host, coordinator };
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
