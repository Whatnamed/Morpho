import { afterEach, describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import type {
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent,
  APlusAgentProviderMessage,
  APlusToolCall
} from "@/shared/agentTurnJournalProtocol";
import type {
  AgentTurnCoordinatorExecutionHandshake,
  AgentTurnCoordinatorHost
} from "./agentTurnCoordinator";
import {
  createAgentTurnHostSessionDetachedError,
  type AgentTurnHost
} from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  detachMorphoAgentTurnForPageUnload,
  cancelMorphoAgentTurn,
  recoverMorphoAgentTurn,
  resumeMorphoAgentTurn,
  runMorphoAgentTurn,
  type AgentTurnRunnerAPlusDependencies
} from "./agentTurnRunner";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import type {
  AgentTurnRecoveryStore,
  APlusTurnRecoveryRecord
} from "./agentTurnRecoveryStore";
import type { WorkspacePersistenceState } from "./workspacePersistence";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const LOCAL_PROJECT_ID = createTestWorkspace().project.id;

afterEach(() => {
  detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
});

describe("A+ Agent turn runner", () => {
  it("runs the Workspace entry through Coordinator, display, persistence and reducer outcome", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "A+ 已完成当前讨论。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "A+ 已完成当前讨论。",
      status: "done",
      agentTurnOutcome: "success"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();
    expect(fixture.store.loadCalls).toBe(0);
    expect(fixture.fake.getEvents().filter((event) => event.name === "persist").length).toBeGreaterThan(0);
  });

  it("preserves a Server Turn creation error and releases the project for a clean retry", async () => {
    const fixture = createFixture([]);
    fixture.coordinatorHost.createError = new Error("请先登录 Morpho。");

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "请先登录 Morpho。",
      status: "failed",
      agentTurnOutcome: "failedBeforeExecution"
    });
    fixture.coordinatorHost.createError = undefined;
    fixture.coordinatorHost.appendScripts([
      { status: "externallyCompleted", outputText: "重新登录后已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "重新登录后已完成。",
      status: "done",
      agentTurnOutcome: "success"
    });
  });

  it("keeps a bounded stream failure detail in the failed assistant message", async () => {
    const secretDiagnostic = "internal-host.local api_key=secret raw upstream body /private/path";
    const fixture = createFixture([{
      status: "externallyFailed",
      externalErrorCode: "provider_execution_failed",
      externalErrorMessage: secretDiagnostic
    }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "模型返回异常，本轮未完成。",
      status: "failed",
      agentTurnOutcome: "failedDuringProvider"
    });
    expect(JSON.stringify(fixture.fake.getWorkspace())).not.toContain(secretDiagnostic);
    expect(JSON.stringify(fixture.store.record ?? null)).not.toContain(secretDiagnostic);
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
    fixture.input.draft = "创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[1]).toEqual(fixture.coordinatorHost.executions[0]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "安全重试完成。",
      agentTurnOutcome: "success"
    });
  });

  it("preserves the webSearch authority bit from Preparation to the Coordinator host and Recovery", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "已核实。" }
    ]);
    fixture.input.draft = "查一下最新的行业标准，联网核实。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    // Preparation → Coordinator start: the host captures webSearch:true.
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
    // Recovery export keeps the bit in both the active request and the base request.
    expect(fixture.store.record?.coordinator.activeRequest?.providerRequest.capabilityIntent.webSearch).toBe(true);
    expect(fixture.store.record?.metadata.runtime.providerBaseRequest.capabilityIntent.webSearch).toBe(true);
    // Restore reconciles the same authority without regenerating a different bit.
    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    const resumed = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("keeps webSearch absent/false across the whole chain when the turn is not authorized", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).not.toBe(true);
    expect(fixture.store.record?.coordinator.activeRequest?.providerRequest.capabilityIntent.webSearch).not.toBe(true);
    expect(fixture.store.record?.metadata.runtime.providerBaseRequest.capabilityIntent.webSearch).not.toBe(true);
  });

  it("reuses the exact webSearch authority on an exact retry", async () => {
    const fixture = createFixture([
      { status: "transportFailure" },
      { status: "externallyCompleted", outputText: "重试完成。" }
    ]);
    fixture.input.draft = "查一下最新的行业标准，联网核实。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[1]).toEqual(fixture.coordinatorHost.executions[0]);
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
  });

  it("keeps the webSearch authority on the continuation request", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先建立研究草案。",
        toolCalls: [researchToolCall("call-research-searchable")]
      },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    fixture.input.draft = "联网查最新标准，并创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.capabilityIntent.webSearch).toBe(true);
  });

  it("arms the deterministic memory final check only when the turn has candidates", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    // No candidates: no reminder anywhere.
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    fixture.store.clear();
    const fixture2 = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    fixture2.input.draft = "预算不能超过 500 元。";
    await runMorphoAgentTurn(fixture2.input, fixture2.host, fixture2.dependencies);
    expect(fixture2.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(true);
    expect(fixture2.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(true);
    expect(
      fixture2.store.record?.metadata.runtime.providerBaseRequest.input.filter(reminderText)
    ).toHaveLength(1);
  });

  it("keeps non-declarations free of reminder and memory authority end to end", async () => {
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    // Representative negatives: scope-only question, ordinary design
    // discussion, threshold question, open-question query, temporary
    // avoidance, and current-turn agent/tool operation commands. None may
    // produce a candidate, a reminder, or memory authority.
    let fixture = createFixture([{ status: "providerRunning" }]);
    for (const draft of [
      "后续怎么做？",
      "这个材质怎么样？",
      "高度低于多少合适？",
      "有哪些待确认问题？",
      "先别用蓝色。",
      "不要比较，只分析。",
      "不要联网，只总结本地内容。",
      "不要创建研究分析。",
      "必须先联网查一下。"
    ]) {
      detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
      fixture.store.clear();
      const run = createFixture([{ status: "providerRunning" }]);
      run.input.draft = draft;
      await runMorphoAgentTurn(run.input, run.host, run.dependencies);
      expect(run.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
      expect(run.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);
      expect(run.store.record?.metadata.runtime.facts.handledMemoryCandidateIndexes).toEqual([]);
      fixture = run;
    }
  });

  it("executes an explicit comparison turn through the provider end to end", async () => {
    // H: comparison turns must reach the provider with comparison strategy,
    // the comparisonDecision pack and comparisonAnalysis intent, and settle
    // like any completed turn (chat-only; no memory candidates from a plain
    // comparison).
    const fixture = createFixture([{ status: "externallyCompleted", outputText: "比较完成。" }]);
    const sources = selectComparableSources(fixture);
    fixture.input.selectedObjectIds = sources.map((object) => object.id);
    fixture.input.selectedObjects = sources;
    fixture.input.draft = "把这两个比较一下。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    const request = fixture.coordinatorHost.executions[0]?.providerRequest;
    expect(request?.strategy).toBe("comparison");
    expect(request?.capabilityIntent.comparisonAnalysis).toBe(true);
    expect(request?.methodPacks).toContain("comparisonDecision");
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({ body: "比较完成。" });
  });

  it("keeps a compare-without-persist request free of memory authority end to end", async () => {
    // The clause 但不要保存记录 is a current-turn operation boundary, never a
    // long-term avoidance: comparison stays on (strategy + pack) while the
    // memory side produces no candidate, no reminder and no submit authority.
    // providerRunning keeps the turn in recovery so the runtime facts remain
    // readable, like the other memory-authority e2e rows.
    const fixture = createFixture([{ status: "providerRunning" }]);
    const sources = selectComparableSources(fixture);
    fixture.input.selectedObjectIds = sources.map((object) => object.id);
    fixture.input.selectedObjects = sources;
    fixture.input.draft = "比较一下，但不要保存记录。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    const request = fixture.coordinatorHost.executions[0]?.providerRequest;
    expect(request?.strategy).toBe("comparison");
    expect(request?.capabilityIntent.comparisonAnalysis).toBe(true);
    expect(request?.methodPacks).toContain("comparisonDecision");
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.handledMemoryCandidateIndexes).toEqual([]);
  });

  it("reminds exactly once when the model would end without handling a candidate", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "好的，我会注意预算。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "好的，我会注意预算。",
      agentTurnOutcome: "success"
    });
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    const reminders = fixture.coordinatorHost.executions[0]?.providerRequest.input.filter(reminderText) ?? [];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.content[0]).toMatchObject({
      type: "input_text",
      text: expect.stringContaining("submit_memory_update")
    });
  });

  it("completes normally when the model submits the candidate via the tool", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先记录预算约束。",
        toolCalls: [memoryConstraintToolCall("call-memory-budget")]
      },
      { status: "externallyCompleted", outputText: "已记录预算约束。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "success"
    });
    // The candidate is handled; the reminder is still the same single transient
    // message (never regenerated) and no second reminder round occurs.
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.input.filter(reminderText)).toHaveLength(1);
  });

  it("marks candidates handled when the model skips with items: [] and skippedReason", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "这条先不写入长期记忆。",
        toolCalls: [memorySkipToolCall("call-memory-skip")]
      },
      { status: "externallyCompleted", outputText: "已跳过。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "success"
    });
    expect(fixture.fake.getWorkspace().projectContinuity.recordEntries.length).toBeGreaterThanOrEqual(0);
  });

  it("keeps one-off turns free of both memory authority and the reminder", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "尝试写入。",
        toolCalls: [memoryConstraintToolCall("call-memory-one-off")]
      },
      { status: "externallyCompleted", outputText: "已说明不可写入。" }
    ]);
    fixture.input.draft = "这张图不要高反光。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    // The un-authorized submit call is blocked locally; nothing was written.
    expect(fixture.fake.getWorkspace().projectContinuity.recordEntries).toHaveLength(0);
  });

  it("restores a terminal Pending Confirmation card without reopening the old Turn", async () => {
    const fixture = createFixture([{
      status: "awaitingNextRequest",
      outputText: "这个写入需要确认。",
      toolCalls: [researchToolCall("call-confirm")]
    }]);
    fixture.input.agentTurnMode = "confirm";
    fixture.input.draft = "创建研究分析，并在执行前向我确认。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.store.record?.coordinator.lifecycle.phase).toBe("terminal");
    const before = fixture.fake.getEvents().filter((event) => event.name === "confirmation").length;

    await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(fixture.fake.getEvents().filter((event) => event.name === "confirmation").length).toBe(before + 1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("uses query-only reconciliation after refresh while Provider is still running", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.fake.getEvents().filter((event) => event.name === "streaming").at(-1)).toEqual(
      expect.objectContaining({ value: [false] })
    );
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);

    const recovered = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(recovered).toBe("pending");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("routes a persisted recovery record through the full loader without appending a duplicate user message", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const userMessageIds = fixture.fake.getWorkspace().ai.messages
      .filter((message) => message.role === "user")
      .map((message) => message.id);
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.store.loadCalls).toBe(1);
    expect(fixture.fake.getWorkspace().ai.messages
      .filter((message) => message.role === "user")
      .map((message) => message.id)).toEqual(userMessageIds);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);
  });

  it("closes stale local recovery when the retained Server Turn no longer exists", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record).toBeDefined();
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    fixture.coordinatorHost.queryError = Object.assign(new Error("Server Turn no longer exists."), {
      code: "not_found"
    });

    await expect(
      recoverMorphoAgentTurn(
        fixture.fake.getWorkspace().project.id,
        fixture.host,
        fixture.dependencies
      )
    ).resolves.toBe("failed");

    expect(fixture.store.record).toBeUndefined();
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      status: "failed",
      agentTurnOutcome: "failedDuringProvider"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    fixture.coordinatorHost.queryError = undefined;
    fixture.coordinatorHost.appendScripts([{ status: "externallyCompleted", outputText: "新请求完成。" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "新请求完成。",
      agentTurnOutcome: "success"
    });
  });

  it("keeps A+ recovery recoverable when a local confirmation already occupies the slot", async () => {
    const fixture = createFixture([{
      status: "awaitingNextRequest",
      outputText: "这个写入需要确认。",
      toolCalls: [researchToolCall("call-confirm-collision")]
    }]);
    fixture.input.agentTurnMode = "confirm";
    fixture.input.draft = "创建研究分析，并在执行前向我确认。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const occupiedHost: AgentTurnHost = {
      ...fixture.host,
      ui: {
        ...fixture.host.ui,
        requestPendingConfirmation: () => ({
          status: "rejected" as const,
          code: "confirmation_slot_occupied" as const,
          origin: "agent" as const
        })
      }
    };

    await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      occupiedHost,
      fixture.dependencies
    );

    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);
    expect(fixture.store.record).toBeDefined();
  });

  it("detaches a stale host without finalizing a failed turn into the new workspace", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "旧页面结果" }
    ]);
    const host: AgentTurnHost = {
      ...fixture.host,
      commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>) => {
        if (fixture.fake.getWorkspace().project.id !== LOCAL_PROJECT_ID) {
          throw createAgentTurnHostSessionDetachedError();
        }
        return fixture.host.commitWorkspace(transform);
      }
    };
    const releaseCompletion = fixture.coordinatorHost.deferNextCompletion();
    const run = runMorphoAgentTurn(fixture.input, host, fixture.dependencies);

    await waitForCondition(() => fixture.coordinatorHost.executions.length === 1);
    const current = fixture.fake.getWorkspace();
    current.project = { ...current.project, id: "project-new" };
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    host.abortSlot.get()?.abort(createAgentTurnHostSessionDetachedError());
    releaseCompletion();
    await expect(run).resolves.toBeUndefined();

    expect(fixture.fake.getWorkspace().project.id).toBe("project-new");
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "",
      status: "streaming"
    });
    expect(latestAssistant(fixture.fake.getWorkspace())?.agentTurnOutcome).toBeUndefined();
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.cancelCalls).toBe(0);
  });

  it("resumes an active provider-running session on the same page and permits the next Turn", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "下一回合已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    const resumed = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const firstCheck = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(firstCheck).toBe("pending");
    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    await expect(resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    )).resolves.toBe("recovered");

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
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
    fixture.input.draft = "请联网搜索当前资料。";
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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.pendingExternalAction).toMatchObject({
      status: "running",
      actionKind: "webSearch",
      callId: "call-search-running"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    running = false;
    const resumed = await resumeMorphoAgentTurn(
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

  it("persists the exact Search request before send and recovers when the first page never receives a response", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-page-loss")]
      },
      { status: "externallyCompleted", outputText: "Search 已从发送前快照恢复。" }
    ]);
    fixture.input.draft = "请联网搜索当前资料。";
    const requestBodies: string[] = [];
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      async (request) => {
        requestBodies.push(await request.clone().text());
        if (requestBodies.length === 1) {
          return new Promise<Response>(() => undefined);
        }
        return Response.json({
          replayed: true,
          sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
          failedSourceCount: 0,
          timedOutSourceCount: 0
        });
      }
    );

    void runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    await waitForCondition(() =>
      fixture.store.record?.metadata.pendingExternalAction?.status === "acquired"
    );
    const persistedBody = fixture.store.record?.metadata.pendingExternalAction?.requestBody;
    expect(persistedBody).toBeTruthy();
    expect(requestBodies).toEqual([persistedBody]);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    const recovered = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(recovered).toBe("recovered");
    expect(requestBodies).toEqual([persistedBody, persistedBody]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "Search 已从发送前快照恢复。",
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
    fixture.input.draft = "请联网搜索并创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      () => Response.json({
        replayed: true,
        sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
        failedSourceCount: 0,
        timedOutSourceCount: 0
      })
    );

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.runtime.facts.hasWebSearchEvidence).toBe(true);
    expect(fixture.store.record?.metadata.runtime.facts.collectedCitations).toHaveLength(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    const refreshed = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(refreshed).toBe("pending");
    fixture.coordinatorHost.setJournalStatus("awaitingNextRequest");

    await expect(resumeMorphoAgentTurn(
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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    const cancelled = await cancelMorphoAgentTurn(
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

  it("does not let a detached old session release a newer same-project owner", async () => {
    const first = createFixture([
      { status: "externallyCompleted", outputText: "旧页面结果" }
    ]);
    const releaseFirstCompletion = first.coordinatorHost.deferNextCompletion();
    const firstRun = runMorphoAgentTurn(first.input, first.host, first.dependencies);

    await waitForCondition(() => first.coordinatorHost.executions.length === 1);
    detachMorphoAgentTurnForPageUnload(first.fake.getWorkspace().project.id);

    const second = createFixture([{ status: "providerRunning" }]);
    await runMorphoAgentTurn(second.input, second.host, second.dependencies);
    expect(second.coordinatorHost.executions).toHaveLength(1);

    // Remove durable recovery so a successful resume proves the in-memory
    // second owner survived the first owner's late finalization.
    second.store.record = undefined;
    releaseFirstCompletion();
    await expect(firstRun).resolves.toBeUndefined();

    await expect(resumeMorphoAgentTurn(
      second.fake.getWorkspace().project.id,
      second.host,
      second.dependencies
    )).resolves.toBe("pending");
    await expect(cancelMorphoAgentTurn(
      second.fake.getWorkspace().project.id,
      "用户停止了第二个 Provider Stream。"
    )).resolves.toBe(true);
    expect(second.coordinatorHost.cancelCalls).toBe(1);
  });

  it("releases a terminal cancellation so the next Turn can start immediately", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "第二回合已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    await expect(cancelMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      "用户停止了 Provider Stream。"
    )).resolves.toBe(true);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "第二回合已完成。",
      agentTurnOutcome: "success"
    });
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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

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

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

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
    fixture.input.taskMode = "imageGeneration";
    fixture.input.recommendedTaskMode = "imageGeneration";
    fixture.input.directionPreviewCount = 2;

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

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

  it("completes a delivery draft Tool as a persisted local write and continues the Turn", async () => {
    const fixture = createFixture([]);
    const delivery = Object.values(fixture.fake.getWorkspace().objects)
      .find((object) => object.type === "delivery");
    if (!delivery || delivery.type !== "delivery") throw new Error("Fixture 缺少 delivery object。");
    const section = delivery.sections.find((candidate) => candidate.referenceIds.length > 0);
    if (!section) throw new Error("Fixture 缺少带引用的 delivery section。");
    fixture.input.draft = "为当前交付章节创建草案";
    fixture.input.pendingDeliveryDraftTarget = {
      deliveryObjectId: delivery.id,
      sectionId: section.id
    };
    fixture.coordinatorHost.appendScripts([
      {
        status: "awaitingNextRequest",
        toolCalls: [deliveryToolCall("call-delivery-runner", section.referenceIds[0]!)]
      },
      { status: "externallyCompleted", outputText: "交付章节草案已准备好。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(Object.keys(fixture.fake.getWorkspace().deliverySectionDrafts)).toHaveLength(1);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          callId: "call-delivery-runner",
          output: expect.stringContaining('"status":"draftCreated"')
        })
      ])
    );
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "交付章节草案已准备好。",
      status: "done",
      agentTurnOutcome: "success"
    });
    expect(fixture.fake.getEvents().filter((event) => event.name === "confirmation")).toHaveLength(0);
    expect(fixture.store.record).toBeUndefined();
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
    fixture.input.draft = "创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

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
      externalErrorCode?: string;
      externalErrorMessage?: string;
    }>;

class CoordinatorHostFake implements AgentTurnCoordinatorHost {
  readonly executions: Array<Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0]> = [];
  cancelCalls = 0;
  createError: Error | undefined;
  queryError: Error | undefined;
  private deferredCompletion: { promise: Promise<void>; resolve: () => void } | undefined;
  private index = 0;
  private snapshot: AgentTurnJournalSnapshot = snapshotFor("created", null, 0, 0);

  private readonly scripts: Script[];

  constructor(scripts: readonly Script[]) {
    this.scripts = [...scripts];
  }

  appendScripts(scripts: readonly Script[]): void {
    this.scripts.push(...scripts);
  }

  deferNextCompletion(): () => void {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    this.deferredCompletion = { promise, resolve };
    return resolve;
  }

  async createServerTurn(input: { localProjectId: string }): Promise<{
    snapshot: AgentTurnJournalSnapshot;
    replayed: boolean;
  }> {
    if (this.createError) throw this.createError;
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
        const deferred = this.deferredCompletion;
        this.deferredCompletion = undefined;
        if (deferred) await deferred.promise;
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
        if (script.externalErrorCode) {
          observer({
            type: "externalError",
            requestId: input.requestId,
            stepSequence: input.stepSequence,
            code: script.externalErrorCode,
            message: script.externalErrorMessage ?? "文本 AI 服务暂时不可用，请稍后重试。",
            recoverable: true
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
    if (this.queryError) throw this.queryError;
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
  loadCalls = 0;

  hasPersistedRecord(localProjectId: string): boolean {
    return this.record?.localProjectId === localProjectId;
  }

  async save(record: APlusTurnRecoveryRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async load(localProjectId: string): Promise<
    | { status: "none" }
    | { status: "ok"; record: APlusTurnRecoveryRecord }
  > {
    this.loadCalls += 1;
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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the A+ Recovery barrier.");
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

function selectComparableSources(fixture: ReturnType<typeof createFixture>) {
  const objects = Object.values(fixture.fake.getWorkspace().objects)
    .filter((object) => object.visibility === "active" && (object.type === "image" || object.type === "research"))
    .slice(0, 2);
  if (objects.length !== 2) throw new Error("Fixture 缺少两个可 Compare 对象。");
  return objects;
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

function deliveryToolCall(callId: string, referenceId: string): APlusToolCall {
  return {
    callId,
    name: "prepare_delivery_section_draft",
    argumentsText: JSON.stringify({
      title: "交付章节草案",
      narrative: "这份草案等待用户在交付面板中应用或放弃。",
      captions: [{ referenceId, caption: "核心参考" }],
      suggestedGaps: []
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

function memoryConstraintToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "submit_memory_update",
    argumentsText: JSON.stringify({
      items: [{
        kind: "constraint",
        scope: "project",
        evidenceQuote: "预算不能超过 500 元",
        relatedObjectIds: [],
        relatedRevisionIds: []
      }]
    })
  };
}

function memorySkipToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "submit_memory_update",
    argumentsText: JSON.stringify({
      items: [],
      skippedReason: "审慎判断该候选不需要写入长期记忆"
    })
  };
}
