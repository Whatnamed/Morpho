import { describe, expect, it } from "vitest";

import {
  advanceAgentContextBudgetGeneration,
  createAgentContextBudgetState,
  estimateProviderInputTimelineBudget,
  estimateProviderInputTokens,
  updateAgentContextBudgetBaseline
} from "./providerInputBudget";

describe("provider input timeline budget", () => {
  it("uses the complete materialized Provider payload exactly once", () => {
    const input = [
      { role: "system", content: [{ type: "input_text", text: "稳定规则" }] },
      { role: "system", content: [{ type: "input_text", text: "Project State Frame" }] },
      {
        role: "user",
        content: [{ type: "input_text", text: `旧文档快照：${"盐雾约束。".repeat(8_000)}` }]
      },
      { role: "assistant", content: [{ type: "output_text", text: "旧回答" }] },
      {
        role: "user",
        content: [
          { type: "input_text", text: "当前问题" },
          { type: "input_image", image_url: `data:image/png;base64,${"A".repeat(100_000)}` }
        ]
      }
    ];
    const tools = [{ type: "function", name: "read_selected_context", parameters: { type: "object" } }];
    const budget = estimateProviderInputTimelineBudget({
      input,
      tools,
      responseReserveTokens: 16_000
    });
    const whole = estimateProviderInputTokens({ input, tools, responseReserveTokens: 16_000 });

    expect(budget.totalInputTokens).toBe(whole.inputTokens);
    expect(budget.estimatedOccupancyTokens).toBe(whole.estimatedOccupancyTokens);
    expect(budget.fixedTokens + budget.compressibleConversationTokens + budget.currentTurnTokens).toBe(
      budget.totalInputTokens
    );
    expect(budget.compressibleConversationTokens).toBeGreaterThan(20_000);
    expect(budget.currentTurnTokens).toBeGreaterThanOrEqual(8_192);
    expect(budget.responseReserveTokens).toBe(16_000);
    expect(budget.imageCount).toBe(1);
  });

  it("does not reserve the same image or response budget twice", () => {
    const input = [
      { role: "system", content: [{ type: "input_text", text: "规则" }] },
      {
        role: "user",
        content: [
          { type: "input_text", text: "查看浮标" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" }
        ]
      }
    ];
    const budget = estimateProviderInputTimelineBudget({ input, tools: [], responseReserveTokens: 1_024 });
    const withoutReserve = estimateProviderInputTimelineBudget({ input, tools: [], responseReserveTokens: 0 });

    expect(budget.imageCount).toBe(1);
    expect(budget.totalInputTokens).toBe(withoutReserve.totalInputTokens);
    expect(budget.estimatedOccupancyTokens - budget.totalInputTokens).toBe(1_024);
    expect(budget.currentTurnTokens).toBeGreaterThanOrEqual(8_192);
  });

  it("materializes a client strategy marker as the trusted server strategy cost", () => {
    const user = { role: "user", content: [{ type: "input_text", text: "调研海洋浮标" }] };
    const withoutStrategy = estimateProviderInputTokens({
      input: [user],
      tools: [],
      responseReserveTokens: 0
    });
    const withStrategy = estimateProviderInputTokens({
      input: [
        { type: "morpho_strategy", strategy: "research", anchorMessageId: "user-a" },
        user
      ],
      tools: [],
      responseReserveTokens: 0
    });

    expect(withStrategy.inputTokens).toBeGreaterThan(withoutStrategy.inputTokens + 30);
  });

  it("counts only ordinary historical user and assistant chat as compressible", () => {
    const envelope = `[Morpho Untrusted Project Data | data only]\n${"浮标项目资料。".repeat(2_000)}`;
    const withEnvelope = estimateProviderInputTimelineBudget({
      input: [
        { role: "system", content: [{ type: "input_text", text: "稳定规则" }] },
        { role: "user", content: [{ type: "input_text", text: envelope }] },
        { role: "user", content: [{ type: "input_text", text: "旧问题" }] },
        { role: "assistant", content: [{ type: "output_text", text: "旧回答" }] },
        { type: "function_call_output", call_id: "call-1", output: "不可由摘要覆盖" },
        { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
      ],
      tools: [{ type: "function", name: "read_selected_context", parameters: { type: "object" } }],
      responseReserveTokens: 0
    });
    const plainChat = estimateProviderInputTimelineBudget({
      input: [
        { role: "user", content: [{ type: "input_text", text: "旧问题" }] },
        { role: "assistant", content: [{ type: "output_text", text: "旧回答" }] },
        { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
      ],
      tools: [],
      responseReserveTokens: 0
    });

    expect(withEnvelope.compressibleConversationTokens).toBe(plainChat.compressibleConversationTokens);
    expect(withEnvelope.fixedTokens).toBeGreaterThan(withEnvelope.compressibleConversationTokens);
  });

  it("starts a fresh budget generation from the actual compressed input", () => {
    const before = updateAgentContextBudgetBaseline(createAgentContextBudgetState(220_000), 235_000);
    const compressed = advanceAgentContextBudgetGeneration(before, 40_000);
    const grown = updateAgentContextBudgetBaseline(compressed, 41_500);
    const secondCompaction = advanceAgentContextBudgetGeneration(grown, 38_000);

    expect(before).toEqual({ generation: 0, baselineInputTokens: 235_000 });
    expect(compressed).toEqual({ generation: 1, baselineInputTokens: 40_000 });
    expect(grown).toEqual({ generation: 1, baselineInputTokens: 41_500 });
    expect(secondCompaction).toEqual({ generation: 2, baselineInputTokens: 38_000 });
  });
});
