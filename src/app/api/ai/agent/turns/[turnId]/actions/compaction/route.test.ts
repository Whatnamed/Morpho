import { describe, expect, it, vi } from "vitest";
import { createExternalResultFake } from "@/test/externalResultFake";

import { executeOpenAiCompatibleResponse } from "@/server/ai/openaiCompatibleProvider";
import type { ConversationSummary } from "@/domain/morpho/types";
import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import type { AgentTurnExternalActionSnapshot } from "@/shared/agentTurnExternalActionProtocol";
import {
  createAgentTurnCompactionActionPostHandler,
  type AgentTurnCompactionActionDependencies
} from "./handler";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const ACTION_ID = "compact:manual:1";
const SUMMARY: ConversationSummary = {
  threadGoal: "收敛产品方向",
  establishedContext: ["项目保持连续画布"],
  decisionsAndReasons: ["保留 local-first 边界"],
  activeWork: ["验证 A+ Runtime"],
  unresolvedQuestions: ["等待独立审计"],
  referencedObjects: []
};

describe("A+ compaction action route", () => {
  async function completedEscrow(overrides: Record<string, unknown> = {}) {
    const results = createExternalResultFake();
    const acquire = vi.fn(async () => ({ status: "ok" as const, executionGranted: true, replayed: false, snapshot: actionSnapshot("running") }));
    const settle = vi.fn(async () => ({ status: "ok" as const, replayed: false, snapshot: actionSnapshot("externallyCompleted") }));
    const loadConfig = vi.fn(() => validConfig());
    const execute = vi.fn<AgentTurnCompactionActionDependencies["execute"]>(async () => ({ responseId: "original-response",
      outputText: `\`\`\`json\n${JSON.stringify({ morphoConversationSummary: SUMMARY })}\n\`\`\``,
      functionCalls: [], citations: [], webSearchCallCount: 0, outputItems: [] }));
    const handler = createAgentTurnCompactionActionPostHandler({ authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      results: results.port, acquire, settle, loadConfig, execute });
    const body = { ...await compactionRequest().json(), ...overrides };
    const original = await handler(requestBody(body), routeContext());
    expect(original.status).toBe(200);
    const manifest = (await original.json()).result;
    const record = [...results.records.values()][0];
    expect(record.binding).toMatchObject({ serverTurnId: TURN_ID, actionId: ACTION_ID, requestContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    return { results, acquire, settle, loadConfig, execute, handler, body, manifest, record };
  }
  function requestBody(body: unknown) {
    return new Request("http://morpho.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  it.each(["changed", "unavailable"])("completed exact replay is independent of %s current config", async config => {
    const f = await completedEscrow();
    f.loadConfig.mockImplementation(() => config === "unavailable" ? loadOpenAiCompatibleConfig({}) : loadOpenAiCompatibleConfig({
      MORPHO_AI_API_KEY: "new-key", MORPHO_AI_BASE_URL: "https://different.test/v1", MORPHO_AI_MODEL: "new-model" }));
    const response = await f.handler(compactionRequest(), routeContext());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: f.manifest });
    expect(f.loadConfig).toHaveBeenCalledOnce(); expect(f.acquire).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it.each(["body", "sourceStart", "sourceEnd", "order", "membership", "previousSummary", "previousRevision", "mode", "requestId", "sequence"])(
    "completed replay rejects changed %s before result delivery or execution", async field => {
      const f = await completedEscrow(), changed = structuredClone(f.body);
      switch (field) {
        case "body": changed.messages[0].body += " changed"; break;
        case "sourceStart": changed.sourceStartMessageId = "other-start"; break;
        case "sourceEnd": changed.sourceEndMessageId = "other-end"; break;
        case "order": changed.messages.reverse(); break;
        case "membership": changed.messages.pop(); break;
        case "previousSummary": changed.previousSummary = SUMMARY; break;
        case "previousRevision": changed.expectedPreviousRevisionId = "other-revision"; break;
        case "mode": changed.mode = "automatic"; break;
        case "requestId": changed.requestId = "other-request"; break;
        case "sequence": changed.stepSequence = 2; break;
      }
      const before = structuredClone(f.record);
      const response = await f.handler(requestBody(changed), routeContext());
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: "external_action_hash_conflict", recoverable: false });
      expect(structuredClone(f.record)).toEqual(before); expect(f.acquire).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce(); expect(f.loadConfig).toHaveBeenCalledOnce();
    });
  it("canonical object key order and null/absent optional bases retain exact replay", async () => {
    const f = await completedEscrow();
    const reordered = Object.fromEntries(Object.entries({ ...f.body, previousSummary: null }).reverse());
    reordered.messages = f.body.messages.map((message: Record<string, unknown>) => Object.fromEntries(Object.entries(message).reverse()));
    const response = await f.handler(requestBody(reordered), routeContext());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: f.manifest }); expect(f.execute).toHaveBeenCalledOnce();
  });
  it("canonical nested previous Summary key order retains exact replay", async () => {
    const f = await completedEscrow({ previousSummary: SUMMARY, expectedPreviousRevisionId: "previous-revision" });
    const response = await f.handler(requestBody({ ...f.body, previousSummary: Object.fromEntries(Object.entries(SUMMARY).reverse()) }), routeContext());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: f.manifest }); expect(f.execute).toHaveBeenCalledOnce();
  });
  it.each([true, false].flatMap(published => [undefined, null, "invalid", "A".repeat(64)].map(proof => ({ published, proof }))))("missing/invalid proof $proof published=$published fails closed", async ({ published, proof }) => {
    const f = await completedEscrow(); f.record.published = published;
    f.record.binding = { ...(f.record.binding as Record<string, unknown>), requestContentSha256: proof };
    const beforePublishes = f.results.calls.filter(c => c.operation === "publish").length;
    const response = await f.handler(compactionRequest(), routeContext());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "request_content_identity_unavailable", recoverable: false });
    expect(f.record.published).toBe(published); expect(f.results.calls.filter(c => c.operation === "publish")).toHaveLength(beforePublishes);
    expect(f.loadConfig).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it("verified staged Summary can publish on exact replay without current config or execution", async () => {
    const f = await completedEscrow(); f.record.published = false;
    f.loadConfig.mockImplementation(() => loadOpenAiCompatibleConfig({}));
    const response = await f.handler(compactionRequest(), routeContext());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: f.manifest });
    expect(f.record.published).toBe(true); expect(f.loadConfig).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it("authenticates before reserving Provider quota", async () => {
    const acquire = vi.fn();
    const handler = createAgentTurnCompactionActionPostHandler({
      authenticate: async () => ({ status: "denied", httpStatus: 401, error: "login" }),
      acquire,
      settle: vi.fn(),
      loadConfig: validConfig,
      execute: vi.fn()
    });

    const response = await handler(new Request("http://morpho.test", { method: "POST" }), {
      params: Promise.resolve({ turnId: TURN_ID })
    });

    expect(response.status).toBe(401);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("validates and settles one Summary execution through the action Journal", async () => {
    const acquire = vi.fn(async () => ({
      status: "ok" as const,
      executionGranted: true,
      replayed: false,
      snapshot: actionSnapshot("running")
    }));
    const settle = vi.fn(async () => ({
      status: "ok" as const,
      replayed: false,
      snapshot: actionSnapshot("externallyCompleted")
    }));
    const execute = vi.fn<AgentTurnCompactionActionDependencies["execute"]>(async () => ({
      responseId: "response-1",
      outputText: `\`\`\`json\n${JSON.stringify({ morphoConversationSummary: SUMMARY })}\n\`\`\``,
      functionCalls: [],
      citations: [],
      webSearchCallCount: 0,
      outputItems: []
    }));
    const handler = createAgentTurnCompactionActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire,
      settle,
      loadConfig: validConfig,
      execute
    });

    const response = await handler(compactionRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ summary: SUMMARY, replayed: false });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      actionId: ACTION_ID,
      actionKind: "compaction",
      actionHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    }));
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      actionId: ACTION_ID,
      status: "externallyCompleted"
    }));
  });

  it("uses the same server-only cache hint boundary for Summary execution", async () => {
    const execute = vi.fn<AgentTurnCompactionActionDependencies["execute"]>(async () => ({
      responseId: "response-cache",
      outputText: `\`\`\`json\n${JSON.stringify({ morphoConversationSummary: SUMMARY })}\n\`\`\``,
      functionCalls: [], citations: [], webSearchCallCount: 0, outputItems: []
    }));
    const handler = createAgentTurnCompactionActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({
        status: "ok", executionGranted: true, replayed: false,
        snapshot: actionSnapshot("running")
      }),
      settle: async () => ({
        status: "ok", replayed: false,
        snapshot: actionSnapshot("externallyCompleted")
      }),
      loadConfig: () => validConfig(true),
      execute
    });

    const response = await handler(compactionRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      promptCacheKey: expect.stringMatching(/^morpho-pc-v1-[0-9a-f]{48}$/),
      promptCacheRetention: "24h"
    });
  });

  it("never re-executes a completed Summary when the payload is unavailable", async () => {
    const execute = vi.fn();
    const handler = createAgentTurnCompactionActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({
        status: "ok",
        executionGranted: false,
        replayed: true,
        snapshot: actionSnapshot("externallyCompleted")
      }),
      settle: vi.fn(),
      loadConfig: validConfig,
      execute
    });

    const response = await handler(compactionRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "external_action_result_unavailable",
      recoverable: false
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("settles unknown once without a summary; settlement retry and exact replay do not infer again", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => { throw new TypeError("response lost"); });
    global.fetch = fetchMock;
    let terminal = false;
    const settle = vi.fn<AgentTurnCompactionActionDependencies["settle"]>()
      .mockResolvedValueOnce({ status: "denied", httpStatus: 503, code: "external_action_unavailable", error: "unavailable", recoverable: false })
      .mockImplementation(async () => {
        terminal = true;
        return { status: "ok", replayed: false, snapshot: { ...actionSnapshot("externallyFailed"), failureCode: "external_execution_state_unknown" } };
      });
    const handler = createAgentTurnCompactionActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({ status: "ok", executionGranted: !terminal, replayed: terminal,
        snapshot: { ...actionSnapshot(terminal ? "externallyFailed" : "running"), ...(terminal ? { failureCode: "external_execution_state_unknown" } : {}) } }),
      settle, loadConfig: validConfig, execute: executeOpenAiCompatibleResponse,
      waitForSettlementRetry: async () => undefined
    });
    try {
      const response = await handler(compactionRequest(), routeContext());
      const body = await response.json();
      expect(response.status).toBe(502);
      expect(body).toMatchObject({ code: "external_execution_state_unknown", recoverable: false, action: { status: "externallyFailed", failureCode: "external_execution_state_unknown" } });
      expect(body).not.toHaveProperty("summary");
      expect(settle).toHaveBeenCalledTimes(2);
      expect(settle.mock.calls.every(([input]) => input.failureCode === "external_execution_state_unknown")).toBe(true);
      const replay = await handler(compactionRequest(), routeContext());
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ code: "external_execution_state_unknown" });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { global.fetch = originalFetch; }
  });

});

function validConfig(promptCacheEnabled = false) {
  return loadOpenAiCompatibleConfig({
    MORPHO_AI_API_KEY: "test-key",
    MORPHO_AI_BASE_URL: "https://provider.test/v1",
    MORPHO_AI_MODEL: "test-model",
    ...(promptCacheEnabled
      ? {
          MORPHO_AI_SUPPORTS_PROMPT_CACHE_KEY: "true",
          MORPHO_AI_SUPPORTS_PROMPT_CACHE_RETENTION: "true",
          MORPHO_AI_PROMPT_CACHE_KEY_ENABLED: "true",
          MORPHO_AI_PROMPT_CACHE_RETENTION: "24h"
        }
      : {})
  });
}

function compactionRequest(): Request {
  return new Request(`http://morpho.test/${TURN_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localProjectId: "project-test",
      requestId: ACTION_ID,
      stepSequence: 1,
      actionId: ACTION_ID,
      mode: "manual",
      sourceStartMessageId: "u1",
      sourceEndMessageId: "a1",
      messages: [
        { id: "u1", role: "user", body: "目标是什么？" },
        { id: "a1", role: "assistant", body: "收敛产品方向。" }
      ]
    })
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
    requestId: ACTION_ID,
    stepSequence: 1,
    actionId: ACTION_ID,
    actionKind: "compaction",
    status,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status === "running" ? null : "2026-07-29T00:00:01.000Z"
  };
}
