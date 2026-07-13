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

export type ResponseImageContentPart = {
  type: "input_image";
  image_url: string;
};

export type ResponseMessageInput = {
  role: "system" | "user" | "assistant";
  content: Array<ResponseTextContentPart | ResponseImageContentPart>;
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

type RawChatCompletion = {
  id?: string;
  usage?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown[];
    };
  }>;
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

const TRANSIENT_RESPONSE_RETRY_DELAYS_MS = [300, 800] as const;

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
    if (shouldFallbackToChatCompletions(response.status, diagnostic)) {
      return executeOpenAiCompatibleChatCompletion(config, request, signal);
    }
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
    if (shouldFallbackToChatCompletions(response.status, diagnostic)) {
      return streamOpenAiCompatibleChatCompletion(config, request, handlers, signal);
    }
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    if (contentType.includes("application/json")) {
      const raw = (await response.json()) as RawResponse | RawChatCompletion;
      if (!isRawChatCompletion(raw) && !isRawResponsesResult(raw)) {
        return streamOpenAiCompatibleChatCompletion(config, request, handlers, signal);
      }
      const result = isRawChatCompletion(raw) ? extractChatCompletionResult(raw) : resultFromRawResponse(raw);
      emitBufferedResult(result, handlers);
      return result;
    }
    return streamOpenAiCompatibleChatCompletion(config, request, handlers, signal);
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
      throw new OpenAiCompatibleProviderError(502, error.kind === "interrupted" ? "stream interrupted" : "stream failed");
    }
    throw error;
  }
}

async function executeOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      messages: convertResponseInputToChatMessages(request.input),
      tools: convertResponseToolsToChatTools(request.tools)
    }),
    signal
  });

  if (!response.ok) {
    throw new OpenAiCompatibleProviderError(response.status, await safeReadDiagnostic(response));
  }

  const raw = (await response.json()) as RawChatCompletion;
  return extractChatCompletionResult(raw);
}

async function streamOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      messages: convertResponseInputToChatMessages(request.input),
      tools: convertResponseToolsToChatTools(request.tools),
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    throw new OpenAiCompatibleProviderError(response.status, await safeReadDiagnostic(response));
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    const raw = (await response.json()) as RawChatCompletion;
    const result = extractChatCompletionResult(raw);
    emitBufferedResult(result, handlers);
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textChunks: string[] = [];
  const citations: ProviderCitation[] = [];
  const toolCalls = new Map<number, ChatToolCall>();
  const streamPartOrder: Array<{ kind: "text" } | { kind: "tool"; index: number }> = [];
  const orderedToolIndices = new Set<number>();
  let textOrderRegistered = false;
  let responseId = "";
  let reasoningStarted = false;
  const reasoningPartId = "chat-reasoning";
  let usage: ProviderTokenUsage | undefined;
  let aborted = signal?.aborted === true;
  const abortReader = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  if (aborted) {
    abortReader();
  } else {
    signal?.addEventListener("abort", abortReader, { once: true });
  }

  const consumeParsed = (parsed: NonNullable<ReturnType<typeof parseChatCompletionStreamData>>) => {
    responseId = parsed.responseId ?? responseId;
    if (parsed.reasoning) {
      if (!reasoningStarted) {
        reasoningStarted = true;
        handlers.onEvent?.({ type: "reasoning-start", partId: reasoningPartId });
      }
      handlers.onEvent?.({ type: "reasoning-delta", partId: reasoningPartId, delta: parsed.reasoning });
    }
    if (parsed.text) {
      if (!textOrderRegistered) {
        textOrderRegistered = true;
        streamPartOrder.push({ kind: "text" });
      }
      textChunks.push(parsed.text);
    }
    if (parsed.citations.length > 0) {
      citations.push(...parsed.citations);
      handlers.onCitations?.(parsed.citations);
      parsed.citations.forEach((citation) => handlers.onEvent?.({ type: "citation", citation }));
    }
    parsed.toolDeltas.forEach((toolDelta) => {
      if (!orderedToolIndices.has(toolDelta.index)) {
        orderedToolIndices.add(toolDelta.index);
        streamPartOrder.push({ kind: "tool", index: toolDelta.index });
      }
      const existing = toolCalls.get(toolDelta.index);
      toolCalls.set(toolDelta.index, {
        id: toolDelta.id ?? existing?.id ?? `chat-call-${toolDelta.index}`,
        type: "function",
        function: {
          name: toolDelta.name ?? existing?.function.name ?? "",
          arguments: `${existing?.function.arguments ?? ""}${toolDelta.argumentsDelta ?? ""}`
        }
      });
    });
    if (parsed.usage) {
      usage = parsed.usage;
      handlers.onEvent?.({ type: "usage", usage });
    }
  };

  try {
    while (true) {
      if (aborted) {
        throw createAbortError();
      }
      const result = await reader.read();
      if (aborted) {
        throw createAbortError();
      }
      if (result.value) {
        buffer += decoder.decode(result.value, { stream: !result.done });
        const parsedFrames = consumeChatCompletionSseFrames(buffer);
        buffer = parsedFrames.remainder;
        for (const frame of parsedFrames.frames) {
          if (frame.done) {
            continue;
          }
          const parsed = parseChatCompletionStreamData(frame.data);
          if (parsed) {
            consumeParsed(parsed);
          }
        }
      }
      if (result.done) {
        break;
      }
    }

    const tailFrames = consumeChatCompletionSseFrames(`${buffer}\n\n`);
    for (const frame of tailFrames.frames) {
      if (frame.done) {
        continue;
      }
      const parsed = parseChatCompletionStreamData(frame.data);
      if (parsed) {
        consumeParsed(parsed);
      }
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }

  const finalCitations = dedupeCitations(citations);
  if (reasoningStarted) {
    handlers.onEvent?.({ type: "reasoning-end", partId: reasoningPartId });
  }
  const functionCallByIndex = new Map(
    [...toolCalls.entries()].flatMap(([index, toolCall]) => {
      const functionCall = extractChatToolCalls([toolCall])[0];
      return functionCall ? [[index, functionCall] as const] : [];
    })
  );
  const functionCalls = [...functionCallByIndex.values()];
  const bufferedText = textChunks.join("");
  const phase = functionCalls.length > 0 ? "commentary" : "final";
  const partId = phase === "commentary" ? "chat-commentary" : "chat-final";
  let textEmitted = false;
  const emittedFunctionCallIds = new Set<string>();
  const emitText = () => {
    if (!bufferedText || textEmitted) {
      return;
    }
    textEmitted = true;
    handlers.onEvent?.({ type: phase === "commentary" ? "commentary-start" : "final-start", partId });
    textChunks.forEach((delta) => {
      handlers.onEvent?.({
        type: phase === "commentary" ? "commentary-delta" : "final-delta",
        partId,
        delta
      });
      if (phase === "final") {
        handlers.onTextDelta?.(delta);
      }
    });
    handlers.onEvent?.({ type: phase === "commentary" ? "commentary-end" : "final-end", partId });
  };
  streamPartOrder.forEach((part) => {
    if (part.kind === "text") {
      emitText();
      return;
    }
    const functionCall = functionCallByIndex.get(part.index);
    if (functionCall) {
      emittedFunctionCallIds.add(functionCall.callId);
      handlers.onEvent?.({ type: "function-call-ready", functionCall });
    }
  });
  emitText();
  functionCalls.forEach((functionCall) => {
    if (!emittedFunctionCallIds.has(functionCall.callId)) {
      handlers.onEvent?.({ type: "function-call-ready", functionCall });
    }
  });
  return {
    responseId,
    outputText: phase === "final" ? bufferedText.trim() : "",
    functionCalls,
    citations: finalCitations,
    outputItems: [
      ...(bufferedText.trim()
        ? [
            {
              type: "message",
              phase: phase === "commentary" ? "commentary" : "final_answer",
              content: [{ type: "output_text", text: bufferedText.trim() }]
            }
          ]
        : []),
      ...functionCalls.map((call) => ({
        type: "function_call",
        id: call.id,
        call_id: call.callId,
        name: call.name,
        arguments: call.argumentsText
      }))
    ],
    webSearchCallCount: 0,
    ...(usage ? { usage } : {})
  };
}

function dedupeCitations(citations: ProviderCitation[]): ProviderCitation[] {
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

function consumeChatCompletionSseFrames(value: string): {
  frames: Array<{ data: string; done: boolean }>;
  remainder: string;
} {
  const frames: Array<{ data: string; done: boolean }> = [];
  let cursor = 0;
  while (cursor < value.length) {
    const delimiter = findSseFrameDelimiter(value, cursor);
    if (!delimiter) {
      break;
    }
    const dataLines = value
      .slice(cursor, delimiter.start)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    const data = dataLines.join("\n");
    if (data) {
      frames.push({ data, done: data === "[DONE]" });
    }
    cursor = delimiter.end;
  }
  return { frames, remainder: value.slice(cursor) };
}

function findSseFrameDelimiter(value: string, fromIndex: number): { start: number; end: number } | undefined {
  const crlfIndex = value.indexOf("\r\n\r\n", fromIndex);
  const lfIndex = value.indexOf("\n\n", fromIndex);
  if (crlfIndex < 0 && lfIndex < 0) {
    return undefined;
  }
  if (lfIndex < 0 || (crlfIndex >= 0 && crlfIndex < lfIndex)) {
    return { start: crlfIndex, end: crlfIndex + 4 };
  }
  return { start: lfIndex, end: lfIndex + 2 };
}

function parseChatCompletionStreamData(value: string):
  | {
      responseId?: string;
      text: string;
      reasoning: string;
      citations: ProviderCitation[];
      toolDeltas: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }>;
      usage?: ProviderTokenUsage;
    }
  | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    return undefined;
  }

  const toolDeltas: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }> = [];
  let text = "";
  let reasoning = "";
  for (const choice of parsed.choices) {
    if (!isRecord(choice) || !isRecord(choice.delta)) {
      continue;
    }
    const delta = choice.delta;
    text += typeof delta.content === "string" ? delta.content : "";
    reasoning +=
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((toolCall, fallbackIndex) => {
        if (!isRecord(toolCall)) {
          return;
        }
        const functionRecord = isRecord(toolCall.function) ? toolCall.function : undefined;
        const index =
          typeof toolCall.index === "number" && Number.isSafeInteger(toolCall.index) ? toolCall.index : fallbackIndex;
        toolDeltas.push({
          index,
          ...(typeof toolCall.id === "string" ? { id: toolCall.id } : {}),
          ...(typeof functionRecord?.name === "string" ? { name: functionRecord.name } : {}),
          ...(typeof functionRecord?.arguments === "string" ? { argumentsDelta: functionRecord.arguments } : {})
        });
      });
    }
  }
  return {
    responseId: typeof parsed.id === "string" ? parsed.id : undefined,
    text,
    reasoning,
    citations: extractCitations(parsed),
    toolDeltas,
    usage: normalizeProviderTokenUsage(parsed.usage, {
      input: "prompt_tokens",
      output: "completion_tokens"
    })
  };
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

function shouldFallbackToChatCompletions(status: number, diagnostic: string | undefined): boolean {
  if (status === 404 || status === 405 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const normalized = (diagnostic ?? "").toLowerCase();
  return (
    normalized.includes("responses endpoint") ||
    normalized.includes("responses api") ||
    normalized.includes("endpoint unsupported") ||
    normalized.includes("unsupported endpoint") ||
    normalized.includes("not support /responses") ||
    normalized.includes("does not support responses") ||
    normalized.includes("不支持 responses") ||
    normalized.includes("不支持 /responses")
  );
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

function isRawResponsesResult(value: RawResponse | RawChatCompletion): value is RawResponse {
  return Array.isArray((value as RawResponse).output) || typeof (value as RawResponse).id === "string";
}

function isRawChatCompletion(value: RawResponse | RawChatCompletion): value is RawChatCompletion {
  return Array.isArray((value as RawChatCompletion).choices);
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

function convertResponseInputToChatMessages(input: OpenAiCompatibleResponseRequest["input"]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];

    if (isResponseMessageInput(item)) {
      messages.push(convertResponseMessageToChatMessage(item));
      continue;
    }

    if (isFunctionCallOutput(item)) {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output
      });
      continue;
    }

    if (isRecord(item) && item.type === "message") {
      messages.push({
        role: "assistant",
        content: extractOutputTextFromMessageItem(item)
      });
      continue;
    }

    if (isAgentOutputItemType(item, "function_call")) {
      const toolCalls: ChatToolCall[] = [];
      let cursor = index;
      while (cursor < input.length && isAgentOutputItemType(input[cursor], "function_call")) {
        const toolCall = convertFunctionCallItemToChatToolCall(input[cursor]);
        if (toolCall) {
          toolCalls.push(toolCall);
        }
        cursor += 1;
      }
      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls
        });
      }
      index = cursor - 1;
    }
  }

  return messages;
}

function convertResponseMessageToChatMessage(message: ResponseMessageInput): ChatMessage {
  const textParts = message.content
    .filter((part): part is ResponseTextContentPart => part.type === "input_text")
    .map((part) => part.text);
  const imageParts = message.content.filter((part): part is ResponseImageContentPart => part.type === "input_image");

  if (message.role === "user" && imageParts.length > 0) {
    return {
      role: "user",
      content: [
        ...textParts.map((text) => ({ type: "text" as const, text })),
        ...imageParts.map((part) => ({
          type: "image_url" as const,
          image_url: { url: part.image_url }
        }))
      ]
    };
  }

  return {
    role: message.role,
    content: textParts.join("\n")
  };
}

function convertResponseToolsToChatTools(tools: ResponseTool[] | undefined): ChatTool[] | undefined {
  const chatTools = tools?.flatMap((tool): ChatTool[] => {
    if (tool.type !== "function") {
      return [];
    }

    return [
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }
    ];
  });

  return chatTools && chatTools.length > 0 ? chatTools : undefined;
}

function extractChatCompletionResult(raw: RawChatCompletion): OpenAiCompatibleResponseResult {
  const message = raw.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const functionCalls = extractChatToolCalls(message?.tool_calls);
  const phase = functionCalls.length > 0 ? "commentary" : "final";
  const outputItems: AgentOutputItem[] = [];
  const usage = normalizeProviderTokenUsage(raw.usage, {
    input: "prompt_tokens",
    output: "completion_tokens"
  });

  if (content.trim()) {
    outputItems.push({
      type: "message",
      phase: phase === "commentary" ? "commentary" : "final_answer",
      content: [
        {
          type: "output_text",
          text: content
        }
      ]
    });
  }

  outputItems.push(
    ...functionCalls.map((call) => ({
      type: "function_call",
      id: call.id,
      call_id: call.callId,
      name: call.name,
      arguments: call.argumentsText
    }))
  );

  return {
    responseId: typeof raw.id === "string" ? raw.id : "",
    outputText: phase === "final" ? content.trim() : "",
    functionCalls,
    citations: extractCitations(raw),
    outputItems,
    webSearchCallCount: 0,
    ...(usage ? { usage } : {})
  };
}

function extractChatToolCalls(value: unknown): ProviderFunctionCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || !isRecord(item.function)) {
        return undefined;
      }
      if (typeof item.function.name !== "string" || typeof item.function.arguments !== "string") {
        return undefined;
      }

      return {
        id: item.id,
        callId: item.id,
        name: item.function.name,
        argumentsText: item.function.arguments
      };
    })
    .filter((item): item is ProviderFunctionCall => Boolean(item));
}

function convertFunctionCallItemToChatToolCall(item: unknown): ChatToolCall | undefined {
  if (
    !isRecord(item) ||
    typeof item.call_id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.arguments !== "string"
  ) {
    return undefined;
  }

  return {
    id: item.call_id,
    type: "function",
    function: {
      name: item.name,
      arguments: item.arguments
    }
  };
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

function isResponseMessageInput(value: unknown): value is ResponseMessageInput {
  return (
    isRecord(value) &&
    (value.role === "system" || value.role === "user" || value.role === "assistant") &&
    Array.isArray(value.content)
  );
}

function isFunctionCallOutput(value: unknown): value is ResponseFunctionToolOutput {
  return (
    isRecord(value) &&
    value.type === "function_call_output" &&
    typeof value.call_id === "string" &&
    typeof value.output === "string"
  );
}

function isAgentOutputItemType(value: unknown, type: string): value is AgentOutputItem {
  return isRecord(value) && value.type === type;
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
