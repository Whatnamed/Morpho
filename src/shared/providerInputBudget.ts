export const PROVIDER_INPUT_BASE_TOKENS = 128;
export const PROVIDER_INPUT_IMAGE_TOKEN_RESERVE = 8_192;

export type ProviderInputBudget = {
  inputTokens: number;
  responseReserveTokens: number;
  estimatedOccupancyTokens: number;
  imageCount: number;
};

/**
 * A single estimate of the exact candidate Provider input, separated by the
 * portions that can and cannot be reduced by conversation compaction.
 */
export type ProviderInputTimelineBudget = {
  totalInputTokens: number;
  fixedTokens: number;
  compressibleHistoricalTokens: number;
  currentTurnTokens: number;
  responseReserveTokens: number;
  estimatedOccupancyTokens: number;
  imageCount: number;
};

export function estimateProviderInputTokens(input: {
  input: readonly unknown[];
  tools: readonly unknown[];
  responseReserveTokens: number;
}): ProviderInputBudget {
  const imageCount = countImageInputs(input.input);
  const serializedTokens = estimateSerializedTokens({ input: input.input, tools: input.tools });
  const inputTokens = PROVIDER_INPUT_BASE_TOKENS + serializedTokens + imageCount * PROVIDER_INPUT_IMAGE_TOKEN_RESERVE;
  const responseReserveTokens = Math.max(0, Math.floor(input.responseReserveTokens));
  return {
    inputTokens,
    responseReserveTokens,
    estimatedOccupancyTokens: inputTokens + responseReserveTokens,
    imageCount
  };
}

/**
 * Keep the threshold decision tied to the same fully materialized Provider
 * payload that will be sent. Segment figures are explanatory; their sum is
 * normalized back to totalInputTokens so framing JSON is never double-counted.
 */
export function estimateProviderInputTimelineBudget(input: {
  input: readonly unknown[];
  tools: readonly unknown[];
  responseReserveTokens: number;
}): ProviderInputTimelineBudget {
  const total = estimateProviderInputTokens(input);
  const currentUserIndex = findCurrentUserIndex(input.input);
  const historicalItems = currentUserIndex < 0
    ? []
    : input.input.slice(0, currentUserIndex).filter(isConversationMessage);
  const currentTurnItems = currentUserIndex < 0
    ? input.input.filter((item) => !isSystemMessage(item))
    : input.input.slice(currentUserIndex).filter((item) => !isSystemMessage(item));
  const compressibleHistoricalTokens = estimateInputSegmentTokens(historicalItems);
  const currentTurnTokens = estimateInputSegmentTokens(currentTurnItems);
  const fixedTokens = Math.max(
    0,
    total.inputTokens - compressibleHistoricalTokens - currentTurnTokens
  );

  return {
    totalInputTokens: total.inputTokens,
    fixedTokens,
    compressibleHistoricalTokens,
    currentTurnTokens,
    responseReserveTokens: total.responseReserveTokens,
    estimatedOccupancyTokens: total.estimatedOccupancyTokens,
    imageCount: total.imageCount
  };
}

export function estimateProviderSerializedTokens(value: unknown): number {
  return estimateSerializedTokens(value);
}

function estimateSerializedTokens(value: unknown): number {
  const normalized = JSON.stringify(value, (key, item) => {
    if (key === "image_url" && typeof item === "string") {
      return "[image-input]";
    }
    return item;
  });
  return Math.ceil(new TextEncoder().encode(normalized ?? "null").length / 3);
}

function countImageInputs(input: readonly unknown[]): number {
  let count = 0;
  for (const item of input) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    count += item.content.filter(
      (part): part is Record<string, unknown> => isRecord(part) && part.type === "input_image"
    ).length;
  }
  return count;
}

function estimateInputSegmentTokens(items: readonly unknown[]): number {
  if (items.length === 0) {
    return 0;
  }
  return estimateSerializedTokens(items) + countImageInputs(items) * PROVIDER_INPUT_IMAGE_TOKEN_RESERVE;
}

function findCurrentUserIndex(input: readonly unknown[]): number {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (isConversationMessage(item) && item.role === "user") {
      return index;
    }
  }
  return -1;
}

function isConversationMessage(value: unknown): value is Record<string, unknown> & { role: "system" | "user" | "assistant" } {
  return (
    isRecord(value) &&
    (value.role === "system" || value.role === "user" || value.role === "assistant") &&
    Array.isArray(value.content)
  );
}

function isSystemMessage(value: unknown): boolean {
  return isConversationMessage(value) && value.role === "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
