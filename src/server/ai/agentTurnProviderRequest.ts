import { createHash } from "node:crypto";

import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import {
  buildMorphoAgentStableSystemPrompt,
  buildMorphoAgentTools
} from "@/features/workspace/morphoAgent";
import type {
  APlusAgentImagePart,
  APlusAgentContinuationItem,
  APlusAgentProviderMessage,
  APlusAgentProviderRequest,
  APlusAgentTextPart,
  APlusToolCall
} from "@/shared/agentTurnJournalProtocol";
import { MAX_AGENT_FUNCTION_CALLS } from "@/shared/agentFunctionCallLimits";
import {
  canonicalAgentRuntimeMessage,
  isValidCanonicalAgentRuntimeItem,
  resolveCanonicalAgentRuntimeItem,
  type AgentCanonicalRuntimeItem,
  type AgentRuntimeMode,
  type AgentToolProfile
} from "@/shared/agentRuntimeItem";
import { estimateProviderInputTokens } from "@/shared/providerInputBudget";

import type {
  OpenAiCompatibleResponseRequest,
  AgentOutputItem,
  ProviderFunctionCall,
  ResponseFunctionToolOutput,
  ResponseMessageInput
} from "./openaiCompatibleProvider";

const MAX_INPUT_ITEMS = 1_024;
const MAX_CONTENT_PARTS = 64;
const MAX_TEXT_PART_CHARS = 120_000;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_CONTINUATION_ITEMS = 64;
const MAX_FUNCTION_ARGUMENT_CHARS = 120_000;
const MAX_FUNCTION_OUTPUT_CHARS = 120_000;
const MAX_FUNCTION_ARGUMENT_DEPTH = 12;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const REGISTERED_TOOL_NAMES = new Set(
  buildMorphoAgentTools(true).flatMap((tool) =>
    tool.type === "function" ? [tool.name] : []
  )
);

export type ValidatedAPlusAgentProviderRequest = Readonly<{
  input: APlusAgentProviderRequest["input"];
  continuationItems: readonly APlusAgentContinuationItem[];
  promptContractVersion: typeof MORPHO_AGENT_PROMPT_CONTRACT_VERSION;
  mode: AgentRuntimeMode;
  capabilityIntent: Readonly<{ comparisonAnalysis: boolean }>;
  previousRuntimeItem?: AgentCanonicalRuntimeItem;
}>;

export type APlusAgentProviderContract = Readonly<{
  request: OpenAiCompatibleResponseRequest;
  runtimeItem: AgentCanonicalRuntimeItem;
  effectiveToolProfile: AgentToolProfile;
}>;

export type APlusExternalToolActionClaim = Readonly<{
  toolCallId: string;
  actionKind: "webSearch" | "image";
  claimHash: string;
  maxActionCount: number;
}>;

export function parseAPlusAgentProviderRequest(value: unknown):
  | { status: "ok"; value: ValidatedAPlusAgentProviderRequest }
  | { status: "failed"; reason: string } {
  if (!isRecord(value)) {
    return failed("providerRequest 必须是对象。");
  }
  const unknown = unknownKeys(value, [
    "input",
    "continuationItems",
    "promptContractVersion",
    "mode",
    "capabilityIntent",
    "previousRuntimeItem"
  ]);
  if (unknown.length > 0) {
    return failed(`providerRequest 包含不允许的字段：${unknown.join("、")}。`);
  }
  if (value.promptContractVersion !== MORPHO_AGENT_PROMPT_CONTRACT_VERSION) {
    return failed(`不支持的 Prompt Contract Version：${String(value.promptContractVersion ?? "缺失")}。`);
  }
  if (value.mode !== "auto" && value.mode !== "confirm") {
    return failed("mode 必须是 auto 或 confirm。");
  }
  if (
    !isRecord(value.capabilityIntent) ||
    unknownKeys(value.capabilityIntent, ["comparisonAnalysis"]).length > 0 ||
    typeof value.capabilityIntent.comparisonAnalysis !== "boolean"
  ) {
    return failed("capabilityIntent 格式无效。");
  }
  if (!Array.isArray(value.input) || value.input.length < 1 || value.input.length > MAX_INPUT_ITEMS) {
    return failed(`input 必须包含 1-${MAX_INPUT_ITEMS} 个 bounded message。`);
  }
  const parsedInput = parseMessages(value.input);
  if (parsedInput.status === "failed") {
    return parsedInput;
  }
  const continuationItems = parseContinuationItems(value.continuationItems);
  if (continuationItems.status === "failed") {
    return continuationItems;
  }
  const previousRuntimeItem = value.previousRuntimeItem === undefined
    ? undefined
    : parseCanonicalRuntimeItem(value.previousRuntimeItem);
  if (value.previousRuntimeItem !== undefined && !previousRuntimeItem) {
    return failed("previousRuntimeItem 不是有效的 canonical Runtime Item。");
  }

  return {
    status: "ok",
    value: {
      input: parsedInput.value,
      continuationItems: continuationItems.value,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      mode: value.mode,
      capabilityIntent: {
        comparisonAnalysis: value.capabilityIntent.comparisonAnalysis
      },
      ...(previousRuntimeItem ? { previousRuntimeItem } : {})
    }
  };
}

export function buildAPlusAgentProviderContract(input: {
  localProjectId: string;
  request: ValidatedAPlusAgentProviderRequest;
  webSearchEnabled: boolean;
}): APlusAgentProviderContract {
  const tools = buildMorphoAgentTools(input.webSearchEnabled);
  const effectiveToolProfile: AgentToolProfile = tools.some(
    (tool) => tool.type === "function" && tool.name === "search_web_evidence"
  )
    ? "standardWithWebSearch"
    : "standard";
  const runtimeItem = resolveCanonicalAgentRuntimeItem({
    projectId: input.localProjectId,
    mode: input.request.mode,
    effectiveToolProfile,
    promptContractVersion: input.request.promptContractVersion,
    previous: input.request.previousRuntimeItem
  });
  const request: OpenAiCompatibleResponseRequest = {
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: buildMorphoAgentStableSystemPrompt() }]
      },
      canonicalAgentRuntimeMessage(runtimeItem),
      ...input.request.input.map(copyProviderMessage),
      ...input.request.continuationItems.map(copyContinuationItem)
    ],
    tools
  };
  const budget = estimateProviderInputTokens({
    input: request.input,
    tools,
    responseReserveTokens: 0
  });
  if (request.input.length > MAX_INPUT_ITEMS) {
    throw new APlusAgentProviderRequestError(`Provider Input Item 数量超过 ${MAX_INPUT_ITEMS}。`, 413);
  }
  if (budget.inputTokens > MORPHO_AGENT_CONTEXT_POLICY.windowTokens) {
    throw new APlusAgentProviderRequestError("Provider Input 超出 Morpho 允许的 Context Window。", 413);
  }
  return { request, runtimeItem, effectiveToolProfile };
}

function parseContinuationItems(value: unknown):
  | { status: "ok"; value: readonly APlusAgentContinuationItem[] }
  | { status: "failed"; reason: string } {
  if (value === undefined) return { status: "ok", value: [] };
  if (!Array.isArray(value) || value.length > MAX_CONTINUATION_ITEMS) {
    return failed(`continuationItems 最多包含 ${MAX_CONTINUATION_ITEMS} 个 Item。`);
  }
  const parsed: APlusAgentContinuationItem[] = [];
  const callIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item) || (item.type !== "function_call" && item.type !== "function_call_output")) {
      return failed(`continuationItems[${index}] 类型无效。`);
    }
    if (!isBoundedIdentifier(item.callId)) {
      return failed(`continuationItems[${index}].callId 无效。`);
    }
    if (item.type === "function_call") {
      if (
        unknownKeys(item, ["type", "callId", "name", "argumentsText"]).length > 0 ||
        typeof item.name !== "string" ||
        !REGISTERED_TOOL_NAMES.has(item.name) ||
        typeof item.argumentsText !== "string" ||
        item.argumentsText.length < 2 ||
        item.argumentsText.length > MAX_FUNCTION_ARGUMENT_CHARS ||
        !isBoundedJsonObject(item.argumentsText)
      ) {
        return failed(`continuationItems[${index}] Function Call 无效。`);
      }
      if (callIds.has(item.callId)) {
        return failed(`continuationItems 包含重复 Function Call：${item.callId}。`);
      }
      callIds.add(item.callId);
      parsed.push({
        type: "function_call",
        callId: item.callId,
        name: item.name,
        argumentsText: item.argumentsText
      });
      continue;
    }
    if (
      unknownKeys(item, ["type", "callId", "output"]).length > 0 ||
      typeof item.output !== "string" ||
      item.output.length < 1 ||
      item.output.length > MAX_FUNCTION_OUTPUT_CHARS ||
      !callIds.has(item.callId)
    ) {
      return failed(`continuationItems[${index}] Function Result 无效或缺少前置 Call。`);
    }
    parsed.push({ type: "function_call_output", callId: item.callId, output: item.output });
  }
  const resultIds = new Set(
    parsed.filter((item) => item.type === "function_call_output").map((item) => item.callId)
  );
  if ([...callIds].some((callId) => !resultIds.has(callId))) {
    return failed("continuationItems 中每个 Function Call 都必须有一个终态 Result。");
  }
  return { status: "ok", value: parsed };
}

function isBoundedJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) && jsonDepth(parsed) <= MAX_FUNCTION_ARGUMENT_DEPTH;
  } catch {
    return false;
  }
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce((max, item) => Math.max(max, jsonDepth(item)), 0);
  }
  if (isRecord(value)) {
    return 1 + Object.values(value).reduce<number>(
      (max, item) => Math.max(max, jsonDepth(item)),
      0
    );
  }
  return 0;
}

export function hashAPlusAgentExternalRequest(input: {
  model: string;
  reasoningEffort?: string;
  providerRequest: OpenAiCompatibleResponseRequest;
}): string {
  const canonical = canonicalJson({
    domain: "morpho-agent-a-plus-external-request-v1",
    model: input.model,
    reasoningEffort: input.reasoningEffort ?? null,
    input: input.providerRequest.input,
    tools: input.providerRequest.tools ?? []
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Persists only a bounded authorization claim derived from the server-observed
 * Provider call. Raw arguments stay out of the Journal. Local Tool Results are
 * still client-owned and are not authenticated by this claim.
 */
export function buildAPlusExternalToolActionClaims(
  toolCalls: readonly APlusToolCall[]
): readonly APlusExternalToolActionClaim[] {
  return toolCalls.flatMap<APlusExternalToolActionClaim>((call) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.argumentsText) as unknown;
    } catch {
      return [];
    }
    if (call.name === "search_web_evidence" && isRecord(parsed)) {
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries
            .filter((query): query is string => typeof query === "string")
            .map((query) => query.trim())
        : [];
      if (
        queries.length < 1 || queries.length > 3 ||
        queries.some((query) => query.length < 1 || query.length > 300) ||
        new Set(queries).size !== queries.length
      ) return [];
      return [{
        toolCallId: call.callId,
        actionKind: "webSearch" as const,
        claimHash: hashAPlusExternalToolActionClaim({
          actionKind: "webSearch",
          toolCallId: call.callId,
          queries
        }),
        maxActionCount: 1
      }];
    }
    if (call.name === "generate_visuals" && isRecord(parsed) && Array.isArray(parsed.items)) {
      const count = parsed.items.length;
      if (count < 1 || count > 32) return [];
      return [{
        toolCallId: call.callId,
        actionKind: "image" as const,
        claimHash: hashAPlusExternalToolActionClaim({
          actionKind: "image",
          toolCallId: call.callId
        }),
        maxActionCount: count
      }];
    }
    return [];
  });
}

export function hashAPlusExternalToolActionClaim(input: Readonly<
  | { actionKind: "webSearch"; toolCallId: string; queries: readonly string[] }
  | { actionKind: "image"; toolCallId: string }
>): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function normalizeAPlusProviderToolCalls(
  calls: readonly ProviderFunctionCall[]
): APlusToolCall[] {
  if (calls.length > MAX_AGENT_FUNCTION_CALLS) {
    throw new APlusAgentProviderRequestError("Provider 返回的 Tool Call 数量超过安全上限。");
  }
  const seen = new Set<string>();
  return calls.map((call) => {
    if (
      !isBoundedIdentifier(call.callId) ||
      seen.has(call.callId) ||
      !REGISTERED_TOOL_NAMES.has(call.name) ||
      call.argumentsText.length < 2 ||
      call.argumentsText.length > MAX_FUNCTION_ARGUMENT_CHARS ||
      !isBoundedJsonObject(call.argumentsText)
    ) {
      throw new APlusAgentProviderRequestError("Provider 返回了无效或重复的 Tool Call Payload。");
    }
    seen.add(call.callId);
    return {
      callId: call.callId,
      name: call.name,
      argumentsText: call.argumentsText
    };
  });
}

export class APlusAgentProviderRequestError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message);
    this.name = "APlusAgentProviderRequestError";
  }
}

function parseMessages(value: readonly unknown[]):
  | { status: "ok"; value: APlusAgentProviderRequest["input"] }
  | { status: "failed"; reason: string } {
  const messages: APlusAgentProviderMessage[] = [];
  let imageCount = 0;
  let totalImageBytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (
      !isRecord(raw) ||
      unknownKeys(raw, ["role", "content"]).length > 0 ||
      (raw.role !== "user" && raw.role !== "assistant") ||
      !Array.isArray(raw.content) ||
      raw.content.length < 1 ||
      raw.content.length > MAX_CONTENT_PARTS
    ) {
      return failed(`input[${index}] 不是允许的 user/assistant message。`);
    }
    const content: Array<APlusAgentTextPart | APlusAgentImagePart> = [];
    for (let partIndex = 0; partIndex < raw.content.length; partIndex += 1) {
      const part = raw.content[partIndex];
      if (!isRecord(part) || typeof part.type !== "string") {
        return failed(`input[${index}].content[${partIndex}] 格式无效。`);
      }
      if (part.type === "input_text" || part.type === "output_text") {
        if (
          unknownKeys(part, ["type", "text"]).length > 0 ||
          typeof part.text !== "string" ||
          part.text.length < 1 ||
          part.text.length > MAX_TEXT_PART_CHARS
        ) {
          return failed(`input[${index}].content[${partIndex}] 文本无效或过长。`);
        }
        content.push({ type: part.type, text: part.text });
        continue;
      }
      if (part.type === "input_image") {
        if (
          raw.role !== "user" ||
          unknownKeys(part, ["type", "image_url"]).length > 0 ||
          typeof part.image_url !== "string"
        ) {
          return failed(`input[${index}].content[${partIndex}] 图片输入无效。`);
        }
        const bytes = imageDataBytes(part.image_url);
        if (bytes === undefined || bytes > MAX_IMAGE_BYTES) {
          return failed(`input[${index}].content[${partIndex}] 图片格式不支持或过大。`);
        }
        imageCount += 1;
        totalImageBytes += bytes;
        content.push({ type: "input_image", image_url: part.image_url });
        continue;
      }
      return failed(`input[${index}].content[${partIndex}] 类型不允许。`);
    }
    messages.push({ role: raw.role, content });
  }
  if (imageCount > MAX_IMAGE_COUNT || totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    return failed(`图片最多 ${MAX_IMAGE_COUNT} 张，总大小不得超过 ${MAX_TOTAL_IMAGE_BYTES} bytes。`);
  }
  return { status: "ok", value: messages };
}

function imageDataBytes(value: string): number | undefined {
  const match = value.match(IMAGE_DATA_URL);
  if (!match) {
    return undefined;
  }
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  throw new APlusAgentProviderRequestError("Provider Request 包含不可规范化的值。");
}

function failed(reason: string): { status: "failed"; reason: string } {
  return { status: "failed", reason };
}

function parseCanonicalRuntimeItem(value: unknown): AgentCanonicalRuntimeItem | undefined {
  if (
    !isRecord(value) ||
    unknownKeys(value, [
      "id",
      "contentHash",
      "effectiveToolProfile",
      "mode",
      "promptContractVersion",
      "placement",
      "sequence",
      "renderedText",
      "predecessorItemId"
    ]).length > 0 ||
    !isValidCanonicalAgentRuntimeItem(value)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    contentHash: value.contentHash,
    effectiveToolProfile: value.effectiveToolProfile,
    mode: value.mode,
    promptContractVersion: value.promptContractVersion,
    placement: value.placement,
    sequence: value.sequence,
    renderedText: value.renderedText,
    ...(value.predecessorItemId ? { predecessorItemId: value.predecessorItemId } : {})
  };
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyProviderMessage(message: APlusAgentProviderMessage): ResponseMessageInput {
  return {
    role: message.role,
    content: message.content.map((part) => ({ ...part }))
  };
}

function copyContinuationItem(
  item: APlusAgentContinuationItem
): AgentOutputItem | ResponseFunctionToolOutput {
  return item.type === "function_call"
    ? {
        type: "function_call",
        call_id: item.callId,
        name: item.name,
        arguments: item.argumentsText
      }
    : {
        type: "function_call_output",
        call_id: item.callId,
        output: item.output
      };
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}
