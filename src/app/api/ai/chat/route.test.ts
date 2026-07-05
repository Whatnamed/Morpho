import { beforeEach, describe, expect, it, vi } from "vitest";

import { MiMoProviderError } from "@/server/ai/errors";

import { POST } from "./route";

vi.mock("@/server/ai/config", () => ({
  loadAiConfig: () => ({
    status: "ok",
    config: {
      provider: "mimo",
      apiKey: "test-key",
      baseUrl: "https://example.test",
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

const streamMiMoChatMock = vi.fn();

vi.mock("@/server/ai/mimoProvider", () => ({
  streamMiMoChat: (...args: unknown[]) => streamMiMoChatMock(...args)
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
    streamMiMoChatMock.mockReset();
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
    expect(streamMiMoChatMock).not.toHaveBeenCalled();
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
    expect(streamMiMoChatMock).not.toHaveBeenCalled();
  });

  it("returns provider request diagnostics with modality and web search context", async () => {
    streamMiMoChatMock.mockRejectedValueOnce(new MiMoProviderError("requestInvalid", 400));

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
    expect(streamMiMoChatMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capability: "multimodal",
        webSearch: expect.objectContaining({ enabled: true })
      })
    );
  });
});
