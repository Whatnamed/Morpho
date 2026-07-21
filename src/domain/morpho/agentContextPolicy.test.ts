import { describe, expect, it } from "vitest";

import { DEFAULT_CONVERSATION_TOKEN_LIMITS } from "./conversationCompaction";
import { MORPHO_AGENT_CONTEXT_POLICY, createMorphoAgentContextPolicy } from "./agentContextPolicy";
import { createAgentContextLimits } from "@/server/ai/agentContextBudget";

describe("Morpho Agent context policy", () => {
  it("keeps the fixed 256k policy and its threshold math in one source", () => {
    expect(MORPHO_AGENT_CONTEXT_POLICY).toEqual({
      windowTokens: 256_000,
      prepareTokens: 204_800,
      compactTokens: 230_400,
      targetUncompressedTokens: 16_000
    });
    expect(MORPHO_AGENT_CONTEXT_POLICY.prepareTokens).toBe(
      MORPHO_AGENT_CONTEXT_POLICY.windowTokens * 0.8
    );
    expect(MORPHO_AGENT_CONTEXT_POLICY.compactTokens).toBe(
      MORPHO_AGENT_CONTEXT_POLICY.windowTokens * 0.9
    );
  });

  it("is shared by client compaction and server request budgeting", () => {
    expect(DEFAULT_CONVERSATION_TOKEN_LIMITS).toBe(MORPHO_AGENT_CONTEXT_POLICY);
    expect(createAgentContextLimits()).toEqual({
      windowTokens: MORPHO_AGENT_CONTEXT_POLICY.windowTokens,
      prepareTokens: MORPHO_AGENT_CONTEXT_POLICY.prepareTokens,
      compactTokens: MORPHO_AGENT_CONTEXT_POLICY.compactTokens,
      targetTokens: MORPHO_AGENT_CONTEXT_POLICY.targetUncompressedTokens
    });
    expect(createMorphoAgentContextPolicy()).toEqual(MORPHO_AGENT_CONTEXT_POLICY);
  });
});
