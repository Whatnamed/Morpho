import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const markMock = vi.fn();

vi.mock("@/server/auth/agentTurnLease", () => ({
  markAgentTurnToolExecutionStarted: (...args: unknown[]) => markMock(...args)
}));

describe("Agent Tool execution marker route", () => {
  beforeEach(() => {
    markMock.mockReset();
    markMock.mockResolvedValue({ status: "marked" });
  });

  it("marks the authenticated lease before local tool execution", async () => {
    const response = await POST(request({ leaseId: "lease-a", agentTurnId: "turn-a" }));
    expect(response.status).toBe(200);
    expect(markMock).toHaveBeenCalledWith({ leaseId: "lease-a", agentTurnId: "turn-a" });
  });

  it("rejects forged fields before the RPC", async () => {
    const response = await POST(request({ leaseId: "lease-a", agentTurnId: "turn-a", userId: "forged" }));
    expect(response.status).toBe(400);
    expect(markMock).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/agent/lease/tool", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
