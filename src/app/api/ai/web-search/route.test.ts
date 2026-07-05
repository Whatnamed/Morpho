import { afterEach, describe, expect, it } from "vitest";

import { POST } from "./route";

describe("web search route", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests when agent web search is disabled", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "false";

    const response = await POST(
      new Request("http://localhost/api/ai/web-search", {
        method: "POST",
        body: JSON.stringify({ queries: ["night rail constraints"] })
      })
    );

    expect(response.status).toBe(403);
  });
});
