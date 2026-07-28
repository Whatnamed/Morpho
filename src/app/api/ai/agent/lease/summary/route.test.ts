import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const verifyMock = vi.fn();
const readMock = vi.fn();
const completeMock = vi.fn();

vi.mock("@/server/ai/agentContinuationToken", () => ({
  resolveAgentContinuationSecret: () => "secret",
  verifyAgentContinuationToken: (...args: unknown[]) => verifyMock(...args)
}));

vi.mock("@/server/auth/agentTurnLease", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/agentTurnLease")>();
  return {
    ...actual,
    readAgentTurnClosureState: (...args: unknown[]) => readMock(...args),
    completeAgentTurnLease: (...args: unknown[]) => completeMock(...args)
  };
});

describe("Conversation Summary-only closure route", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    readMock.mockReset();
    completeMock.mockReset();
    readMock.mockResolvedValue({ status: "read", stateName: "none", statusName: "active" });
    completeMock.mockResolvedValue({ status: "completed", statusName: "success", replayed: false });
  });

  it("rejects an ordinary continuation token", async () => {
    verifyMock.mockReturnValue({ status: "ok", claims: { summary: false } });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("closes only with a signed Summary receipt", async () => {
    verifyMock.mockReturnValue({
      status: "ok",
      claims: { summary: true, compactionReceipt: { receiptVersion: 3 } }
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({
      leaseId: "lease-a",
      agentTurnId: "turn-a",
      outcome: "success",
      closureRequestId: "summary-close-a",
      expectedProviderSequence: 2
    }));
  });
});

function request() {
  return new Request("http://localhost/api/ai/agent/lease/summary", {
    method: "POST",
    body: JSON.stringify({
      leaseId: "lease-a",
      agentTurnId: "turn-a",
      leaseSequence: 2,
      continuationToken: "signed-summary-token",
      closureRequestId: "summary-close-a"
    })
  });
}
