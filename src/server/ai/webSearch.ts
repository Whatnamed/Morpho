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

export async function searchWebEvidence(input: SearchWebEvidenceInput): Promise<SearchWebEvidenceResult> {
  const distinctQueries = Array.from(
    new Set(
      input.queries
        .map((query) => query.trim())
        .filter(Boolean)
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

  throwIfAborted(input.signal);
  const queryResults = await Promise.allSettled(
    distinctQueries.map((query) => searchDuckDuckGo(query, input.signal, queryTimeoutMs))
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
    aggregated.map((source) => fetchReadableExcerpt(source.url, input.signal, sourceTimeoutMs))
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
  timeoutMs: number
): Promise<WebSearchSource[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Morpho/1.0 (+https://morpho.local)",
      Accept: "text/html,application/xhtml+xml"
    }
  }, timeoutMs, signal);

  if (!response.ok) {
    throw new Error(`Search request failed with ${response.status}.`);
  }

  const html = await response.text();
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
  timeoutMs: number
): Promise<string | undefined> {
  const response = await fetchWithTimeout(
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
    {
      headers: {
        "User-Agent": "Morpho/1.0 (+https://morpho.local)"
      }
    },
    timeoutMs,
    signal
  );
  if (!response.ok) {
    throw new Error(`Source request failed with ${response.status}.`);
  }

  const text = await response.text();
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<Response> {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (parentSignal?.aborted) {
      throw abortError(parentSignal.reason);
    }
    if (timedOut) {
      throw new WebSearchTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
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
