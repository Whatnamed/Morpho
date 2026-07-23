import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const completeMock = vi.fn();

vi.mock("@/server/auth/agentTurnLease", () => ({
  completeAgentTurnLease: (...args: unknown[]) => completeMock(...args)
}));

describe("Agent Turn Lease completion route", () => {
  beforeEach(() => {
    completeMock.mockReset();
    completeMock.mockResolvedValue({ status: "completed", statusName: "success" });
  });

  it("closes a lease with a bounded terminal outcome", async () => {
    const response = await POST(new Request("http://localhost/api/ai/agent/lease", {
      method: "POST",
      body: JSON.stringify({ leaseId: "lease-a", agentTurnId: "agent-turn-a", outcome: "success" })
    }));
    expect(response.status).toBe(200);
    expect(completeMock).toHaveBeenCalledWith({
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      outcome: "success"
    });
  });

  it("rejects unknown fields and invalid outcomes before RPC", async () => {
    const response = await POST(new Request("http://localhost/api/ai/agent/lease", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-a",
        agentTurnId: "agent-turn-a",
        outcome: "keep-open",
        userId: "forged"
      })
    }));
    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
