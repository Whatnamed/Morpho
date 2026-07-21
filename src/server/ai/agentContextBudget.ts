import type {
  OpenAiCompatibleResponseRequest,
  ResponseFunctionToolOutput,
  ResponseMessageInput
} from "./openaiCompatibleProvider";
import {
  MORPHO_AGENT_CONTEXT_POLICY,
  type MorphoAgentContextPolicy
} from "@/domain/morpho/agentContextPolicy";

export type AgentContextLimits = {
  windowTokens: number;
  prepareTokens: number;
  compactTokens: number;
  targetUncompressedTokens: number;
  responseReserveTokens: number;
};

export type AgentContextPressure = "normal" | "prepare" | "compact";

export type PreparedAgentContextRequest = {
  request: OpenAiCompatibleResponseRequest;
  pressure: AgentContextPressure;
  estimatedInputTokens: number;
  estimatedOccupancyTokens: number;
  finalEstimatedInputTokens: number;
  compressibleTokens: number;
  compacted: boolean;
  checkpointRequested: boolean;
};

export type AgentContextExecutionResult<T> = {
  result: T;
  context: Omit<PreparedAgentContextRequest, "request"> & {
    retried: boolean;
  };
};

export type AgentContextExecutionAttempt = {
  index: 0 | 1;
  kind: "initial" | "contextRetry";
};

type AgentContextCompactionMode = "prepare" | "compact" | "emergency";

const IMAGE_INPUT_TOKEN_RESERVE = 8_192;
const ESTIMATE_BASE_TOKENS = 128;
const EMERGENCY_OLD_TOOL_OUTPUT_CHARS = 480;

export function createAgentContextLimits(
  policy: MorphoAgentContextPolicy = MORPHO_AGENT_CONTEXT_POLICY
): AgentContextLimits {
  return {
    windowTokens: policy.windowTokens,
    prepareTokens: policy.prepareTokens,
    compactTokens: policy.compactTokens,
    targetUncompressedTokens: policy.targetUncompressedTokens,
    responseReserveTokens: policy.responseReserveTokens
  };
}

export function classifyAgentContextPressure(
  estimatedInputTokens: number,
  limits: AgentContextLimits
): AgentContextPressure {
  if (estimatedInputTokens >= limits.compactTokens) {
    return "compact";
  }
  if (estimatedInputTokens >= limits.prepareTokens) {
    return "prepare";
  }
  return "normal";
}

export function estimateAgentContextTokens(request: OpenAiCompatibleResponseRequest): number {
  const imageCount = countImageInputs(request.input);
  const textTokens = estimateSerializedTokens({
    input: request.input,
    tools: request.tools ?? []
  });
  return ESTIMATE_BASE_TOKENS + textTokens + imageCount * IMAGE_INPUT_TOKEN_RESERVE;
}

export function prepareAgentContextRequest(
  request: OpenAiCompatibleResponseRequest,
  options: {
    limits: AgentContextLimits;
    baselineInputTokens?: number;
    force?: AgentContextCompactionMode;
  }
): PreparedAgentContextRequest {
  const localEstimate = estimateAgentContextTokens(request);
  const estimatedInputTokens = Math.max(localEstimate, options.baselineInputTokens ?? 0);
  const estimatedOccupancyTokens = estimatedInputTokens + options.limits.responseReserveTokens;
  const pressure =
    options.force === "emergency"
      ? "compact"
      : options.force ?? classifyAgentContextPressure(estimatedOccupancyTokens, options.limits);
  if (pressure === "normal") {
    return {
      request,
      pressure,
      estimatedInputTokens,
      estimatedOccupancyTokens,
      finalEstimatedInputTokens: localEstimate,
      compressibleTokens: estimateCompressibleContextTokens(request),
      compacted: false,
      checkpointRequested: false
    };
  }

  if (options.force !== "emergency") {
    return {
      request,
      pressure,
      estimatedInputTokens,
      estimatedOccupancyTokens,
      finalEstimatedInputTokens: localEstimate,
      compressibleTokens: estimateCompressibleContextTokens(request),
      compacted: false,
      checkpointRequested: false
    };
  }

  const compactedRequest = compactAgentContextRequest(request, "emergency");
  return {
    request: compactedRequest,
    pressure,
    estimatedInputTokens,
    estimatedOccupancyTokens,
    finalEstimatedInputTokens: estimateAgentContextTokens(compactedRequest),
    compressibleTokens: estimateCompressibleContextTokens(compactedRequest),
    compacted: compactedRequest !== request,
    checkpointRequested: false
  };
}

export async function executeAgentRequestWithContextBudget<T>(
  request: OpenAiCompatibleResponseRequest,
  options: {
    limits: AgentContextLimits;
    baselineInputTokens?: number;
    execute: (request: OpenAiCompatibleResponseRequest, attempt: AgentContextExecutionAttempt) => Promise<T>;
    onRetry?: (attempt: { failed: AgentContextExecutionAttempt; next: AgentContextExecutionAttempt }) => void;
  }
): Promise<AgentContextExecutionResult<T>> {
  const prepared = prepareAgentContextRequest(request, {
    limits: options.limits,
    baselineInputTokens: options.baselineInputTokens
  });
  const initialAttempt: AgentContextExecutionAttempt = { index: 0, kind: "initial" };
  try {
    const result = await options.execute(prepared.request, initialAttempt);
    return {
      result,
      context: {
        pressure: prepared.pressure,
        estimatedInputTokens: prepared.estimatedInputTokens,
        estimatedOccupancyTokens: prepared.estimatedOccupancyTokens,
        finalEstimatedInputTokens: prepared.finalEstimatedInputTokens,
        compressibleTokens: prepared.compressibleTokens,
        compacted: prepared.compacted,
        checkpointRequested: prepared.checkpointRequested,
        retried: false
      }
    };
  } catch (error) {
    if (!isContextLimitError(error)) {
      throw error;
    }
    const emergency = prepareAgentContextRequest(request, {
      limits: options.limits,
      baselineInputTokens: options.baselineInputTokens,
      force: "emergency"
    });
    if (!emergency.compacted) {
      throw error;
    }
    const retryAttempt: AgentContextExecutionAttempt = { index: 1, kind: "contextRetry" };
    options.onRetry?.({ failed: initialAttempt, next: retryAttempt });
    const result = await options.execute(emergency.request, retryAttempt);
    return {
      result,
      context: {
        pressure: "compact",
        estimatedInputTokens: prepared.estimatedInputTokens,
        estimatedOccupancyTokens: emergency.estimatedInputTokens + options.limits.responseReserveTokens,
        finalEstimatedInputTokens: emergency.finalEstimatedInputTokens,
        compressibleTokens: emergency.compressibleTokens,
        compacted: emergency.compacted,
        checkpointRequested: false,
        retried: true
      }
    };
  }
}

function compactAgentContextRequest(
  request: OpenAiCompatibleResponseRequest,
  mode: AgentContextCompactionMode
): OpenAiCompatibleResponseRequest {
  if (mode !== "emergency") {
    return request;
  }
  const compactedInput = compactOldToolOutputs(request.input, EMERGENCY_OLD_TOOL_OUTPUT_CHARS);
  if (compactedInput === request.input) {
    return request;
  }
  return { ...request, input: compactedInput };
}

function isContextLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "context_limit"
  );
}

function estimateCompressibleContextTokens(request: OpenAiCompatibleResponseRequest): number {
  const currentUserIndex = findCurrentUserMessageIndex(request.input);
  const history = request.input
    .slice(0, currentUserIndex)
    .filter((item) => isResponseMessage(item) && item.role !== "system");
  const protectedToolTailStart = findProtectedToolTailStart(request.input, currentUserIndex);
  const completedToolHistory = request.input.slice(currentUserIndex + 1, protectedToolTailStart);
  return estimateSerializedTokens({
    history,
    completedToolHistory
  });
}

function findProtectedToolTailStart(
  input: OpenAiCompatibleResponseRequest["input"],
  currentUserIndex: number
): number {
  const latestOutputCallIds = new Set<string>();
  for (let index = input.length - 1; index > currentUserIndex; index -= 1) {
    const item = input[index];
    if (isFunctionToolOutput(item)) {
      latestOutputCallIds.add(item.call_id);
      continue;
    }
    if (latestOutputCallIds.size > 0) {
      break;
    }
  }
  if (latestOutputCallIds.size === 0) {
    return input.length;
  }

  for (let index = currentUserIndex + 1; index < input.length; index += 1) {
    const item = input[index];
    if (
      isAgentFunctionCall(item) &&
      latestOutputCallIds.has(item.call_id)
    ) {
      return index;
    }
  }
  return input.length;
}

function estimateSerializedTokens(value: unknown): number {
  const normalized = JSON.stringify(value, (key, item) => {
    if (key === "image_url" && typeof item === "string") {
      return "[image-input]";
    }
    return item;
  });
  return Math.ceil(new TextEncoder().encode(normalized).length / 3);
}

function compactOldToolOutputs(
  items: OpenAiCompatibleResponseRequest["input"],
  maxChars: number
): OpenAiCompatibleResponseRequest["input"] {
  let latestToolOutputIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isFunctionToolOutput(items[index])) {
      latestToolOutputIndex = index;
      break;
    }
  }
  if (latestToolOutputIndex < 0) {
    return items;
  }
  let latestToolOutputGroupStart = latestToolOutputIndex;
  while (
    latestToolOutputGroupStart > 0 &&
    isFunctionToolOutput(items[latestToolOutputGroupStart - 1])
  ) {
    latestToolOutputGroupStart -= 1;
  }

  let changed = false;
  const compacted = items.map((item, index) => {
    if (
      !isFunctionToolOutput(item) ||
      index >= latestToolOutputGroupStart ||
      item.output.length <= maxChars
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      output: `${item.output.slice(0, maxChars)}…`
    };
  });
  return changed ? compacted : items;
}

function findCurrentUserMessageIndex(input: OpenAiCompatibleResponseRequest["input"]): number {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (isResponseMessage(item) && item.role === "user") {
      return index;
    }
  }
  return 0;
}

function countImageInputs(input: OpenAiCompatibleResponseRequest["input"]): number {
  let count = 0;
  for (const item of input) {
    if (!isResponseMessage(item)) {
      continue;
    }
    count += item.content.filter((part) => part.type === "input_image").length;
  }
  return count;
}

function isResponseMessage(value: OpenAiCompatibleResponseRequest["input"][number]): value is ResponseMessageInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    (value.role === "system" || value.role === "user" || value.role === "assistant") &&
    "content" in value &&
    Array.isArray(value.content)
  );
}

function isFunctionToolOutput(
  value: OpenAiCompatibleResponseRequest["input"][number]
): value is ResponseFunctionToolOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "function_call_output" &&
    "output" in value &&
    typeof value.output === "string"
  );
}

function isAgentFunctionCall(
  value: OpenAiCompatibleResponseRequest["input"][number]
): value is OpenAiCompatibleResponseRequest["input"][number] & {
  type: "function_call";
  call_id: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "function_call" &&
    "call_id" in value &&
    typeof value.call_id === "string"
  );
}
