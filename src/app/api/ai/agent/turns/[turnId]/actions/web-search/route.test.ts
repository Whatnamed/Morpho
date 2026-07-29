import { describe, expect, it, vi } from "vitest";

import type { AgentTurnExternalActionSnapshot } from "@/shared/agentTurnExternalActionProtocol";
import { createAgentTurnWebSearchActionPostHandler } from "./route";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const ACTION_ID = "call-search-1";

describe("A+ web search action route", () => {
  it("authenticates and checks the server feature boundary before reserving work", async () => {
    const acquire = vi.fn();
    const handler = createAgentTurnWebSearchActionPostHandler({
      authenticate: async () => ({ status: "denied", httpStatus: 401, error: "login" }),
      acquire,
      settle: vi.fn(),
      search: vi.fn(),
      webSearchEnabled: () => true
    });

    const response = await handler(new Request("http://morpho.test", { method: "POST" }), {
      params: Promise.resolve({ turnId: TURN_ID })
    });

    expect(response.status).toBe(401);
    expect(acquire).not.toHaveBeenCalled();

    const disabledAcquire = vi.fn();
    const disabled = createAgentTurnWebSearchActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: disabledAcquire,
      settle: vi.fn(),
      search: vi.fn(),
      webSearchEnabled: () => false
    });
    const disabledResponse = await disabled(new Request("http://morpho.test", { method: "POST" }), {
      params: Promise.resolve({ turnId: TURN_ID })
    });

    expect(disabledResponse.status).toBe(403);
    expect(disabledAcquire).not.toHaveBeenCalled();
  });

  it("replays one bounded Search receipt without starting a second paid action", async () => {
    const receipt = {
      sources: [{
        title: "Morpho source",
        url: "https://example.test/morpho",
        domain: "example.test",
        snippet: "local-first evidence"
      }],
      failedSourceCount: 0,
      timedOutSourceCount: 0
    };
    let acquireCount = 0;
    const acquire = vi.fn(async () => {
      acquireCount += 1;
      return acquireCount === 1
        ? {
            status: "ok" as const,
            executionGranted: true,
            replayed: false,
            snapshot: actionSnapshot("running")
          }
        : {
            status: "ok" as const,
            executionGranted: false,
            replayed: true,
            snapshot: { ...actionSnapshot("externallyCompleted"), resultReceipt: receipt }
          };
    });
    const settle = vi.fn(async () => ({
      status: "ok" as const,
      replayed: false,
      snapshot: { ...actionSnapshot("externallyCompleted"), resultReceipt: receipt }
    }));
    const search = vi.fn(async () => receipt);
    const handler = createAgentTurnWebSearchActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire,
      settle,
      search,
      webSearchEnabled: () => true
    });
    const body = {
      localProjectId: "project-test",
      requestId: "request-1",
      stepSequence: 1,
      actionId: ACTION_ID,
      queries: ["Morpho local-first"],
      maxSources: 5
    };

    const first = await handler(searchRequest(body), routeContext());
    const second = await handler(searchRequest(body), routeContext());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ replayed: true, sources: receipt.sources });
    expect(search).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actionId: ACTION_ID,
      claimCallId: ACTION_ID,
      actionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      claimHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    }));
  });
});

function searchRequest(body: Record<string, unknown>): Request {
  return new Request(`http://morpho.test/${TURN_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function routeContext() {
  return { params: Promise.resolve({ turnId: TURN_ID }) };
}

function actionSnapshot(
  status: AgentTurnExternalActionSnapshot["status"]
): AgentTurnExternalActionSnapshot {
  return {
    serverTurnId: TURN_ID,
    requestId: "request-1",
    stepSequence: 1,
    actionId: ACTION_ID,
    actionKind: "webSearch",
    status,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status === "running" ? null : "2026-07-29T00:00:01.000Z"
  };
}
