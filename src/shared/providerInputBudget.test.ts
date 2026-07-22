import { describe, expect, it } from "vitest";

import {
  estimateProviderInputTimelineBudget,
  estimateProviderInputTokens
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
    expect(budget.fixedTokens + budget.compressibleHistoricalTokens + budget.currentTurnTokens).toBe(
      budget.totalInputTokens
    );
    expect(budget.compressibleHistoricalTokens).toBeGreaterThan(20_000);
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
});
