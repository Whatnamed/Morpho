import { describe, expect, it, vi } from "vitest";

import { requireAiRouteUserForClient, reserveAiQuotaForRequest } from "./aiAccess";

function createClient(overrides: {
  user?: { id: string; email?: string } | null;
  authError?: Error;
  rpcRows?: unknown[];
  rpcError?: Error;
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === undefined ? { id: "user-a", email: "a@example.test" } : overrides.user },
        error: overrides.authError
      }))
    },
    rpc: vi.fn(() => ({
      single: vi.fn(async () => ({
        data: overrides.rpcRows?.[0] ?? null,
        error: overrides.rpcError
      }))
    }))
  };
}

describe("AI access and quota guard", () => {
  it("returns the shared 401 login error for agent and web-search continuations", async () => {
    const client = createClient({ user: null });

    await expect(requireAiRouteUserForClient(client)).resolves.toEqual({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when no authenticated user is available", async () => {
    const client = createClient({ user: null });

    await expect(reserveAiQuotaForRequest(client, "text")).resolves.toMatchObject({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });

    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 403 for pending users before provider work starts", async () => {
    const client = createClient({
      rpcRows: [
        {
          allowed: false,
          denial_reason: "pending",
          role_name: "tester",
          status_name: "pending",
          daily_text_limit: 20,
          daily_image_limit: 4,
          text_request_count: 0,
          image_request_count: 0,
          usage_date: "2026-07-05"
        }
      ]
    });

    await expect(reserveAiQuotaForRequest(client, "text")).resolves.toMatchObject({
      status: "denied",
      httpStatus: 403,
      error: "当前账号尚未获得测试资格，请联系项目管理员。"
    });
  });

  it("returns 403 for blocked users without exposing database details", async () => {
    const client = createClient({
      rpcRows: [
        {
          allowed: false,
          denial_reason: "blocked",
          role_name: "tester",
          status_name: "blocked",
          daily_text_limit: 20,
          daily_image_limit: 4,
          text_request_count: 0,
          image_request_count: 0,
          usage_date: "2026-07-05"
        }
      ]
    });

    await expect(reserveAiQuotaForRequest(client, "image")).resolves.toMatchObject({
      status: "denied",
      httpStatus: 403,
      error: "当前测试资格不可用。如需继续使用，请联系项目管理员。"
    });
  });

  it("allows active users when the requested quota is reserved", async () => {
    const client = createClient({
      rpcRows: [
        {
          allowed: true,
          denial_reason: null,
          role_name: "tester",
          status_name: "active",
          daily_text_limit: 20,
          daily_image_limit: 4,
          text_request_count: 3,
          image_request_count: 1,
          usage_date: "2026-07-05"
        }
      ]
    });

    await expect(reserveAiQuotaForRequest(client, "text")).resolves.toMatchObject({
      status: "allowed",
      usage: {
        textRequestCount: 3,
        imageRequestCount: 1
      }
    });

    expect(client.rpc).toHaveBeenCalledWith("reserve_ai_daily_quota", { request_kind: "text" });
  });

  it("returns 429 when the matching quota is exhausted", async () => {
    const client = createClient({
      rpcRows: [
        {
          allowed: false,
          denial_reason: "quota_exceeded",
          role_name: "tester",
          status_name: "active",
          daily_text_limit: 1,
          daily_image_limit: 4,
          text_request_count: 1,
          image_request_count: 0,
          usage_date: "2026-07-05"
        }
      ]
    });

    await expect(reserveAiQuotaForRequest(client, "text")).resolves.toMatchObject({
      status: "denied",
      httpStatus: 429,
      error: "今日文本 AI 额度已用完，请明天再试。"
    });
  });
});
