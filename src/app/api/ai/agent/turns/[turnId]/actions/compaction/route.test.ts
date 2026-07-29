import { describe, expect, it, vi } from "vitest";

import type { ConversationSummary } from "@/domain/morpho/types";
import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import type { AgentTurnExternalActionSnapshot } from "@/shared/agentTurnExternalActionProtocol";
import { createAgentTurnCompactionActionPostHandler } from "./route";

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
    const execute = vi.fn(async () => ({
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
});

function validConfig() {
  return loadOpenAiCompatibleConfig({
    MORPHO_AI_API_KEY: "test-key",
    MORPHO_AI_BASE_URL: "https://provider.test/v1",
    MORPHO_AI_MODEL: "test-model"
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
