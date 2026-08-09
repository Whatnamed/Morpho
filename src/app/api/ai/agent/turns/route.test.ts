import { describe, expect, it, vi } from "vitest";

import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import { createAgentTurnPostHandler } from "./route";

const SNAPSHOT: AgentTurnJournalSnapshot = {
  serverTurnId: "019fa9c0-7b9d-7a20-8f31-2c676296c9d1",
  localProjectId: "project-a",
  status: "created",
  latestRequestId: null,
  latestStepSequence: 0,
  counters: { provider: 0, webSearch: 0, image: 0 },
  createdAt: "2026-07-29T01:00:00.000Z",
  updatedAt: "2026-07-29T01:00:00.000Z",
  terminalAt: null
};

describe("POST /api/ai/agent/turns", () => {
  it("returns 401 before Journal creation when no Session user exists", async () => {
    const createJournal = vi.fn();
    const authenticate = vi.fn(async () => ({
      status: "denied" as const,
      httpStatus: 401 as const,
      error: "请先登录 Morpho。"
    }));
    const handler = createAgentTurnPostHandler({
      authenticate,
      createJournal
    });
    const response = await handler(rawRequest("{not-json"));
    expect(response.status).toBe(401);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(createJournal).not.toHaveBeenCalled();
  });

  it("rejects a client-forged userId after authentication and never reaches Journal", async () => {
    const authenticate = vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const));
    const createJournal = vi.fn();
    const handler = createAgentTurnPostHandler({ authenticate, createJournal });
    const response = await handler(request({ ...validBody(), userId: "user-forged" }));
    expect(response.status).toBe(400);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(createJournal).not.toHaveBeenCalled();
  });

  it("rejects a false-Content-Length body while streaming past the small route limit", async () => {
    const createJournal = vi.fn();
    const handler = createAgentTurnPostHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      createJournal
    });
    const response = await handler(new Request("http://localhost/api/ai/agent/turns", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: JSON.stringify({ ...validBody(), padding: "x".repeat(17_000) })
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "body_too_large" });
    expect(createJournal).not.toHaveBeenCalled();
  });

  it("returns the minimal created snapshot without user, Hash, or local content", async () => {
    const createJournal = vi.fn(async () => ({ status: "ok" as const, replayed: false, snapshot: SNAPSHOT }));
    const handler = createAgentTurnPostHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      createJournal
    });
    const response = await handler(request(validBody()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ...SNAPSHOT, replayed: false });
    expect(JSON.stringify(body)).not.toMatch(/userId|requestHash|transcript|workspace|toolResult|providerOutput/i);
    expect(createJournal).toHaveBeenCalledWith({
      localProjectId: "project-a",
      creationIdempotencyKey: "creation-a"
    });
  });

  it("returns the same Server Turn for an exact creation retry", async () => {
    const createJournal = vi.fn(async () => ({ status: "ok" as const, replayed: true, snapshot: SNAPSHOT }));
    const handler = createAgentTurnPostHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      createJournal
    });
    const first = await handler(request(validBody()));
    const second = await handler(request(validBody()));
    expect((await first.json()).serverTurnId).toBe(SNAPSHOT.serverTurnId);
    expect(await second.json()).toMatchObject({ serverTurnId: SNAPSHOT.serverTurnId, replayed: true });
  });

  it("returns a deterministic non-recoverable 409 for a Project binding conflict", async () => {
    const handler = createAgentTurnPostHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      createJournal: vi.fn(async () => ({
        status: "denied" as const,
        httpStatus: 409 as const,
        code: "creation_key_conflict",
        error: "conflict",
        recoverable: false as const
      }))
    });
    const response = await handler(request(validBody()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "conflict",
      code: "creation_key_conflict",
      recoverable: false
    });
  });
});

function validBody() {
  return { localProjectId: "project-a", creationIdempotencyKey: "creation-a" };
}

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ai/agent/turns", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function rawRequest(body: string): Request {
  return new Request("http://localhost/api/ai/agent/turns", { method: "POST", body });
}
