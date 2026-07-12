import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { filterAgentRequestForConfig } from "@/server/ai/agentRoute";
import type { OpenAiCompatibleResponseRequest } from "@/server/ai/openaiCompatibleProvider";

vi.mock("@/server/ai/openaiCompatibleConfig", () => ({
  loadOpenAiCompatibleConfig: () => ({
    status: "ok",
    config: {
      provider: "aijws",
      apiKey: "test-key",
      baseUrl: "https://agent.example.test",
      model: "test-model",
      webSearchEnabled: true,
      contextWindowTokens: 372_000,
      contextPrepareTokens: 200_000,
      contextCompactTokens: 300_000,
      contextTargetTokens: 16_000
    }
  })
}));

const guardAiRouteMock = vi.fn();
const requireAiRouteUserMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const executeOpenAiCompatibleResponseMock = vi.fn();

vi.mock("@/server/ai/openaiCompatibleProvider", () => ({
  executeOpenAiCompatibleResponse: (...args: unknown[]) => executeOpenAiCompatibleResponseMock(...args),
  OpenAiCompatibleProviderError: class OpenAiCompatibleProviderError extends Error {
    status: number;
    diagnostic?: string;
    code?: string;

    constructor(status: number, diagnostic?: string) {
      super(`OpenAI-compatible provider error (${status})`);
      this.status = status;
      this.diagnostic = diagnostic;
      this.code = diagnostic?.includes("context_length_exceeded") ? "context_limit" : undefined;
    }
  }
}));

describe("agent route config filtering", () => {
  beforeEach(() => {
    guardAiRouteMock.mockReset();
    requireAiRouteUserMock.mockReset();
    guardAiRouteMock.mockResolvedValue({
      status: "allowed",
      usage: {
        role: "tester",
        accessStatus: "active",
        dailyTextLimit: 20,
        dailyImageLimit: 4,
        textRequestCount: 1,
        imageRequestCount: 0,
        usageDate: "2026-07-05"
      }
    });
    requireAiRouteUserMock.mockResolvedValue({
      status: "allowed",
      userId: "user-1"
    });
    executeOpenAiCompatibleResponseMock.mockReset();
    executeOpenAiCompatibleResponseMock.mockResolvedValue({
      responseId: "resp_1",
      outputText: "ok",
      functionCalls: [],
      citations: [],
      webSearchCallCount: 0,
      outputItems: []
    });
  });

  it("removes local web search tools before provider execution when disabled", () => {
    const request: OpenAiCompatibleResponseRequest = {
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [
        {
          type: "function",
          name: "read_selected_context",
          description: "Read",
          parameters: { type: "object" }
        },
        {
          type: "function",
          name: "search_web_evidence",
          description: "Search",
          parameters: { type: "object" }
        }
      ]
    };

    expect(
      filterAgentRequestForConfig(request, { webSearchEnabled: false }).tools
        ?.filter((tool) => tool.type === "function")
        .map((tool) => tool.name)
    ).toEqual(["read_selected_context"]);
  });

  it("returns JSON 401 for unauthenticated requests before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        body: JSON.stringify({
          input: [{ role: "user", content: [{ type: "input_text", text: "继续讨论" }] }]
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(executeOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("uses auth-only access for same agent turn continuations", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        body: JSON.stringify({
          agentTurnId: "agent-turn-1",
          continuation: true,
          input: [{ role: "user", content: [{ type: "input_text", text: "continue" }] }]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(requireAiRouteUserMock).toHaveBeenCalledTimes(1);
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(executeOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(1);
  });

  it("returns a machine-readable context limit code while preserving the current Chinese error", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    executeOpenAiCompatibleResponseMock.mockRejectedValue(
      new OpenAiCompatibleProviderError(400, '{"error":{"code":"context_length_exceeded"}}')
    );

    const response = await POST(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        body: JSON.stringify({
          input: [{ role: "user", content: [{ type: "input_text", text: "继续讨论" }] }]
        })
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI-compatible Provider 请求格式不兼容，请检查模型、tools 或图片输入。",
      code: "context_limit"
    });
    expect(executeOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(2);
  });

  it("emergency-compacts and retries a context limit without re-entering the client tool loop", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    executeOpenAiCompatibleResponseMock
      .mockRejectedValueOnce(
        new OpenAiCompatibleProviderError(400, '{"error":{"code":"context_length_exceeded"}}')
      )
      .mockResolvedValueOnce({
        responseId: "resp_retry",
        outputText: "重试完成",
        functionCalls: [],
        citations: [],
        webSearchCallCount: 0,
        outputItems: [],
        usage: {
          inputTokens: 210_000,
          outputTokens: 500,
          totalTokens: 210_500
        }
      });

    const response = await POST(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        body: JSON.stringify({
          agentTurnId: "agent-turn-retry",
          continuation: true,
          input: [
            { role: "system", content: [{ type: "input_text", text: "系统规则" }] },
            { role: "user", content: [{ type: "input_text", text: "旧问题" }] },
            { role: "assistant", content: [{ type: "input_text", text: "旧回答" }] },
            { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
          ]
        })
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outputText).toBe("重试完成");
    expect(payload.context).toMatchObject({
      pressure: "compact",
      compacted: true,
      checkpointRequested: true,
      retried: true
    });
    expect(executeOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(2);
    const retryRequest = executeOpenAiCompatibleResponseMock.mock.calls[1]?.[1] as OpenAiCompatibleResponseRequest;
    expect(JSON.stringify(retryRequest.input)).not.toContain("旧问题");
    expect(JSON.stringify(retryRequest.input)).toContain("当前问题");
  });
});
