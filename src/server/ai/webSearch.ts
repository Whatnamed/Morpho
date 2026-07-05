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
};

export async function searchWebEvidence(input: SearchWebEvidenceInput): Promise<WebSearchSource[]> {
  const distinctQueries = Array.from(
    new Set(
      input.queries
        .map((query) => query.trim())
        .filter(Boolean)
        .slice(0, 3)
    )
  );
  const maxSources = clampInteger(input.maxSources ?? 5, 1, 5);
  const aggregated: WebSearchSource[] = [];
  const seenUrls = new Set<string>();

  for (const query of distinctQueries) {
    const searchResults = await searchDuckDuckGo(query, input.signal);
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

  const enriched = await Promise.all(
    aggregated.map(async (source) => ({
      ...source,
      excerpt: await fetchReadableExcerpt(source.url, input.signal)
    }))
  );

  return enriched;
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Morpho/1.0 (+https://morpho.local)",
      Accept: "text/html,application/xhtml+xml"
    },
    signal
  });

  if (!response.ok) {
    return [];
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

async function fetchReadableExcerpt(url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`, {
      headers: {
        "User-Agent": "Morpho/1.0 (+https://morpho.local)"
      },
      signal
    });
    if (!response.ok) {
      return undefined;
    }

    const text = await response.text();
    const excerpt = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 18)
      .join(" ");
    return excerpt ? excerpt.slice(0, 1200) : undefined;
  } catch {
    return undefined;
  }
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
