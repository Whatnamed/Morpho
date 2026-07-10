import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";

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

export type ProviderTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

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
};

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
  if (shouldUseChatCompletionsFirst(config)) {
    return executeOpenAiCompatibleChatCompletion(config, request, signal);
  }

  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
      input: request.input,
      tools: request.tools
    }),
    signal
  });

  if (!response.ok) {
    const diagnostic = await safeReadDiagnostic(response);
    if (requestHasImageInput(request) && shouldRetryWithChatCompletions(response.status, diagnostic)) {
      return executeOpenAiCompatibleChatCompletion(config, request, signal);
    }
    throw new OpenAiCompatibleProviderError(response.status, diagnostic);
  }

  const raw = (await response.json()) as RawResponse;
  const usage = extractTokenUsage(raw.usage, "input_tokens", "output_tokens");
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

export async function streamOpenAiCompatibleResponse(
  config: OpenAiCompatibleProviderConfig,
  request: OpenAiCompatibleResponseRequest,
  handlers: OpenAiCompatibleStreamHandlers,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  if (shouldUseChatCompletionsFirst(config)) {
    return streamOpenAiCompatibleChatCompletion(config, request, handlers, signal);
  }

  const result = await executeOpenAiCompatibleResponse(config, request, signal);
  if (result.outputText) {
    handlers.onTextDelta?.(result.outputText);
  }
  if (result.citations.length > 0) {
    handlers.onCitations?.(result.citations);
  }
  return result;
}

function shouldUseChatCompletionsFirst(config: OpenAiCompatibleProviderConfig): boolean {
  try {
    return new URL(config.baseUrl).hostname.toLowerCase().includes("aijws.com");
  } catch {
    return false;
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
    if (result.outputText) {
      handlers.onTextDelta?.(result.outputText);
    }
    if (result.citations.length > 0) {
      handlers.onCitations?.(result.citations);
    }
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  const citations: ProviderCitation[] = [];

  while (true) {
    const result = await reader.read();
    if (result.value) {
      buffer += decoder.decode(result.value, { stream: !result.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseChatCompletionStreamLine(line);
        if (!parsed || parsed.done) {
          continue;
        }
        if (parsed.text) {
          outputText += parsed.text;
          handlers.onTextDelta?.(parsed.text);
        }
        if (parsed.citations.length > 0) {
          citations.push(...parsed.citations);
          handlers.onCitations?.(parsed.citations);
        }
      }
    }
    if (result.done) {
      break;
    }
  }

  if (buffer.trim()) {
    const parsed = parseChatCompletionStreamLine(buffer);
    if (parsed && !parsed.done) {
      if (parsed.text) {
        outputText += parsed.text;
        handlers.onTextDelta?.(parsed.text);
      }
      if (parsed.citations.length > 0) {
        citations.push(...parsed.citations);
        handlers.onCitations?.(parsed.citations);
      }
    }
  }

  const finalCitations = dedupeCitations(citations);
  return {
    responseId: "",
    outputText: outputText.trim(),
    functionCalls: [],
    citations: finalCitations,
    outputItems: outputText.trim()
      ? [
          {
            type: "message",
            content: [{ type: "output_text", text: outputText.trim() }]
          }
        ]
      : [],
    webSearchCallCount: 0
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

function parseChatCompletionStreamLine(line: string): { text: string; citations: ProviderCitation[]; done: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) {
    return null;
  }

  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") {
    return { text: "", citations: [], done: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  const text = extractChatCompletionDeltaText(parsed);
  return {
    text,
    citations: extractCitations(parsed),
    done: false
  };
}

function extractChatCompletionDeltaText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return "";
  }

  return value.choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.delta)) {
        return "";
      }
      return typeof choice.delta.content === "string" ? choice.delta.content : "";
    })
    .join("");
}

async function safeReadDiagnostic(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 800) || undefined;
  } catch {
    return undefined;
  }
}

function requestHasImageInput(request: OpenAiCompatibleResponseRequest): boolean {
  return request.input.some((item) => {
    const record: Record<string, unknown> | undefined = isRecord(item) ? item : undefined;
    const content = record?.content;
    if (!Array.isArray(content)) {
      return false;
    }
    return content.some((part) => isRecord(part) && part.type === "input_image");
  });
}

function shouldRetryWithChatCompletions(status: number, diagnostic: string | undefined): boolean {
  if (![400, 413, 415, 422, 500, 502, 503, 504].includes(status)) {
    return false;
  }

  const normalized = (diagnostic ?? "").toLowerCase();
  return (
    normalized.includes("image") ||
    normalized.includes("input_image") ||
    normalized.includes("bad gateway") ||
    normalized.includes("provider") ||
    normalized.includes("请求格式") ||
    status === 502
  );
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
  const outputItems: AgentOutputItem[] = [];
  const usage = extractTokenUsage(raw.usage, "prompt_tokens", "completion_tokens");

  if (content.trim()) {
    outputItems.push({
      type: "message",
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
    outputText: content.trim(),
    functionCalls,
    citations: extractCitations(raw),
    outputItems,
    webSearchCallCount: 0,
    ...(usage ? { usage } : {})
  };
}

function extractTokenUsage(
  value: unknown,
  inputField: "input_tokens" | "prompt_tokens",
  outputField: "output_tokens" | "completion_tokens"
): ProviderTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = nonNegativeInteger(value[inputField]);
  const outputTokens = nonNegativeInteger(value[outputField]);
  const totalTokens = nonNegativeInteger(value.total_tokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? inputTokens + outputTokens
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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

  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
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
