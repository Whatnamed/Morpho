import { describe, expect, it } from "vitest";

import {
  executeOpenAiCompatibleResponse,
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse
} from "./openaiCompatibleProvider";

describe("openai-compatible provider adapter", () => {
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
