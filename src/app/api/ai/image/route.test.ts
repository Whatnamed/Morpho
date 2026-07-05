import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const loadGrsImageConfigMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: "ok",
    config: {
      apiKey: "test-key",
      baseUrl: "https://image.example.test",
      model: "nano-banana-fast"
    }
  }))
);

vi.mock("@/server/image/config", () => ({
  loadGrsImageConfig: () => loadGrsImageConfigMock()
}));

const guardAiRouteMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const resolveGrsImageResultMock = vi.fn();

vi.mock("@/server/image/grsProvider", () => ({
  resolveGrsImageResult: (...args: unknown[]) => resolveGrsImageResultMock(...args)
}));

describe("AI image route auth guard", () => {
  beforeEach(() => {
    guardAiRouteMock.mockReset();
    guardAiRouteMock.mockResolvedValue({
      status: "allowed",
      usage: {
        role: "tester",
        accessStatus: "active",
        dailyTextLimit: 20,
        dailyImageLimit: 4,
        textRequestCount: 0,
        imageRequestCount: 1,
        usageDate: "2026-07-05"
      }
    });
    resolveGrsImageResultMock.mockReset();
    loadGrsImageConfigMock.mockClear();
  });

  it("returns JSON 401 for unauthenticated requests before image provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({
          prompt: "生成柔光轨道产品图",
          images: [],
          aspectRatio: "1:1"
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(loadGrsImageConfigMock).not.toHaveBeenCalled();
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
  });

  it("returns JSON 429 when image quota is exhausted before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 429,
      error: "今日生图额度已用完，请明天再试。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/image", {
        method: "POST",
        body: JSON.stringify({
          prompt: "生成柔光轨道产品图",
          images: [],
          aspectRatio: "1:1"
        })
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "今日生图额度已用完，请明天再试。" });
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
  });
});
