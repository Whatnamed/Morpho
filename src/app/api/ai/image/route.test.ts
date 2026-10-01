import { createExternalResultFake } from "@/test/externalResultFake";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const resultFake = vi.hoisted(() => ({ current: undefined as ReturnType<typeof createExternalResultFake> | undefined }));
vi.mock("@/server/ai/externalResultStore", async () => ({
  ...await vi.importActual<typeof import("@/server/ai/externalResultStore")>("@/server/ai/externalResultStore"),
  externalResultResponse: (identity: import("@/server/ai/externalEffectJournal").EffectIdentity) =>
    vi.importActual<typeof import("@/server/ai/externalResultStore")>("@/server/ai/externalResultStore").then((m) => m.externalResultResponse(identity, resultFake.current!.port)),
  externalResultStore: { call: (...args: Parameters<import("@/server/ai/externalResultStore").ExternalResultPort["call"]>) => resultFake.current!.port.call(...args) }
}));

const observeExistingMock = vi.hoisted(() => vi.fn<() => Promise<Response | undefined>>(async () => undefined));
vi.mock("@/server/ai/externalEffectObservation", () => ({ existingImageEffectResponse: observeExistingMock }));

const loadGrsImageConfigMock = vi.hoisted(() =>
  vi.fn<() => unknown>(() => ({
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
const requireAiRouteUserMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const resolveGrsImageResultMock = vi.fn();

vi.mock("@/server/image/grsProvider", () => ({
  resolveGrsImageResult: (...args: unknown[]) => resolveGrsImageResultMock(...args)
}));

describe("AI image route auth guard", () => {
  it("rejects a new paid request with no stable key and reuses known effects before reserving quota", async () => {
    const make = (clientRequestId?: string) => new Request("http://localhost/api/ai/image", { method: "POST",
      body: JSON.stringify({ prompt: "test", images: [], ...(clientRequestId ? { clientRequestId } : {}) }) });
    expect((await POST(make())).status).toBe(400);
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    observeExistingMock.mockResolvedValueOnce(Response.json({ effect: { executionState: "running" } }, { status: 202 }));
    expect((await POST(make("stable-confirmed-image"))).status).toBe(202);
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
    expect((await POST(make("legacy-in-flight-image"))).status).toBe(409);
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    resultFake.current = createExternalResultFake();
    observeExistingMock.mockReset().mockResolvedValue(undefined);
    requireAiRouteUserMock.mockReset();
    requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: "user-a" });
    guardAiRouteMock.mockReset();
    guardAiRouteMock.mockResolvedValue({
      status: "allowed",
      userId: "user-a",
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
    loadGrsImageConfigMock.mockReset();
    loadGrsImageConfigMock.mockReturnValue({
      status: "ok",
      config: {
        apiKey: "test-key",
        baseUrl: "https://image.example.test",
        model: "nano-banana-fast"
      }
    });
  });

  it("returns 503 for invalid provider config without reserving image quota", async () => {
    loadGrsImageConfigMock.mockReturnValueOnce({ status: "failed", reason: "missing image config" });

    const response = await POST(
      new Request("http://localhost/api/ai/image", {
        method: "POST", headers: { "X-Morpho-Effect-Key": "image-test", "X-Morpho-Effect-Contract": "1" },
        body: JSON.stringify({ prompt: "生成柔光轨道产品图", images: [], aspectRatio: "1:1" })
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "图像服务暂时不可用，请稍后重试。",
      code: "image_provider_unavailable",
      recoverable: false
    });
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 for unauthenticated requests before image provider execution", async () => {
    requireAiRouteUserMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    const response = await POST(
      new Request("http://localhost/api/ai/image", {
        method: "POST", headers: { "X-Morpho-Effect-Key": "image-test", "X-Morpho-Effect-Contract": "1" },
        body: "{not-json"
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录 Morpho。" });
    expect(guardAiRouteMock).not.toHaveBeenCalled();
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
        method: "POST", headers: { "X-Morpho-Effect-Key": "image-test", "X-Morpho-Effect-Contract": "1" },
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

  it("rejects a declared oversized body before reserving image quota", async () => {
    const response = await POST(new Request("http://localhost/api/ai/image", {
      method: "POST",
      headers: { "Content-Length": String(36 * 1024 * 1024 + 1) },
      body: "{}"
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "body_too_large" });
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(resolveGrsImageResultMock).not.toHaveBeenCalled();
  });

  it("does not expose an upstream image task failure reason", async () => {
    const secretReason = "internal-host.local api_key=secret raw upstream body /private/path";
    resolveGrsImageResultMock.mockResolvedValueOnce({ status: "failed", reason: secretReason });

    const response = await POST(
      new Request("http://localhost/api/ai/image", {
        method: "POST", headers: { "X-Morpho-Effect-Key": "image-test", "X-Morpho-Effect-Contract": "1" },
        body: JSON.stringify({ prompt: "生成柔光轨道产品图", images: [], aspectRatio: "1:1" })
      })
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({
      error: "图像任务失败，请稍后重试。",
      code: "image_generation_failed",
      recoverable: false
    });
    expect(body).not.toContain(secretReason);
    expect(body).not.toContain("api_key=secret");
  });
  it("exposes a stable unknown submission envelope without resubmitting or leaking diagnostics", async () => {
    resolveGrsImageResultMock.mockResolvedValueOnce({ status: "failed", reason: "private-host secret-key", failureCode: "external_execution_state_unknown" });
    const response = await POST(new Request("http://localhost/api/ai/image", { method: "POST", headers: { "X-Morpho-Effect-Key": "image-test", "X-Morpho-Effect-Contract": "1" }, body: JSON.stringify({ prompt: "test", images: [] }) }));
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toEqual({ code: "external_execution_state_unknown", error: "无法确认外部请求是否已经执行；Morpho 已停止自动重试，不会基于该不确定状态继续提交新请求。", recoverable: false });
    expect(body).not.toContain("secret-key");
    expect(resolveGrsImageResultMock).toHaveBeenCalledOnce();
  });

});
