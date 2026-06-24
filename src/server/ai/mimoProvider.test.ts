import { describe, expect, it } from "vitest";

import { createMiMoChatRequest, parseOpenAiCompatibleSse } from "./mimoProvider";

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
});
