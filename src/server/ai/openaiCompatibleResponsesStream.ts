import type {
  AgentOutputItem,
  OpenAiCompatibleResponseResult,
  ProviderCitation,
  ProviderFunctionCall,
  ProviderTokenUsage
} from "./openaiCompatibleProvider";
import type { AgentStreamActivityKind } from "@/shared/agentStreamProtocol";
import { normalizeProviderTokenUsage } from "./providerTokenUsage";
import { assertAgentFunctionCallCount } from "@/shared/agentFunctionCallLimits";

type MessagePhase = "commentary" | "final";

type MessageStreamState = {
  phase?: MessagePhase;
  text: string;
  emittedLength: number;
  done: boolean;
  startEmitted: boolean;
  endEmitted: boolean;
};

export type OpenAiCompatibleAgentStreamEvent =
  | { type: "reasoning-start" | "reasoning-end"; partId: string }
  | { type: "reasoning-delta"; partId: string; delta: string }
  | { type: "commentary-start" | "commentary-end" | "final-start" | "final-end"; partId: string }
  | { type: "commentary-delta" | "final-delta"; partId: string; delta: string }
  | {
      type: "provider-tool-start" | "provider-tool-update" | "provider-tool-end";
      toolCallId: string;
      toolName: string;
      activityKind: AgentStreamActivityKind;
      label: string;
      detail?: string;
      state?: "done" | "failed";
    }
  | { type: "function-call-ready"; functionCall: ProviderFunctionCall }
  | { type: "citation"; citation: ProviderCitation }
  | { type: "usage"; usage: ProviderTokenUsage }
  | { type: "unknown"; eventType: string };

export class OpenAiCompatibleStreamError extends Error {
  constructor(
    message: "failed" | "interrupted",
    readonly kind: "failed" | "interrupted"
  ) {
    super(message === "failed" ? "OpenAI-compatible Responses stream failed." : "OpenAI-compatible Responses stream ended early.");
    this.name = "OpenAiCompatibleStreamError";
  }
}

export async function parseOpenAiResponsesStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: OpenAiCompatibleAgentStreamEvent) => void;
  } = {}
): Promise<OpenAiCompatibleResponseResult> {
  const accumulator = createOpenAiCompatibleResponseAccumulator(options.onEvent);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = options.signal?.aborted === true;
  const abortReader = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  if (aborted) {
    abortReader();
  } else {
    options.signal?.addEventListener("abort", abortReader, { once: true });
  }

  try {
    while (true) {
      if (aborted) {
        throw createAbortError();
      }

      const next = await reader.read();
      if (aborted) {
        throw createAbortError();
      }
      if (next.value) {
        buffer += decoder.decode(next.value, { stream: !next.done });
        const parsed = consumeSseFrames(buffer);
        buffer = parsed.remainder;
        parsed.events.forEach((event) => accumulator.consume(event));
      }

      if (next.done) {
        const parsed = consumeSseFrames(`${buffer}\n\n`);
        parsed.events.forEach((event) => accumulator.consume(event));
        return accumulator.finish();
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}

export function createOpenAiCompatibleResponseAccumulator(
  onEvent?: (event: OpenAiCompatibleAgentStreamEvent) => void
) {
  const itemById = new Map<string, AgentOutputItem>();
  const messagePhaseById = new Map<string, MessagePhase>();
  const messageStateById = new Map<string, MessageStreamState>();
  const functionByItemId = new Map<string, ProviderFunctionCall>();
  const emittedFunctionCallIds = new Set<string>();
  const citations: ProviderCitation[] = [];
  const hostedToolIds = new Set<string>();
  let responseId = "";
  let usage: ProviderTokenUsage | undefined;
  let completed = false;
  let failed = false;
  let hasFunctionCall = false;

  const emit = (event: OpenAiCompatibleAgentStreamEvent) => onEvent?.(event);

  return {
    consume(frame: ParsedSseFrame): void {
      if (frame.data === "[DONE]") {
        return;
      }

      let value: unknown;
      try {
        value = JSON.parse(frame.data);
      } catch {
        emit({ type: "unknown", eventType: frame.event ?? "unparseable" });
        return;
      }

      const record = asRecord(value);
      const eventType = stringValue(record?.type) ?? frame.event;
      if (!record || !eventType) {
        emit({ type: "unknown", eventType: frame.event ?? "unknown" });
        return;
      }

      switch (eventType) {
        case "response.created":
        case "response.in_progress": {
          const response = asRecord(record.response);
          responseId = stringValue(response?.id) ?? responseId;
          return;
        }
        case "response.output_item.added": {
          const item = asRecord(record.item);
          const itemId = stringValue(item?.id);
          if (!item || !itemId) {
            return;
          }
          itemById.set(itemId, toOutputItem(item));
          const itemType = stringValue(item.type);
          if (itemType === "message") {
            registerMessageItem(itemId, item);
            return;
          }
          if (itemType === "function_call") {
            markFunctionCallPresent();
            const functionCall = functionCallFromItem(item);
            if (functionCall) {
              functionByItemId.set(itemId, functionCall);
            }
            return;
          }
          const hosted = hostedToolFromItem(item);
          if (hosted) {
            hostedToolIds.add(itemId);
            emit({
              type: "provider-tool-start",
              toolCallId: itemId,
              toolName: hosted.toolName,
              activityKind: hosted.activityKind,
              label: hosted.label
            });
            return;
          }
          if (itemType && itemType !== "reasoning") {
            emit({ type: "unknown", eventType });
          }
          return;
        }
        case "response.output_item.done": {
          const item = asRecord(record.item);
          const itemId = stringValue(item?.id);
          if (!item || !itemId) {
            return;
          }
          itemById.set(itemId, toOutputItem(item));
          const itemType = stringValue(item.type);
          if (itemType === "message") {
            registerMessageItem(itemId, item);
            finishMessageItem(itemId);
            return;
          }
          if (itemType === "function_call") {
            markFunctionCallPresent();
            const functionCall = functionCallFromItem(item) ?? functionByItemId.get(itemId);
            if (functionCall) {
              functionByItemId.set(itemId, functionCall);
              emitFunctionCall(functionCall);
            }
            return;
          }
          if (hostedToolIds.has(itemId)) {
            const hosted = hostedToolFromItem(item);
            if (hosted) {
              emit({
                type: "provider-tool-end",
                toolCallId: itemId,
                toolName: hosted.toolName,
                activityKind: hosted.activityKind,
                label: hosted.label,
                state: "done"
              });
            }
          }
          return;
        }
        case "response.reasoning_summary_part.added": {
          const itemId = stringValue(record.item_id) ?? stringValue(record.itemId);
          const summaryIndex = numberValue(record.summary_index) ?? 0;
          if (itemId) {
            emit({ type: "reasoning-start", partId: reasoningPartId(itemId, summaryIndex) });
          }
          return;
        }
        case "response.reasoning_summary_text.delta": {
          const itemId = stringValue(record.item_id) ?? stringValue(record.itemId);
          const summaryIndex = numberValue(record.summary_index) ?? 0;
          const delta = stringValue(record.delta);
          if (itemId && delta) {
            emit({ type: "reasoning-delta", partId: reasoningPartId(itemId, summaryIndex), delta });
          }
          return;
        }
        case "response.reasoning_summary_text.done":
        case "response.reasoning_summary_part.done": {
          const itemId = stringValue(record.item_id) ?? stringValue(record.itemId);
          const summaryIndex = numberValue(record.summary_index) ?? 0;
          if (itemId) {
            emit({ type: "reasoning-end", partId: reasoningPartId(itemId, summaryIndex) });
          }
          return;
        }
        case "response.output_text.delta": {
          const itemId = stringValue(record.item_id);
          const delta = stringValue(record.delta);
          if (!itemId || !delta) {
            return;
          }
          appendMessageText(itemId, delta);
          return;
        }
        case "response.output_text.done": {
          const itemId = stringValue(record.item_id);
          if (!itemId) {
            return;
          }
          const text = stringValue(record.text);
          if (text) {
            setMessageText(itemId, text);
          }
          finishMessageItem(itemId);
          return;
        }
        case "response.function_call_arguments.delta":
        case "response.function_call_arguments.done": {
          const itemId = stringValue(record.item_id);
          const previous = itemId ? functionByItemId.get(itemId) : undefined;
          const argumentsText = stringValue(record.arguments) ?? stringValue(record.delta);
          if (itemId && previous && argumentsText !== undefined) {
            functionByItemId.set(itemId, {
              ...previous,
              argumentsText:
                eventType === "response.function_call_arguments.delta"
                  ? `${previous.argumentsText}${argumentsText}`
                  : argumentsText
            });
          }
          return;
        }
        case "response.web_search_call.in_progress":
        case "response.web_search_call.searching":
        case "response.web_search_call.completed": {
          const itemId = stringValue(record.item_id) ?? stringValue(record.id);
          if (!itemId) {
            return;
          }
          const isComplete = eventType === "response.web_search_call.completed";
          const query = extractHostedToolQuery(record);
          emit({
            type: isComplete ? "provider-tool-end" : "provider-tool-update",
            toolCallId: itemId,
            toolName: "web_search",
            activityKind: "webSearch",
            label: query ? `搜索 ${query}` : "搜索并检查相关资料",
            ...(isComplete ? { state: "done" as const } : {})
          });
          return;
        }
        case "response.output_text.annotation.added": {
          const citation = citationFromUnknown(record.annotation);
          if (citation) {
            citations.push(citation);
            emit({ type: "citation", citation });
          }
          return;
        }
        case "response.completed": {
          const response = asRecord(record.response);
          responseId = stringValue(response?.id) ?? responseId;
          usage = extractUsage(response?.usage) ?? usage;
          if (itemById.size === 0 && Array.isArray(response?.output)) {
            response.output.forEach((item, index) => {
              const itemRecord = asRecord(item);
              if (itemRecord) {
                const itemId =
                  stringValue(itemRecord.id) ??
                  stringValue(itemRecord.call_id) ??
                  `response-output-${index}`;
                const normalizedItem = { ...itemRecord, id: itemId };
                itemById.set(itemId, toOutputItem(normalizedItem));
                if (itemRecord.type === "message") {
                  registerMessageItem(itemId, normalizedItem);
                  finishMessageItem(itemId);
                } else if (itemRecord.type === "function_call") {
                  markFunctionCallPresent();
                  const functionCall = functionCallFromItem(normalizedItem);
                  if (functionCall) {
                    functionByItemId.set(itemId, functionCall);
                    emitFunctionCall(functionCall);
                  }
                }
              }
            });
          }
          if (!hasFunctionCall && [...itemById.values()].some((item) => item.type === "function_call")) {
            markFunctionCallPresent();
          }
          flushUnclassifiedMessages(hasFunctionCall ? "commentary" : "final");
          completed = true;
          return;
        }
        case "response.failed":
        case "error": {
          failed = true;
          return;
        }
        default:
          emit({ type: "unknown", eventType });
      }
    },
    finish(): OpenAiCompatibleResponseResult {
      if (failed) {
        throw new OpenAiCompatibleStreamError("failed", "failed");
      }
      if (!completed) {
        throw new OpenAiCompatibleStreamError("interrupted", "interrupted");
      }

      const outputItems = [...itemById.values()];
      const result: OpenAiCompatibleResponseResult = {
        responseId,
        outputText: extractOutputText(outputItems, messagePhaseById),
        functionCalls: collectFunctionCalls(outputItems, functionByItemId),
        citations: dedupeCitations([...citations, ...extractCitations(outputItems)]),
        outputItems,
        webSearchCallCount: outputItems.filter((item) => item.type === "web_search_call").length,
        ...(usage ? { usage } : {})
      };
      assertAgentFunctionCallCount(result.functionCalls.length);
      result.functionCalls.forEach((functionCall) => {
        emit({ type: "function-call-ready", functionCall });
      });
      if (usage) {
        emit({ type: "usage", usage });
      }
      return result;
    }
  };

  function emitFunctionCall(functionCall: ProviderFunctionCall) {
    if (emittedFunctionCallIds.has(functionCall.callId)) {
      return;
    }
    emittedFunctionCallIds.add(functionCall.callId);
  }

  function getMessageState(itemId: string): MessageStreamState {
    const existing = messageStateById.get(itemId);
    if (existing) {
      return existing;
    }
    const created: MessageStreamState = {
      text: "",
      emittedLength: 0,
      done: false,
      startEmitted: false,
      endEmitted: false
    };
    messageStateById.set(itemId, created);
    return created;
  }

  function registerMessageItem(itemId: string, item: Record<string, unknown>): void {
    const state = getMessageState(itemId);
    const itemText = extractMessageItemText(item);
    if (itemText) {
      setMessageText(itemId, itemText);
    }
    const explicitPhase = parseMessagePhase(item.phase);
    if (explicitPhase) {
      classifyMessage(itemId, explicitPhase);
    } else if (hasFunctionCall) {
      classifyMessage(itemId, "commentary");
    } else if (state.phase) {
      messagePhaseById.set(itemId, state.phase);
    }
  }

  function appendMessageText(itemId: string, delta: string): void {
    const state = getMessageState(itemId);
    state.text += delta;
    emitPendingMessageText(itemId, state);
  }

  function setMessageText(itemId: string, text: string): void {
    const state = getMessageState(itemId);
    if (text.length >= state.text.length) {
      state.text = text;
    }
    emitPendingMessageText(itemId, state);
  }

  function finishMessageItem(itemId: string): void {
    const state = getMessageState(itemId);
    state.done = true;
    if (!state.phase && hasFunctionCall) {
      classifyMessage(itemId, "commentary");
    }
    emitMessageEnd(itemId, state);
  }

  function classifyMessage(itemId: string, phase: MessagePhase): void {
    const state = getMessageState(itemId);
    state.phase = phase;
    messagePhaseById.set(itemId, phase);
    if (!state.startEmitted) {
      state.startEmitted = true;
      emit({ type: phase === "commentary" ? "commentary-start" : "final-start", partId: itemId });
    }
    emitPendingMessageText(itemId, state);
    emitMessageEnd(itemId, state);
  }

  function emitPendingMessageText(itemId: string, state: MessageStreamState): void {
    if (!state.phase || state.emittedLength >= state.text.length) {
      return;
    }
    const delta = state.text.slice(state.emittedLength);
    state.emittedLength = state.text.length;
    emit({
      type: state.phase === "commentary" ? "commentary-delta" : "final-delta",
      partId: itemId,
      delta
    });
  }

  function emitMessageEnd(itemId: string, state: MessageStreamState): void {
    if (!state.phase || !state.done || state.endEmitted) {
      return;
    }
    state.endEmitted = true;
    emit({ type: state.phase === "commentary" ? "commentary-end" : "final-end", partId: itemId });
  }

  function flushUnclassifiedMessages(phase: MessagePhase): void {
    messageStateById.forEach((state, itemId) => {
      if (!state.phase) {
        classifyMessage(itemId, phase);
      }
    });
  }

  function markFunctionCallPresent(): void {
    if (hasFunctionCall) {
      return;
    }
    hasFunctionCall = true;
    flushUnclassifiedMessages("commentary");
  }
}

type ParsedSseFrame = {
  event?: string;
  data: string;
};

function consumeSseFrames(value: string): { events: ParsedSseFrame[]; remainder: string } {
  const events: ParsedSseFrame[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const delimiter = findSseFrameDelimiter(value, cursor);
    if (!delimiter) {
      break;
    }
    const frame = parseSseFrame(value.slice(cursor, delimiter.start));
    if (frame) {
      events.push(frame);
    }
    cursor = delimiter.end;
  }
  return { events, remainder: value.slice(cursor) };
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

function parseSseFrame(frame: string): ParsedSseFrame | undefined {
  const data: string[] = [];
  let event: string | undefined;
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).trimStart() : "";
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  const joined = data.join("\n");
  return joined ? { ...(event ? { event } : {}), data: joined } : undefined;
}

function parseMessagePhase(value: unknown): MessagePhase | undefined {
  if (value === "commentary") {
    return "commentary";
  }
  return value === "final_answer" ? "final" : undefined;
}

function reasoningPartId(itemId: string, summaryIndex: number): string {
  return `${itemId}:summary:${summaryIndex}`;
}

function hostedToolFromItem(item: Record<string, unknown>):
  | { toolName: string; activityKind: AgentStreamActivityKind; label: string }
  | undefined {
  switch (item.type) {
    case "web_search_call":
      return {
        toolName: "web_search",
        activityKind: "webSearch",
        label: extractHostedToolQuery(item) ? `搜索 ${extractHostedToolQuery(item)}` : "搜索并检查相关资料"
      };
    case "file_search_call":
      return {
        toolName: "file_search",
        activityKind: "fileRead",
        label: extractHostedToolQuery(item) ? `检索 ${extractHostedToolQuery(item)}` : "读取相关文件和资料"
      };
    case "computer_call":
    case "shell_call":
    case "code_interpreter_call":
      return { toolName: String(item.type), activityKind: "other", label: "处理相关任务" };
    default:
      return undefined;
  }
}

function extractHostedToolQuery(value: Record<string, unknown>): string | undefined {
  const action = asRecord(value.action);
  const direct = stringValue(value.query) ?? stringValue(action?.query);
  const queries = Array.isArray(value.queries)
    ? value.queries
    : Array.isArray(action?.queries)
      ? action.queries
      : undefined;
  const query = direct ?? queries?.find((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (!query) {
    return undefined;
  }
  return query.replace(/\s+/g, " ").trim().slice(0, 72);
}

function functionCallFromItem(item: Record<string, unknown>): ProviderFunctionCall | undefined {
  const callId = stringValue(item.call_id);
  const name = stringValue(item.name);
  if (!callId || !name) {
    return undefined;
  }
  return {
    id: stringValue(item.id) ?? callId,
    callId,
    name,
    argumentsText: stringValue(item.arguments) ?? ""
  };
}

function collectFunctionCalls(
  outputItems: AgentOutputItem[],
  functionByItemId: Map<string, ProviderFunctionCall>
): ProviderFunctionCall[] {
  return outputItems
    .map((item) => {
      const record = asRecord(item);
      if (!record || record.type !== "function_call") {
        return undefined;
      }
      return functionCallFromItem(record) ?? (typeof record.id === "string" ? functionByItemId.get(record.id) : undefined);
    })
    .filter((call): call is ProviderFunctionCall => Boolean(call));
}

function extractOutputText(
  outputItems: AgentOutputItem[],
  messagePhaseById: Map<string, MessagePhase>
): string {
  const text: string[] = [];
  for (const item of outputItems) {
    const record = asRecord(item);
    if (!record || record.type !== "message") {
      continue;
    }
    const itemId = stringValue(record.id);
    if (itemId && messagePhaseById.get(itemId) === "commentary") {
      continue;
    }
    if (!Array.isArray(record.content)) {
      continue;
    }
    for (const part of record.content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === "output_text" && typeof partRecord.text === "string") {
        text.push(partRecord.text);
      }
    }
  }
  return text.join("\n").trim();
}

function extractUsage(value: unknown): ProviderTokenUsage | undefined {
  return normalizeProviderTokenUsage(value, {
    input: "input_tokens",
    output: "output_tokens"
  });
}

function extractMessageItemText(item: Record<string, unknown>): string {
  if (!Array.isArray(item.content)) {
    return "";
  }
  return item.content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "output_text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function extractCitations(value: unknown): ProviderCitation[] {
  const citations: ProviderCitation[] = [];
  visitRecords(value, (record) => {
    const citation = citationFromUnknown(record.url_citation ?? record);
    if (citation) {
      citations.push(citation);
    }
  });
  return dedupeCitations(citations);
}

function citationFromUnknown(value: unknown): ProviderCitation | undefined {
  const record = asRecord(value);
  const url = stringValue(record?.url);
  if (!url || !looksLikeHttpUrl(url)) {
    return undefined;
  }
  return {
    title: stringValue(record?.title) ?? stringValue(record?.name) ?? domainFromUrl(url) ?? "未命名来源",
    url,
    domain: stringValue(record?.domain) ?? domainFromUrl(url),
    snippet: stringValue(record?.snippet) ?? stringValue(record?.content) ?? stringValue(record?.text)
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

function visitRecords(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitRecords(item, visitor));
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  visitor(record);
  Object.values(record).forEach((entry) => visitRecords(entry, visitor));
}

function toOutputItem(value: Record<string, unknown>): AgentOutputItem {
  return value as AgentOutputItem;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function looksLikeHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function domainFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function createAbortError(): DOMException {
  return new DOMException("The stream was aborted.", "AbortError");
}
