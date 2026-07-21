import { describe, expect, it } from "vitest";

import { normalizeProviderTokenUsage } from "./providerTokenUsage";

const responseFields = { input: "input_tokens", output: "output_tokens" } as const;

describe("provider token usage normalization", () => {
  it("uses explicit input, output, total, and reasoning token values", () => {
    expect(
      normalizeProviderTokenUsage(
        {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
          output_tokens_details: { reasoning_tokens: 12 }
        },
        responseFields
      )
    ).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150, reasoningTokens: 12 });
  });

  it("derives a missing input token count from valid total and output counts", () => {
    expect(
      normalizeProviderTokenUsage({ output_tokens: 76, total_tokens: 4505 }, responseFields)
    ).toEqual({ inputTokens: 4429, outputTokens: 76, totalTokens: 4505 });
  });

  it("normalizes cached and uncached input tokens without double counting", () => {
    expect(
      normalizeProviderTokenUsage(
        {
          input_tokens: 1_000,
          output_tokens: 100,
          total_tokens: 1_100,
          prompt_tokens_details: { cached_tokens: 750 },
          completion_tokens_details: { reasoning_tokens: 40 }
        },
        responseFields
      )
    ).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 750,
      uncachedInputTokens: 250,
      cacheHitRatio: 0.75,
      outputTokens: 100,
      totalTokens: 1_100,
      reasoningTokens: 40
    });
  });

  it("rejects cached input counts larger than total input", () => {
    expect(
      normalizeProviderTokenUsage(
        { input_tokens: 10, output_tokens: 2, total_tokens: 12, cached_input_tokens: 11 },
        responseFields
      )
    ).toBeUndefined();
  });

  it("rejects totals below output tokens and non-numeric fields", () => {
    expect(normalizeProviderTokenUsage({ output_tokens: 20, total_tokens: 10 }, responseFields)).toBeUndefined();
    expect(
      normalizeProviderTokenUsage({ input_tokens: "4", output_tokens: 2, total_tokens: 6 }, responseFields)
    ).toBeUndefined();
    expect(normalizeProviderTokenUsage({ input_tokens: 4, output_tokens: Number.NaN }, responseFields)).toBeUndefined();
  });

  it("returns undefined when usage or the required output count is missing", () => {
    expect(normalizeProviderTokenUsage(undefined, responseFields)).toBeUndefined();
    expect(normalizeProviderTokenUsage({}, responseFields)).toBeUndefined();
  });
});
