import type {
  OpenAiCompatibleResponseRequest,
  ResponseFunctionToolOutput,
  ResponseMessageInput
} from "./openaiCompatibleProvider";

export type AgentContextLimits = {
  windowTokens: number;
  prepareTokens: number;
  compactTokens: number;
  targetTokens: number;
};

export type AgentContextPressure = "normal" | "prepare" | "compact";

export type PreparedAgentContextRequest = {
  request: OpenAiCompatibleResponseRequest;
  pressure: AgentContextPressure;
  estimatedInputTokens: number;
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
const PREPARE_HISTORY_LIMIT = 4;
const COMPACT_HISTORY_LIMIT = 2;
const PREPARE_OLD_TOOL_OUTPUT_CHARS = 1_200;
const COMPACT_OLD_TOOL_OUTPUT_CHARS = 480;
const CHECKPOINT_INSTRUCTION_MARKER = "morphoConversationCheckpoint";

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
  const pressure =
    options.force === "emergency"
      ? "compact"
      : options.force ?? classifyAgentContextPressure(estimatedInputTokens, options.limits);
  if (pressure === "normal") {
    return {
      request,
      pressure,
      estimatedInputTokens,
      finalEstimatedInputTokens: localEstimate,
      compressibleTokens: estimateCompressibleContextTokens(request),
      compacted: false,
      checkpointRequested: false
    };
  }

  let compactedRequest = compactAgentContextRequest(request, options.force ?? pressure);
  let compressibleTokens = estimateCompressibleContextTokens(compactedRequest);
  if (compressibleTokens > options.limits.targetTokens) {
    compactedRequest = compactAgentContextRequest(request, "emergency");
    compressibleTokens = estimateCompressibleContextTokens(compactedRequest);
  }
  const requestWithCheckpointInstruction = appendCheckpointInstruction(compactedRequest);
  return {
    request: requestWithCheckpointInstruction,
    pressure,
    estimatedInputTokens,
    finalEstimatedInputTokens: estimateAgentContextTokens(requestWithCheckpointInstruction),
    compressibleTokens,
    compacted: true,
    checkpointRequested: true
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
    const retryAttempt: AgentContextExecutionAttempt = { index: 1, kind: "contextRetry" };
    options.onRetry?.({ failed: initialAttempt, next: retryAttempt });
    const result = await options.execute(emergency.request, retryAttempt);
    return {
      result,
      context: {
        pressure: "compact",
        estimatedInputTokens: prepared.estimatedInputTokens,
        finalEstimatedInputTokens: emergency.finalEstimatedInputTokens,
        compressibleTokens: emergency.compressibleTokens,
        compacted: true,
        checkpointRequested: true,
        retried: true
      }
    };
  }
}

function compactAgentContextRequest(
  request: OpenAiCompatibleResponseRequest,
  mode: AgentContextCompactionMode
): OpenAiCompatibleResponseRequest {
  const currentUserIndex = findCurrentUserMessageIndex(request.input);
  const historyLimit =
    mode === "emergency"
      ? 0
      : mode === "compact"
        ? COMPACT_HISTORY_LIMIT
        : PREPARE_HISTORY_LIMIT;
  const prefix = request.input.slice(0, currentUserIndex);
  const systemMessages = prefix.filter((item) => isResponseMessage(item) && item.role === "system");
  const historyMessages = prefix.filter(
    (item) => isResponseMessage(item) && (item.role === "user" || item.role === "assistant")
  );
  const currentAndTail = request.input.slice(currentUserIndex);
  const compactedTail = compactOldToolOutputs(
    currentAndTail,
    mode === "emergency"
      ? Math.floor(COMPACT_OLD_TOOL_OUTPUT_CHARS / 2)
      : mode === "compact"
        ? COMPACT_OLD_TOOL_OUTPUT_CHARS
        : PREPARE_OLD_TOOL_OUTPUT_CHARS
  );

  return {
    ...request,
    input: [
      ...systemMessages,
      ...(historyLimit > 0 ? historyMessages.slice(-historyLimit) : []),
      ...compactedTail
    ]
  };
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

  return items.map((item, index) => {
    if (
      !isFunctionToolOutput(item) ||
      index >= latestToolOutputGroupStart ||
      item.output.length <= maxChars
    ) {
      return item;
    }
    return {
      ...item,
      output: `${item.output.slice(0, maxChars)}…`
    };
  });
}

function appendCheckpointInstruction(request: OpenAiCompatibleResponseRequest): OpenAiCompatibleResponseRequest {
  const systemIndex = request.input.findIndex((item) => isResponseMessage(item) && item.role === "system");
  if (systemIndex < 0) {
    return request;
  }
  const systemMessage = request.input[systemIndex];
  if (!isResponseMessage(systemMessage)) {
    return request;
  }
  const existingText = systemMessage.content
    .filter((part) => part.type === "input_text")
    .map((part) => part.text)
    .join("\n");
  if (existingText.includes(CHECKPOINT_INSTRUCTION_MARKER)) {
    return request;
  }

  const nextInput = [...request.input];
  nextInput[systemIndex] = {
    ...systemMessage,
    content: [
      ...systemMessage.content,
      {
        type: "input_text",
        text: [
          "当前请求已接近 Context 预算，请在正常回答末尾附带一个简短的 checkpoint。",
          "仅记录当前讨论目标、进展、待继续问题和下一轮锚点，不记录项目状态写入或内部提示。",
          'JSON shape: { "morphoConversationCheckpoint": { "threadGoal": string, "progress": string[], "openThreads": string[], "nextTurnAnchor"?: string } }'
        ].join("\n")
      }
    ]
  };
  return {
    ...request,
    input: nextInput
  };
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
