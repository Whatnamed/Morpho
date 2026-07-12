export type NormalizedProviderTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

type ProviderUsageFieldNames = {
  input: "input_tokens" | "prompt_tokens";
  output: "output_tokens" | "completion_tokens";
};

export function normalizeProviderTokenUsage(
  value: unknown,
  fields: ProviderUsageFieldNames
): NormalizedProviderTokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }

  const providedInputTokens = nonNegativeInteger(usage[fields.input]);
  const outputTokens = nonNegativeInteger(usage[fields.output]);
  const providedTotalTokens = nonNegativeInteger(usage.total_tokens);
  if (fields.input in usage && providedInputTokens === undefined) {
    return undefined;
  }
  if ("total_tokens" in usage && providedTotalTokens === undefined) {
    return undefined;
  }
  if (outputTokens === undefined) {
    return undefined;
  }
  if (providedTotalTokens !== undefined && providedTotalTokens < outputTokens) {
    return undefined;
  }

  const inputTokens =
    providedInputTokens ??
    (providedTotalTokens !== undefined ? providedTotalTokens - outputTokens : undefined);
  if (inputTokens === undefined) {
    return undefined;
  }

  const totalTokens = providedTotalTokens ?? inputTokens + outputTokens;
  if (totalTokens < inputTokens || totalTokens < outputTokens) {
    return undefined;
  }

  const outputDetails = asRecord(usage.output_tokens_details);
  const reasoningTokens = nonNegativeInteger(outputDetails?.reasoning_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined && reasoningTokens <= outputTokens ? { reasoningTokens } : {})
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
