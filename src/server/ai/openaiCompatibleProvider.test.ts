import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeOpenAiCompatibleResponse,
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse
} from "./openaiCompatibleProvider";
import {
  PROVIDER_BUFFERED_RESPONSE_MAX_BYTES,
  PROVIDER_OVERALL_DEADLINE_MS,
  PROVIDER_SSE_PENDING_MAX_BYTES
} from "./providerResponseBoundary";

describe("openai-compatible provider adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("extracts text, tool calls, citations, and usage from a Responses result", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      jsonResponse({
        id: "resp_123",
        usage: {
          input_tokens: 1234,
          output_tokens: 56,
          total_tokens: 1290
        },
        output: [
          { type: "web_search_call", id: "ws_1" },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "已找到外部证据。",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: {
                      title: "Example",
                      url: "https://example.com/article",
                      snippet: "snippet"
                    }
                  }
                ]
              }
            ]
          },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "read_selected_context",
            arguments: "{}"
          }
        ]
      }) as unknown as Response;

    try {
      const result = await executeOpenAiCompatibleResponse(config(), request());

      expect(result).toMatchObject({
        responseId: "resp_123",
        outputText: "",
        functionCalls: [
          {
            id: "fc_1",
            callId: "call_1",
            name: "read_selected_context",
            argumentsText: "{}"
          }
        ],
        citations: [
          {
            title: "Example",
            url: "https://example.com/article",
            domain: "example.com",
            snippet: "snippet"
          }
        ],
        webSearchCallCount: 1,
        usage: {
          inputTokens: 1234,
          outputTokens: 56,
          totalTokens: 1290
        }
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fails before exposing or executing a Provider response with more than 64 calls", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => jsonResponse({
      id: "resp_too_many_calls",
      output: Array.from({ length: 65 }, (_, index) => ({
        type: "function_call",
        id: `fc_${index}`,
        call_id: `call_${index}`,
        name: "read_selected_context",
        arguments: "{}"
      }))
    }) as unknown as Response;

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({
        code: "function_call_limit"
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("forwards prompt cache fields only when the provider capability is explicitly enabled", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const originalFetch = global.fetch;
    global.fetch = async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({
        id: "resp_cached",
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          total_tokens: 110,
          input_tokens_details: { cached_tokens: 60 }
        },
        output: [{ type: "message", content: [{ type: "output_text", text: "cached" }] }]
      }) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          ...config(),
          promptCache: {
            supportsPromptCacheKey: true,
            supportsPromptCacheRetention: true,
            promptCacheKeyEnabled: true,
            promptCacheRetention: "24h"
          }
        },
        {
          ...request(),
          promptCacheKey: "morpho:project:model:contract:standard",
          promptCacheRetention: "24h"
        }
      );
      expect(calls[0]).toMatchObject({
        prompt_cache_key: "morpho:project:model:contract:standard",
        prompt_cache_retention: "24h"
      });
      expect(result.usage).toMatchObject({ cachedInputTokens: 60, uncachedInputTokens: 40, cacheHitRatio: 0.6 });
      expect(result.providerDiagnostics).toMatchObject({
        cachedInputTokens: 60,
        uncachedInputTokens: 40,
        cacheHitRatio: 0.6
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries once without unsupported prompt cache fields after a compatible 400", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const originalFetch = global.fetch;
    global.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: { message: "Unknown field prompt_cache_key" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }) as unknown as Response;
      }
      return jsonResponse({
        id: "resp_no_cache",
        output: [{ type: "message", content: [{ type: "output_text", text: "fallback" }] }]
      }) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          ...config(),
          promptCache: {
            supportsPromptCacheKey: true,
            supportsPromptCacheRetention: false,
            promptCacheKeyEnabled: true
          }
        },
        { ...request(), promptCacheKey: "morpho:cache-key" }
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]).toHaveProperty("prompt_cache_key", "morpho:cache-key");
      expect(calls[1]).not.toHaveProperty("prompt_cache_key");
      expect(result.outputText).toBe("fallback");
      expect(result.providerDiagnostics?.cacheStatus).toBe("unavailable");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not send cache fields when the provider capability is disabled", async () => {
    const originalFetch = global.fetch;
    let body: Record<string, unknown> | undefined;
    global.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ id: "resp_default", output: [] }) as unknown as Response;
    };
    try {
      await executeOpenAiCompatibleResponse(
        config(),
        { ...request(), promptCacheKey: "should-not-forward", promptCacheRetention: "24h" }
      );
      expect(body).not.toHaveProperty("prompt_cache_key");
      expect(body).not.toHaveProperty("prompt_cache_retention");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("requests Responses with stream and a reasoning summary by default", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return sseResponse([
        responseEvent("response.created", { response: { id: "resp_stream" } }),
        responseEvent("response.output_item.added", {
          output_index: 0,
          item: { id: "msg_1", type: "message", role: "assistant", phase: "final_answer", content: [] }
        }),
        responseEvent("response.output_text.delta", { item_id: "msg_1", delta: "hello " }),
        responseEvent("response.output_text.delta", { item_id: "msg_1", delta: "world" }),
        responseEvent("response.output_item.done", {
          output_index: 0,
          item: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [{ type: "output_text", text: "hello world" }]
          }
        }),
        responseEvent("response.completed", {
          response: {
            id: "resp_stream",
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }
          }
        })
      ]) as unknown as Response;
    };

    try {
      const deltas: string[] = [];
      const result = await streamOpenAiCompatibleResponse(
        { ...config(), baseUrl: "https://api.aijws.com/v1", reasoningEffort: "high" },
        request(),
        { onTextDelta: (delta) => deltas.push(delta) }
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        url: "https://api.aijws.com/v1/responses",
        body: {
          model: "gpt-5.4",
          stream: true,
          reasoning: { effort: "high", summary: "auto" },
          input: request().input
        }
      });
      expect(deltas).toEqual(["hello ", "world"]);
      expect(result.outputText).toBe("hello world");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("streams reasoning, commentary, tool calls, and final text in provider order", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      sseResponse([
        responseEvent("response.created", { response: { id: "resp_1" } }),
        responseEvent("response.output_item.added", {
          output_index: 0,
          item: { id: "reasoning_1", type: "reasoning", content: [] }
        }),
        responseEvent("response.reasoning_summary_part.added", { item_id: "reasoning_1", summary_index: 0 }),
        responseEvent("response.reasoning_summary_text.delta", {
          item_id: "reasoning_1",
          summary_index: 0,
          delta: "检查当前输入。"
        }),
        responseEvent("response.reasoning_summary_part.done", { item_id: "reasoning_1", summary_index: 0 }),
        responseEvent("response.output_item.added", {
          output_index: 1,
          item: { id: "commentary_1", type: "message", role: "assistant", phase: "commentary", content: [] }
        }),
        responseEvent("response.output_text.delta", { item_id: "commentary_1", delta: "我会先读取资料。" }),
        responseEvent("response.output_item.done", {
          output_index: 1,
          item: {
            id: "commentary_1",
            type: "message",
            role: "assistant",
            phase: "commentary",
            content: [{ type: "output_text", text: "我会先读取资料。" }]
          }
        }),
        responseEvent("response.output_item.added", {
          output_index: 2,
          item: {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "read_selected_context",
            arguments: ""
          }
        }),
        responseEvent("response.function_call_arguments.delta", { item_id: "fc_1", delta: "{\"scope\":\"selected\"}" }),
        responseEvent("response.output_item.done", {
          output_index: 2,
          item: {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "read_selected_context",
            arguments: "{\"scope\":\"selected\"}"
          }
        }),
        responseEvent("response.completed", {
          response: {
            id: "resp_1",
            usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 }
          }
        })
      ]) as unknown as Response;

    try {
      const events: string[] = [];
      const result = await streamOpenAiCompatibleResponse(config(), request(), {
        onEvent: (event) => events.push(event.type)
      });

      expect(events).toEqual([
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "commentary-start",
        "commentary-delta",
        "commentary-end",
        "function-call-ready",
        "usage"
      ]);
      expect(result.outputText).toBe("");
      expect(result.functionCalls).toEqual([
        {
          id: "fc_1",
          callId: "call_1",
          name: "read_selected_context",
          argumentsText: "{\"scope\":\"selected\"}"
        }
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not call Chat Completions when Responses is unsupported", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      return new Response("Responses endpoint unsupported", { status: 404 }) as unknown as Response;
    };

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({ status: 404 });
      expect(calls).toEqual(["https://api.example.com/v1/responses"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries a transient Responses gateway failure before succeeding", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response("bad gateway", { status: 502 }) as unknown as Response;
      }
      return jsonResponse({
        id: "resp_retried",
        output: [{ type: "message", content: [{ type: "output_text", text: "retried response" }] }]
      }) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(config(), request());
      expect(calls).toEqual(["https://api.example.com/v1/responses", "https://api.example.com/v1/responses"]);
      expect(result.outputText).toBe("retried response");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("keeps repeated Responses gateway failures on the Responses endpoint", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      return new Response("bad gateway", { status: 502 }) as unknown as Response;
    };

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({ status: 502 });
      expect(calls).toEqual([
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/responses"
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  }, 15_000);

  it("falls back to a buffered Responses request after repeated stream gateway failures", async () => {
    const calls: Array<{ url: string; stream: boolean | undefined }> = [];
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      calls.push({ url: String(input), stream: body.stream });
      if (body.stream) {
        return new Response("bad gateway", { status: 502 }) as unknown as Response;
      }
      return jsonResponse({
        id: "resp_buffered",
        output: [{ type: "message", content: [{ type: "output_text", text: "buffered Responses result" }] }]
      }) as unknown as Response;
    };

    try {
      const result = await streamOpenAiCompatibleResponse(config(), request(), {});
      expect(calls).toEqual([
        { url: "https://api.example.com/v1/responses", stream: true },
        { url: "https://api.example.com/v1/responses", stream: true },
        { url: "https://api.example.com/v1/responses", stream: true },
        { url: "https://api.example.com/v1/responses", stream: true },
        { url: "https://api.example.com/v1/responses", stream: undefined }
      ]);
      expect(result.outputText).toBe("buffered Responses result");
    } finally {
      global.fetch = originalFetch;
    }
  }, 15_000);

  it("falls back to a buffered Responses request when an event stream ends early", async () => {
    const calls: Array<{ url: string; stream: boolean | undefined }> = [];
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      calls.push({ url: String(input), stream: body.stream });
      if (body.stream) {
        return sseResponse([responseEvent("response.created", { response: { id: "resp_incomplete" } })]) as unknown as Response;
      }
      return jsonResponse({
        id: "resp_recovered",
        output: [{ type: "message", content: [{ type: "output_text", text: "recovered Responses result" }] }]
      }) as unknown as Response;
    };

    try {
      const result = await streamOpenAiCompatibleResponse(config(), request(), {});
      expect(calls).toEqual([
        { url: "https://api.example.com/v1/responses", stream: true },
        { url: "https://api.example.com/v1/responses", stream: undefined }
      ]);
      expect(result.outputText).toBe("recovered Responses result");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("surfaces context-limit diagnostics", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      jsonResponse(
        {
          error: {
            message: "This model's maximum context length is 128000 tokens.",
            code: "context_length_exceeded"
          }
        },
        400
      ) as unknown as Response;

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({
        status: 400,
        code: "context_limit"
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects an oversized buffered JSON response from Content-Length before parsing it", async () => {
    const originalFetch = global.fetch;
    const cancelled = vi.fn();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel: cancelled
    }), {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(PROVIDER_BUFFERED_RESPONSE_MAX_BYTES + 1)
      }
    }));
    global.fetch = fetchMock;

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({
        code: "provider_response_too_large"
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("turns malformed buffered JSON below the size limit into a controlled Provider error", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => new Response("{invalid", {
      headers: { "Content-Type": "application/json" }
    }));
    global.fetch = fetchMock;

    try {
      await expect(executeOpenAiCompatibleResponse(config(), request())).rejects.toMatchObject({
        status: 502,
        diagnostic: "Responses endpoint returned invalid JSON."
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not start buffered fallback when an SSE frame exceeds the pending-byte limit", async () => {
    const originalFetch = global.fetch;
    const cancelled = vi.fn();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: " + "x".repeat(PROVIDER_SSE_PENDING_MAX_BYTES + 1)));
      },
      cancel: cancelled
    }), { headers: { "Content-Type": "text/event-stream" } }));
    global.fetch = fetchMock;

    try {
      await expect(streamOpenAiCompatibleResponse(config(), request(), {})).rejects.toMatchObject({
        code: "provider_response_too_large"
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("applies the internal deadline to a fetch that never resolves without retrying", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;

    try {
      const pending = executeOpenAiCompatibleResponse(config(), request());
      const rejected = expect(pending).rejects.toMatchObject({ code: "provider_deadline_exceeded" });
      await vi.advanceTimersByTimeAsync(PROVIDER_OVERALL_DEADLINE_MS);

      await rejected;
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("cancels an SSE reader stuck after fetch and does not start buffered fallback at the deadline", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    const cancelled = vi.fn();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: cancelled
    }), { headers: { "Content-Type": "text/event-stream" } }));
    global.fetch = fetchMock;

    try {
      const pending = streamOpenAiCompatibleResponse(config(), request(), {});
      const rejected = expect(pending).rejects.toMatchObject({ code: "provider_deadline_exceeded" });
      await vi.advanceTimersByTimeAsync(PROVIDER_OVERALL_DEADLINE_MS);

      await rejected;
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("preserves an external AbortError instead of translating it to the internal deadline", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;
    const controller = new AbortController();

    try {
      const pending = executeOpenAiCompatibleResponse(config(), request(), controller.signal);
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not issue a transient retry after the shared deadline expires during backoff", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn(() => first);
    global.fetch = fetchMock;

    try {
      const pending = executeOpenAiCompatibleResponse(config(), request());
      const rejected = expect(pending).rejects.toMatchObject({ code: "provider_deadline_exceeded" });
      await vi.advanceTimersByTimeAsync(PROVIDER_OVERALL_DEADLINE_MS - 100);
      resolveFirst(new Response("bad gateway", { status: 502 }));
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("shares the original deadline with stream-to-buffered fallback", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    let resolveStream!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveStream = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;

    try {
      const pending = streamOpenAiCompatibleResponse(config(), request(), {});
      const rejected = expect(pending).rejects.toMatchObject({ code: "provider_deadline_exceeded" });
      await vi.advanceTimersByTimeAsync(PROVIDER_OVERALL_DEADLINE_MS - 100);
      resolveStream(sseResponse([responseEvent("response.created", { response: { id: "incomplete" } })]));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("shares the original deadline with the prompt-cache compatibility retry", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;

    try {
      const pending = executeOpenAiCompatibleResponse(
        {
          ...config(),
          promptCache: {
            supportsPromptCacheKey: true,
            supportsPromptCacheRetention: false,
            promptCacheKeyEnabled: true
          }
        },
        { ...request(), promptCacheKey: "morpho:shared-budget" }
      );
      const rejected = expect(pending).rejects.toMatchObject({ code: "provider_deadline_exceeded" });
      await vi.advanceTimersByTimeAsync(PROVIDER_OVERALL_DEADLINE_MS - 100);
      resolveFirst(new Response(JSON.stringify({ error: { message: "Unknown field prompt_cache_key" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

function config() {
  return {
    apiKey: "secret",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-5.4",
    webSearchEnabled: true
  };
}

function request() {
  return {
    input: [
      {
        role: "user" as const,
        content: [{ type: "input_text" as const, text: "hi" }]
      }
    ]
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
        controller.close();
      }
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function responseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}
