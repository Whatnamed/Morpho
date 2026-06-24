import { describe, expect, it } from "vitest";

import { createMiMoChatRequest, parseOpenAiCompatibleSse } from "./mimoProvider";

describe("MiMo provider adapter", () => {
  it("keeps the API key in headers and never in the provider JSON body", () => {
    const request = createMiMoChatRequest({
      apiKey: "secret-key",
      baseUrl: "https://mimo.example/v1",
      model: "mimo-test"
    }, {
      messages: [{ role: "user", content: "你好" }],
      systemPrompt: "Morpho context",
      stream: true
    });

    expect(request.url).toBe("https://mimo.example/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.stringify(request.body)).not.toContain("secret-key");
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
