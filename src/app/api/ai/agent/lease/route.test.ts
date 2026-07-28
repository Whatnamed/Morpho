import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueAgentTranscriptSnapshotToken,
  verifyAgentTranscriptSnapshotToken
} from "@/server/ai/agentContinuationToken";
import {
  buildAgentDurableTranscriptManifest,
  createAgentTranscriptMessageItem
} from "@/shared/agentCompactionProtocol";
import { createProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";

import { POST } from "./route";

const completeMock = vi.fn();
const requireAiRouteUserMock = vi.fn();
const SECRET = "lease-outcome-secret";
const USER_ID = "user-ocean-buoy";

vi.mock("@/server/auth/agentTurnLease", () => ({
  completeAgentTurnLease: (...args: unknown[]) => completeMock(...args)
}));

vi.mock("@/server/auth/aiAccess", () => ({
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args)
}));

describe("Agent Turn Lease completion route", () => {
  beforeEach(() => {
    completeMock.mockReset();
    requireAiRouteUserMock.mockReset();
    completeMock.mockResolvedValue({ status: "completed", statusName: "success" });
    requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: USER_ID });
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
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

  it("replaces intermediate Provider text with a signed partial-success outcome", async () => {
    const providerSnapshot = createProviderOutputSnapshot("工具执行前：我会完成全部动作。");
    const transcriptManifest = buildAgentDurableTranscriptManifest([
      createAgentTranscriptMessageItem({
        messageId: "user-a",
        role: "user",
        replayMode: "liveInput",
        providerItems: [{ role: "user", content: [{ type: "input_text", text: "执行浮标检查" }] }],
        durableProviderItems: [{ role: "user", content: [{ type: "input_text", text: "执行浮标检查" }] }]
      }),
      createAgentTranscriptMessageItem({
        messageId: "assistant-a",
        role: "assistant",
        replayMode: "durableReplay",
        providerItems: [{
          role: "assistant",
          content: [{ type: "output_text", text: providerSnapshot.text }]
        }]
      })
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: USER_ID,
      transcriptManifest,
      now: Date.now()
    });
    const response = await POST(new Request("http://localhost/api/ai/agent/lease", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-a",
        agentTurnId: "agent-turn-a",
        outcome: "partialSuccess",
        projectId: "project-ocean-buoy",
        userMessageId: "user-a",
        assistantMessageId: "assistant-a",
        transcriptSnapshotToken: token
      })
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outcomeItem).toMatchObject({
      type: "morpho_turn_outcome",
      outcome: "partialSuccess",
      assistantMessageId: "assistant-a"
    });
    expect(JSON.stringify(payload)).not.toContain(providerSnapshot.text);
    const verified = verifyAgentTranscriptSnapshotToken({
      token: payload.transcriptSnapshotToken,
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: USER_ID,
      now: Date.now()
    });
    expect(verified.status).toBe("ok");
    if (verified.status === "ok") {
      expect(verified.claims.transcriptManifest.items).toContainEqual(expect.objectContaining({
        kind: "outcome",
        messageId: "assistant-a"
      }));
      expect(verified.claims.transcriptManifest.items).not.toContainEqual(expect.objectContaining({
        kind: "message",
        messageId: "assistant-a"
      }));
    }
  });

  it("rejects a cross-user outcome snapshot before completing the lease", async () => {
    const transcriptManifest = buildAgentDurableTranscriptManifest([
      createAgentTranscriptMessageItem({
        messageId: "user-a",
        role: "user",
        providerItems: [{ role: "user", content: [{ type: "input_text", text: "浮标" }] }]
      })
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: "user-other",
      transcriptManifest,
      now: Date.now()
    });
    const response = await POST(new Request("http://localhost/api/ai/agent/lease", {
      method: "POST",
      body: JSON.stringify({
        leaseId: "lease-a",
        agentTurnId: "agent-turn-a",
        outcome: "partialSuccess",
        projectId: "project-ocean-buoy",
        userMessageId: "user-a",
        assistantMessageId: "assistant-a",
        transcriptSnapshotToken: token
      })
    }));

    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
