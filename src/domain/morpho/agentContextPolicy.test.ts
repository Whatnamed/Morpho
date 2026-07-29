import { describe, expect, it } from "vitest";

import { DEFAULT_CONVERSATION_TOKEN_LIMITS } from "./conversationCompaction";
import { MORPHO_AGENT_CONTEXT_POLICY, createMorphoAgentContextPolicy } from "./agentContextPolicy";

describe("Morpho Agent context policy", () => {
  it("keeps the fixed 256k policy and its threshold math in one source", () => {
    expect(MORPHO_AGENT_CONTEXT_POLICY).toEqual({
      windowTokens: 256_000,
      prepareTokens: 204_800,
      compactTokens: 230_400,
      targetUncompressedTokens: 16_000,
      responseReserveTokens: 16_000,
      prepareItemCount: 800,
      compactItemCount: 880
    });
    expect(MORPHO_AGENT_CONTEXT_POLICY.prepareTokens).toBe(
      MORPHO_AGENT_CONTEXT_POLICY.windowTokens * 0.8
    );
    expect(MORPHO_AGENT_CONTEXT_POLICY.compactTokens).toBe(
      MORPHO_AGENT_CONTEXT_POLICY.windowTokens * 0.9
    );
    // Both item thresholds must stay under the server's hard 1024-item ceiling,
    // with room for the server prefix and the items one more turn still adds.
    expect(MORPHO_AGENT_CONTEXT_POLICY.prepareItemCount)
      .toBeLessThan(MORPHO_AGENT_CONTEXT_POLICY.compactItemCount);
    expect(MORPHO_AGENT_CONTEXT_POLICY.compactItemCount).toBeLessThan(1_024);
  });

  it("is shared by client compaction and server request budgeting", () => {
    expect(DEFAULT_CONVERSATION_TOKEN_LIMITS).toBe(MORPHO_AGENT_CONTEXT_POLICY);
    expect(createMorphoAgentContextPolicy()).toEqual(MORPHO_AGENT_CONTEXT_POLICY);
  });
});
