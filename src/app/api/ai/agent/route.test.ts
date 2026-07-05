import { beforeEach, describe, expect, it, vi } from "vitest";

import { filterAgentRequestForConfig, POST } from "./route";
import type { OpenAiCompatibleResponseRequest } from "@/server/ai/openaiCompatibleProvider";

vi.mock("@/server/ai/openaiCompatibleConfig", () => ({
  loadOpenAiCompatibleConfig: () => ({
    status: "ok",
    config: {
      provider: "aijws",
      apiKey: "test-key",
      baseUrl: "https://agent.example.test",
      model: "test-model",
      webSearchEnabled: true
    }
  })
}));

const guardAiRouteMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const executeOpenAiCompatibleResponseMock = vi.fn();

vi.mock("@/server/ai/openaiCompatibleProvider", () => ({
  executeOpenAiCompatibleResponse: (...args: unknown[]) => executeOpenAiCompatibleResponseMock(...args),
  OpenAiCompatibleProviderError: class OpenAiCompatibleProviderError extends Error {
    status: number;
    diagnostic?: string;

    constructor(message: string, status: number, diagnostic?: string) {
      super(message);
      this.status = status;
      this.diagnostic = diagnostic;
    }
  }
}));

describe("agent route config filtering", () => {
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
    executeOpenAiCompatibleResponseMock.mockReset();
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

  it("returns JSON 401 for unauthenticated requests before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/agent", {
        method: "POST",
        body: JSON.stringify({
          input: [{ role: "user", content: [{ type: "input_text", text: "继续讨论" }] }]
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(executeOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });
});
