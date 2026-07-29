import { describe, expect, it } from "vitest";

import type {
  APlusAgentProviderRequest,
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent
} from "@/shared/agentTurnJournalProtocol";
import {
  AgentTurnCoordinator,
  type AgentTurnCoordinatorExecutionHandshake,
  type AgentTurnCoordinatorHost
} from "./agentTurnCoordinator";
import {
  aggregateToolBatchOutcome,
  createAgentTurnLifecycleState,
  reduceAgentTurnLifecycle,
  type AgentTurnEvent,
  type AgentTurnLifecycleState,
  type ToolCallTerminalResult
} from "./agentTurnLifecycle";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const REQUEST = { requestId: "request-1", stepSequence: 1 } as const;
const PROVIDER_REQUEST: APlusAgentProviderRequest = {
  input: [{ role: "user", content: [{ type: "input_text", text: "继续" }] }],
  promptContractVersion: "morpho-agent-v1",
  mode: "auto",
  capabilityIntent: { comparisonAnalysis: false }
};

describe("Stage 3 migration acceptance scenarios", () => {
  it("scenario 1 — keeps client cancellation separate from actual Server completion", () => {
    let state = providerRunning(TURN_ID);
    state = apply(state, {
      type: "CANCELLATION_REQUESTED",
      reason: "用户停止显示"
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...REQUEST,
      status: "externallyCompleted"
    });
    state = apply(state, { type: "TURN_FINALIZED" });

    expect(state).toMatchObject({
      phase: "terminal",
      serverExecutionStatus: "externallyCompleted",
      outcome: { kind: "cancelled" }
    });
  });

  it("scenario 2 — never carries a terminal failure marker into the next Turn", () => {
    let failed = providerRunning(TURN_ID);
    failed = apply(failed, {
      type: "EXTERNAL_ERROR_RECORDED",
      ...REQUEST,
      faultId: "provider-fault",
      error: {
        kind: "terminal",
        code: "provider_failed",
        message: "Provider failed",
        recoverable: false
      }
    });
    failed = apply(failed, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...REQUEST,
      status: "externallyFailed"
    });
    failed = apply(failed, { type: "TURN_FINALIZED" });

    const next = apply(createAgentTurnLifecycleState("turn-next"), {
      type: "PREPARATION_COMPLETED"
    }, "turn-next");
    expect(failed.phase).toBe("terminal");
    expect(next).toMatchObject({ phase: "requestingProvider", fault: { kind: "none" } });
  });

  it("scenario 3 — preserves an executed local Tool when Continuation fails", () => {
    let state = awaitingTools(TURN_ID);
    state = finalizeBatch(state, [executed("call-write")]);
    state = apply(state, {
      type: "PROVIDER_REQUEST_STARTED",
      requestId: "request-2",
      stepSequence: 2
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      requestId: "request-2",
      stepSequence: 2,
      status: "externallyFailed"
    });
    state = apply(state, { type: "TURN_FINALIZED" });

    expect(state).toMatchObject({
      phase: "terminal",
      outcome: { kind: "partiallyCompleted" },
      toolBatches: [expect.objectContaining({
        results: [expect.objectContaining({ callId: "call-write", status: "executed" })]
      })]
    });
  });

  it.each([
    ["all succeeded", [executed("a"), executed("b")], "completed"],
    ["partially succeeded", [executed("a"), failed("b")], "partiallyCompleted"],
    ["all failed", [failed("a"), failed("b")], "failed"],
    ["partially cancelled", [executed("a"), cancelled("b")], "partiallyCompleted"],
    ["pending confirmation", [pending("a")], "pendingConfirmation"],
    ["persistence failed", [executed("a", "failed")], "partiallyCompleted"],
    ["unresolved work", [executed("a", "succeeded", ["work-a"])], "partiallyCompleted"]
  ] as const)("scenario 4 — finalizes %s through the one batch aggregator", (_name, results, expected) => {
    const copied = results.map((result) => ({ ...result }));
    expect(aggregateToolBatchOutcome(
      copied.map((result) => result.callId),
      copied
    )).toMatchObject({
      ok: true,
      outcome: { kind: expected }
    });
    expect(new Set(results.map((result) => result.callId)).size).toBe(results.length);
  });

  it.each(["automatic", "preContinuation", "manual"] as const)(
    "scenario 5 — records %s Compaction with the same lifecycle vocabulary",
    (mode) => {
      let state = requesting(TURN_ID);
      state = apply(state, {
        type: "COMPACTION_STARTED",
        mode,
        actionId: `compact:${mode}`
      });
      state = apply(state, {
        type: "COMPACTION_COMPLETED",
        actionId: `compact:${mode}`,
        completion: { kind: "applied", revisionId: `revision:${mode}` }
      });

      expect(state).toMatchObject({
        phase: "requestingProvider",
        compactions: [{
          mode,
          actionId: `compact:${mode}`,
          completion: { kind: "applied", revisionId: `revision:${mode}` }
        }]
      });
    }
  );

  it("scenario 6 — retries an unobserved request with the exact identity and body", async () => {
    const host = new RequestNotObservedHost();
    const coordinator = new AgentTurnCoordinator({
      localProjectId: "project-test",
      creationIdempotencyKey: "creation-1",
      host,
      createRequestId: () => "request-exact"
    });
    expect((await coordinator.initialize()).status).toBe("ok");

    const first = await coordinator.startInitialRequest(PROVIDER_REQUEST);
    expect(first).toMatchObject({
      status: "denied",
      code: "request_not_observed",
      recoverable: true
    });
    expect((await coordinator.retryActiveRequest()).status).toBe("ok");

    expect(host.executions).toHaveLength(2);
    expect(host.executions[1]).toEqual(host.executions[0]);
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      serverExecutionStatus: "externallyCompleted"
    });
  });

  it("scenario 7 — rejects a deterministic identity conflict without blocking a fresh Turn", () => {
    const current = providerRunning(TURN_ID);
    const conflict = reduceAgentTurnLifecycle(current, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      turnId: TURN_ID,
      requestId: "wrong-request",
      stepSequence: 1,
      status: "externallyCompleted"
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { recoverable: false, code: "externalRequestMismatch" }
    });

    const next = requesting("turn-after-conflict");
    const started = reduceAgentTurnLifecycle(next, {
      type: "PROVIDER_REQUEST_STARTED",
      turnId: "turn-after-conflict",
      requestId: "request-fresh",
      stepSequence: 1
    });
    expect(started).toMatchObject({ ok: true, state: { phase: "requestingProvider" } });
  });
});

type EventWithoutTurnId<T> = T extends { turnId: string } ? Omit<T, "turnId"> : never;

function apply(
  state: AgentTurnLifecycleState,
  event: EventWithoutTurnId<AgentTurnEvent>,
  turnId = TURN_ID
): AgentTurnLifecycleState {
  const result = reduceAgentTurnLifecycle(state, { ...event, turnId } as AgentTurnEvent);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function requesting(turnId: string): AgentTurnLifecycleState {
  return apply(createAgentTurnLifecycleState(turnId), { type: "PREPARATION_COMPLETED" }, turnId);
}

function providerRunning(turnId: string): AgentTurnLifecycleState {
  return apply(requesting(turnId), { type: "PROVIDER_REQUEST_STARTED", ...REQUEST }, turnId);
}

function awaitingTools(turnId: string): AgentTurnLifecycleState {
  let state = providerRunning(turnId);
  state = apply(state, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    ...REQUEST,
    producedUserVisibleEffect: false
  }, turnId);
  return apply(state, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    ...REQUEST,
    status: "awaitingNextRequest"
  }, turnId);
}

function finalizeBatch(
  state: AgentTurnLifecycleState,
  results: readonly ToolCallTerminalResult[]
): AgentTurnLifecycleState {
  let next = apply(state, {
    type: "TOOL_BATCH_STARTED",
    declaredCallIds: results.map((result) => result.callId)
  });
  results.forEach((result) => {
    next = apply(next, { type: "TOOL_CALL_TERMINATED", result });
  });
  return apply(next, { type: "TOOL_BATCH_FINALIZED" });
}

function executed(
  callId: string,
  persistence: "notRequired" | "succeeded" | "failed" = "succeeded",
  unresolvedWorkIds: readonly string[] = []
): Extract<ToolCallTerminalResult, { status: "executed" }> {
  return {
    status: "executed",
    callId,
    localEffect: persistence === "notRequired" ? "none" : "produced",
    persistence,
    unresolvedWorkIds
  };
}

function failed(callId: string): Extract<ToolCallTerminalResult, { status: "failed" }> {
  return {
    status: "failed",
    callId,
    error: {
      kind: "terminal",
      code: "tool_failed",
      message: "Tool failed",
      recoverable: false
    }
  };
}

function cancelled(callId: string): Extract<ToolCallTerminalResult, { status: "cancelled" }> {
  return { status: "cancelled", callId, reason: "cancelled" };
}

function pending(callId: string): Extract<ToolCallTerminalResult, { status: "pendingConfirmation" }> {
  return {
    status: "pendingConfirmation",
    callId,
    confirmationId: `confirmation:${callId}`,
    unresolvedWorkIds: []
  };
}

class RequestNotObservedHost implements AgentTurnCoordinatorHost {
  readonly executions: Array<Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0]> = [];
  private snapshot = journalSnapshot("created", null, 0, 0);

  async createServerTurn(): Promise<{ snapshot: AgentTurnJournalSnapshot; replayed: boolean }> {
    return { snapshot: this.snapshot, replayed: false };
  }

  async executeExternalRequest(
    input: Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0],
    observer: (event: AgentTurnRequestStreamEvent) => void
  ): Promise<AgentTurnCoordinatorExecutionHandshake> {
    this.executions.push(structuredClone(input));
    if (this.executions.length === 1) throw new Error("headers unavailable");
    return {
      status: "started",
      complete: async () => {
        observer({
          type: "providerOutput",
          requestId: input.requestId,
          stepSequence: input.stepSequence,
          outputText: "完成",
          producedUserVisibleEffect: true,
          toolCallIds: [],
          toolCalls: []
        });
        this.snapshot = journalSnapshot(
          "externallyCompleted",
          input.requestId,
          input.stepSequence,
          1
        );
        return { status: "ended", finalFrameReceived: true };
      }
    };
  }

  async queryServerTurn(): Promise<AgentTurnJournalSnapshot> {
    return structuredClone(this.snapshot);
  }
}

function journalSnapshot(
  status: AgentTurnJournalSnapshot["status"],
  latestRequestId: string | null,
  latestStepSequence: number,
  provider: number
): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId: "project-test",
    status,
    latestRequestId,
    latestStepSequence,
    counters: { provider, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status.startsWith("externally") ? "2026-07-29T00:00:01.000Z" : null
  };
}
