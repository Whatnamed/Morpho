import { describe, expect, it, vi } from "vitest";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import type {
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent
} from "@/shared/agentTurnJournalProtocol";
import { createAgentTurnCoordinatorHttpHost } from "./agentTurnCoordinatorHttpHost";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ Coordinator HTTP Host", () => {
  it("creates a Server Turn without sending user identity", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({ localProjectId: "project-a", creationIdempotencyKey: "creation-a" });
      expect(body).not.toHaveProperty("userId");
      return Response.json({ ...snapshot(), replayed: false });
    });
    const host = createAgentTurnCoordinatorHttpHost({ fetch: fetchMock, baseUrl: "http://localhost" });
    await expect(host.createServerTurn({
      localProjectId: "project-a",
      creationIdempotencyKey: "creation-a"
    })).resolves.toMatchObject({ snapshot: { serverTurnId: TURN_ID }, replayed: false });
  });

  it("does not consume SSE until Coordinator invokes the lazy completion", async () => {
    const events: AgentTurnRequestStreamEvent[] = [];
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(frame({
          type: "providerOutput",
          requestId: "request-a",
          stepSequence: 1,
          outputText: "answer",
          producedUserVisibleEffect: true,
          toolCallIds: []
        }));
        controller.enqueue(frame({
          type: "serverStatus",
          requestId: "request-a",
          stepSequence: 1,
          status: "externallyCompleted"
        }));
        controller.close();
      }
    });
    const host = createAgentTurnCoordinatorHttpHost({
      fetch: vi.fn(async () => new Response(stream, {
        headers: { "Content-Type": "text/event-stream" }
      }))
    });
    const handshake = await host.executeExternalRequest(requestInput(), (event) => events.push(event));
    expect(handshake.status).toBe("started");
    expect(events).toEqual([]);
    if (handshake.status !== "started") throw new Error("expected stream");
    await expect(handshake.complete()).resolves.toEqual({ status: "ended", finalFrameReceived: true });
    expect(reads).toBeGreaterThan(0);
    expect(events.map((event) => event.type)).toEqual(["providerOutput", "serverStatus"]);
  });

  it("returns replay without opening a second stream", async () => {
    const host = createAgentTurnCoordinatorHttpHost({
      fetch: vi.fn(async () => Response.json({
        ...snapshot({
          status: "providerRunning",
          latestRequestId: "request-a",
          latestStepSequence: 1,
          counters: { provider: 1, webSearch: 0, image: 0 }
        }),
        replayed: true
      }))
    });
    await expect(host.executeExternalRequest(requestInput(), vi.fn())).resolves.toEqual({ status: "replayed" });
  });

  it("maps deterministic HTTP conflicts without scheduling Recovery", async () => {
    const host = createAgentTurnCoordinatorHttpHost({
      fetch: vi.fn(async () => Response.json({
        error: "conflict",
        code: "sequence_conflict",
        recoverable: false
      }, { status: 409 }))
    });
    await expect(host.executeExternalRequest(requestInput(), vi.fn())).resolves.toEqual({
      status: "denied",
      code: "sequence_conflict",
      error: "conflict",
      recoverable: false
    });
  });

  it("distinguishes temporary Journal outages from terminal Provider configuration", async () => {
    const responses = [
      Response.json({ error: "temporary", code: "journal_unavailable" }, { status: 503 }),
      Response.json({ error: "missing config", code: "provider_unavailable" }, { status: 503 })
    ];
    const host = createAgentTurnCoordinatorHttpHost({
      fetch: vi.fn(async () => responses.shift()!)
    });
    await expect(host.executeExternalRequest(requestInput(), vi.fn())).resolves.toMatchObject({
      status: "denied",
      code: "journal_unavailable",
      recoverable: true
    });
    await expect(host.executeExternalRequest(requestInput(), vi.fn())).resolves.toMatchObject({
      status: "denied",
      code: "provider_unavailable",
      recoverable: false
    });
  });

  it("queries the minimal Journal snapshot by Turn and local Project ID", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      Response.json(snapshot({ status: "externallyCompleted", terminalAt: "now" }))
    );
    const host = createAgentTurnCoordinatorHttpHost({ fetch: fetchMock, baseUrl: "http://localhost" });
    await expect(host.queryServerTurn({
      serverTurnId: TURN_ID,
      localProjectId: "project-a"
    })).resolves.toMatchObject({ status: "externallyCompleted" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `http://localhost/api/ai/agent/turns/${TURN_ID}?localProjectId=project-a`
    );
  });

  it("rejects an out-of-contract Journal snapshot", async () => {
    const host = createAgentTurnCoordinatorHttpHost({
      fetch: vi.fn(async () => Response.json(snapshot({
        counters: { provider: -1, webSearch: 0, image: 0 }
      })))
    });
    await expect(host.queryServerTurn({
      serverTurnId: TURN_ID,
      localProjectId: "project-a"
    })).rejects.toMatchObject({ code: "http_200" });
  });
});

function requestInput() {
  return {
    serverTurnId: TURN_ID,
    localProjectId: "project-a",
    requestId: "request-a",
    stepSequence: 1,
    providerRequest: {
      input: [{ role: "user" as const, content: [{ type: "input_text" as const, text: "hello" }] }],
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      mode: "auto" as const,
      capabilityIntent: { comparisonAnalysis: false }
    }
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

function frame(event: AgentTurnRequestStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}
