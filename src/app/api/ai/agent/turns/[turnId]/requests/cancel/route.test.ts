import { describe, expect, it, vi } from "vitest";

import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import { createAgentTurnCancellationPostHandler } from "./route";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ explicit Provider cancellation route", () => {
  it("cancels only the authenticated latest running Request", async () => {
    const cancelExternal = vi.fn(() => true);
    const handler = createAgentTurnCancellationPostHandler({
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
});

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
