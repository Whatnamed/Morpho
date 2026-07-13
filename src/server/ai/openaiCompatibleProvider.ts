import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";
import {
  OpenAiCompatibleStreamError,
  parseOpenAiResponsesStream,
  type OpenAiCompatibleAgentStreamEvent
} from "./openaiCompatibleResponsesStream";
import {
  normalizeProviderTokenUsage,
  type NormalizedProviderTokenUsage
} from "./providerTokenUsage";

type OpenAiCompatibleProviderConfig = Pick<
  OpenAiCompatibleConfig,
  "apiKey" | "baseUrl" | "model" | "reasoningEffort" | "webSearchEnabled"
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
};

export type OpenAiCompatibleStreamHandlers = {
  onTextDelta?: (text: string) => void;
  onCitations?: (citations: ProviderCitation[]) => void;
  onEvent?: (event: OpenAiCompatibleAgentStreamEvent) => void;
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
  readonly code?: "context_limit";

  constructor(
    readonly status: number,
    readonly diagnostic?: string
  ) {
    super(`OpenAI-compatible provider error (${status})`);
    this.name = "OpenAiCompatibleProviderError";
    this.code = status === 413 || isContextLimitDiagnostic(diagnostic) ? "context_limit" : undefined;
  }
}

export async function executeOpenAiCompatibleResponse(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetchProviderResponse(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort, summary: "auto" } } : {}),
      input: request.input,
      tools: request.tools
    }),
    signal
  });

  if (!response.ok) {
    const diagnostic = await safeReadDiagnostic(response);
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  return resultFromRawResponse((await response.json()) as RawResponse);
}

export async function streamOpenAiCompatibleResponse(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetchProviderResponse(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort, summary: "auto" } } : {}),
      input: request.input,
      tools: request.tools
    }),
    signal
  });

  if (!response.ok) {
    const diagnostic = await safeReadDiagnostic(response);
    if (shouldUseBufferedResponsesFallback(response.status)) {
      return executeBufferedResponsesFallback(config, request, handlers, signal);
    }
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    if (contentType.includes("application/json")) {
      const raw = (await response.json()) as RawResponse;
      if (!isRawResponsesResult(raw)) {
        throw new OpenAiCompatibleProviderError(502, "Responses endpoint returned an incompatible JSON payload.");
      }
      const result = resultFromRawResponse(raw);
      emitBufferedResult(result, handlers);
      return result;
    }
    throw new OpenAiCompatibleProviderError(502, "Responses endpoint did not return an event stream.");
  }

  try {
    return await parseOpenAiResponsesStream(response.body, {
      signal,
      onEvent: (event) => {
        handlers.onEvent?.(event);
        if (event.type === "final-delta") {
          handlers.onTextDelta?.(event.delta);
        } else if (event.type === "citation") {
          handlers.onCitations?.([event.citation]);
        }
      }
    });
  } catch (error) {
    if (error instanceof OpenAiCompatibleStreamError) {
      return executeBufferedResponsesFallback(config, request, handlers, signal);
    }
    throw error;
  }
}

async function executeBufferedResponsesFallback(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const result = await executeOpenAiCompatibleResponse(config, request, signal);
  emitBufferedResult(result, handlers);
  return result;
}

async function safeReadDiagnostic(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 800) || undefined;
  } catch {
    return undefined;
  }
}

async function fetchProviderResponse(url: string, init: RequestInit): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!isTransientProviderResponse(response.status) || attempt === TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length) {
        return response;
      }
      await discardProviderResponse(response);
    } catch (error) {
      if (init.signal?.aborted || attempt === TRANSIENT_RESPONSE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      lastNetworkError = error;
    }

    await waitForTransientRetry(TRANSIENT_RESPONSE_RETRY_DELAYS_MS[attempt], init.signal);
  }

  throw lastNetworkError ?? new Error("Provider request did not produce a response.");
}

function shouldUseBufferedResponsesFallback(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isTransientProviderResponse(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function discardProviderResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is being retried, so an unread diagnostic body is not useful.
  }
}

function waitForTransientRetry(delayMs: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? createAbortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function resultFromRawResponse(raw: RawResponse): OpenAiCompatibleResponseResult {
  const usage = normalizeProviderTokenUsage(raw.usage, {
    input: "input_tokens",
    output: "output_tokens"
  });
  return {
    responseId: typeof raw.id === "string" ? raw.id : "",
    outputText: extractOutputText(raw.output),
    functionCalls: extractFunctionCalls(raw.output),
    citations: extractCitations(raw.output),
    outputItems: extractOutputItems(raw.output),
    webSearchCallCount: Array.isArray(raw.output)
      ? raw.output.filter((item) => isRecord(item) && item.type === "web_search_call").length
      : 0,
    ...(usage ? { usage } : {})
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
  visitRecords(value, (record) => {
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
  const url = typeof record.url === "string" && looksLikeHttpUrl(record.url) ? record.url : undefined;
  if (!url) {
    return undefined;
  }

  return {
    title:
      stringFromUnknown(record.title) ??
      stringFromUnknown(record.name) ??
      stringFromUnknown(record.site_name) ??
      domainFromUrl(url) ??
      "未命名来源",
    url,
    domain: stringFromUnknown(record.domain) ?? domainFromUrl(url),
    snippet: stringFromUnknown(record.snippet) ?? stringFromUnknown(record.content) ?? stringFromUnknown(record.text)
  };
}

function visitRecords(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitRecords(item, visitor));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visitor(value);
  Object.values(value).forEach((item) => visitRecords(item, visitor));
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function looksLikeHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createAbortError(): DOMException {
  return new DOMException("The provider stream was aborted.", "AbortError");
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
