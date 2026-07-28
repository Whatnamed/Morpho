import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import {
  hashAgentContinuationItems,
  issueAgentContinuationToken,
  issueAgentTranscriptSnapshotToken,
  issueAgentTurnClosureToken,
  verifyAgentTurnClosureToken
} from "@/server/ai/agentContinuationToken";
import {
  buildAgentDurableTranscriptManifest,
  createAgentTranscriptMessageItem
} from "@/shared/agentCompactionProtocol";

import { POST } from "./route";

const requireAiRouteUserMock = vi.fn();
const SECRET = "pending-closure-secret";
const USER_ID = "user-ocean-buoy";
const PREFIX = [{ role: "user", content: [{ type: "input_text", text: "先确认再创建海洋浮标方向" }] }];
const PROVIDER_OUTPUT = [{
  type: "function_call",
  id: "fc_1",
  call_id: "call_1",
  name: "create_concept_direction",
  arguments: "{}"
}];

vi.mock("@/server/auth/aiAccess", () => ({
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args)
}));

describe("Pending function-call Closure finalizer", () => {
  beforeEach(() => {
    requireAiRouteUserMock.mockReset();
    requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: USER_ID });
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
  });

  it("upgrades only the exact signed pending function-call continuation", async () => {
    const proof = createProof();
    const response = await request(proof.body);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "pendingConfirmation",
      terminalOutputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      closureToken: expect.any(String)
    });
    expect(verifyAgentTurnClosureToken({
      token: payload.closureToken,
      secret: SECRET,
      userId: USER_ID,
      projectId: "project-ocean-buoy",
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      currentUserMessageId: "user-a",
      assistantMessageId: "assistant-a",
      transcriptManifestHash: proof.transcriptManifestHash,
      providerOutputSnapshotHash: proof.providerSnapshot.contentHash,
      expectedOutcome: "pendingConfirmation",
      now: Date.now()
    })).toMatchObject({
      status: "ok",
      claims: { terminalFunctionCalls: true, requiredOutcome: "pendingConfirmation" }
    });
  });

  it("rejects a missing terminal output before issuing an upgraded token", async () => {
    const proof = createProof();
    const response = await request({
      ...proof.body,
      continuationInput: [...PREFIX, ...PROVIDER_OUTPUT]
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "tool_result_missing" });
  });

  it("rejects forged Call IDs and non-pending terminal batches", async () => {
    const proof = createProof();
    const forged = await request({
      ...proof.body,
      continuationInput: [
        ...PREFIX,
        ...PROVIDER_OUTPUT,
        { type: "function_call_output", call_id: "call-forged", output: "{\"status\":\"pendingConfirmation\"}" }
      ]
    });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ reason: "tool_result_forged" });

    const nonPending = await request({
      ...proof.body,
      continuationInput: [
        ...PREFIX,
        ...PROVIDER_OUTPUT,
        { type: "function_call_output", call_id: "call_1", output: "{\"status\":\"executed\"}" }
      ]
    });
    expect(nonPending.status).toBe(400);
    expect(await nonPending.json()).toMatchObject({ reason: "tool_result_missing" });
  });

  it("rejects a sequence that differs from both signed lease proofs", async () => {
    const proof = createProof();
    const response = await request({ ...proof.body, leaseSequence: 2 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "token_scope" });
  });
});

function createProof() {
  const now = Date.now();
  const providerSnapshot = createProviderOutputSnapshot("已准备确认卡。确认前不会改变项目状态。");
  const transcriptManifest = buildAgentDurableTranscriptManifest([
    createAgentTranscriptMessageItem({
      messageId: "user-a",
      role: "user",
      replayMode: "liveInput",
      providerItems: PREFIX,
      durableProviderItems: PREFIX
    }),
    createAgentTranscriptMessageItem({
      messageId: "assistant-a",
      role: "assistant",
      replayMode: "durableReplay",
      providerItems: [{ role: "assistant", content: [{ type: "output_text", text: providerSnapshot.text }] }]
    })
  ]);
  const transcriptSnapshotToken = issueAgentTranscriptSnapshotToken({
    secret: SECRET,
    projectId: "project-ocean-buoy",
    userId: USER_ID,
    transcriptManifest,
    now
  });
  const continuationToken = issueAgentContinuationToken({
    secret: SECRET,
    leaseId: "lease-a",
    agentTurnId: "agent-turn-a",
    sequence: 1,
    summary: false,
    inputItemCount: PREFIX.length,
    inputHash: hashAgentContinuationItems(PREFIX),
    outputHash: hashAgentContinuationItems(PROVIDER_OUTPUT),
    callIds: ["call_1"],
    now
  });
  const closureToken = issueAgentTurnClosureToken({
    secret: SECRET,
    userId: USER_ID,
    projectId: "project-ocean-buoy",
    leaseId: "lease-a",
    agentTurnId: "agent-turn-a",
    leaseSequence: 1,
    currentUserMessageId: "user-a",
    assistantMessageId: "assistant-a",
    transcriptManifestHash: transcriptManifest.manifestHash,
    providerOutputSnapshotHash: providerSnapshot.contentHash,
    terminalFunctionCalls: false,
    now
  });
  return {
    providerSnapshot,
    transcriptManifestHash: transcriptManifest.manifestHash,
    body: {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      leaseSequence: 1,
      closureToken,
      continuationToken,
      continuationInput: [
        ...PREFIX,
        ...PROVIDER_OUTPUT,
        { type: "function_call_output", call_id: "call_1", output: "{\"status\":\"pendingConfirmation\"}" }
      ],
      projectId: "project-ocean-buoy",
      userMessageId: "user-a",
      assistantMessageId: "assistant-a",
      transcriptSnapshotToken,
      transcriptManifestHash: transcriptManifest.manifestHash,
      providerOutputSnapshot: providerSnapshot
    }
  };
}

function request(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/ai/agent/lease/finalize-function-calls", {
    method: "POST",
    body: JSON.stringify(body)
  }));
}
