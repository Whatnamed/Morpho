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
  compressibleConversationTokens: number;
  currentTurnTokens: number;
  responseReserveTokens: number;
  estimatedOccupancyTokens: number;
  imageCount: number;
  /**
   * Provider input items in the same payload the token figures describe. The
   * Provider rejects a request above its item ceiling regardless of token count,
   * so compaction has to watch this alongside tokens.
   */
  projectedInputItemCount: number;
};

export type AgentContextBudgetState = {
  generation: number;
  baselineInputTokens: number;
};

export function createAgentContextBudgetState(inputTokens: number): AgentContextBudgetState {
  return {
    generation: 0,
    baselineInputTokens: normalizeTokenCount(inputTokens)
  };
}

export function updateAgentContextBudgetBaseline(
  state: AgentContextBudgetState,
  observedInputTokens: number
): AgentContextBudgetState {
  return {
    ...state,
    baselineInputTokens: Math.max(state.baselineInputTokens, normalizeTokenCount(observedInputTokens))
  };
}

export function advanceAgentContextBudgetGeneration(
  state: AgentContextBudgetState,
  compressedInputTokens: number
): AgentContextBudgetState {
  return {
    generation: state.generation + 1,
    baselineInputTokens: normalizeTokenCount(compressedInputTokens)
  };
}

export function estimateProviderInputTokens(input: {
  input: readonly unknown[];
  tools: readonly unknown[];
  responseReserveTokens: number;
}): ProviderInputBudget {
  const materializedInput = input.input.map((item) => {
    const marker = parseAgentStrategyMarker(item);
    return marker ? canonicalAgentStrategyMessage(marker) : item;
  });
  const imageCount = countImageInputs(materializedInput);
  const serializedTokens = estimateSerializedTokens({ input: materializedInput, tools: input.tools });
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
    : input.input.slice(0, currentUserIndex).filter(isCompressibleConversationMessage);
  const currentTurnItems = currentUserIndex < 0
    ? input.input.filter((item) => !isSystemMessage(item))
    : input.input.slice(currentUserIndex).filter((item) => !isSystemMessage(item));
  const compressibleConversationTokens = estimateInputSegmentTokens(historicalItems);
  const currentTurnTokens = estimateInputSegmentTokens(currentTurnItems);
  const fixedTokens = Math.max(
    0,
    total.inputTokens - compressibleConversationTokens - currentTurnTokens
  );

  return {
    totalInputTokens: total.inputTokens,
    fixedTokens,
    compressibleConversationTokens,
    currentTurnTokens,
    responseReserveTokens: total.responseReserveTokens,
    estimatedOccupancyTokens: total.estimatedOccupancyTokens,
    imageCount: total.imageCount,
    projectedInputItemCount: input.input.length
  };
}

/**
 * The server prepends a stable System prompt and the canonical Runtime item to
 * every Provider request. The client must include them when it decides whether to
 * compact, otherwise it under-counts the payload it is about to cause.
 */
export function buildServerManagedPrefixItems(input: {
  stableSystemPrompt: string;
  runtimeItemText?: string;
}): unknown[] {
  return [
    { role: "system", content: [{ type: "input_text", text: input.stableSystemPrompt }] },
    ...(input.runtimeItemText
      ? [{ role: "system", content: [{ type: "input_text", text: input.runtimeItemText }] }]
      : [])
  ];
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

function isCompressibleConversationMessage(value: unknown): boolean {
  if (!isConversationMessage(value) || (value.role !== "user" && value.role !== "assistant")) {
    return false;
  }
  return !messageText(value).startsWith("[Morpho Untrusted Project Data");
}

function messageText(value: Record<string, unknown>): string {
  if (!Array.isArray(value.content)) {
    return "";
  }
  return value.content
    .filter(isRecord)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trimStart();
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import {
  canonicalAgentStrategyMessage,
  parseAgentStrategyMarker
} from "./agentStrategyItem";
