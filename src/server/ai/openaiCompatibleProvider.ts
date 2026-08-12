import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";
import {
  OpenAiCompatibleStreamError,
  parseOpenAiResponsesStream,
  type OpenAiCompatibleAgentStreamEvent
} from "./openaiCompatibleResponsesStream";
import {
  classifyProviderCacheStatus,
  normalizeProviderTokenUsage,
  type NormalizedProviderTokenUsage
} from "./providerTokenUsage";
import type { AgentProviderDiagnostics } from "@/shared/agentStreamProtocol";
import {
  AgentFunctionCallLimitError,
  assertAgentFunctionCallCount
} from "@/shared/agentFunctionCallLimits";
import {
  assertProviderContentLengthWithinLimit,
  createProviderRequestBudget,
  PROVIDER_SSE_TOTAL_MAX_BYTES,
  ProviderResponseBoundaryError,
  readBoundedProviderDiagnostic,
  readBoundedProviderJson,
  type ProviderRequestBudget,
  type ProviderResponseBoundaryCode
} from "./providerResponseBoundary";
import { visitProviderResponseRecords } from "./providerResponseTraversal";
import { normalizeSafeExternalNavigationUrl } from "@/shared/externalNavigationPolicy";

type OpenAiCompatibleProviderConfig = Pick<
  OpenAiCompatibleConfig,
  "apiKey" | "baseUrl" | "model" | "reasoningEffort" | "webSearchEnabled" | "promptCache"
>;

export type ResponseTextContentPart = {
  type: "input_text";
  text: string;
};

export type ResponseOutputTextContentPart = {
  type: "output_text";
  text: string;
};

export type ResponseImageContentPart = {
  type: "input_image";
  image_url: string;
};

export type ResponseMessageInput = {
  role: "system" | "user" | "assistant";
  content: Array<ResponseTextContentPart | ResponseOutputTextContentPart | ResponseImageContentPart>;
};

export type ResponseFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type ResponseWebSearchTool = {
  type: "web_search_preview";
  search_context_size?: "low" | "medium" | "high";
};

export type ResponseTool = ResponseFunctionTool | ResponseWebSearchTool;

export type ResponseFunctionToolOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type OpenAiCompatibleResponseRequest = {
  input: Array<ResponseMessageInput | ResponseFunctionToolOutput | AgentOutputItem>;
  tools?: ResponseTool[];
  previousResponseId?: string;
  promptCacheKey?: string;
  promptCacheRetention?: "24h";
  diagnostics?: AgentProviderDiagnostics;
};

export type ProviderCitation = {
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
};

export type ProviderFunctionCall = {
  id: string;
  callId: string;
  name: string;
  argumentsText: string;
};

export type ProviderTokenUsage = NormalizedProviderTokenUsage;

export type OpenAiCompatibleResponseResult = {
  responseId: string;
  outputText: string;
  functionCalls: ProviderFunctionCall[];
  citations: ProviderCitation[];
  webSearchCallCount: number;
  outputItems: AgentOutputItem[];
  usage?: ProviderTokenUsage;
  providerDiagnostics?: AgentProviderDiagnostics;
};

export type OpenAiCompatibleStreamHandlers = {
  onTextDelta?: (text: string) => void;
  onCitations?: (citations: ProviderCitation[]) => void;
  onEvent?: (event: OpenAiCompatibleAgentStreamEvent) => void;
  onBufferedFallback?: (input: { semanticEventsEmitted: boolean }) => void;
};

export type { OpenAiCompatibleAgentStreamEvent } from "./openaiCompatibleResponsesStream";

type RawResponse = {
  id?: string;
  output?: unknown[];
  usage?: unknown;
};

const TRANSIENT_RESPONSE_RETRY_DELAYS_MS = [750, 2_000, 4_500] as const;

export type AgentOutputItem = {
  type: string;
  [key: string]: unknown;
};

export class OpenAiCompatibleProviderError extends Error {
  readonly code?: "context_limit" | "function_call_limit" | ProviderResponseBoundaryCode;

  constructor(
    readonly status: number,
    readonly diagnostic?: string,
    code?: "context_limit" | "function_call_limit" | ProviderResponseBoundaryCode
  ) {
    super(`OpenAI-compatible provider error (${status})`);
    this.name = "OpenAiCompatibleProviderError";
    this.code = code ?? (status === 413 || isContextLimitDiagnostic(diagnostic) ? "context_limit" : undefined);
  }
}

export async function executeOpenAiCompatibleResponse(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const budget = createProviderRequestBudget(signal);
  try {
    return await executeOpenAiCompatibleResponseWithBudget(config, request, budget);
  } catch (error) {
    throw translateProviderBoundaryError(error);
  } finally {
    budget.dispose();
  }
}

async function executeOpenAiCompatibleResponseWithBudget(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  budget: ProviderRequestBudget
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetchProviderResponse(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildProviderRequestBody(config, request))
  }, budget);

  if (!response.ok) {
    const diagnostic = await safeReadDiagnostic(response, budget);
    if (shouldRetryWithoutUnsupportedPromptCache(config, request, response.status, diagnostic)) {
      budget.throwIfUnavailable();
      const retry = await fetchProviderResponse(`${config.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildProviderRequestBody(config, withoutPromptCacheFields(request)))
      }, budget);
      if (retry.ok) {
        return resultFromRawResponse(
          await readRawResponse(retry, budget),
          request.diagnostics,
          "unavailable"
        );
      }
      const retryDiagnostic = await safeReadDiagnostic(retry, budget);
      throw new OpenAiCompatibleProviderError(retry.status, retryDiagnostic);
    }
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  return resultFromRawResponse(await readRawResponse(response, budget), request.diagnostics);
}

export async function streamOpenAiCompatibleResponse(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const budget = createProviderRequestBudget(signal);
  try {
    return await streamOpenAiCompatibleResponseWithBudget(config, request, handlers, budget);
  } catch (error) {
    throw translateProviderBoundaryError(error);
  } finally {
    budget.dispose();
  }
}

async function streamOpenAiCompatibleResponseWithBudget(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  budget: ProviderRequestBudget
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetchProviderResponse(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...buildProviderRequestBody(config, request), stream: true })
  }, budget);

  if (!response.ok) {
    const diagnostic = await safeReadDiagnostic(response, budget);
    if (shouldRetryWithoutUnsupportedPromptCache(config, request, response.status, diagnostic)) {
      return executeBufferedResponsesFallback(config, withoutPromptCacheFields(request), handlers, budget, "unavailable");
    }
    if (shouldUseBufferedResponsesFallback(response.status)) {
      return executeBufferedResponsesFallback(config, request, handlers, budget);
    }
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    if (contentType.includes("application/json")) {
      const raw = await readRawResponse(response, budget);
      if (!isRawResponsesResult(raw)) {
        throw new OpenAiCompatibleProviderError(502, "Responses endpoint returned an incompatible JSON payload.");
      }
      const result = resultFromRawResponse(raw, request.diagnostics);
      emitBufferedResult(result, handlers);
      return result;
    }
    await discardProviderResponse(response, budget);
    throw new OpenAiCompatibleProviderError(502, "Responses endpoint did not return an event stream.");
  }
  await assertProviderContentLengthWithinLimit(response, PROVIDER_SSE_TOTAL_MAX_BYTES);

  let semanticEventsEmitted = false;
  try {
    const result = await parseOpenAiResponsesStream(response.body, {
      budget,
      onEvent: (event) => {
        if (event.type !== "unknown") {
          semanticEventsEmitted = true;
        }
        handlers.onEvent?.(event);
        if (event.type === "final-delta") {
          handlers.onTextDelta?.(event.delta);
        } else if (event.type === "citation") {
          handlers.onCitations?.([event.citation]);
        }
      }
    });
    result.providerDiagnostics = {
      ...request.diagnostics,
      ...(result.usage?.cachedInputTokens !== undefined
        ? {
            cachedInputTokens: result.usage.cachedInputTokens,
            uncachedInputTokens: result.usage.uncachedInputTokens,
            cacheHitRatio: result.usage.cacheHitRatio
          }
        : {}),
      cacheStatus: classifyProviderCacheStatus(
        result.usage?.inputTokens ?? 0,
        result.usage?.cachedInputTokens
      )
    };
    return result;
  } catch (error) {
    if (error instanceof AgentFunctionCallLimitError) {
      throw new OpenAiCompatibleProviderError(400, error.message, "function_call_limit");
    }
    if (error instanceof OpenAiCompatibleStreamError) {
      handlers.onBufferedFallback?.({ semanticEventsEmitted });
      budget.throwIfUnavailable();
      return executeBufferedResponsesFallback(config, request, handlers, budget);
    }
    throw error;
  }
}

async function executeBufferedResponsesFallback(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  budget: ProviderRequestBudget,
  cacheStatus?: "unavailable"
): Promise<OpenAiCompatibleResponseResult> {
  budget.throwIfUnavailable();
  const result = await executeOpenAiCompatibleResponseWithBudget(config, request, budget);
  if (cacheStatus) {
    result.providerDiagnostics = { ...result.providerDiagnostics, cacheStatus };
  }
  emitBufferedResult(result, handlers);
  return result;
}

async function safeReadDiagnostic(
  response: Response,
  budget: ProviderRequestBudget
): Promise<string | undefined> {
  try {
    return await readBoundedProviderDiagnostic(response, budget);
  } catch (error) {
    if (error instanceof ProviderResponseBoundaryError || isAbortError(error)) throw error;
    return undefined;
  }
}

async function readRawResponse(
  response: Response,
  budget: ProviderRequestBudget
): Promise<RawResponse> {
  let value: unknown;
  try {
    value = await readBoundedProviderJson(response, budget);
  } catch (error) {
    if (error instanceof ProviderResponseBoundaryError || isAbortError(error)) throw error;
    throw new OpenAiCompatibleProviderError(502, "Responses endpoint returned invalid JSON.");
  }
  return isRecord(value) ? value : {};
}

function translateProviderBoundaryError(error: unknown): unknown {
  return error instanceof ProviderResponseBoundaryError
    ? new OpenAiCompatibleProviderError(502, error.message, error.code)
    : error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchProviderResponse(
  url: string,
  init: RequestInit,
  budget: ProviderRequestBudget
): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      budget.throwIfUnavailable();
      const response = await budget.race(fetch(url, { ...init, signal: budget.signal }));
      if (!isTransientProviderResponse(response.status) || attempt === TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length) {
        return response;
      }
      await discardProviderResponse(response, budget);
    } catch (error) {
      if (budget.signal.aborted || attempt === TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      lastNetworkError = error;
    }

    await budget.wait(TRANSIENT_RESPONSE_RETRY_DELAYS_MS[attempt]);
  }

  throw lastNetworkError ?? new Error("Provider request did not produce a response.");
}

function shouldUseBufferedResponsesFallback(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isTransientProviderResponse(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function discardProviderResponse(
  response: Response,
  budget: ProviderRequestBudget
): Promise<void> {
  try {
    if (response.body) await budget.race(response.body.cancel());
  } catch (error) {
    if (error instanceof ProviderResponseBoundaryError || isAbortError(error)) throw error;
    // The response is being retried, so an unread diagnostic body is not useful.
  }
}

function buildProviderRequestBody(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest
): Record<string, unknown> {
  const promptCache = config.promptCache ?? {
    supportsPromptCacheKey: false,
    supportsPromptCacheRetention: false,
    promptCacheKeyEnabled: false
  };
  const body: Record<string, unknown> = {
    model: config.model,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort, summary: "auto" } } : {}),
    input: request.input,
    tools: request.tools
  };

  if (promptCache.promptCacheKeyEnabled && promptCache.supportsPromptCacheKey && request.promptCacheKey) {
    body.prompt_cache_key = request.promptCacheKey;
  }
  if (
    promptCache.supportsPromptCacheRetention &&
    promptCache.promptCacheRetention &&
    request.promptCacheRetention
  ) {
    body.prompt_cache_retention = request.promptCacheRetention;
  }
  return body;
}

function withoutPromptCacheFields(request: OpenAiCompatibleResponseRequest): OpenAiCompatibleResponseRequest {
  const { promptCacheKey: _promptCacheKey, promptCacheRetention: _promptCacheRetention, ...rest } = request;
  return rest;
}

function shouldRetryWithoutUnsupportedPromptCache(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  status: number,
  diagnostic: string | undefined
): boolean {
  if (status !== 400 || !request.promptCacheKey && !request.promptCacheRetention) {
    return false;
  }
  const promptCache = config.promptCache;
  if (!promptCache?.promptCacheKeyEnabled && !promptCache?.promptCacheRetention) {
    return false;
  }
  const normalized = diagnostic?.toLowerCase() ?? "";
  return [
    "prompt_cache_key",
    "prompt_cache_retention",
    "unknown field",
    "unrecognized field",
    "additional properties"
  ].some((pattern) => normalized.includes(pattern));
}

function resultFromRawResponse(
  raw: RawResponse,
  diagnostics?: AgentProviderDiagnostics,
  cacheStatus?: "unavailable"
): OpenAiCompatibleResponseResult {
  const usage = normalizeProviderTokenUsage(raw.usage, {
    input: "input_tokens",
    output: "output_tokens"
  });
  const providerDiagnostics: AgentProviderDiagnostics = {
    ...diagnostics,
    ...(usage?.cachedInputTokens !== undefined
      ? {
          cachedInputTokens: usage.cachedInputTokens,
          uncachedInputTokens: usage.uncachedInputTokens,
          cacheHitRatio: usage.cacheHitRatio
        }
      : {}),
    cacheStatus: cacheStatus ?? classifyProviderCacheStatus(
      usage?.inputTokens ?? 0,
      usage?.cachedInputTokens
    )
  };
  const functionCalls = extractFunctionCalls(raw.output);
  try {
    assertAgentFunctionCallCount(functionCalls.length);
  } catch (error) {
    if (error instanceof AgentFunctionCallLimitError) {
      throw new OpenAiCompatibleProviderError(400, error.message, "function_call_limit");
    }
    throw error;
  }
  return {
    responseId: typeof raw.id === "string" ? raw.id : "",
    outputText: extractOutputText(raw.output),
    functionCalls,
    citations: extractCitations(raw.output),
    outputItems: extractOutputItems(raw.output),
    webSearchCallCount: Array.isArray(raw.output)
      ? raw.output.filter((item) => isRecord(item) && item.type === "web_search_call").length
      : 0,
    ...(usage ? { usage } : {}),
    ...(Object.keys(providerDiagnostics).length > 0 ? { providerDiagnostics } : {})
  };
}

function isRawResponsesResult(value: RawResponse): value is RawResponse {
  return Array.isArray((value as RawResponse).output) || typeof (value as RawResponse).id === "string";
}

function emitBufferedResult(result: OpenAiCompatibleResponseResult, handlers: OpenAiCompatibleStreamHandlers): void {
  const hasFunctionCalls = result.functionCalls.length > 0;
  for (const [index, item] of result.outputItems.entries()) {
    if (item.type === "message") {
      const text = extractOutputTextFromMessageItem(item);
      if (!text) {
        continue;
      }
      const phase = item.phase === "commentary" || (!item.phase && hasFunctionCalls) ? "commentary" : "final";
      const partId = typeof item.id === "string" ? item.id : `buffered-message-${index}`;
      handlers.onEvent?.({ type: phase === "commentary" ? "commentary-start" : "final-start", partId });
      handlers.onEvent?.({ type: phase === "commentary" ? "commentary-delta" : "final-delta", partId, delta: text });
      handlers.onEvent?.({ type: phase === "commentary" ? "commentary-end" : "final-end", partId });
      if (phase === "final") {
        handlers.onTextDelta?.(text);
      }
    } else if (item.type === "function_call") {
      const functionCall = extractFunctionCalls([item])[0];
      if (functionCall) {
        handlers.onEvent?.({ type: "function-call-ready", functionCall });
      }
    }
  }
  if (result.citations.length > 0) {
    handlers.onCitations?.(result.citations);
    result.citations.forEach((citation) => handlers.onEvent?.({ type: "citation", citation }));
  }
  if (result.usage) {
    handlers.onEvent?.({ type: "usage", usage: result.usage });
  }
}

function extractOutputTextFromMessageItem(item: Record<string, unknown>): string {
  if (!Array.isArray(item.content)) {
    return "";
  }

  return item.content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractOutputText(output: unknown[] | undefined): string {
  if (!Array.isArray(output)) {
    return "";
  }

  const hasFunctionCall = output.some((item) => isRecord(item) && item.type === "function_call");
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    if (item.phase === "commentary" || (item.phase !== "final_answer" && hasFunctionCall)) {
      continue;
    }

    for (const contentPart of item.content) {
      if (isRecord(contentPart) && contentPart.type === "output_text" && typeof contentPart.text === "string") {
        parts.push(contentPart.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractFunctionCalls(output: unknown[] | undefined): ProviderFunctionCall[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output
    .map((item) => {
      if (!isRecord(item) || item.type !== "function_call") {
        return undefined;
      }
      if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") {
        return undefined;
      }

      return {
        id: typeof item.id === "string" ? item.id : item.call_id,
        callId: item.call_id,
        name: item.name,
        argumentsText: item.arguments
      };
    })
    .filter((item): item is ProviderFunctionCall => Boolean(item));
}

function extractOutputItems(output: unknown[] | undefined): AgentOutputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output.filter((item): item is AgentOutputItem => isRecord(item) && typeof item.type === "string");
}

function extractCitations(value: unknown): ProviderCitation[] {
  const citations: ProviderCitation[] = [];
  visitProviderResponseRecords(value, (record) => {
    if (isRecord(record.url_citation)) {
      const citation = normalizeCitationRecord(record.url_citation);
      if (citation) {
        citations.push(citation);
      }
      return;
    }

    const directCitation = normalizeCitationRecord(record);
    if (directCitation) {
      citations.push(directCitation);
    }
  });

  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url ?? `${citation.title}:${citation.snippet ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeCitationRecord(record: Record<string, unknown>): ProviderCitation | undefined {
  const destination = typeof record.url === "string"
    ? normalizeSafeExternalNavigationUrl(record.url)
    : undefined;
  if (!destination) {
    return undefined;
  }

  return {
    title:
      stringFromUnknown(record.title) ??
      stringFromUnknown(record.name) ??
      stringFromUnknown(record.site_name) ??
      destination.hostname ??
      "未命名来源",
    url: destination.url,
    domain: destination.hostname,
    snippet: stringFromUnknown(record.snippet) ?? stringFromUnknown(record.content) ?? stringFromUnknown(record.text)
  };
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContextLimitDiagnostic(diagnostic: string | undefined): boolean {
  const normalized = diagnostic?.toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    "context_length_exceeded",
    "context_window_exceeded",
    "maximum context length",
    "maximum context window",
    "exceeds the context window",
    "exceeded the context window",
    "input is too long",
    "prompt is too long",
    "too many tokens"
  ].some((pattern) => normalized.includes(pattern));
}
