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

  it("falls back only when Responses is explicitly unsupported", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      if (String(input).endsWith("/responses")) {
        return new Response("Responses endpoint unsupported", { status: 404 }) as unknown as Response;
      }
      return jsonResponse({
        id: "chat_123",
        choices: [{ message: { role: "assistant", content: "fallback response" } }]
      }) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(config(), request());
      expect(calls).toEqual(["https://api.example.com/v1/responses", "https://api.example.com/v1/chat/completions"]);
      expect(result.outputText).toBe("fallback response");
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

  it("falls back to Chat Completions after repeated Responses gateway failures", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      if (String(input).endsWith("/responses")) {
        return new Response("bad gateway", { status: 502 }) as unknown as Response;
      }
      return jsonResponse({
        id: "chat_after_gateway_failure",
        choices: [{ message: { role: "assistant", content: "chat fallback response" } }]
      }) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(config(), request());
      expect(calls).toEqual([
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/chat/completions"
      ]);
      expect(result.outputText).toBe("chat fallback response");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("preserves Chat Completions fallback reasoning and function-call deltas", async () => {
    const calls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      calls.push(String(input));
      if (String(input).endsWith("/responses")) {
        return new Response("unsupported endpoint", { status: 405 }) as unknown as Response;
      }
      return sseResponse([
        'data: {"id":"chat_1","choices":[{"delta":{"reasoning_content":"checking"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_selected_context","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n"
      ]) as unknown as Response;
    };

    try {
      const events: string[] = [];
      const result = await streamOpenAiCompatibleResponse(config(), request(), {
        onEvent: (event) => events.push(event.type)
      });
      expect(calls).toEqual(["https://api.example.com/v1/responses", "https://api.example.com/v1/chat/completions"]);
      expect(events).toContain("reasoning-delta");
      expect(events).toContain("function-call-ready");
      expect(result.functionCalls[0]).toMatchObject({
        callId: "call_1",
        name: "read_selected_context",
        argumentsText: "{}"
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("buffers Chat Completions text as commentary when a tool call follows", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      if (String(input).endsWith("/responses")) {
        return new Response("unsupported endpoint", { status: 405 }) as unknown as Response;
      }
      return sseResponse([
        'data: {"id":"chat_1","choices":[{"delta":{"content":"我先读取当前选择。"}}]}\n\n',
        'data: {"id":"chat_1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_selected_context","arguments":"{}"}}]}}]}\n\n',
        "data: [DONE]\n\n"
      ]) as unknown as Response;
    };

    try {
      const events: Array<{ type: string; delta?: string }> = [];
      const finalDeltas: string[] = [];
      const result = await streamOpenAiCompatibleResponse(config(), request(), {
        onEvent: (event) => events.push(event),
        onTextDelta: (delta) => finalDeltas.push(delta)
      });

      expect(events.map((event) => event.type)).toEqual([
        "commentary-start",
        "commentary-delta",
        "commentary-end",
        "function-call-ready"
      ]);
      expect(events.find((event) => event.type === "commentary-delta")?.delta).toBe("我先读取当前选择。");
      expect(finalDeltas).toEqual([]);
      expect(result.outputText).toBe("");
      expect(result.functionCalls).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("buffers pure Chat Completions text as final without duplicating commentary", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      if (String(input).endsWith("/responses")) {
        return new Response("unsupported endpoint", { status: 405 }) as unknown as Response;
      }
      return sseResponse([
        'data: {"id":"chat_1","choices":[{"delta":{"content":"最终"}}]}\n\n',
        'data: {"id":"chat_1","choices":[{"delta":{"content":"答复"}}]}\n\n',
        "data: [DONE]\n\n"
      ]) as unknown as Response;
    };

    try {
      const events: Array<{ type: string; delta?: string }> = [];
      const finalDeltas: string[] = [];
      const result = await streamOpenAiCompatibleResponse(config(), request(), {
        onEvent: (event) => events.push(event),
        onTextDelta: (delta) => finalDeltas.push(delta)
      });

      expect(events.map((event) => event.type)).toEqual(["final-start", "final-delta", "final-delta", "final-end"]);
      expect(events.map((event) => event.type)).not.toContain("commentary-delta");
      expect(finalDeltas).toEqual(["最终", "答复"]);
      expect(result.outputText).toBe("最终答复");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("classifies buffered JSON Chat fallback text as commentary when tools are present", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      if (String(input).endsWith("/responses")) {
        return new Response("unsupported endpoint", { status: 405 }) as unknown as Response;
      }
      return jsonResponse({
        id: "chat_1",
        choices: [
          {
            message: {
              role: "assistant",
              content: "我先读取当前选择。",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "read_selected_context", arguments: "{}" }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
      }) as unknown as Response;
    };

    try {
      const events: string[] = [];
      const result = await streamOpenAiCompatibleResponse(config(), request(), {
        onEvent: (event) => events.push(event.type)
      });

      expect(events).toEqual([
        "commentary-start",
        "commentary-delta",
        "commentary-end",
        "function-call-ready",
        "usage"
      ]);
      expect(result.outputText).toBe("");
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
