export type WebSearchSource = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  excerpt?: string;
};

export type SearchWebEvidenceInput = {
  queries: string[];
  maxSources?: number;
  signal?: AbortSignal;
  queryTimeoutMs?: number;
  sourceTimeoutMs?: number;
};

export type SearchWebEvidenceResult = {
  sources: WebSearchSource[];
  failedSourceCount: number;
  timedOutSourceCount: number;
};

export const WEB_SEARCH_QUERY_TIMEOUT_MS = 8_000;
export const WEB_SEARCH_SOURCE_TIMEOUT_MS = 5_000;
export const WEB_SEARCH_QUERY_MAX_RESPONSE_BYTES = 1024 * 1024;
export const WEB_SEARCH_SOURCE_MAX_RESPONSE_BYTES = 512 * 1024;
export const WEB_SEARCH_TOTAL_RESPONSE_BYTES = 5 * 1024 * 1024;

const DUCKDUCKGO_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const JINA_CONTENT_TYPES = new Set(["text/plain", "text/markdown"]);

export async function searchWebEvidence(input: SearchWebEvidenceInput): Promise<SearchWebEvidenceResult> {
  const distinctQueries = Array.from(
    new Set(
      input.queries
        .map((query) => query.trim())
        .filter((query) => query.length > 0 && query.length <= 300)
        .slice(0, 3)
    )
  );
  const maxSources = clampInteger(input.maxSources ?? 5, 1, 5);
  const queryTimeoutMs = clampInteger(input.queryTimeoutMs ?? WEB_SEARCH_QUERY_TIMEOUT_MS, 100, 30_000);
  const sourceTimeoutMs = clampInteger(input.sourceTimeoutMs ?? WEB_SEARCH_SOURCE_TIMEOUT_MS, 100, 30_000);
  const aggregated: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  let failedSourceCount = 0;
  let timedOutSourceCount = 0;
  const responseBudget = new WebSearchResponseByteBudget(WEB_SEARCH_TOTAL_RESPONSE_BYTES);

  throwIfAborted(input.signal);
  const queryResults = await Promise.allSettled(
    distinctQueries.map((query) => searchDuckDuckGo(query, input.signal, queryTimeoutMs, responseBudget))
  );
  throwIfAborted(input.signal);
  for (const result of queryResults) {
    if (result.status === "rejected") {
      if (result.reason instanceof WebSearchTimeoutError) {
        timedOutSourceCount += 1;
      } else {
        failedSourceCount += 1;
      }
      continue;
    }
    const searchResults = result.value;
    for (const result of searchResults) {
      if (seenUrls.has(result.url)) {
        continue;
      }
      seenUrls.add(result.url);
      aggregated.push(result);
      if (aggregated.length >= maxSources) {
        break;
      }
    }
    if (aggregated.length >= maxSources) {
      break;
    }
  }

  const excerptResults = await Promise.allSettled(
    aggregated.map((source) => fetchReadableExcerpt(source.url, input.signal, sourceTimeoutMs, responseBudget))
  );
  throwIfAborted(input.signal);
  const sources = excerptResults.map((result, index) => {
    const source = aggregated[index]!;
    if (result.status === "fulfilled") {
      return { ...source, ...(result.value ? { excerpt: result.value } : {}) };
    }
    if (result.reason instanceof WebSearchTimeoutError) {
      timedOutSourceCount += 1;
    } else {
      failedSourceCount += 1;
    }
    return source;
  });

  return { sources, failedSourceCount, timedOutSourceCount };
}

async function searchDuckDuckGo(
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  responseBudget: WebSearchResponseByteBudget
): Promise<WebSearchSource[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { response, text: html } = await fetchTextWithLimits(
    url,
    {
      headers: {
        "User-Agent": "Morpho/1.0 (+https://morpho.local)",
        Accept: "text/html,application/xhtml+xml"
      }
    },
    {
      timeoutMs,
      parentSignal: signal,
      maxBytes: WEB_SEARCH_QUERY_MAX_RESPONSE_BYTES,
      allowedContentTypes: DUCKDUCKGO_CONTENT_TYPES,
      responseBudget
    }
  );

  if (!response.ok) {
    throw new Error(`Search request failed with ${response.status}.`);
  }
  return parseDuckDuckGoResults(html);
}

export function parseDuckDuckGoResults(html: string): WebSearchSource[] {
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) ?? [];
  const parsed: WebSearchSource[] = [];

  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }

    const rawUrl = decodeHtmlEntities(linkMatch[1]);
    const url = unwrapDuckDuckGoRedirect(rawUrl);
    if (!looksLikeHttpUrl(url)) {
      continue;
    }

    const title = stripHtml(linkMatch[2]).trim();
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : undefined;

    parsed.push({
      title: title || domainFromUrl(url) || "来源未命名",
      url,
      domain: domainFromUrl(url),
      snippet
    });
  }

  return parsed.slice(0, 5);
}

async function fetchReadableExcerpt(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  responseBudget: WebSearchResponseByteBudget
): Promise<string | undefined> {
  const { response, text } = await fetchTextWithLimits(
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
    {
      headers: {
        "User-Agent": "Morpho/1.0 (+https://morpho.local)"
      }
    },
    {
      timeoutMs,
      parentSignal: signal,
      maxBytes: WEB_SEARCH_SOURCE_MAX_RESPONSE_BYTES,
      allowedContentTypes: JINA_CONTENT_TYPES,
      responseBudget
    }
  );
  if (!response.ok) {
    throw new Error(`Source request failed with ${response.status}.`);
  }
  const excerpt = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join(" ");
  return excerpt ? excerpt.slice(0, 1200) : undefined;
}

class WebSearchTimeoutError extends Error {
  constructor() {
    super("Web search request timed out.");
    this.name = "WebSearchTimeoutError";
  }
}

class WebSearchResponseTooLargeError extends Error {
  constructor() {
    super("Web search response exceeded its byte budget.");
    this.name = "WebSearchResponseTooLargeError";
  }
}

class WebSearchUnexpectedContentTypeError extends Error {
  constructor() {
    super("Web search response used an unexpected content type.");
    this.name = "WebSearchUnexpectedContentTypeError";
  }
}

class WebSearchResponseByteBudget {
  private consumedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  consume(bytes: number): void {
    if (this.consumedBytes + bytes > this.maxBytes) throw new WebSearchResponseTooLargeError();
    this.consumedBytes += bytes;
  }
}

async function fetchTextWithLimits(
  url: string,
  init: RequestInit,
  options: Readonly<{
    timeoutMs: number;
    parentSignal?: AbortSignal;
    maxBytes: number;
    allowedContentTypes: ReadonlySet<string>;
    responseBudget: WebSearchResponseByteBudget;
  }>
): Promise<{ response: Response; text: string }> {
  throwIfAborted(options.parentSignal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(options.parentSignal?.reason);
  options.parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      await cancelResponseBody(response.body, "non_success_status");
      return { response, text: "" };
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!contentType || !options.allowedContentTypes.has(contentType)) {
      await cancelResponseBody(response.body, "unexpected_content_type");
      throw new WebSearchUnexpectedContentTypeError();
    }
    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== undefined && declaredLength > options.maxBytes) {
      await cancelResponseBody(response.body, "response_too_large");
      throw new WebSearchResponseTooLargeError();
    }
    const text = await readBoundedResponseText(
      response.body,
      controller.signal,
      options.maxBytes,
      options.responseBudget
    );
    return { response, text };
  } catch (error) {
    if (options.parentSignal?.aborted) {
      throw abortError(options.parentSignal.reason);
    }
    if (timedOut) {
      throw new WebSearchTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function readBoundedResponseText(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
  maxBytes: number,
  responseBudget: WebSearchResponseByteBudget
): Promise<string> {
  if (!body) return "";
  throwIfAborted(signal);
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let responseBytes = 0;
  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortRead = () => rejectAbort?.(abortError(signal.reason));
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      responseBytes += next.value.byteLength;
      if (responseBytes > maxBytes) throw new WebSearchResponseTooLargeError();
      responseBudget.consume(next.value.byteLength);
      parts.push(decoder.decode(next.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await cancelReader(reader, signal.aborted ? signal.reason : "response_read_failed");
    throw error;
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null, reason: string): Promise<void> {
  if (!body) return;
  try {
    await body.cancel(reason);
  } catch {
    // The request still fails closed when the runtime cannot cancel a body.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The request still fails closed when the runtime cannot cancel a reader.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError(signal.reason);
  }
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}

function unwrapDuckDuckGoRedirect(value: string): string {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    if (parsed.hostname !== "duckduckgo.com") {
      return parsed.toString();
    }

    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "));
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

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
