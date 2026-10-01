import { describe, expect, it, vi } from "vitest";

import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import type { ExternalExecutionState } from "@/shared/externalEffectProtocol";
import { createEffectExecution, externalEffectId, providerNamespace, type EffectIdentity } from "@/server/ai/externalEffectJournal";
import { registerAgentTurnExternalRequest, requestAgentTurnExternalCancellation } from "@/server/ai/agentTurnExternalCancellation";
import { createEffectJournalFake } from "@/test/externalEffectJournalFake";
import { createAgentTurnCancellationPostHandler } from "./handler";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ explicit cancellation intent route", () => {
  it("persists cancel intent before instance-local abort and fails closed if persistence fails", async () => {
    const calls: string[] = [];
    const cancelExternal = vi.fn(() => { calls.push("abort"); return false; });
    const persistCancel = vi.fn(async () => { calls.push("intent"); });
    const handler = createAgentTurnCancellationPostHandler({
      ...effectDependencies(),
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: snapshot("providerRunning") }),
      persistCancel, cancelExternal
    });
    expect((await handler(cancelRequest("request-1", 1), routeContext())).status).toBe(200);
    expect(calls).toEqual(["intent", "abort"]);
    expect(persistCancel).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user-a", kind: "text", effectId: expect.stringMatching(/^effect:/) }));
    cancelExternal.mockClear();
    persistCancel.mockRejectedValueOnce(new Error("Journal unavailable"));
    expect((await handler(cancelRequest("request-1", 1), routeContext())).status).toBe(503);
    expect(cancelExternal).not.toHaveBeenCalled();
  });
  it("authenticates before reading the cancellation body", async () => {
    const readTurn = vi.fn();
    const handler = createAgentTurnCancellationPostHandler({
      ...effectDependencies(),
      authenticate: async () => ({ status: "denied", httpStatus: 401, error: "login" }),
      readTurn,
      cancelExternal: vi.fn()
    });

    const response = await handler(rawCancelRequest("{not-json"), routeContext());

    expect(response.status).toBe(401);
    expect(readTurn).not.toHaveBeenCalled();
  });

  it("cancels only the authenticated latest running Request", async () => {
    const cancelExternal = vi.fn(() => true);
    const handler = createAgentTurnCancellationPostHandler({
      ...effectDependencies(),
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: snapshot("providerRunning") }),
      cancelExternal
    });

    const response = await handler(cancelRequest("request-1", 1), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: true,
      observed: true,
      status: "providerRunning"
    });
    expect(cancelExternal).toHaveBeenCalledWith({
      serverTurnId: TURN_ID,
      requestId: "request-1",
      stepSequence: 1
    });
  });

  it("rejects a stale Request identity and does not infer cancellation", async () => {
    const cancelExternal = vi.fn();
    const handler = createAgentTurnCancellationPostHandler({
      ...effectDependencies(),
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: snapshot("providerRunning") }),
      cancelExternal
    });

    const response = await handler(cancelRequest("stale-request", 1), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "request_not_latest",
      recoverable: false
    });
    expect(cancelExternal).not.toHaveBeenCalled();
  });

  it("reports an already terminal Server status without rewriting it", async () => {
    const cancelExternal = vi.fn();
    const handler = createAgentTurnCancellationPostHandler({
      ...effectDependencies(),
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: snapshot("externallyCompleted") }),
      cancelExternal
    });

    const response = await handler(cancelRequest("request-1", 1), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: false,
      observed: false,
      status: "externallyCompleted"
    });
    expect(cancelExternal).not.toHaveBeenCalled();
  });

  it.each(["running", "unknown"] as const)(
    "persists intent for exact %s effect after unknown administrative failure without a local observer",
    async (state) => {
      const fixture = await effectFixture(state);
      const turn = { ...snapshot("externallyFailed"), failureCode: "external_execution_state_unknown" };
      const beforeTurn = structuredClone(turn);
      const cancelExternal = vi.fn(requestAgentTurnExternalCancellation);
      const handler = createAgentTurnCancellationPostHandler({
        authenticate: async () => ({ status: "allowed", userId: "user-a" }),
        readTurn: async () => ({ status: "ok", snapshot: turn }),
        ...fixture.dependencies, cancelExternal
      });
      const response = await handler(cancelRequest("request-1", 1), routeContext());
      expect(await response.json()).toEqual({ accepted: true, observed: false, status: "externallyFailed" });
      const effect = (await fixture.journal.port.call("read", fixture.identity)).snapshot;
      expect(effect).toMatchObject({ executionState: state, cancelRequestedAt: expect.any(String),
        responseId: "same-response", attemptId: fixture.attemptId, localAbortObservedAt: null });
      expect(turn).toEqual(beforeTurn);
      expect(fixture.journal.calls.slice(fixture.setupCallCount).map((call) => call.operation)).toEqual(["read", "cancel", "read"]);
      expect(fixture.journal.calls.slice(fixture.setupCallCount).every((call) =>
        JSON.stringify(call.identity) === JSON.stringify(fixture.identity))).toBe(true);
      expect(fixture.journal.requests.size).toBe(1); // no new registration, attempt or Provider submission

      await fixture.execution.observe({ kind: "succeeded", responseId: "same-response" });
      expect((await fixture.journal.port.call("read", fixture.identity)).snapshot).toMatchObject({
        executionState: "succeeded", cancelRequestedAt: effect?.cancelRequestedAt, responseId: "same-response"
      });
      expect(turn).toEqual(beforeTurn);
    }
  );

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "does not create cancel intent or abort for confirmed %s effects even if the Turn still says running",
    async (state) => {
      const fixture = await effectFixture(state);
      const cancelExternal = vi.fn();
      for (const status of ["providerRunning", "externallyFailed"] as const) {
        const handler = createAgentTurnCancellationPostHandler({
          authenticate: async () => ({ status: "allowed", userId: "user-a" }),
          readTurn: async () => ({ status: "ok", snapshot: snapshot(status) }),
          ...fixture.dependencies, cancelExternal
        });
        expect(await (await handler(cancelRequest("request-1", 1), routeContext())).json()).toEqual({
          accepted: false, observed: false, status
        });
      }
      expect(cancelExternal).not.toHaveBeenCalled();
      expect((await fixture.journal.port.call("read", fixture.identity)).snapshot).toMatchObject({
        executionState: state, cancelRequestedAt: null, localAbortObservedAt: null
      });
      expect(fixture.journal.calls.slice(fixture.setupCallCount).map((call) => call.operation)).toEqual(["read", "read", "read"]);
    }
  );

  it("keeps a legacy terminal without an effect read-only and does not backfill Provider identity", async () => {
    const journal = createEffectJournalFake();
    const cancelExternal = vi.fn();
    const turn = snapshot("externallyFailed");
    const handler = createAgentTurnCancellationPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: turn }),
      readEffect: async (identity) => (await journal.port.call("read", identity)).snapshot,
      persistCancel: async (identity) => { await journal.port.call("cancel", identity); },
      cancelExternal
    });
    expect(await (await handler(cancelRequest("request-1", 1), routeContext())).json()).toEqual({
      accepted: false, observed: false, status: "externallyFailed"
    });
    expect(journal.calls.map((call) => call.operation)).toEqual(["read"]);
    expect(journal.records.size).toBe(0);
    expect(journal.requests.size).toBe(0);
    expect(cancelExternal).not.toHaveBeenCalled();
  });

  it("aborts a current local execution only after durable intent while leaving running Provider truth intact", async () => {
    const fixture = await effectFixture("running");
    const controller = new AbortController();
    const unregister = registerAgentTurnExternalRequest({ serverTurnId: TURN_ID, requestId: "request-1", stepSequence: 1 }, controller);
    const onAbort = vi.fn(() => {
      expect([...fixture.journal.records.values()][0].cancelRequestedAt).not.toBeNull();
    });
    controller.signal.addEventListener("abort", onAbort);
    try {
      const handler = createAgentTurnCancellationPostHandler({
        authenticate: async () => ({ status: "allowed", userId: "user-a" }),
        readTurn: async () => ({ status: "ok", snapshot: snapshot("providerRunning") }),
        ...fixture.dependencies, cancelExternal: requestAgentTurnExternalCancellation
      });
      expect(await (await handler(cancelRequest("request-1", 1), routeContext())).json()).toEqual({
        accepted: true, observed: true, status: "providerRunning"
      });
      expect(onAbort).toHaveBeenCalledOnce();
      expect(controller.signal.aborted).toBe(true);
      expect((await fixture.journal.port.call("read", fixture.identity)).snapshot?.executionState).toBe("running");
    } finally { unregister(); }
  });

  it("fails closed on effect read errors and checks both latest identity fields before accessing the effect", async () => {
    const readEffect = vi.fn(async () => { throw new Error("effect read unavailable"); });
    const persistCancel = vi.fn();
    const cancelExternal = vi.fn();
    const handler = createAgentTurnCancellationPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readTurn: async () => ({ status: "ok", snapshot: snapshot("externallyFailed") }),
      readEffect, persistCancel, cancelExternal
    });
    for (const [requestId, sequence] of [["stale-request", 1], ["request-1", 2]] as const) {
      expect((await handler(cancelRequest(requestId, sequence), routeContext())).status).toBe(409);
    }
    expect(readEffect).not.toHaveBeenCalled();
    const response = await handler(cancelRequest("request-1", 1), routeContext());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cancel_intent_unavailable" });
    expect(persistCancel).not.toHaveBeenCalled();
    expect(cancelExternal).not.toHaveBeenCalled();
  });
});

function effectDependencies() {
  return { readEffect: vi.fn(async () => null), persistCancel: vi.fn(async () => {}) };
}

async function effectFixture(state: ExternalExecutionState) {
  const journal = createEffectJournalFake();
  const identity = { actorUserId: "user-a", effectId: externalEffectId("a-plus", TURN_ID, "project-test", "text", "request-1", 1), kind: "text" as const };
  const execution = createEffectExecution(identity, journal.port);
  await execution.beforeSubmit({ input: "frozen text request" }, providerNamespace("openai-compatible", {
    baseUrl: "https://provider.test", apiKey: "test-only-key"
  }));
  await execution.observe({ kind: state, responseId: "same-response" });
  await execution.observe({ kind: "unknown" }); // later transport/SSE loss cannot downgrade known running
  const attemptId = (await journal.port.call("read", identity)).snapshot?.attemptId;
  return {
    journal, identity, execution, setupCallCount: journal.calls.length,
    attemptId,
    dependencies: {
      readEffect: async (effectIdentity: EffectIdentity) => (await journal.port.call("read", effectIdentity)).snapshot,
      persistCancel: async (effectIdentity: EffectIdentity) => { await journal.port.call("cancel", effectIdentity); }
    }
  };
}

function cancelRequest(requestId: string, stepSequence: number): Request {
  return new Request(`http://morpho.test/${TURN_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localProjectId: "project-test",
      requestId,
      stepSequence
    })
  });
}

function rawCancelRequest(body: string): Request {
  return new Request(`http://morpho.test/${TURN_ID}`, { method: "POST", body });
}

function routeContext() {
  return { params: Promise.resolve({ turnId: TURN_ID }) };
}

function snapshot(status: AgentTurnJournalSnapshot["status"]): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId: "project-test",
    status,
    latestRequestId: "request-1",
    latestStepSequence: 1,
    counters: { provider: 1, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:01.000Z",
    terminalAt: status.startsWith("externally") ? "2026-07-29T00:00:01.000Z" : null
  };
}
