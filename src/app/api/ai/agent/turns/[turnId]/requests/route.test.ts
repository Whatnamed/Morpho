import { describe, expect, it, vi } from "vitest";

import { createMorphoAgentContextPolicy } from "@/domain/morpho/agentContextPolicy";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import type {
  AcquireAgentTurnRequestResult,
  ReadAgentTurnJournalResult,
  SettleAgentTurnRequestResult
} from "@/server/ai/agentTurnJournal";
import type { OpenAiCompatibleResponseResult } from "@/server/ai/openaiCompatibleProvider";
import type {
  AgentTurnJournalSnapshot,
  ServerExternalExecutionStatus
} from "@/shared/agentTurnJournalProtocol";
import { createAgentTurnGetHandler } from "../route";
import {
  createAgentTurnRequestPostHandler,
  type AgentTurnRequestRouteDependencies
} from "./route";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("POST /api/ai/agent/turns/[turnId]/requests", () => {
  it("returns 401 without acquiring, counting, or invoking Provider", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const handler = makeHandler(store, provider, {
      authenticate: async () => ({ status: "denied", httpStatus: 401, error: "login" })
    });
    const response = await call(handler, validBody());
    expect(response.status).toBe(401);
    expect(store.acquire).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(store.snapshot.counters.provider).toBe(0);
  });

  it("returns 503 for missing Provider config before acquisition", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const handler = makeHandler(store, provider, {
      loadConfig: () => ({ status: "failed", reason: "missing config" })
    });
    const response = await call(handler, validBody());
    expect(response.status).toBe(503);
    expect(store.acquire).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["userId", "status", "providerCallCount", "requestHash"])(
    "rejects client authority field %s before acquisition",
    async (field) => {
      const store = new FakeJournal();
      const provider = vi.fn(async () => providerResult());
      const handler = makeHandler(store, provider);
      const response = await call(handler, { ...validBody(), [field]: "forged" });
      expect(response.status).toBe(400);
      expect(store.acquire).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    }
  );

  it("hides a cross-user execution attempt as 404", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const handler = makeHandler(store, provider, {
      authenticate: async () => ({ status: "allowed", userId: "user-b" }),
      acquireRequest: async () => denial("not_found", 404)
    });
    const response = await call(handler, validBody());
    expect(response.status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it("hides a same-user execution under the wrong localProjectId as 404", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const response = await call(makeHandler(store, provider), {
      ...validBody(),
      localProjectId: "project-other"
    });
    expect(response.status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });

  it("computes a stable SHA-256 on the server and calls Provider once", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const handler = makeHandler(store, provider);
    const response = await call(handler, validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.text();
    expect(store.acquire).toHaveBeenCalledWith(expect.objectContaining({
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    }));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.snapshot.counters.provider).toBe(1);
    expect(store.snapshot.status).toBe("externallyCompleted");
  });

  it("does not execute or count an exact Request replay", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult());
    const handler = makeHandler(store, provider);
    const first = await call(handler, validBody());
    await first.text();
    const second = await call(handler, validBody());
    expect(second.headers.get("content-type")).toContain("application/json");
    const replay = await second.json();
    expect(replay).toMatchObject({ replayed: true });
    expect(replay).not.toHaveProperty("providerCallCount");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.snapshot.counters.provider).toBe(1);
  });

  it.each([
    ["request_id_conflict", 409],
    ["sequence_conflict", 409],
    ["sequence_replay", 409],
    ["sequence_skip", 409],
    ["terminal_turn", 409],
    ["quota_exceeded", 429]
  ])("does not call Provider for %s", async (code, status) => {
    const store = new FakeJournal();
    store.nextDenial = code;
    const provider = vi.fn(async () => providerResult());
    const response = await call(makeHandler(store, provider), validBody());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, recoverable: false });
    expect(provider).not.toHaveBeenCalled();
    expect(store.snapshot.counters.provider).toBe(0);
  });

  it("settles a no-Tool Provider answer as externallyCompleted", async () => {
    const store = new FakeJournal();
    const response = await call(makeHandler(store, vi.fn(async () => providerResult())), validBody());
    const events = parseSse(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "providerOutput",
      producedUserVisibleEffect: true,
      toolCallIds: []
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "serverStatus",
      status: "externallyCompleted"
    }));
    expect(store.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "externallyCompleted" }));
  });

  it("settles a Provider Tool Call as awaitingNextRequest without executing local Tools", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => providerResult({
      outputText: "",
      functionCalls: [{
        id: "item-a",
        callId: "call-a",
        name: "read_project_memory",
        argumentsText: "{}"
      }]
    }));
    const response = await call(makeHandler(store, provider), validBody());
    const events = parseSse(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "providerOutput",
      toolCallIds: ["call-a"]
    }));
    expect(store.snapshot.status).toBe("awaitingNextRequest");
    expect(store.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "awaitingNextRequest" }));
    expect(JSON.stringify(store)).not.toContain("toolResult");
  });

  it("records only a bounded failure code when Provider execution fails", async () => {
    const store = new FakeJournal();
    const provider = vi.fn(async () => {
      throw new Error("raw upstream body must not be stored");
    });
    const response = await call(makeHandler(store, provider), validBody());
    const events = parseSse(await response.text());
    expect(events).toContainEqual(expect.objectContaining({
      type: "serverStatus",
      status: "externallyFailed"
    }));
    expect(store.snapshot).toMatchObject({
      status: "externallyFailed",
      failureCode: "provider_execution_failed"
    });
    expect(JSON.stringify(store.snapshot)).not.toContain("raw upstream body");
  });

  it("allows only one of two concurrent identical requests to execute", async () => {
    const store = new FakeJournal();
    const deferred = createDeferred<OpenAiCompatibleResponseResult>();
    const provider = vi.fn(() => deferred.promise);
    const handler = makeHandler(store, provider);
    const first = await call(handler, validBody());
    const second = await call(handler, validBody());
    expect(second.headers.get("content-type")).toContain("application/json");
    expect(await second.json()).toMatchObject({ replayed: true, status: "providerRunning" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.snapshot.counters.provider).toBe(1);
    deferred.resolve(providerResult());
    await first.text();
  });

  it("rejects a concurrent conflicting request without a second execution", async () => {
    const store = new FakeJournal();
    const deferred = createDeferred<OpenAiCompatibleResponseResult>();
    const provider = vi.fn(() => deferred.promise);
    const handler = makeHandler(store, provider);
    const first = await call(handler, validBody());
    const conflicting = await call(handler, {
      ...validBody(),
      requestId: "request-other",
      providerRequest: providerRequest("different input")
    });
    expect(conflicting.status).toBe(409);
    expect(provider).toHaveBeenCalledTimes(1);
    deferred.resolve(providerResult());
    await first.text();
  });

  it("rejects the same Request ID with a different server-computed Hash", async () => {
    const store = new FakeJournal();
    const deferred = createDeferred<OpenAiCompatibleResponseResult>();
    const provider = vi.fn(() => deferred.promise);
    const handler = makeHandler(store, provider);
    const first = await call(handler, validBody());
    const conflict = await call(handler, {
      ...validBody(),
      providerRequest: providerRequest("changed request body")
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "request_id_conflict", recoverable: false });
    expect(provider).toHaveBeenCalledTimes(1);
    deferred.resolve(providerResult());
    await first.text();
  });

  it("updates Journal from server execution even when the client never reads the final SSE", async () => {
    const store = new FakeJournal();
    const deferred = createDeferred<OpenAiCompatibleResponseResult>();
    const provider = vi.fn(() => deferred.promise);
    const post = makeHandler(store, provider);
    const response = await call(post, validBody());
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(store.snapshot.status).toBe("providerRunning");

    deferred.resolve(providerResult({ outputText: "server completed without a final-frame reader" }));
    await waitFor(() => store.snapshot.status === "externallyCompleted");

    const get = createAgentTurnGetHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      readJournal: store.read
    });
    const query = await get(
      new Request(`http://localhost/api/ai/agent/turns/${TURN_ID}?localProjectId=project-a`),
      { params: Promise.resolve({ turnId: TURN_ID }) }
    );
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({
      status: "externallyCompleted",
      latestRequestId: "request-a",
      counters: { provider: 1 }
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

class FakeJournal {
  snapshot: AgentTurnJournalSnapshot = snapshot();
  private request:
    | { requestId: string; stepSequence: number; requestHash: string }
    | undefined;
  nextDenial: string | undefined;

  readonly acquire = vi.fn(async (input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    requestHash: string;
  }): Promise<AcquireAgentTurnRequestResult> => {
    if (this.nextDenial) {
      const code = this.nextDenial;
      this.nextDenial = undefined;
      return denial(code, code === "quota_exceeded" ? 429 : 409);
    }
    if (input.serverTurnId !== TURN_ID || input.localProjectId !== "project-a") {
      return denial("not_found", 404);
    }
    if (this.request) {
      if (
        this.request.requestId === input.requestId &&
        this.request.stepSequence === input.stepSequence &&
        this.request.requestHash === input.requestHash
      ) {
        return {
          status: "ok",
          executionGranted: false,
          replayed: true,
          snapshot: this.snapshot
        };
      }
      return denial(
        this.request.requestId === input.requestId ? "request_id_conflict" : "sequence_conflict",
        409
      );
    }
    this.request = {
      requestId: input.requestId,
      stepSequence: input.stepSequence,
      requestHash: input.requestHash
    };
    this.snapshot = snapshot({
      status: "providerRunning",
      latestRequestId: input.requestId,
      latestStepSequence: input.stepSequence,
      counters: { provider: 1, webSearch: 0, image: 0 }
    });
    return { status: "ok", executionGranted: true, replayed: false, snapshot: this.snapshot };
  });

  readonly settle = vi.fn(async (input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    status: Exclude<ServerExternalExecutionStatus, "created" | "providerRunning">;
    failureCode?: string;
  }): Promise<SettleAgentTurnRequestResult> => {
    const terminal = input.status.startsWith("externally");
    this.snapshot = snapshot({
      status: input.status,
      latestRequestId: input.requestId,
      latestStepSequence: input.stepSequence,
      counters: { provider: 1, webSearch: 0, image: 0 },
      terminalAt: terminal ? "2026-07-29T01:02:00.000Z" : null,
      ...(input.failureCode ? { failureCode: input.failureCode } : {})
    });
    return { status: "ok", replayed: false, snapshot: this.snapshot };
  });

  readonly read = vi.fn(async (input: {
    serverTurnId: string;
    localProjectId: string;
  }): Promise<ReadAgentTurnJournalResult> => {
    return input.serverTurnId === TURN_ID && input.localProjectId === "project-a"
      ? { status: "ok", snapshot: this.snapshot }
      : denial("not_found", 404);
  });
}

function makeHandler(
  store: FakeJournal,
  provider: AgentTurnRequestRouteDependencies["streamProvider"],
  overrides: Partial<AgentTurnRequestRouteDependencies> = {}
) {
  return createAgentTurnRequestPostHandler({
    authenticate: async () => ({ status: "allowed", userId: "user-a" }),
    loadConfig: config,
    acquireRequest: store.acquire,
    settleRequest: store.settle,
    streamProvider: provider,
    ...overrides
  });
}

function config() {
  return {
    status: "ok" as const,
    config: {
      apiKey: "test-key",
      baseUrl: "https://provider.test/v1",
      model: "test-model",
      webSearchEnabled: false,
      contextPolicy: createMorphoAgentContextPolicy()
    }
  };
}

function validBody() {
  return {
    localProjectId: "project-a",
    requestId: "request-a",
    stepSequence: 1,
    providerRequest: providerRequest("hello")
  };
}

function providerRequest(text: string) {
  return {
    input: [{ role: "user", content: [{ type: "input_text", text }] }],
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: "auto",
    capabilityIntent: { comparisonAnalysis: false }
  };
}

function providerResult(
  overrides: Partial<OpenAiCompatibleResponseResult> = {}
): OpenAiCompatibleResponseResult {
  return {
    responseId: "response-a",
    outputText: "hello from provider",
    functionCalls: [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: [],
    ...overrides
  };
}

function call(
  handler: ReturnType<typeof createAgentTurnRequestPostHandler>,
  body: Record<string, unknown>
): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/ai/agent/turns/${TURN_ID}/requests`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ turnId: TURN_ID }) }
  );
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

function denial(
  code: string,
  httpStatus: 404 | 409 | 429
): Extract<AcquireAgentTurnRequestResult, { status: "denied" }> {
  return { status: "denied", httpStatus, code, error: code, recoverable: false };
}

function parseSse(value: string): Array<Record<string, unknown>> {
  return value
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data:\s*/, "")) as Record<string, unknown>);
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
  throw new Error("Timed out waiting for server-side Journal settlement.");
}
