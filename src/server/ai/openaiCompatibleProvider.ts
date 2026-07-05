import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";

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

export type OpenAiCompatibleResponseResult = {
  responseId: string;
  outputText: string;
  functionCalls: ProviderFunctionCall[];
  citations: ProviderCitation[];
  webSearchCallCount: number;
  outputItems: AgentOutputItem[];
};

type RawResponse = {
  id?: string;
  output?: unknown[];
};

type RawChatCompletion = {
  id?: string;
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
  constructor(
    readonly status: number,
    readonly diagnostic?: string
  ) {
    super(`OpenAI-compatible provider error (${status})`);
    this.name = "OpenAiCompatibleProviderError";
  }
}

export async function executeOpenAiCompatibleResponse(
  config: OpenAiCompatibleConfig,
  request: OpenAiCompatibleResponseRequest,
  signal?: AbortSignal
): Promise<OpenAiCompatibleResponseResult> {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
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
  return {
    responseId: typeof raw.id === "string" ? raw.id : "",
    outputText: extractOutputText(raw.output),
    functionCalls: extractFunctionCalls(raw.output),
    citations: extractCitations(raw.output),
    outputItems: extractOutputItems(raw.output),
    webSearchCallCount: Array.isArray(raw.output)
      ? raw.output.filter((item) => isRecord(item) && item.type === "web_search_call").length
      : 0
  };
}

async function executeOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleConfig,
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
          parameters: tool.parameters,
          strict: tool.strict
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
    webSearchCallCount: 0
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
