import type { MiMoConfig, ProviderChatInput, ProviderCitation, ProviderRequest, ProviderStreamEvent } from "./types";
import { MiMoProviderError } from "./errors";
import { classifyMiMoFailure, createMiMoKeyPool } from "./keyPool";

export function createMiMoChatRequest(config: MiMoConfig, input: ProviderChatInput): ProviderRequest {
  return createMiMoChatRequestWithKey(config, input, config.apiKeys[0] ?? "");
}

function createMiMoChatRequestWithKey(config: MiMoConfig, input: ProviderChatInput, apiKey: string): ProviderRequest {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const model = input.capability === "multimodal" ? config.multimodalModel : config.textModel;

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: {
      model,
      messages: [{ role: "system", content: input.systemPrompt }, ...input.messages],
      stream: input.stream,
      thinking: {
        type: "disabled"
      },
      tools: input.webSearch?.enabled ? [buildWebSearchTool(input.webSearch)] : undefined
    }
  };
}

function buildWebSearchTool(webSearch: NonNullable<ProviderChatInput["webSearch"]>) {
  return {
    type: "web_search" as const,
    ...(typeof webSearch.maxKeyword === "number" ? { max_keyword: webSearch.maxKeyword } : {}),
    force_search: webSearch.forceSearch,
    ...(typeof webSearch.limit === "number" ? { limit: webSearch.limit } : {})
  };
}

export async function streamMiMoChat(config: MiMoConfig, input: ProviderChatInput): Promise<ReadableStream<Uint8Array>> {
  const keyPool = createMiMoKeyPool(config.apiKeys);
  let providerRequest = createMiMoChatRequestWithKey(config, input, keyPool.current());
  let response: Response;

  try {
    response = await fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      signal: input.signal
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }

    const next = keyPool.nextAfterFailure({ kind: "network" });
    if (next.status === "stop") {
      throw error;
    }

    providerRequest = createMiMoChatRequestWithKey(config, input, next.apiKey);
    response = await fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      signal: input.signal
    });
  }

  if (!response.ok) {
    const next = keyPool.nextAfterFailure({ status: response.status });
    if (next.status === "retry") {
      providerRequest = createMiMoChatRequestWithKey(config, input, next.apiKey);
      response = await fetch(providerRequest.url, {
        method: "POST",
        headers: providerRequest.headers,
        body: JSON.stringify(providerRequest.body),
        signal: input.signal
      });
    }
  }

  if (!response.ok) {
    const diagnostic = await readProviderFailureDiagnostic(response);
    throw new MiMoProviderError(classifyMiMoFailure({ status: response.status }), response.status, diagnostic);
  }

  if (!response.body) {
    throw new MiMoProviderError("temporaryFailure", response.status);
  }

  return response.body.pipeThrough(createOpenAiCompatibleEventTransform());
}

async function readProviderFailureDiagnostic(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 500) || undefined;
  } catch {
    return undefined;
  }
}

export function createOpenAiCompatibleTextTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const token of parseOpenAiCompatibleSse(lines.join("\n"))) {
        controller.enqueue(encoder.encode(token));
      }
    },
    flush(controller) {
      for (const token of parseOpenAiCompatibleSse(buffer)) {
        controller.enqueue(encoder.encode(token));
      }
    }
  });
}

export function createOpenAiCompatibleEventTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const seenCitations = new Set<string>();

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const event of parseOpenAiCompatibleSseEvents(lines.join("\n"))) {
        if (event.type === "citations") {
          const fresh = event.citations.filter((citation) => {
            const key = citation.url ?? `${citation.title}:${citation.snippet ?? ""}`;
            if (seenCitations.has(key)) {
              return false;
            }
            seenCitations.add(key);
            return true;
          });
          if (fresh.length === 0) {
            continue;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "citations", citations: fresh })}\n`));
          continue;
        }

        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
    },
    flush(controller) {
      for (const event of parseOpenAiCompatibleSseEvents(buffer)) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
    }
  });
}

export function parseOpenAiCompatibleSse(text: string): string[] {
  const tokens: string[] = [];
  for (const event of parseOpenAiCompatibleSseEvents(text)) {
    if (event.type === "delta") {
      tokens.push(event.text);
    }
  }

  return tokens;
}

export function parseOpenAiCompatibleSseEvents(text: string): ProviderStreamEvent[] {
  const events: ProviderStreamEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      const content = extractStreamingContent(parsed);
      if (content) {
        events.push({ type: "delta", text: content });
      }
      const citations = extractCitations(parsed);
      if (citations.length > 0) {
        events.push({ type: "citations", citations });
      }
    } catch {
      // Ignore malformed provider chunks; the final route error handles transport failures.
    }
  }

  return events;
}

function extractStreamingContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return "";
  }

  const firstChoice = value.choices[0] as unknown;
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    return "";
  }

  return typeof firstChoice.delta.content === "string" ? firstChoice.delta.content : "";
}

export function extractCitations(value: unknown): ProviderCitation[] {
  const candidates: ProviderCitation[] = [];
  visitRecords(value, (record) => {
    if (typeof record.url === "string" && looksLikeHttpUrl(record.url)) {
      candidates.push(normalizeCitationRecord(record));
      return;
    }

    const urlCitation = record.url_citation;
    if (isRecord(urlCitation) && typeof urlCitation.url === "string" && looksLikeHttpUrl(urlCitation.url)) {
      candidates.push(normalizeCitationRecord(urlCitation));
    }
  });

  const seen = new Set<string>();
  return candidates.filter((citation) => {
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

  if (!isRecord(value)) {
    return;
  }

  visitor(value);
  Object.values(value).forEach((item) => visitRecords(item, visitor));
}

function normalizeCitationRecord(record: Record<string, unknown>): ProviderCitation {
  const url = typeof record.url === "string" ? record.url : undefined;
  const title =
    stringFromUnknown(record.title) ??
    stringFromUnknown(record.name) ??
    stringFromUnknown(record.site_name) ??
    (url ? domainFromUrl(url) : undefined) ??
    "未命名来源";
  return {
    title,
    url,
    domain: stringFromUnknown(record.domain) ?? (url ? domainFromUrl(url) : undefined),
    snippet: stringFromUnknown(record.snippet) ?? stringFromUnknown(record.content) ?? stringFromUnknown(record.text)
  };
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
