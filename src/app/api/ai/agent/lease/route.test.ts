import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueAgentTranscriptSnapshotToken,
  issueAgentTurnClosureToken,
  verifyAgentTranscriptSnapshotToken
} from "@/server/ai/agentContinuationToken";
import {
  buildAgentDurableTranscriptManifest,
  createAgentTranscriptMessageItem
} from "@/shared/agentCompactionProtocol";
import { createProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { hashAgentTurnLeaseValue } from "@/server/auth/agentTurnLease";

import { POST } from "./route";

const completeMock = vi.fn();
const readClosureMock = vi.fn();
const requireAiRouteUserMock = vi.fn();
const SECRET = "lease-outcome-secret";
const USER_ID = "user-ocean-buoy";

vi.mock("@/server/auth/agentTurnLease", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/agentTurnLease")>();
  return {
    ...actual,
    completeAgentTurnLease: (...args: unknown[]) => completeMock(...args),
    readAgentTurnClosureState: (...args: unknown[]) => readClosureMock(...args)
  };
});

vi.mock("@/server/auth/aiAccess", () => ({
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args)
}));

describe("Agent Turn Lease completion route", () => {
  beforeEach(() => {
    completeMock.mockReset();
    readClosureMock.mockReset();
    requireAiRouteUserMock.mockReset();
    completeMock.mockResolvedValue({ status: "completed", statusName: "success", replayed: false });
    readClosureMock.mockResolvedValue({ status: "read", stateName: "none", statusName: "active" });
    requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: USER_ID });
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
  });

  it.each(["success", "partialSuccess", "pendingConfirmation"])(
    "rejects %s without closure proof before RPC",
    async (outcome) => {
      const response = await request({
        leaseId: "lease-a",
        agentTurnId: "agent-turn-a",
        closureRequestId: "closure-a",
        outcome
      });
      expect(response.status).toBe(400);
      expect(completeMock).not.toHaveBeenCalled();
      expect(readClosureMock).not.toHaveBeenCalled();
    }
  );

  it("delegates BeforeExecution proof to the atomic Lease RPC", async () => {
    completeMock.mockResolvedValue({
      status: "denied",
      httpStatus: 403,
      error: "Agent Turn 已开始执行，不能声明为执行前终止。",
      reason: "execution_already_started"
    });
    const response = await request({
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      closureRequestId: "closure-a",
      outcome: "failedBeforeExecution"
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "execution_already_started" });
    expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedProviderSequence: 0
    }));
  });

  it.each(["failedDuringProvider", "cancelledDuringProvider"])(
    "closes %s only against the server-recorded Provider failure sequence",
    async (outcome) => {
      const response = await request({
        leaseId: "lease-a",
        agentTurnId: "agent-turn-a",
        closureRequestId: "closure-a",
        leaseSequence: 3,
        outcome
      });

      expect(response.status).toBe(200);
      expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({
        outcome,
        expectedProviderSequence: 3
      }));
    }
  );

  it("rejects a DuringProvider outcome without its exact Lease sequence", async () => {
    const response = await request({
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      closureRequestId: "closure-a",
      outcome: "failedDuringProvider"
    });

    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("replaces intermediate Provider text with a signed partial-success outcome", async () => {
    const proof = createProof();
    const response = await request({ ...proof.body, outcome: "partialSuccess" });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outcomeItem).toMatchObject({
      type: "morpho_turn_outcome",
      outcome: "partialSuccess",
      assistantMessageId: "assistant-a"
    });
    expect(JSON.stringify(payload)).not.toContain(proof.providerSnapshot.text);
    expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedProviderSequence: 1
    }));
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

  it("keeps existing proof Closure request hashes stable when no explicit sequence field is sent", async () => {
    const proof = createProof();
    const closureBody = { ...proof.body, outcome: "success" };

    const response = await request(closureBody);

    expect(response.status).toBe(200);
    expect(readClosureMock).toHaveBeenCalledWith(expect.objectContaining({
      closureRequestHash: hashAgentTurnLeaseValue({
        leaseId: closureBody.leaseId,
        agentTurnId: closureBody.agentTurnId,
        outcome: closureBody.outcome,
        closureRequestId: closureBody.closureRequestId,
        closureToken: closureBody.closureToken,
        projectId: closureBody.projectId,
        userMessageId: closureBody.userMessageId,
        assistantMessageId: closureBody.assistantMessageId,
        transcriptSnapshotToken: closureBody.transcriptSnapshotToken,
        transcriptManifestHash: closureBody.transcriptManifestHash,
        providerOutputSnapshot: closureBody.providerOutputSnapshot
      })
    }));
  });

  it.each([
    ["success", "工具执行前：我会完成全部动作。", false],
    ["pendingConfirmation", "本轮停在待确认状态。确认前不把相关动作视为已完成。", true]
  ])("produces the server-authoritative %s outcome", async (outcome, expectedText, pendingProof) => {
    const proof = createProof({ pendingProof });
    const response = await request({ ...proof.body, outcome });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcomeItem: {
        outcome,
        text: expectedText
      }
    });
  });

  it.each([
    ["leaseId", "lease-other"],
    ["agentTurnId", "agent-turn-other"],
    ["projectId", "project-other"],
    ["userMessageId", "user-other"],
    ["assistantMessageId", "assistant-other"],
    ["transcriptManifestHash", "f".repeat(64)]
  ])("rejects closure token scope mutation: %s", async (field, value) => {
    const proof = createProof();
    const response = await request({ ...proof.body, [field]: value, outcome: "success" });
    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("rejects cross-user replay", async () => {
    const proof = createProof({ userId: "user-other" });
    const response = await request({ ...proof.body, outcome: "success" });
    expect(response.status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("recovers an already-saved closure with the same request hash after the short token expires", async () => {
    const proof = createProof({ closureNow: Date.now() - 21 * 60 * 1000 });
    readClosureMock.mockResolvedValue({
      status: "read",
      stateName: "match",
      statusName: "partialSuccess",
      outcome: "partialSuccess"
    });
    const response = await request({ ...proof.body, outcome: "partialSuccess" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, status: "partialSuccess" });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("rejects a conflicting idempotency key", async () => {
    const proof = createProof();
    readClosureMock.mockResolvedValue({ status: "read", stateName: "conflict", statusName: "success" });
    const response = await request({ ...proof.body, outcome: "partialSuccess" });
    expect(response.status).toBe(409);
    expect(completeMock).not.toHaveBeenCalled();
  });
});

function createProof(overrides: { userId?: string; closureNow?: number; pendingProof?: boolean } = {}) {
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
      providerItems: [{ role: "assistant", content: [{ type: "output_text", text: providerSnapshot.text }] }]
    })
  ]);
  const userId = overrides.userId ?? USER_ID;
  const transcriptSnapshotToken = issueAgentTranscriptSnapshotToken({
    secret: SECRET,
    projectId: "project-ocean-buoy",
    userId,
    transcriptManifest,
    now: Date.now()
  });
  const closureToken = issueAgentTurnClosureToken({
    secret: SECRET,
    userId,
    projectId: "project-ocean-buoy",
    leaseId: "lease-a",
    agentTurnId: "agent-turn-a",
    leaseSequence: 1,
    currentUserMessageId: "user-a",
    assistantMessageId: "assistant-a",
    transcriptManifestHash: transcriptManifest.manifestHash,
    providerOutputSnapshotHash: providerSnapshot.contentHash,
    terminalFunctionCalls: true,
    ...(overrides.pendingProof
      ? { requiredOutcome: "pendingConfirmation" as const, terminalOutputHash: "d".repeat(64) }
      : {}),
    now: overrides.closureNow ?? Date.now()
  });
  return {
    providerSnapshot,
    body: {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      closureRequestId: "closure-a",
      projectId: "project-ocean-buoy",
      userMessageId: "user-a",
      assistantMessageId: "assistant-a",
      transcriptSnapshotToken,
      transcriptManifestHash: transcriptManifest.manifestHash,
      closureToken,
      providerOutputSnapshot: providerSnapshot
    }
  };
}

function request(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/ai/agent/lease", {
    method: "POST",
    body: JSON.stringify(body)
  }));
}
