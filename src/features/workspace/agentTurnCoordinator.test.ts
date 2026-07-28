import { describe, expect, it, vi } from "vitest";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import type {
  APlusAgentProviderRequest,
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent,
  ServerExternalExecutionStatus
} from "@/shared/agentTurnJournalProtocol";
import { resolveCanonicalAgentRuntimeItem } from "@/shared/agentRuntimeItem";
import {
  reduceAgentTurnLifecycle,
  type AgentTurnEvent
} from "./agentTurnLifecycle";
import {
  AgentTurnCoordinator,
  type AgentTurnCoordinatorExecutionHandshake,
  type AgentTurnCoordinatorHost,
  type AgentTurnCoordinatorTransportResult
} from "./agentTurnCoordinator";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ AgentTurnCoordinator", () => {
  it("creates the lifecycle from the Server Turn ID and completes preparation through the reducer", async () => {
    const host = new FakeHost();
    const coordinator = createCoordinator(host, ["request-1"]);
    const result = await coordinator.initialize();
    expect(result).toMatchObject({
      status: "ok",
      lifecycle: { turnId: TURN_ID, phase: "requestingProvider", serverExecutionStatus: "created" }
    });
    expect(host.createServerTurn).toHaveBeenCalledWith({
      localProjectId: "project-a",
      creationIdempotencyKey: "creation-a"
    });
  });

  it("uses Sequence 1 for the first Provider request", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    const result = await coordinator.startInitialRequest(providerRequest());
    expect(result).toMatchObject({ status: "ok", requestId: "request-1", stepSequence: 1 });
    expect(host.executions[0]).toMatchObject({ requestId: "request-1", stepSequence: 1 });
  });

  it("increments Sequence strictly for a Continuation", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: true, toolCallIds: ["call-a"] });
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-2"]);
    await coordinator.startInitialRequest(providerRequest());
    const result = await coordinator.startContinuation(providerRequest("tool continuation"));
    expect(result).toMatchObject({ status: "ok", requestId: "request-2", stepSequence: 2 });
    expect(host.executions.map(({ requestId, stepSequence }) => [requestId, stepSequence])).toEqual([
      ["request-1", 1],
      ["request-2", 2]
    ]);
  });

  it("rejects a second active request while one transport is still running", async () => {
    const host = new FakeHost();
    const completion = createDeferred<AgentTurnCoordinatorTransportResult>();
    host.queueHandshake({ status: "started", complete: () => completion.promise });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-2"]);
    const first = coordinator.startInitialRequest(providerRequest());
    const second = await coordinator.startInitialRequest(providerRequest("second"));
    expect(second).toMatchObject({ status: "denied", code: "request_in_flight" });
    completion.resolve({ status: "interrupted", code: "network" });
    await first;
  });

  it("reuses the same Request ID, Sequence and request content for retry", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    host.queueHandshake({ status: "replayed" });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-never-used"]);
    await coordinator.startInitialRequest(providerRequest("same body"));
    await coordinator.retryActiveRequest();
    expect(host.executions).toHaveLength(2);
    expect(host.executions[1]).toEqual(host.executions[0]);
  });

  it("marks an unobserved Request recoverable and retries the same identity", async () => {
    const host = new FakeHost();
    host.queueTransportFailure();
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-never-used"]);

    await expect(coordinator.startInitialRequest(providerRequest("same body"))).resolves.toMatchObject({
      status: "denied",
      code: "request_not_observed",
      recoverable: true
    });
    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "ok",
      requestId: "request-1",
      stepSequence: 1,
      lifecycle: { phase: "terminal", outcome: { kind: "completed" } }
    });
    expect(host.executions).toHaveLength(2);
    expect(host.executions.map(({ requestId, stepSequence }) => [requestId, stepSequence])).toEqual([
      ["request-1", 1],
      ["request-1", 1]
    ]);
    expect(host.externalExecutionCount).toBe(1);
  });

  it("uses a fresh Request ID for a new Continuation", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: true, toolCallIds: ["call-a"] });
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-2"]);
    await coordinator.startInitialRequest(providerRequest());
    await coordinator.startContinuation(providerRequest("next"));
    expect(host.executions[0]?.requestId).toBe("request-1");
    expect(host.executions[1]?.requestId).toBe("request-2");
  });

  it("routes every lifecycle state change through the Stage 1 reducer", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true, activity: true });
    const events: AgentTurnEvent[] = [];
    const coordinator = createCoordinator(host, ["request-1"], (state, event) => {
      events.push(event);
      return reduceAgentTurnLifecycle(state, event);
    });
    await coordinator.initialize();
    await coordinator.startInitialRequest(providerRequest());
    expect(events.map((event) => event.type)).toEqual([
      "PREPARATION_COMPLETED",
      "PROVIDER_REQUEST_STARTED",
      "STREAM_ACTIVITY_OBSERVED",
      "PROVIDER_OUTPUT_RECEIVED",
      "SERVER_EXECUTION_STATUS_OBSERVED",
      "TURN_FINALIZED"
    ]);
  });

  it("has no public Overall Outcome setter and derives completion in the reducer", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect("setOverallOutcome" in coordinator).toBe(false);
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "completed" }
    });
  });

  it("rejects a stale Request SSE event without mutating the new Request", async () => {
    const host = new FakeHost();
    const displayEvents: AgentTurnRequestStreamEvent[] = [];
    host.queueStarted({ status: "awaitingNextRequest", output: true, toolCallIds: ["call-a"] });
    const secondCompletion = createDeferred<AgentTurnCoordinatorTransportResult>();
    host.queueHandshake({ status: "started", complete: () => secondCompletion.promise });
    const coordinator = await initializedCoordinator(
      host,
      ["request-1", "request-2"],
      (event) => displayEvents.push(event)
    );
    await coordinator.startInitialRequest(providerRequest());
    const second = coordinator.startContinuation(providerRequest("next"));
    await waitFor(() => coordinator.getLifecycleSnapshot()?.externalRequest.kind === "active");
    const before = coordinator.getLifecycleSnapshot();
    host.emit("request-1", {
      type: "streamActivity",
      requestId: "request-1",
      stepSequence: 1,
      sequence: 99,
      event: { type: "final-delta", delta: "stale" }
    });
    expect(coordinator.getLifecycleSnapshot()).toEqual(before);
    expect(displayEvents).toHaveLength(2);
    secondCompletion.resolve({ status: "interrupted", code: "stop" });
    await second;
  });

  it("forwards validated text, Tool Call IDs and process events exactly once", async () => {
    const host = new FakeHost();
    const displayEvents: AgentTurnRequestStreamEvent[] = [];
    host.queueStarted({
      status: "awaitingNextRequest",
      output: true,
      toolCallIds: ["call-a", "call-b"],
      activity: true
    });
    const coordinator = await initializedCoordinator(
      host,
      ["request-1"],
      (event) => displayEvents.push(event)
    );
    await coordinator.startInitialRequest(providerRequest());
    expect(displayEvents.filter((event) => event.type === "streamActivity")).toHaveLength(1);
    expect(displayEvents.filter((event) => event.type === "providerOutput")).toEqual([
      expect.objectContaining({
        outputText: "visible output",
        toolCallIds: ["call-a", "call-b"]
      })
    ]);
    expect(displayEvents.filter((event) => event.type === "serverStatus")).toHaveLength(1);
  });

  it("keeps pre-interruption display output local and immutable", async () => {
    const host = new FakeHost();
    const displayEvents: AgentTurnRequestStreamEvent[] = [];
    let mutationSucceeded = true;
    host.queueStarted({ status: "externallyCompleted", output: true, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"], (event) => {
      mutationSucceeded = Reflect.set(event, "requestId", "mutated");
      displayEvents.push(event);
    });
    await coordinator.startInitialRequest(providerRequest());
    expect(mutationSucceeded).toBe(false);
    expect(displayEvents).toContainEqual(expect.objectContaining({
      type: "providerOutput",
      outputText: "visible output",
      requestId: "request-1"
    }));
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "completed" }
    });
  });

  it("rejects a stale Query result after a newer Request starts", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: true, toolCallIds: ["call-a"] });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-2"]);
    await coordinator.startInitialRequest(providerRequest());

    const staleQuery = createDeferred<AgentTurnJournalSnapshot>();
    host.queryOverride = () => staleQuery.promise;
    const recovery = coordinator.recoverServerExecutionStatus();
    const secondCompletion = createDeferred<AgentTurnCoordinatorTransportResult>();
    host.queueHandshake({ status: "started", complete: () => secondCompletion.promise });
    const second = coordinator.startContinuation(providerRequest("next"));
    await waitFor(() => coordinator.getLifecycleSnapshot()?.externalRequest.kind === "active");
    const duringSecond = coordinator.getLifecycleSnapshot();
    staleQuery.resolve(snapshot({
      status: "awaitingNextRequest",
      latestRequestId: "request-1",
      latestStepSequence: 1
    }));
    await expect(recovery).resolves.toMatchObject({ status: "denied", code: "stale_query_result" });
    expect(coordinator.getLifecycleSnapshot()).toEqual(duringSecond);
    host.queryOverride = undefined;
    secondCompletion.resolve({ status: "interrupted", code: "stop" });
    await second;
  });

  it("completes a normal Provider answer with no Tool Calls", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      serverExecutionStatus: "externallyCompleted",
      outcome: { kind: "completed" }
    });
  });

  it("keeps a Provider Tool Call at awaitingNextRequest", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: false, toolCallIds: ["call-a"] });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "continuing",
      serverExecutionStatus: "awaitingNextRequest"
    });
  });

  it("does not execute local Tools in Stage 2", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: false, toolCallIds: ["call-a"] });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(Object.keys(host)).not.toContain("executeTool");
    expect(coordinator.getLifecycleSnapshot()?.phase).toBe("continuing");
  });

  it("queries the Journal when the final SSE frame is missing", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(host.queryServerTurn).toHaveBeenCalledTimes(1);
  });

  it("recovers completion when local Provider output already exists", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "completed" }
    });
  });

  it("does not fabricate success when Journal completed without local output", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: false, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: {
        kind: "failed",
        reasons: ["externalExecutionCompletedWithoutUsableOutcome"]
      }
    });
  });

  it("terminates without replay when awaitingNextRequest payload was lost", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "awaitingNextRequest", output: false, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      providerOutput: { kind: "none" },
      outcome: {
        kind: "failed",
        reasons: ["providerContinuationPayloadUnavailable"]
      }
    });
    expect(host.executions).toHaveLength(1);
    expect(host.externalExecutionCount).toBe(1);
  });

  it("keeps a providerRunning Journal recovery non-terminal", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "requestingProvider",
      serverExecutionStatus: "providerRunning"
    });
  });

  it("keeps partial completion when Journal failed after local Provider output", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyFailed", output: true, finalFrameReceived: false });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      outcome: { kind: "partiallyCompleted" }
    });
  });

  it("retries transport without creating a second external execution", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    host.queueHandshake({ status: "replayed" });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    await coordinator.retryActiveRequest();
    expect(host.externalExecutionCount).toBe(1);
    expect(host.executions).toHaveLength(2);
  });

  it.each([
    ["quota_exceeded", "quotaExceeded", false],
    ["provider_limit", "quotaExceeded", false],
    ["sequence_conflict", "conflict", false],
    ["provider_unavailable", "terminal", false]
  ] as const)("classifies %s as %s", async (code, kind, recoverable) => {
    const host = new FakeHost();
    host.queueHandshake({ status: "denied", code, error: code, recoverable });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    const result = await coordinator.startInitialRequest(providerRequest());
    expect(result).toMatchObject({ status: "denied", code, recoverable });
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "terminal",
      fault: { kind: "present", error: { kind, code } }
    });
  });

  it("keeps a temporary Journal denial retryable and reuses the same Request", async () => {
    const host = new FakeHost();
    host.queueHandshake({
      status: "denied",
      code: "journal_unavailable",
      error: "temporary",
      recoverable: true
    });
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-never-used"]);
    await expect(coordinator.startInitialRequest(providerRequest())).resolves.toMatchObject({
      status: "denied",
      code: "journal_unavailable",
      recoverable: true,
      lifecycle: { phase: "recovering", fault: { error: { kind: "retryable" } } }
    });
    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "ok",
      lifecycle: { phase: "terminal", outcome: { kind: "completed" } }
    });
    expect(host.executions.map(({ requestId, stepSequence }) => [requestId, stepSequence])).toEqual([
      ["request-1", 1],
      ["request-1", 1]
    ]);
  });

  it("reconciles a non-retryable denial after execution started without rerunning Provider", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    host.queueHandshake({
      status: "denied",
      code: "request_id_conflict",
      error: "server contract changed",
      recoverable: false
    });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    host.queryOverride = async () => snapshot({
      status: "externallyFailed",
      latestRequestId: "request-1",
      latestStepSequence: 1,
      terminalAt: "2026-07-29T01:03:00.000Z",
      failureCode: "external_execution_state_unknown"
    });

    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "ok",
      lifecycle: {
        phase: "terminal",
        fault: { kind: "none" },
        outcome: { kind: "failed" }
      }
    });
    expect(host.executions).toHaveLength(2);
    expect(host.externalExecutionCount).toBe(1);
    expect(host.queryServerTurn).toHaveBeenCalledTimes(2);
  });

  it("keeps a non-retryable denial query-only while Journal still reports providerRunning", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    host.queueHandshake({
      status: "denied",
      code: "request_id_conflict",
      error: "server contract changed",
      recoverable: false
    });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());

    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "denied",
      code: "external_execution_pending_reconciliation",
      recoverable: true,
      lifecycle: {
        phase: "requestingProvider",
        serverExecutionStatus: "providerRunning",
        fault: { kind: "none" }
      }
    });
    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "denied",
      code: "request_in_flight",
      recoverable: false
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "denied",
      code: "external_execution_pending_reconciliation",
      recoverable: true
    });
    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "denied",
      code: "request_in_flight"
    });
    expect(host.executions).toHaveLength(2);
    expect(host.externalExecutionCount).toBe(1);
    expect(host.queryServerTurn).toHaveBeenCalledTimes(3);
  });

  it("continues cleanly when retry denial reconciles to awaitingNextRequest with local output", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: true, interrupted: true });
    host.queueHandshake({
      status: "denied",
      code: "request_id_conflict",
      error: "server contract changed",
      recoverable: false
    });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    await coordinator.startInitialRequest(providerRequest());
    host.queryOverride = async () => snapshot({
      status: "awaitingNextRequest",
      latestRequestId: "request-1",
      latestStepSequence: 1
    });

    await expect(coordinator.retryActiveRequest()).resolves.toMatchObject({
      status: "ok",
      lifecycle: {
        phase: "continuing",
        serverExecutionStatus: "awaitingNextRequest",
        providerOutput: { kind: "received" },
        fault: { kind: "none" }
      }
    });
    expect(host.executions).toHaveLength(2);
    expect(host.externalExecutionCount).toBe(1);
  });

  it("blocks unresolved Faults before a Continuation reaches the Host", async () => {
    const host = new FakeHost();
    const completion = createDeferred<AgentTurnCoordinatorTransportResult>();
    host.queueHandshake({ status: "started", complete: () => completion.promise });
    const coordinator = await initializedCoordinator(host, ["request-1", "request-2"]);
    const first = coordinator.startInitialRequest(providerRequest());
    await waitFor(() => host.executions.length === 1);
    host.emit("request-1", {
      type: "providerOutput",
      requestId: "request-1",
      stepSequence: 1,
      outputText: "visible output",
      producedUserVisibleEffect: true,
      toolCallIds: ["call-a"]
    });
    host.emit("request-1", {
      type: "externalError",
      requestId: "request-1",
      stepSequence: 1,
      code: "provider_contract_invalid"
    });
    host.emit("request-1", {
      type: "serverStatus",
      requestId: "request-1",
      stepSequence: 1,
      status: "awaitingNextRequest"
    });
    completion.resolve({ status: "ended", finalFrameReceived: true });
    await first;
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      phase: "continuing",
      serverExecutionStatus: "awaitingNextRequest",
      fault: { kind: "present" }
    });

    await expect(coordinator.startContinuation(providerRequest("next"))).resolves.toMatchObject({
      status: "denied",
      code: "unresolvedFaultConflict"
    });
    expect(host.executeExternalRequest).toHaveBeenCalledTimes(1);
  });

  it("resolves Recovery before interpreting a providerRunning Journal query", async () => {
    const { coordinator, host } = await recoveringCoordinator(false);
    host.queryOverride = async () => snapshot({
      status: "providerRunning",
      latestRequestId: "request-1",
      latestStepSequence: 1
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "ok",
      lifecycle: { phase: "requestingProvider", serverExecutionStatus: "providerRunning", fault: { kind: "none" } }
    });
    expect(host.externalExecutionCount).toBe(1);
  });

  it("resolves Recovery before accepting awaitingNextRequest with local output", async () => {
    const { coordinator, host } = await recoveringCoordinator(true);
    host.queryOverride = async () => snapshot({
      status: "awaitingNextRequest",
      latestRequestId: "request-1",
      latestStepSequence: 1
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "ok",
      lifecycle: {
        phase: "continuing",
        serverExecutionStatus: "awaitingNextRequest",
        providerOutput: { kind: "received" },
        fault: { kind: "none" }
      }
    });
    expect(host.externalExecutionCount).toBe(1);
  });

  it("resolves Recovery before terminating an unavailable awaitingNextRequest payload", async () => {
    const { coordinator, host } = await recoveringCoordinator(false);
    host.queryOverride = async () => snapshot({
      status: "awaitingNextRequest",
      latestRequestId: "request-1",
      latestStepSequence: 1
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "ok",
      lifecycle: {
        phase: "terminal",
        outcome: { kind: "failed", reasons: ["providerContinuationPayloadUnavailable"] }
      }
    });
    expect(host.externalExecutionCount).toBe(1);
  });

  it.each([
    ["externallyCompleted", "completed"],
    ["externallyCancelled", "partiallyCompleted"],
    ["externallyFailed", "partiallyCompleted"]
  ] as const)("resolves Recovery before finalizing %s", async (status, outcomeKind) => {
    const { coordinator, host } = await recoveringCoordinator(true);
    host.queryOverride = async () => snapshot({
      status,
      latestRequestId: "request-1",
      latestStepSequence: 1,
      terminalAt: "2026-07-29T01:03:00.000Z",
      ...(status === "externallyFailed" ? { failureCode: "provider_failed" } : {})
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "ok",
      lifecycle: { phase: "terminal", serverExecutionStatus: status, outcome: { kind: outcomeKind } }
    });
    expect(host.externalExecutionCount).toBe(1);
  });

  it("keeps Journal query failure recoverable and resumes by query without rerunning Provider", async () => {
    const host = new FakeHost();
    let queryAttempt = 0;
    host.queryOverride = async () => {
      queryAttempt += 1;
      if (queryAttempt === 1) throw new Error("temporary Journal outage");
      return snapshot({
        status: "externallyFailed",
        latestRequestId: "request-1",
        latestStepSequence: 1,
        terminalAt: "2026-07-29T01:03:00.000Z",
        failureCode: "external_execution_state_unknown"
      });
    };
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);

    await expect(coordinator.startInitialRequest(providerRequest())).resolves.toMatchObject({
      status: "denied",
      code: "journal_query_failed",
      recoverable: true,
      lifecycle: { phase: "requestingProvider", serverExecutionStatus: "providerRunning" }
    });
    await expect(coordinator.recoverServerExecutionStatus()).resolves.toMatchObject({
      status: "ok",
      lifecycle: { phase: "terminal", outcome: { kind: "failed" } }
    });
    expect(host.executions).toHaveLength(1);
    expect(host.externalExecutionCount).toBe(1);
    expect(host.queryServerTurn).toHaveBeenCalledTimes(2);
  });

  it("fails deterministically on a Journal Turn/Project binding mismatch", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "providerRunning", output: false, interrupted: true });
    host.queryOverride = async () => snapshot({ localProjectId: "project-other" });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    const result = await coordinator.startInitialRequest(providerRequest());
    expect(result).toMatchObject({ status: "denied", code: "server_turn_binding_mismatch" });
    expect(coordinator.getLifecycleSnapshot()).toMatchObject({
      fault: { kind: "present", error: { kind: "conflict" } }
    });
  });

  it("uploads only the bounded Provider request contract", async () => {
    const host = new FakeHost();
    host.queueStarted({ status: "externallyCompleted", output: true });
    const coordinator = await initializedCoordinator(host, ["request-1"]);
    const previousRuntimeItem = resolveCanonicalAgentRuntimeItem({
      projectId: "project-a",
      mode: "auto",
      effectiveToolProfile: "standard",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION
    });
    const unsafe = {
      ...providerRequest(),
      previousRuntimeItem: {
        ...previousRuntimeItem,
        workspace: { secret: "nested-workspace" },
        toolResult: { secret: "nested-tool" }
      },
      workspace: { secret: "workspace" },
      toolResult: { secret: "tool" },
      memory: { secret: "memory" },
      summary: { secret: "summary" }
    } as unknown as APlusAgentProviderRequest & Record<string, unknown>;
    await coordinator.startInitialRequest(unsafe);
    const sent = host.executions[0]?.providerRequest;
    expect(Object.keys(sent ?? {}).sort()).toEqual([
      "capabilityIntent",
      "input",
      "mode",
      "previousRuntimeItem",
      "promptContractVersion"
    ]);
    expect(Object.keys(sent?.previousRuntimeItem ?? {}).sort()).toEqual([
      "contentHash",
      "effectiveToolProfile",
      "id",
      "mode",
      "placement",
      "promptContractVersion",
      "renderedText",
      "sequence"
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/workspace|toolResult|"memory"|"summary"/i);
  });

  it("starts a new Turn without inheriting the previous Turn Fault", async () => {
    const failedHost = new FakeHost();
    failedHost.queueHandshake({
      status: "denied",
      code: "sequence_conflict",
      error: "conflict",
      recoverable: false
    });
    const failed = await initializedCoordinator(failedHost, ["request-1"]);
    await failed.startInitialRequest(providerRequest());
    expect(failed.getLifecycleSnapshot()).toMatchObject({ phase: "terminal", fault: { kind: "present" } });

    const cleanHost = new FakeHost();
    const clean = await initializedCoordinator(cleanHost, ["request-2"]);
    expect(clean.getLifecycleSnapshot()).toMatchObject({
      phase: "requestingProvider",
      fault: { kind: "none" }
    });
  });
});

class FakeHost implements AgentTurnCoordinatorHost {
  snapshot = snapshot();
  readonly createServerTurn = vi.fn(async () => ({ snapshot: this.snapshot, replayed: false }));
  readonly queryServerTurn = vi.fn(async () =>
    this.queryOverride ? this.queryOverride() : this.snapshot
  );
  readonly executions: Array<{
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    providerRequest: APlusAgentProviderRequest;
  }> = [];
  externalExecutionCount = 0;
  queryOverride: (() => Promise<AgentTurnJournalSnapshot>) | undefined;
  private readonly handshakes: Array<
    | AgentTurnCoordinatorExecutionHandshake
    | ((input: FakeHost["executions"][number], observer: (event: AgentTurnRequestStreamEvent) => void) => AgentTurnCoordinatorExecutionHandshake)
  > = [];
  private readonly observers = new Map<string, (event: AgentTurnRequestStreamEvent) => void>();

  readonly executeExternalRequest = vi.fn(async (
    input: FakeHost["executions"][number],
    observer: (event: AgentTurnRequestStreamEvent) => void
  ): Promise<AgentTurnCoordinatorExecutionHandshake> => {
    const copied = structuredClone(input);
    this.executions.push(copied);
    this.observers.set(input.requestId, observer);
    const planned = this.handshakes.shift();
    if (!planned) throw new Error("No Fake Host execution plan.");
    const handshake = typeof planned === "function" ? planned(input, observer) : planned;
    if (handshake.status === "started") this.externalExecutionCount += 1;
    return handshake;
  });

  queueHandshake(handshake: AgentTurnCoordinatorExecutionHandshake): void {
    this.handshakes.push(handshake);
  }

  queueTransportFailure(): void {
    this.handshakes.push(() => {
      throw new Error("transport failed before Journal observed the Request");
    });
  }

  queueStarted(options: {
    status: Exclude<ServerExternalExecutionStatus, "created">;
    output: boolean;
    toolCallIds?: readonly string[];
    activity?: boolean;
    finalFrameReceived?: boolean;
    interrupted?: boolean;
  }): void {
    this.handshakes.push((input, observer) => ({
      status: "started",
      complete: () => new Promise<AgentTurnCoordinatorTransportResult>((resolvePromise) => {
        setTimeout(() => {
          if (options.activity) {
            observer({
              type: "streamActivity",
              requestId: input.requestId,
              stepSequence: input.stepSequence,
              sequence: 1,
              event: { type: "final-delta", delta: "visible" }
            });
          }
          if (options.output) {
            observer({
              type: "providerOutput",
              requestId: input.requestId,
              stepSequence: input.stepSequence,
              outputText: "visible output",
              producedUserVisibleEffect: true,
              toolCallIds: options.toolCallIds ?? []
            });
          } else if ((options.toolCallIds?.length ?? 0) > 0) {
            observer({
              type: "providerOutput",
              requestId: input.requestId,
              stepSequence: input.stepSequence,
              outputText: "",
              producedUserVisibleEffect: false,
              toolCallIds: options.toolCallIds ?? []
            });
          }
          this.snapshot = snapshot({
            status: options.status,
            latestRequestId: input.requestId,
            latestStepSequence: input.stepSequence,
            counters: { provider: input.stepSequence, webSearch: 0, image: 0 },
            terminalAt: options.status.startsWith("externally")
              ? "2026-07-29T01:02:00.000Z"
              : null,
            ...(options.status === "externallyFailed" ? { failureCode: "provider_failed" } : {})
          });
          if (options.finalFrameReceived !== false && options.status !== "providerRunning") {
            observer({
              type: "serverStatus",
              requestId: input.requestId,
              stepSequence: input.stepSequence,
              status: options.status
            });
          }
          resolvePromise(options.interrupted
            ? { status: "interrupted", code: "network_interrupted" }
            : { status: "ended", finalFrameReceived: options.finalFrameReceived !== false });
        }, 0);
      })
    }));
  }

  emit(requestId: string, event: AgentTurnRequestStreamEvent): void {
    this.observers.get(requestId)?.(event);
  }
}

function createCoordinator(
  host: FakeHost,
  requestIds: string[],
  reducer?: typeof reduceAgentTurnLifecycle,
  onDisplayEvent?: (event: AgentTurnRequestStreamEvent) => void
): AgentTurnCoordinator {
  return new AgentTurnCoordinator({
    localProjectId: "project-a",
    creationIdempotencyKey: "creation-a",
    host,
    createRequestId: () => requestIds.shift() ?? "request-fallback",
    ...(reducer ? { reducer } : {}),
    ...(onDisplayEvent ? { onDisplayEvent } : {})
  });
}

async function initializedCoordinator(
  host: FakeHost,
  requestIds: string[],
  onDisplayEvent?: (event: AgentTurnRequestStreamEvent) => void
): Promise<AgentTurnCoordinator> {
  const coordinator = createCoordinator(host, requestIds, undefined, onDisplayEvent);
  const initialized = await coordinator.initialize();
  if (initialized.status !== "ok") throw new Error(initialized.error);
  return coordinator;
}

async function recoveringCoordinator(
  output: boolean
): Promise<{ coordinator: AgentTurnCoordinator; host: FakeHost }> {
  const host = new FakeHost();
  host.queueStarted({ status: "providerRunning", output, interrupted: true });
  host.queueHandshake({
    status: "denied",
    code: "journal_unavailable",
    error: "temporary",
    recoverable: true
  });
  const coordinator = await initializedCoordinator(host, ["request-1"]);
  await coordinator.startInitialRequest(providerRequest());
  const retry = await coordinator.retryActiveRequest();
  expect(retry).toMatchObject({
    status: "denied",
    code: "journal_unavailable",
    recoverable: true,
    lifecycle: { phase: "recovering" }
  });
  return { coordinator, host };
}

function providerRequest(text = "hello"): APlusAgentProviderRequest {
  return {
    input: [{ role: "user", content: [{ type: "input_text", text }] }],
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: "auto",
    capabilityIntent: { comparisonAnalysis: false }
  };
}

function snapshot(overrides: Partial<AgentTurnJournalSnapshot> = {}): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId: "project-a",
    status: "created",
    latestRequestId: null,
    latestStepSequence: 0,
    counters: { provider: 0, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T01:00:00.000Z",
    updatedAt: "2026-07-29T01:00:00.000Z",
    terminalAt: null,
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
  }
  throw new Error("Timed out waiting for Coordinator state.");
}
