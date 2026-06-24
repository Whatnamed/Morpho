import { describe, expect, it } from "vitest";

import { createMiMoChatRequest, extractCitations, parseOpenAiCompatibleSse, parseOpenAiCompatibleSseEvents } from "./mimoProvider";

describe("MiMo provider adapter", () => {
  it("keeps the API key in headers and never in the provider JSON body", () => {
    const request = createMiMoChatRequest({
      apiKeys: ["secret-key"],
      baseUrl: "https://mimo.example/v1",
      textModel: "mimo-text",
      multimodalModel: "mimo-vision",
      webSearchEnabled: false
    }, {
      messages: [{ role: "user", content: "你好" }],
      systemPrompt: "Morpho context",
      stream: true,
      capability: "text"
    });

    expect(request.url).toBe("https://mimo.example/v1/chat/completions");
    expect(request.headers["api-key"]).toBe("secret-key");
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body.model).toBe("mimo-text");
    expect(request.body.thinking).toEqual({ type: "disabled" });
    expect(JSON.stringify(request.body)).not.toContain("secret-key");
  });

  it("routes visual understanding requests to the configured multimodal model", () => {
    const request = createMiMoChatRequest({
      apiKeys: ["secret-key"],
      baseUrl: "https://mimo.example/v1",
      textModel: "mimo-text",
      multimodalModel: "mimo-vision",
      webSearchEnabled: false
    }, {
      messages: [{ role: "user", content: "分析这张图" }],
      systemPrompt: "Morpho context",
      stream: true,
      capability: "multimodal"
    });

    expect(request.body.model).toBe("mimo-vision");
  });

  it("adds native web_search tool params when authorized", () => {
    const request = createMiMoChatRequest({
      apiKeys: ["secret-key"],
      baseUrl: "https://mimo.example/v1",
      textModel: "mimo-text",
      multimodalModel: "mimo-vision",
      webSearchEnabled: true
    }, {
      messages: [{ role: "user", content: "请联网核实" }],
      systemPrompt: "Morpho context",
      stream: true,
      capability: "text",
      webSearch: {
        enabled: true,
        maxKeyword: 2,
        forceSearch: true,
        limit: 3
      }
    });

    expect(request.body.tools).toEqual([
      {
        type: "web_search",
        max_keyword: 2,
        force_search: true,
        limit: 3
      }
    ]);
  });

  it("parses OpenAI-compatible streaming deltas into plain assistant text", () => {
    const text = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"，Morpho"}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    expect(parseOpenAiCompatibleSse(text)).toEqual(["你好", "，Morpho"]);
  });

  it("parses provider citation annotations without fabricating from normal text", () => {
    const text = [
      'data: {"choices":[{"delta":{"content":"已核实。","annotations":[{"type":"url_citation","url_citation":{"title":"MiMo Docs","url":"https://mimo.mi.com/docs","content":"docs"}}]}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    expect(parseOpenAiCompatibleSseEvents(text)).toEqual([
      { type: "delta", text: "已核实。" },
      {
        type: "citations",
        citations: [
          {
            title: "MiMo Docs",
            url: "https://mimo.mi.com/docs",
            domain: "mimo.mi.com",
            snippet: "docs"
          }
        ]
      }
    ]);
    expect(extractCitations({ choices: [{ delta: { content: "普通文本 https://example.com" } }] })).toEqual([]);
  });
});
