import { createHash } from "node:crypto";

import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import {
  buildMorphoAgentStableSystemPrompt,
  buildMorphoAgentTools
} from "@/features/workspace/morphoAgent";
import type {
  APlusAgentImagePart,
  APlusAgentProviderMessage,
  APlusAgentProviderRequest,
  APlusAgentTextPart
} from "@/shared/agentTurnJournalProtocol";
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
  ResponseMessageInput
} from "./openaiCompatibleProvider";

const MAX_INPUT_ITEMS = 1_024;
const MAX_CONTENT_PARTS = 64;
const MAX_TEXT_PART_CHARS = 120_000;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

export type ValidatedAPlusAgentProviderRequest = Readonly<{
  input: APlusAgentProviderRequest["input"];
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

export function parseAPlusAgentProviderRequest(value: unknown):
  | { status: "ok"; value: ValidatedAPlusAgentProviderRequest }
  | { status: "failed"; reason: string } {
  if (!isRecord(value)) {
    return failed("providerRequest 必须是对象。");
  }
  const unknown = unknownKeys(value, [
    "input",
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
  const previousRuntimeItem = value.previousRuntimeItem === undefined
    ? undefined
    : isValidCanonicalAgentRuntimeItem(value.previousRuntimeItem)
      ? value.previousRuntimeItem
      : undefined;
  if (value.previousRuntimeItem !== undefined && !previousRuntimeItem) {
    return failed("previousRuntimeItem 不是有效的 canonical Runtime Item。");
  }

  return {
    status: "ok",
    value: {
      input: parsedInput.value,
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
      ...input.request.input.map(copyProviderMessage)
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
