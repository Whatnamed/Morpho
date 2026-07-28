import { describe, expect, it } from "vitest";

import {
  aggregateToolBatchOutcome,
  createAgentTurnLifecycleState,
  reduceAgentTurnLifecycle,
  type AgentTurnError,
  type AgentTurnEvent,
  type AgentTurnLifecycleState,
  type ToolCallTerminalResult
} from "./agentTurnLifecycle";

const turnId = "turn-1";
const request1 = { requestId: "request-1", stepSequence: 1 } as const;
const request2 = { requestId: "request-2", stepSequence: 2 } as const;
const fault1 = "fault-1";
const retryableError = {
  kind: "retryable",
  code: "networkInterrupted",
  message: "temporary network interruption",
  recoverable: true
} satisfies AgentTurnError;
const terminalError = {
  kind: "terminal",
  code: "invalidProviderResponse",
  message: "provider response is terminally invalid",
  recoverable: false
} satisfies AgentTurnError;
const conflictError = {
  kind: "conflict",
  code: "sequenceConflict",
  message: "request sequence conflicts",
  recoverable: false
} satisfies AgentTurnError;
const quotaError = {
  kind: "quotaExceeded",
  code: "quotaExceeded",
  message: "quota exceeded",
  recoverable: false
} satisfies AgentTurnError;

type EventWithoutTurnId<T> = T extends { turnId: string } ? Omit<T, "turnId"> : never;

function apply(
  state: AgentTurnLifecycleState,
  event: EventWithoutTurnId<AgentTurnEvent>
): AgentTurnLifecycleState {
  const result = reduceAgentTurnLifecycle(state, { ...event, turnId } as AgentTurnEvent);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function requesting(): AgentTurnLifecycleState {
  return apply(createAgentTurnLifecycleState(turnId), { type: "PREPARATION_COMPLETED" });
}

function startProviderRequest(
  state: AgentTurnLifecycleState,
  request: typeof request1 | typeof request2 = request1
): AgentTurnLifecycleState {
  return apply(state, { type: "PROVIDER_REQUEST_STARTED", ...request });
}

function withProviderOutput(): AgentTurnLifecycleState {
  let state = startProviderRequest(requesting());
  state = apply(state, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    ...request1,
    producedUserVisibleEffect: true
  });
  return apply(state, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    ...request1,
    status: "externallyCompleted"
  });
}

function withToolCallingOutput(producedUserVisibleEffect = false): AgentTurnLifecycleState {
  let state = startProviderRequest(requesting());
  state = apply(state, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    ...request1,
    producedUserVisibleEffect
  });
  return apply(state, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    ...request1,
    status: "awaitingNextRequest"
  });
}

function withContinuationToolOutput(state: AgentTurnLifecycleState): AgentTurnLifecycleState {
  let next = startProviderRequest(state, request2);
  next = apply(next, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    ...request2,
    producedUserVisibleEffect: false
  });
  return apply(next, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    ...request2,
    status: "awaitingNextRequest"
  });
}

function executed(
  callId: string,
  options: Partial<Extract<ToolCallTerminalResult, { status: "executed" }>> = {}
): ToolCallTerminalResult {
  return {
    status: "executed",
    callId,
    localEffect: "produced",
    persistence: "succeeded",
    unresolvedWorkIds: [],
    ...options
  };
}

function failed(callId: string): ToolCallTerminalResult {
  return { status: "failed", callId, error: terminalError };
}

function cancelled(callId: string): ToolCallTerminalResult {
  return { status: "cancelled", callId, reason: "user cancelled" };
}

function pending(callId: string): ToolCallTerminalResult {
  return {
    status: "pendingConfirmation",
    callId,
    confirmationId: `confirmation-${callId}`,
    unresolvedWorkIds: []
  };
}

function finalizeBatch(
  state: AgentTurnLifecycleState,
  declaredCallIds: readonly string[],
  results: readonly ToolCallTerminalResult[]
): AgentTurnLifecycleState {
  let next = apply(state, { type: "TOOL_BATCH_STARTED", declaredCallIds });
  for (const result of results) next = apply(next, { type: "TOOL_CALL_TERMINATED", result });
  return apply(next, { type: "TOOL_BATCH_FINALIZED" });
}

function finalizeTurn(state: AgentTurnLifecycleState): AgentTurnLifecycleState {
  return apply(state, { type: "TURN_FINALIZED" });
}

function outcome(state: AgentTurnLifecycleState): string {
  expect(state.phase).toBe("terminal");
  if (state.phase !== "terminal") throw new Error("expected terminal state");
  return state.outcome.kind;
}

describe("Agent Turn lifecycle foundations", () => {
  it("creates a Turn in the preparing phase with isolated initial facts", () => {
    const state = createAgentTurnLifecycleState(turnId);
    expect(state).toMatchObject({
      phase: "preparing",
      turnId,
      serverExecutionStatus: "created",
      externalRequest: { kind: "none", lastStepSequence: 0 },
      providerOutput: { kind: "none" },
      unresolvedWorkIds: [],
      fault: { kind: "none" }
    });
  });

  it("rejects an event that is illegal in the current phase", () => {
    const result = reduceAgentTurnLifecycle(createAgentTurnLifecycleState(turnId), {
      type: "TOOL_BATCH_FINALIZED",
      turnId
    });
    expect(result).toMatchObject({ ok: false, error: { code: "illegalTransition", recoverable: false } });
  });

  it("does not mutate the previous state", () => {
    const previous = createAgentTurnLifecycleState(turnId);
    const snapshot = structuredClone(previous);
    apply(previous, { type: "PREPARATION_COMPLETED" });
    expect(previous).toEqual(snapshot);
  });

  it("is deterministic for identical state and event inputs", () => {
    const state = startProviderRequest(requesting());
    const event = { type: "STREAM_ACTIVITY_OBSERVED", turnId, ...request1, sequence: 1 } as const;
    expect(reduceAgentTurnLifecycle(state, event)).toEqual(reduceAgentTurnLifecycle(state, event));
  });

  it("keeps terminal states absorbing", () => {
    const terminal = finalizeTurn(withProviderOutput());
    const result = reduceAgentTurnLifecycle(terminal, {
      type: "PROVIDER_REQUEST_STARTED",
      turnId,
      ...request2
    });
    expect(result).toMatchObject({ ok: false, error: { code: "illegalTransition" } });
  });
});

describe("Provider and display inputs", () => {
  it("completes a no-tool Provider answer", () => {
    expect(outcome(finalizeTurn(withProviderOutput()))).toBe("completed");
  });

  it("does not treat externallyCompleted as the overall local outcome", () => {
    let state = startProviderRequest(requesting());
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "externallyCompleted"
    });
    const result = reduceAgentTurnLifecycle(state, { type: "TURN_FINALIZED", turnId });
    expect(result).toMatchObject({ ok: false, error: { code: "insufficientTerminalFacts" } });
  });

  it("records an SSE display activity without deciding a terminal outcome", () => {
    const state = apply(startProviderRequest(requesting()), {
      type: "STREAM_ACTIVITY_OBSERVED",
      ...request1,
      sequence: 7
    });
    expect(state).toMatchObject({ phase: "requestingProvider", streamActivitySequence: 7 });
  });

  it("rejects regressing a terminal Server external status", () => {
    let state = startProviderRequest(requesting());
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "externallyCompleted"
    });
    const result = reduceAgentTurnLifecycle(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      turnId,
      ...request1,
      status: "providerRunning"
    });
    expect(result).toMatchObject({ ok: false, error: { code: "invalidServerStatusTransition" } });
  });

  it("preserves an earlier Provider effect across a textless Continuation and later failure", () => {
    let state = withToolCallingOutput(true);
    state = startProviderRequest(state, request2);
    state = apply(state, {
      type: "PROVIDER_OUTPUT_RECEIVED",
      ...request2,
      producedUserVisibleEffect: false
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request2,
      status: "externallyFailed"
    });
    expect(state.providerEffectProduced).toBe(true);
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });

  it.each([
    {
      label: "status",
      event: {
        type: "SERVER_EXECUTION_STATUS_OBSERVED",
        turnId,
        ...request1,
        status: "externallyFailed"
      } as const
    },
    {
      label: "output",
      event: {
        type: "PROVIDER_OUTPUT_RECEIVED",
        turnId,
        ...request1,
        producedUserVisibleEffect: true
      } as const
    },
    {
      label: "failure",
      event: {
        type: "EXTERNAL_ERROR_RECORDED",
        turnId,
        ...request1,
        faultId: "stale-provider-fault",
        error: retryableError
      } as const
    }
  ])("rejects a stale same-Turn Provider $label event from an earlier request", ({ event }) => {
    const state = startProviderRequest(withToolCallingOutput(), request2);
    const result = reduceAgentTurnLifecycle(state, event);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "externalRequestMismatch", recoverable: false }
    });
  });

  it("scopes SSE activity sequence to the active Provider request", () => {
    let state = apply(startProviderRequest(requesting()), {
      type: "STREAM_ACTIVITY_OBSERVED",
      ...request1,
      sequence: 9
    });
    state = apply(state, {
      type: "PROVIDER_OUTPUT_RECEIVED",
      ...request1,
      producedUserVisibleEffect: false
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "awaitingNextRequest"
    });
    state = startProviderRequest(state, request2);
    state = apply(state, {
      type: "STREAM_ACTIVITY_OBSERVED",
      ...request2,
      sequence: 1
    });
    expect(state.streamActivitySequence).toBe(1);
  });

  it("rejects an external error after that request already completed", () => {
    const state = withProviderOutput();
    expect(reduceAgentTurnLifecycle(state, {
      type: "EXTERNAL_ERROR_RECORDED",
      turnId,
      ...request1,
      faultId: "late-error",
      error: terminalError
    })).toMatchObject({
      ok: false,
      error: { code: "invalidServerStatusTransition" }
    });
  });
});

describe("Phase and Server status guards", () => {
  it.each(["externallyCompleted", "externallyCancelled", "externallyFailed"] as const)(
    "does not start a new Provider request after %s",
    (status) => {
      let state = startProviderRequest(requesting());
      state = apply(state, {
        type: "SERVER_EXECUTION_STATUS_OBSERVED",
        ...request1,
        status
      });
      expect(reduceAgentTurnLifecycle(state, {
        type: "PROVIDER_REQUEST_STARTED",
        turnId,
        ...request2
      })).toMatchObject({ ok: false, error: { code: "illegalTransition" } });
    }
  );

  it("starts a Continuation only from awaitingNextRequest with the next sequence", () => {
    const state = withToolCallingOutput();
    expect(startProviderRequest(state, request2)).toMatchObject({
      phase: "requestingProvider",
      serverExecutionStatus: "providerRunning",
      externalRequest: { kind: "active", ...request2 }
    });
    expect(reduceAgentTurnLifecycle(state, {
      type: "PROVIDER_REQUEST_STARTED",
      turnId,
      requestId: "request-gap",
      stepSequence: 3
    })).toMatchObject({ ok: false, error: { code: "illegalTransition" } });
  });

  it("does not start a Tool Batch after external execution is terminal", () => {
    let state = startProviderRequest(requesting());
    state = apply(state, {
      type: "PROVIDER_OUTPUT_RECEIVED",
      ...request1,
      producedUserVisibleEffect: false
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "externallyCompleted"
    });
    expect(reduceAgentTurnLifecycle(state, {
      type: "TOOL_BATCH_STARTED",
      turnId,
      declaredCallIds: ["a"]
    })).toMatchObject({ ok: false, error: { code: "illegalTransition" } });
  });

  it("does not start Compaction while Provider execution is running", () => {
    const state = startProviderRequest(requesting());
    expect(reduceAgentTurnLifecycle(state, {
      type: "COMPACTION_STARTED",
      turnId,
      mode: "automatic"
    })).toMatchObject({
      ok: false,
      error: { code: "invalidServerStatusTransition" }
    });
  });

  it("does not accept a terminal Server status while executing local Tools", () => {
    const state = apply(withToolCallingOutput(), {
      type: "TOOL_BATCH_STARTED",
      declaredCallIds: ["a"]
    });
    expect(reduceAgentTurnLifecycle(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      turnId,
      ...request1,
      status: "externallyCompleted"
    })).toMatchObject({
      ok: false,
      error: { code: "invalidServerStatusTransition" }
    });
  });
});

describe("Tool Batch aggregation", () => {
  it.each([
    ["empty batch", [], [], "completed"],
    ["one executed Call", ["a"], [executed("a")], "completed"],
    ["all executed Calls", ["a", "b"], [executed("a"), executed("b")], "completed"],
    ["executed and failed", ["a", "b"], [executed("a"), failed("b")], "partiallyCompleted"],
    ["all failed", ["a", "b"], [failed("a"), failed("b")], "failed"],
    ["one pending", ["a"], [pending("a")], "pendingConfirmation"],
    ["executed and pending", ["a", "b"], [executed("a"), pending("b")], "partiallyCompleted"],
    ["executed and cancelled", ["a", "b"], [executed("a"), cancelled("b")], "partiallyCompleted"],
    ["all cancelled", ["a", "b"], [cancelled("a"), cancelled("b")], "cancelled"],
    ["pending and failed", ["a", "b"], [pending("a"), failed("b")], "pendingConfirmation"]
  ] as const)("aggregates %s", (_label, declared, results, expected) => {
    const result = aggregateToolBatchOutcome(declared, results);
    expect(result).toMatchObject({ ok: true, outcome: { kind: expected } });
  });

  it("rejects duplicate declared Call IDs", () => {
    expect(aggregateToolBatchOutcome(["a", "a"], [executed("a")])).toMatchObject({
      ok: false,
      error: { code: "duplicateDeclaredCallId", callId: "a" }
    });
  });

  it("rejects a missing terminal result", () => {
    expect(aggregateToolBatchOutcome(["a", "b"], [executed("a")])).toMatchObject({
      ok: false,
      error: { code: "missingTerminalResult", callId: "b" }
    });
  });

  it("rejects an undeclared Call result", () => {
    expect(aggregateToolBatchOutcome(["a"], [executed("a"), executed("b")])).toMatchObject({
      ok: false,
      error: { code: "undeclaredCallId", callId: "b" }
    });
  });

  it("rejects duplicate submitted terminal results", () => {
    expect(aggregateToolBatchOutcome(["a"], [executed("a"), executed("a")])).toMatchObject({
      ok: false,
      error: { code: "duplicateTerminalResult", callId: "a" }
    });
  });

  it("allows an identical Call terminal event idempotently", () => {
    let state = apply(withToolCallingOutput(), { type: "TOOL_BATCH_STARTED", declaredCallIds: ["a"] });
    state = apply(state, { type: "TOOL_CALL_TERMINATED", result: executed("a") });
    const repeated = apply(state, { type: "TOOL_CALL_TERMINATED", result: executed("a") });
    expect(repeated).toEqual(state);
  });

  it("rejects conflicting terminal facts for the same Call", () => {
    let state = apply(withToolCallingOutput(), { type: "TOOL_BATCH_STARTED", declaredCallIds: ["a"] });
    state = apply(state, { type: "TOOL_CALL_TERMINATED", result: executed("a") });
    const result = reduceAgentTurnLifecycle(state, {
      type: "TOOL_CALL_TERMINATED",
      turnId,
      result: failed("a")
    });
    expect(result).toMatchObject({ ok: false, error: { code: "conflictingToolResult" } });
  });

  it("preserves earlier batch facts across a continuation batch", () => {
    let state = finalizeBatch(withToolCallingOutput(), ["a"], [executed("a")]);
    state = withContinuationToolOutput(state);
    state = finalizeBatch(state, ["b"], [failed("b")]);
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });

  it("rejects reuse of a terminal Call ID in a later batch", () => {
    let state = finalizeBatch(withToolCallingOutput(), ["a"], [executed("a")]);
    state = withContinuationToolOutput(state);
    const result = reduceAgentTurnLifecycle(state, {
      type: "TOOL_BATCH_STARTED",
      turnId,
      declaredCallIds: ["a"]
    });
    expect(result).toMatchObject({ ok: false, error: { code: "conflictingToolResult" } });
  });
});

describe("Overall Local Agent Turn Outcome", () => {
  it("keeps a successful tool effect when the Provider later fails", () => {
    let state = finalizeBatch(withToolCallingOutput(), ["a"], [executed("a")]);
    state = startProviderRequest(state, request2);
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request2,
      status: "externallyFailed"
    });
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });

  it("returns partiallyCompleted when cancellation follows success", () => {
    const state = finalizeBatch(withToolCallingOutput(), ["a"], [executed("a")]);
    const cancelling = apply(state, { type: "CANCELLATION_REQUESTED", reason: "stop" });
    expect(outcome(finalizeTurn(cancelling))).toBe("partiallyCompleted");
  });

  it("returns cancelled when cancellation follows no successful effect", () => {
    const cancelling = apply(requesting(), { type: "CANCELLATION_REQUESTED", reason: "stop" });
    expect(outcome(finalizeTurn(cancelling))).toBe("cancelled");
  });

  it("returns failed for a terminal fault without a successful effect", () => {
    const state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: terminalError
    });
    expect(outcome(finalizeTurn(state))).toBe("failed");
  });

  it("returns partiallyCompleted when successful work remains unresolved", () => {
    let state = withProviderOutput();
    state = apply(state, { type: "UNRESOLVED_WORK_RECORDED", workId: "work-1" });
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });

  it("returns pendingConfirmation only while a real pending Call exists", () => {
    let state = finalizeBatch(withToolCallingOutput(true), ["a"], [pending("a")]);
    expect(state).toMatchObject({ phase: "awaitingConfirmation" });
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");

    state = finalizeBatch(withToolCallingOutput(), ["a"], [pending("a")]);
    expect(outcome(finalizeTurn(state))).toBe("pendingConfirmation");
  });

  it("ends the current Turn at Pending and requires later execution to use a new Turn", () => {
    const pendingTurn = finalizeTurn(
      finalizeBatch(withToolCallingOutput(), ["a"], [pending("a")])
    );
    expect(outcome(pendingTurn)).toBe("pendingConfirmation");
    expect(createAgentTurnLifecycleState("confirmation-execution-turn")).toMatchObject({
      phase: "preparing",
      confirmation: { kind: "none" },
      toolBatches: []
    });
    expect(reduceAgentTurnLifecycle(pendingTurn, {
      type: "PROVIDER_REQUEST_STARTED",
      turnId,
      ...request2
    })).toMatchObject({ ok: false, error: { code: "illegalTransition" } });
  });

  it("lets a local persistence failure make a successful Turn partial", () => {
    let state = apply(withProviderOutput(), { type: "LOCAL_PERSISTENCE_REQUIRED" });
    state = apply(state, {
      type: "LOCAL_PERSISTENCE_FAILED",
      faultId: fault1,
      error: terminalError
    });
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });

  it("does not let external completion override a local Tool failure", () => {
    let state = finalizeBatch(withToolCallingOutput(), ["a"], [failed("a")]);
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "externallyCompleted"
    });
    expect(outcome(finalizeTurn(state))).toBe("failed");
  });

  it("waits for running external execution to stop before finalizing cancellation", () => {
    let state = startProviderRequest(requesting());
    state = apply(state, { type: "CANCELLATION_REQUESTED", reason: "stop" });
    expect(reduceAgentTurnLifecycle(state, { type: "TURN_FINALIZED", turnId })).toMatchObject({
      ok: false,
      error: { code: "insufficientTerminalFacts" }
    });
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request1,
      status: "externallyCancelled"
    });
    expect(outcome(finalizeTurn(state))).toBe("cancelled");
  });

  it("does not let external failure erase a successful local effect", () => {
    let state = finalizeBatch(withToolCallingOutput(), ["a"], [executed("a")]);
    state = startProviderRequest(state, request2);
    state = apply(state, {
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      ...request2,
      status: "externallyFailed"
    });
    const terminal = finalizeTurn(state);
    expect(terminal).toMatchObject({
      phase: "terminal",
      outcome: { kind: "partiallyCompleted", reasons: ["externalExecutionFailed"] }
    });
  });

  it("propagates a Tool-local persistence failure into partial completion", () => {
    const state = finalizeBatch(
      withToolCallingOutput(),
      ["a"],
      [executed("a", { persistence: "failed" })]
    );
    expect(outcome(finalizeTurn(state))).toBe("partiallyCompleted");
  });
});

describe("Error and recovery boundaries", () => {
  it("encodes recoverability in the error discriminant", () => {
    expect(retryableError.recoverable).toBe(true);
    expect([terminalError, conflictError, quotaError].every((error) => !error.recoverable)).toBe(true);
  });

  it("allows only retryable errors to enter recovering", () => {
    let retryable = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: retryableError
    });
    retryable = apply(retryable, { type: "RECOVERY_STARTED", faultId: fault1 });
    expect(retryable).toMatchObject({ phase: "recovering", error: { kind: "retryable" } });

    const conflicted = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: conflictError
    });
    expect(reduceAgentTurnLifecycle(conflicted, {
      type: "RECOVERY_STARTED",
      turnId,
      faultId: fault1
    })).toMatchObject({
      ok: false,
      error: { code: "invalidEvent", recoverable: false }
    });
  });

  it("does not classify quotaExceeded as ordinary retryable", () => {
    const state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: quotaError
    });
    expect(reduceAgentTurnLifecycle(state, {
      type: "RECOVERY_STARTED",
      turnId,
      faultId: fault1
    })).toMatchObject({
      ok: false,
      error: { code: "invalidEvent" }
    });
  });

  it("clears a retryable fault only through explicit recovery resolution", () => {
    let state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: retryableError
    });
    state = apply(state, { type: "RECOVERY_STARTED", faultId: fault1 });
    state = apply(state, { type: "RECOVERY_RESOLVED", faultId: fault1 });
    expect(state).toMatchObject({ phase: "requestingProvider", fault: { kind: "none" } });
  });

  it("does not let a later retryable fault overwrite an unresolved terminal fault", () => {
    const state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: "terminal-fault",
      error: terminalError
    });
    const result = reduceAgentTurnLifecycle(state, {
      type: "ERROR_RECORDED",
      turnId,
      faultId: "retryable-fault",
      error: retryableError
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unresolvedFaultConflict", recoverable: false }
    });
    expect(state.fault).toMatchObject({
      kind: "present",
      faultId: "terminal-fault",
      error: { kind: "terminal" }
    });
  });

  it("accepts only an identical repeated fault fact idempotently", () => {
    const state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: retryableError
    });
    const repeated = apply(state, {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: retryableError
    });
    expect(repeated).toEqual(state);
    expect(reduceAgentTurnLifecycle(state, {
      type: "ERROR_RECORDED",
      turnId,
      faultId: fault1,
      error: terminalError
    })).toMatchObject({ ok: false, error: { code: "unresolvedFaultConflict" } });
  });

  it("resolves only the matching retryable Fault ID", () => {
    let state = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: retryableError
    });
    state = apply(state, { type: "RECOVERY_STARTED", faultId: fault1 });
    expect(reduceAgentTurnLifecycle(state, {
      type: "RECOVERY_RESOLVED",
      turnId,
      faultId: "other-fault"
    })).toMatchObject({ ok: false, error: { code: "unresolvedFaultConflict" } });
    state = apply(state, { type: "RECOVERY_RESOLVED", faultId: fault1 });
    expect(state.fault).toEqual({ kind: "none" });
  });

  it("rejects cancelled errors from the generic fault channel", () => {
    const result = reduceAgentTurnLifecycle(requesting(), {
      type: "ERROR_RECORDED",
      turnId,
      faultId: "cancelled-fault",
      error: {
        kind: "cancelled",
        code: "userCancelled",
        message: "cancelled",
        recoverable: false
      }
    } as unknown as AgentTurnEvent);
    expect(result).toMatchObject({ ok: false, error: { code: "invalidEvent" } });
  });

  it("rejects stale same-Turn external failures by request identity", () => {
    const state = startProviderRequest(withToolCallingOutput(), request2);
    const result = reduceAgentTurnLifecycle(state, {
      type: "EXTERNAL_ERROR_RECORDED",
      turnId,
      ...request1,
      faultId: "old-attempt-failure",
      error: retryableError
    });
    expect(result).toMatchObject({ ok: false, error: { code: "externalRequestMismatch" } });
    expect(state.fault).toEqual({ kind: "none" });
  });

  it("does not inherit failure state into a new Turn", () => {
    const failedTurn = apply(requesting(), {
      type: "ERROR_RECORDED",
      faultId: fault1,
      error: terminalError
    });
    expect(failedTurn.fault.kind).toBe("present");
    expect(createAgentTurnLifecycleState("turn-2").fault).toEqual({ kind: "none" });
  });

  it("rejects a stale Provider failure event for another Turn", () => {
    const result = reduceAgentTurnLifecycle(requesting(), {
      type: "ERROR_RECORDED",
      turnId: "stale-turn",
      faultId: fault1,
      error: terminalError
    });
    expect(result).toMatchObject({ ok: false, error: { code: "turnMismatch" } });
  });
});

describe("Compaction lifecycle semantics", () => {
  it("enters compacting with an explicit resume phase", () => {
    const state = apply(requesting(), { type: "COMPACTION_STARTED", mode: "automatic" });
    expect(state).toMatchObject({
      phase: "compacting",
      mode: "automatic",
      resumePhase: "requestingProvider"
    });
  });

  it("returns to the captured phase after successful compaction", () => {
    let state = apply(requesting(), { type: "COMPACTION_STARTED", mode: "preContinuation" });
    state = apply(state, { type: "COMPACTION_COMPLETED" });
    expect(state.phase).toBe("requestingProvider");
  });

  it("does not fabricate compaction success after a retryable failure", () => {
    let state = apply(requesting(), { type: "COMPACTION_STARTED", mode: "automatic" });
    state = apply(state, {
      type: "COMPACTION_FAILED",
      faultId: fault1,
      error: retryableError
    });
    expect(state).toMatchObject({ phase: "recovering", fault: { kind: "present" } });
  });

  it("makes compaction cancellation terminal and never completed", () => {
    let state = apply(requesting(), { type: "COMPACTION_STARTED", mode: "manual" });
    state = apply(state, { type: "COMPACTION_CANCELLED", reason: "user cancelled compaction" });
    expect(outcome(state)).toBe("cancelled");
  });

  it.each(["automatic", "preContinuation", "manual"] as const)(
    "uses the same compacting vocabulary for %s compaction",
    (mode) => {
      const state = apply(requesting(), { type: "COMPACTION_STARTED", mode });
      expect(state).toMatchObject({ phase: "compacting", mode });
    }
  );

  it("makes a terminal compaction failure failed rather than completed", () => {
    let state = apply(requesting(), { type: "COMPACTION_STARTED", mode: "automatic" });
    state = apply(state, {
      type: "COMPACTION_FAILED",
      faultId: fault1,
      error: terminalError
    });
    expect(outcome(state)).toBe("failed");
  });
});
