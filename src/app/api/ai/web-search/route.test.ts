import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const guardAiRouteMock = vi.fn();
const continueAgentTurnLeaseMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

vi.mock("@/server/auth/agentTurnLease", () => ({
  continueAgentTurnLease: (...args: unknown[]) => continueAgentTurnLeaseMock(...args),
  hashAgentTurnLeaseValue: (value: unknown) => `hash:${JSON.stringify(value)}`,
  agentTurnLeaseDeniedResponse: (result: { error: string; httpStatus: number }) =>
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
    continueAgentTurnLeaseMock.mockReset();
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
    continueAgentTurnLeaseMock.mockResolvedValue({
      status: "allowed",
      lease: {
        id: "lease-1",
        agentTurnId: "agent-turn-1",
        expiresAt: "2026-07-24T03:00:00.000Z",
        providerCallCount: 2,
        webSearchCallCount: 1,
        nextProviderSequence: 2
      }
    });
    searchWebEvidenceMock.mockReset();
    searchWebEvidenceMock.mockResolvedValue({
      sources: [{ title: "Source", url: "https://example.com" }],
      failedSourceCount: 0,
      timedOutSourceCount: 0
    });
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

  it("uses the same verified lease for Agent continuation web searches", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";

    const response = await POST(
      new Request("http://localhost/api/ai/web-search", {
        method: "POST",
        body: JSON.stringify({
          agentTurnId: "agent-turn-1",
          leaseId: "lease-1",
          agentContinuation: true,
          leaseSequence: 1,
          queries: ["night rail constraints"]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(continueAgentTurnLeaseMock).toHaveBeenCalledWith({
      leaseId: "lease-1",
      agentTurnId: "agent-turn-1",
      continuationKind: "webSearch",
      expectedSequence: 1,
      requestHash: 'hash:{"queries":["night rail constraints"],"maxSources":null}',
      requestManifestHash: 'hash:{"kind":"webSearch","queryCount":1}'
    });
    expect(guardAiRouteMock).not.toHaveBeenCalled();
    expect(searchWebEvidenceMock).toHaveBeenCalledTimes(1);
  });

  it("returns partial-source failure diagnostics without discarding successful sources", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";
    searchWebEvidenceMock.mockResolvedValueOnce({
      sources: [{ title: "Ocean buoy source", url: "https://example.com/buoy" }],
      failedSourceCount: 1,
      timedOutSourceCount: 2
    });

    const response = await POST(new Request("http://localhost/api/ai/web-search", {
      method: "POST",
      body: JSON.stringify({ queries: ["ocean buoy constraints"] })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [{ title: "Ocean buoy source", url: "https://example.com/buoy" }],
      failedSourceCount: 1,
      timedOutSourceCount: 2
    });
  });

  it("reports the consumed lease sequence on upstream failure and cancellation", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";
    searchWebEvidenceMock.mockRejectedValueOnce(new Error("upstream down"));

    const failed = await POST(new Request("http://localhost/api/ai/web-search", {
      method: "POST",
      body: JSON.stringify({
        agentTurnId: "agent-turn-1",
        leaseId: "lease-1",
        agentContinuation: true,
        leaseSequence: 1,
        queries: ["ocean buoy constraints"]
      })
    }));

    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ nextProviderSequence: 2 });

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    searchWebEvidenceMock.mockRejectedValueOnce(abortError);

    const cancelled = await POST(new Request("http://localhost/api/ai/web-search", {
      method: "POST",
      body: JSON.stringify({
        agentTurnId: "agent-turn-1",
        leaseId: "lease-1",
        agentContinuation: true,
        leaseSequence: 2,
        queries: ["ocean buoy constraints"]
      })
    }));

    expect(cancelled.status).toBe(499);
    await expect(cancelled.json()).resolves.toMatchObject({ nextProviderSequence: 2 });
  });

  it("keeps standalone searches free of lease sequence reporting", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";
    searchWebEvidenceMock.mockRejectedValueOnce(new Error("upstream down"));

    const response = await POST(new Request("http://localhost/api/ai/web-search", {
      method: "POST",
      body: JSON.stringify({ queries: ["ocean buoy constraints"] })
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "外部检索失败，请稍后重试。" });
  });

  it("rejects a forged Agent continuation before external search", async () => {
    process.env.MORPHO_AI_PROVIDER = "aijws";
    process.env.MORPHO_AI_BASE_URL = "https://api.aijws.com/v1";
    process.env.MORPHO_AI_API_KEY = "test-key";
    process.env.MORPHO_AI_WEB_SEARCH_ENABLED = "true";
    continueAgentTurnLeaseMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 403,
      error: "Agent Turn Lease 无效或不属于当前用户。",
      reason: "invalid_lease"
    });

    const response = await POST(new Request("http://localhost/api/ai/web-search", {
      method: "POST",
      body: JSON.stringify({
        agentTurnId: "agent-turn-forged",
        leaseId: "lease-forged",
        agentContinuation: true,
        leaseSequence: 1,
        queries: ["ocean buoy constraints"]
      })
    }));

    expect(response.status).toBe(403);
    expect(searchWebEvidenceMock).not.toHaveBeenCalled();
  });
});
