import { describe, expect, it } from "vitest";

import {
  executeOpenAiCompatibleResponse,
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse
} from "./openaiCompatibleProvider";

describe("openai-compatible provider adapter", () => {
  it("extracts text, tool calls, citations, and web search count from responses output", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp_123",
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ) as unknown as Response;

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          apiKey: "secret",
          baseUrl: "https://api.example.com/v1",
          model: "gpt-5.4",
          webSearchEnabled: true
        },
        {
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: "hi" }]
            }
          ]
        }
      );

      expect(result).toEqual({
        responseId: "resp_123",
        outputText: "已找到外部证据。",
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
        outputItems: [
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
        ],
        webSearchCallCount: 1
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("surfaces provider diagnostics on non-200 responses", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response("bad request", { status: 400 }) as unknown as Response;

    try {
      await expect(
        executeOpenAiCompatibleResponse(
          {
            apiKey: "secret",
            baseUrl: "https://api.example.com/v1",
            model: "gpt-5.4",
            webSearchEnabled: true
          },
          {
            input: [
              {
                role: "user",
                content: [{ type: "input_text", text: "hi" }]
              }
            ]
          }
        )
      ).rejects.toEqual(expect.any(OpenAiCompatibleProviderError));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls back to chat completions for image turns when responses rejects image input", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body))
      });

      if (String(input).endsWith("/responses")) {
        return new Response("bad gateway", { status: 502 }) as unknown as Response;
      }

      return new Response(
        JSON.stringify({
          id: "chat_123",
          choices: [
            {
              message: {
                role: "assistant",
                content: "red"
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          apiKey: "secret",
          baseUrl: "https://api.example.com/v1",
          model: "gpt-5.4",
          webSearchEnabled: true
        },
        {
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "What color?" },
                { type: "input_image", image_url: "data:image/png;base64,abc" }
              ]
            }
          ]
        }
      );

      expect(calls.map((call) => call.url)).toEqual([
        "https://api.example.com/v1/responses",
        "https://api.example.com/v1/chat/completions"
      ]);
      expect(calls[1].body).toEqual({
        model: "gpt-5.4",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What color?" },
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }
            ]
          }
        ]
      });
      expect(result.outputText).toBe("red");
      expect(result.outputItems).toEqual([
        {
          type: "message",
          content: [{ type: "output_text", text: "red" }]
        }
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses chat completions first for aijws-compatible endpoints", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body))
      });

      return new Response(
        JSON.stringify({
          id: "chat_aijws_123",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_selected_context",
                      arguments: "{}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          apiKey: "secret",
          baseUrl: "https://api.aijws.com/v1",
          model: "gpt-5.4",
          webSearchEnabled: true
        },
        {
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: "Read context." }]
            }
          ],
          tools: [
            {
              type: "function",
              name: "read_selected_context",
              description: "Read context",
              parameters: { type: "object", additionalProperties: false, properties: {} },
              strict: true
            }
          ]
        }
      );

      expect(calls.map((call) => call.url)).toEqual(["https://api.aijws.com/v1/chat/completions"]);
      expect(calls[0].body).toEqual({
        model: "gpt-5.4",
        messages: [
          {
            role: "user",
            content: "Read context."
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "read_selected_context",
              description: "Read context",
              parameters: { type: "object", additionalProperties: false, properties: {} }
            }
          }
        ]
      });
      expect(result.functionCalls).toEqual([
        {
          id: "call_1",
          callId: "call_1",
          name: "read_selected_context",
          argumentsText: "{}"
        }
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("streams chat completion deltas from aijws-compatible endpoints", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = global.fetch;
    const encoder = new TextEncoder();
    global.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body))
      });

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      ) as unknown as Response;
    };

    try {
      const deltas: string[] = [];
      const result = await streamOpenAiCompatibleResponse(
        {
          apiKey: "secret",
          baseUrl: "https://api.aijws.com/v1",
          model: "gpt-5.6-terra",
          reasoningEffort: "high",
          webSearchEnabled: true
        },
        {
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: "hi" }]
            }
          ]
        },
        {
          onTextDelta: (text) => deltas.push(text)
        }
      );

      expect(calls[0].url).toBe("https://api.aijws.com/v1/chat/completions");
      expect(calls[0].body).toEqual({
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "hi" }],
        stream: true
      });
      expect(deltas).toEqual(["hello ", "world"]);
      expect(result.outputText).toBe("hello world");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("converts chat tool calls into the agent response shape", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input) => {
      if (String(input).endsWith("/responses")) {
        return new Response("bad gateway", { status: 502 }) as unknown as Response;
      }

      return new Response(
        JSON.stringify({
          id: "chat_tool_123",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_selected_context",
                      arguments: "{}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ) as unknown as Response;
    };

    try {
      const result = await executeOpenAiCompatibleResponse(
        {
          apiKey: "secret",
          baseUrl: "https://api.example.com/v1",
          model: "gpt-5.4",
          webSearchEnabled: true
        },
        {
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "Read context." },
                { type: "input_image", image_url: "data:image/png;base64,abc" }
              ]
            }
          ],
          tools: [
            {
              type: "function",
              name: "read_selected_context",
              description: "Read context",
              parameters: { type: "object", additionalProperties: false, properties: {} },
              strict: true
            }
          ]
        }
      );

      expect(result.functionCalls).toEqual([
        {
          id: "call_1",
          callId: "call_1",
          name: "read_selected_context",
          argumentsText: "{}"
        }
      ]);
      expect(result.outputItems).toEqual([
        {
          type: "function_call",
          id: "call_1",
          call_id: "call_1",
          name: "read_selected_context",
          arguments: "{}"
        }
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
