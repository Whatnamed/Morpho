import { describe, expect, it } from "vitest";

import type { ConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";

import { buildConversationSummaryAgentRequest } from "./conversationSummaryAgentRequest";

const plan: ConversationCompactionPlan = {
  sourceMessages: [
    { id: "message-1", role: "user", body: "继续验证海洋浮标" },
    { id: "message-2", role: "assistant", body: "先验证边缘识别误报率" }
  ],
  sourceStartMessageId: "message-1",
  sourceEndMessageId: "message-2",
  sourceMessageCount: 2,
  sourceMessageIdsHash: "summary-source-hash",
  remainingMessages: [],
  estimatedInputTokens: 2_400,
  pressure: "compact"
};

describe("Conversation Summary Agent request", () => {
  it("uses the strict summary directive with only untrusted user text", () => {
    const request = buildConversationSummaryAgentRequest({
      plan,
      projectId: "project-ocean-buoy",
      agentTurnId: "agent-turn-summary",
      mode: "auto"
    });

    expect(request).toMatchObject({
      projectId: "project-ocean-buoy",
      agentTurnId: "agent-turn-summary",
      continuation: false,
      capabilityIntent: { comparisonAnalysis: false },
      directive: { kind: "conversationSummary" }
    });
    expect(request.input).toHaveLength(1);
    expect(request.input[0]).toMatchObject({ role: "user" });
    expect(JSON.stringify(request)).not.toContain('"role":"system"');
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("leaseId");
  });

  it("reuses an existing turn lease without claiming Provider transcript continuation", () => {
    const request = buildConversationSummaryAgentRequest({
      plan,
      projectId: "project-ocean-buoy",
      agentTurnId: "agent-turn-summary",
      mode: "confirm",
      leaseId: "lease-existing"
    });

    expect(request).toMatchObject({
      continuation: false,
      leaseContinuation: true,
      leaseId: "lease-existing"
    });
    expect(request).not.toHaveProperty("previousRuntimeItem");
  });
});
