import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/server/ai/openaiCompatibleConfig", () => ({
  loadOpenAiCompatibleConfig: () => ({
    status: "ok",
    config: {
      apiKey: "test-key",
      baseUrl: "https://api.aijws.com/v1",
      model: "gpt-5.4",
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
    constructor(
      readonly status: number,
      readonly diagnostic?: string
    ) {
      super(`provider ${status}`);
    }
  }
}));

describe("AI chat route", () => {
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
    executeOpenAiCompatibleResponseMock.mockResolvedValue({
      responseId: "resp_123",
      outputText: "已继续分析。",
      functionCalls: [],
      citations: [{ title: "Source", url: "https://example.com" }],
      webSearchCallCount: 0,
      outputItems: []
    });
  });

  it("returns JSON 401 for unauthenticated requests before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          draft: "继续讨论",
          messages: [],
          objectSummaries: [],
          attachments: []
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(executeOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("returns JSON 429 when text quota is exhausted before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 429,
      error: "今日文本 AI 额度已用完，请明天再试。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          draft: "继续讨论",
          messages: [],
          objectSummaries: [],
          attachments: []
        })
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "今日文本 AI 额度已用完，请明天再试。" });
    expect(executeOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("routes chat, image input, and web-search intent through the AiJWS-compatible provider", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          draft: "分析这张图并联网补充依据",
          messages: [],
          objectSummaries: [],
          attachments: [
            {
              id: "asset-a",
              kind: "image",
              objectId: "image-a",
              mimeType: "image/png",
              dataUrl: "data:image/png;base64,abc123",
              status: "ready"
            }
          ],
          webSearch: {
            enabled: true,
            forceSearch: true
          }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("\"type\":\"delta\"");
    expect(executeOpenAiCompatibleResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.aijws.com/v1",
        model: "gpt-5.4"
      }),
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "input_image", image_url: "data:image/png;base64,abc123" })
            ])
          })
        ]),
        tools: [expect.objectContaining({ type: "web_search_preview" })]
      }),
      expect.any(AbortSignal)
    );
  });

  it("returns AiJWS diagnostics with image and web-search context", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    executeOpenAiCompatibleResponseMock.mockRejectedValueOnce(
      new OpenAiCompatibleProviderError(400, "unsupported image input")
    );

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          draft: "分析这张图并联网补充依据",
          messages: [],
          objectSummaries: [],
          attachments: [
            {
              id: "asset-a",
              kind: "image",
              objectId: "image-a",
              mimeType: "image/png",
              dataUrl: "data:image/png;base64,abc123",
              status: "ready"
            }
          ],
          webSearch: {
            enabled: true,
            forceSearch: true
          }
        })
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("图片输入 1 个")
    });
  });
});
