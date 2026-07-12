import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { filterAgentRequestForConfig } from "@/server/ai/agentRoute";
import type { OpenAiCompatibleResponseRequest } from "@/server/ai/openaiCompatibleProvider";
import { readAgentRouteSse, type AgentRouteStreamEvent } from "@/shared/agentStreamProtocol";

vi.mock("@/server/ai/openaiCompatibleConfig", () => ({
  loadOpenAiCompatibleConfig: () => ({
    status: "ok",
    config: {
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

const streamOpenAiCompatibleResponseMock = vi.fn();

vi.mock("@/server/ai/openaiCompatibleProvider", () => ({
  streamOpenAiCompatibleResponse: (...args: unknown[]) => streamOpenAiCompatibleResponseMock(...args),
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

describe("agent route stream", () => {
  beforeEach(() => {
    guardAiRouteMock.mockReset();
    requireAiRouteUserMock.mockReset();
    streamOpenAiCompatibleResponseMock.mockReset();
    guardAiRouteMock.mockResolvedValue({ status: "allowed" });
    requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: "user-1" });
    streamOpenAiCompatibleResponseMock.mockImplementation(
      async (_config: unknown, _request: unknown, handlers: { onEvent?: (event: unknown) => void }) => {
        handlers.onEvent?.({ type: "reasoning-start", partId: "reasoning-1" });
        handlers.onEvent?.({ type: "reasoning-delta", partId: "reasoning-1", delta: "检查语境。" });
        handlers.onEvent?.({
          type: "function-call-ready",
          functionCall: {
            id: "fc_1",
            callId: "call_1",
            name: "read_selected_context",
            argumentsText: "{}"
          }
        });
        handlers.onEvent?.({
          type: "usage",
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
        });
        handlers.onEvent?.({ type: "final-delta", partId: "final-1", delta: "完成。" });
        return {
          responseId: "resp_1",
          outputText: "完成。",
          functionCalls: [],
          citations: [],
          webSearchCallCount: 0,
          outputItems: [],
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
        };
      }
    );
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

  it("keeps pre-stream authentication failures as JSON", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(agentRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(streamOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("uses auth-only access for same-turn continuations and returns typed SSE", async () => {
    const response = await POST(
      agentRequest({
        agentTurnId: "agent-turn-1",
        continuation: true
      })
    );
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(requireAiRouteUserMock).toHaveBeenCalledTimes(1);
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(streamOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(1);
    expect(body).toContain("event: turn-start");
    expect(body).toContain("event: reasoning-delta");
    expect(body).toContain("event: function-call-ready");
    expect(body).toContain("event: usage");
    expect(body).toContain("event: turn-complete");
  });

  it("flushes turn-start before the provider completes", async () => {
    let finishProvider: (() => void) | undefined;
    streamOpenAiCompatibleResponseMock.mockImplementationOnce(
      async (_config: unknown, _request: unknown, handlers: { onEvent?: (event: unknown) => void }) => {
        handlers.onEvent?.({ type: "reasoning-start", partId: "reasoning-early" });
        await new Promise<void>((resolve) => {
          finishProvider = resolve;
        });
        return {
          responseId: "resp_delayed",
          outputText: "完成。",
          functionCalls: [],
          citations: [],
          webSearchCallCount: 0,
          outputItems: []
        };
      }
    );

    const response = await POST(agentRequest());
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected an SSE response body.");
    }
    const first = await reader.read();
    const firstChunk = new TextDecoder().decode(first.value);

    expect(firstChunk).toContain("event: turn-start");
    finishProvider?.();
    await reader.cancel();
  });

  it("emits a final stream error after the response has started", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    streamOpenAiCompatibleResponseMock.mockRejectedValue(
      new OpenAiCompatibleProviderError(400, '{"error":{"code":"context_length_exceeded"}}')
    );

    const response = await POST(agentRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: turn-start");
    expect(body).toContain("event: turn-error");
    expect(body).toContain('"code":"context_limit"');
  });

  it("emergency-compacts and retries a context-limit stream without client tool replay", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    let attempt = 0;
    streamOpenAiCompatibleResponseMock.mockImplementation(
      async (_config: unknown, _request: unknown, handlers: { onEvent?: (event: unknown) => void }) => {
        attempt += 1;
        if (attempt === 1) {
          handlers.onEvent?.({ type: "reasoning-start", partId: "reasoning-old" });
          handlers.onEvent?.({ type: "reasoning-delta", partId: "reasoning-old", delta: "半截推理" });
          handlers.onEvent?.({ type: "usage", usage: { inputTokens: 300_000, outputTokens: 20, totalTokens: 300_020 } });
          throw new OpenAiCompatibleProviderError(400, '{"error":{"code":"context_length_exceeded"}}');
        }
        handlers.onEvent?.({ type: "reasoning-start", partId: "reasoning-new" });
        handlers.onEvent?.({ type: "reasoning-delta", partId: "reasoning-new", delta: "正确推理" });
        handlers.onEvent?.({ type: "usage", usage: { inputTokens: 210_000, outputTokens: 500, totalTokens: 210_500 } });
        return {
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
        };
      }
    );

    const response = await POST(
      agentRequest({
        agentTurnId: "agent-turn-retry",
        continuation: true,
        input: [
          { role: "system", content: [{ type: "input_text", text: "系统规则" }] },
          { role: "user", content: [{ type: "input_text", text: "旧问题" }] },
          { role: "assistant", content: [{ type: "input_text", text: "旧回答" }] },
          { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
        ]
      })
    );
    const events: AgentRouteStreamEvent[] = [];
    if (!response.body) {
      throw new Error("Expected an SSE response body.");
    }
    await readAgentRouteSse(response.body, { onEvent: (event) => events.push(event) });

    const start = events.find((event) => event.type === "turn-start");
    const reset = events.find((event) => event.type === "turn-attempt-reset");
    const complete = events.find((event) => event.type === "turn-complete");
    const usageEvents = events.filter((event) => event.type === "usage");
    expect(start).toMatchObject({ attemptId: expect.any(String) });
    expect(reset).toMatchObject({
      attemptId: start && "attemptId" in start ? start.attemptId : undefined,
      nextAttemptId: expect.any(String),
      message: "正在重新整理当前语境"
    });
    expect(reset && "nextAttemptId" in reset ? reset.nextAttemptId : undefined).not.toBe(
      start && "attemptId" in start ? start.attemptId : undefined
    );
    expect(complete).toMatchObject({
      attemptId: reset && "nextAttemptId" in reset ? reset.nextAttemptId : undefined,
      result: expect.objectContaining({ outputText: "重试完成" })
    });
    expect(usageEvents).toHaveLength(2);
    expect(usageEvents[1]).toMatchObject({
      attemptId: reset && "nextAttemptId" in reset ? reset.nextAttemptId : undefined,
      usage: { inputTokens: 210_000 }
    });
    expect(streamOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(2);
    const retryRequest = streamOpenAiCompatibleResponseMock.mock.calls[1]?.[1] as OpenAiCompatibleResponseRequest;
    expect(JSON.stringify(retryRequest.input)).not.toContain("旧问题");
    expect(JSON.stringify(retryRequest.input)).toContain("当前问题");
  });

  it("aborts the upstream provider signal when the response reader is cancelled", async () => {
    let providerSignal: AbortSignal | undefined;
    let markAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    streamOpenAiCompatibleResponseMock.mockImplementationOnce(
      async (
        _config: unknown,
        _request: unknown,
        _handlers: unknown,
        signal: AbortSignal
      ) => {
        providerSignal = signal;
        await new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            markAborted?.();
            reject(new DOMException("aborted", "AbortError"));
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      }
    );

    const response = await POST(agentRequest());
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected an SSE response body.");
    }
    await reader.read();
    await reader.cancel();
    await aborted;

    expect(providerSignal?.aborted).toBe(true);
    expect(streamOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(1);
  });
});

function agentRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/ai/agent", {
    method: "POST",
    body: JSON.stringify({
      input: [{ role: "user", content: [{ type: "input_text", text: "继续讨论" }] }],
      ...overrides
    })
  });
}
