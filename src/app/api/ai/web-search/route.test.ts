import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const guardAiRouteMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const searchWebEvidenceMock = vi.fn();

vi.mock("@/server/ai/webSearch", () => ({
  searchWebEvidence: (...args: unknown[]) => searchWebEvidenceMock(...args)
}));

describe("web search route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    guardAiRouteMock.mockReset();
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
    searchWebEvidenceMock.mockReset();
  });

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

  it("returns JSON 401 for unauthenticated requests before external search execution", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/web-search", {
        method: "POST",
        body: JSON.stringify({ queries: ["night rail constraints"] })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(searchWebEvidenceMock).not.toHaveBeenCalled();
  });
});
