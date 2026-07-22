export const PROVIDER_INPUT_BASE_TOKENS = 128;
export const PROVIDER_INPUT_IMAGE_TOKEN_RESERVE = 8_192;

export type ProviderInputBudget = {
  inputTokens: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
