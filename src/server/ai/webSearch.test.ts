import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEB_SEARCH_QUERY_MAX_RESPONSE_BYTES,
  parseDuckDuckGoResults,
  searchWebEvidence
} from "./webSearch";

describe("web search parsing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parses duckduckgo html results into sources", () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">Example Article</a>
          </h2>
          <a class="result__snippet">A concise summary.</a>
        </div>
      </div>
    `;

    expect(parseDuckDuckGoResults(html)).toEqual([
      {
        title: "Example Article",
        url: "https://example.com/article",
        domain: "example.com",
        snippet: "A concise summary."
      }
    ]);
  });

  it("keeps successful sources when another excerpt fails and one times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://html.duckduckgo.com")) {
        return new Response(searchResultHtml([
          ["Source A", "https://example.com/a"],
          ["Source B", "https://example.com/b"],
          ["Source C", "https://example.com/c"]
        ]), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (url.endsWith("example.com/a")) {
        return new Response("Useful excerpt A", { status: 200 });
      }
      if (url.endsWith("example.com/b")) {
        throw new Error("source unavailable");
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = searchWebEvidence({
      queries: ["ocean buoy"],
      maxSources: 5,
      queryTimeoutMs: 100,
      sourceTimeoutMs: 100
    });
    await vi.advanceTimersByTimeAsync(101);
    const result = await resultPromise;

    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({ url: "https://example.com/a", excerpt: "Useful excerpt A" });
    expect(result.sources[1]).toMatchObject({ url: "https://example.com/b" });
    expect(result.sources[2]).toMatchObject({ url: "https://example.com/c" });
    expect(result).toMatchObject({ failedSourceCount: 1, timedOutSourceCount: 1 });
  });

  it("keeps the deadline active after headers and cancels a stalled source body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://html.duckduckgo.com")) {
        return new Response(searchResultHtml([["Source A", "https://example.com/a"]]), {
          status: 200,
          headers: { "Content-Type": "text/html" }
        });
      }
      return new Response(new ReadableStream<Uint8Array>({ cancel }), {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }));

    const resultPromise = searchWebEvidence({
      queries: ["ocean buoy"],
      queryTimeoutMs: 100,
      sourceTimeoutMs: 100
    });
    await vi.advanceTimersByTimeAsync(101);
    const result = await resultPromise;

    expect(result.sources).toHaveLength(1);
    expect(result).toMatchObject({ failedSourceCount: 0, timedOutSourceCount: 1 });
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels a chunked query response as soon as it exceeds the byte ceiling", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(Math.floor(WEB_SEARCH_QUERY_MAX_RESPONSE_BYTES / 2) + 1);
    let sent = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < 2) {
          sent += 1;
          controller.enqueue(chunk);
        }
      },
      cancel
    }), { status: 200, headers: { "Content-Type": "text/html" } })));

    const result = await searchWebEvidence({ queries: ["ocean buoy"] });

    expect(result).toEqual({ sources: [], failedSourceCount: 1, timedOutSourceCount: 0 });
    expect(cancel).toHaveBeenCalledWith("response_read_failed");
  });

  it("rejects an unexpected fixed-origin response content type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })));

    await expect(searchWebEvidence({ queries: ["ocean buoy"] })).resolves.toEqual({
      sources: [],
      failedSourceCount: 1,
      timedOutSourceCount: 0
    });
  });

  it("enforces one aggregate byte budget across query and excerpt fan-out", async () => {
    const queryBody = `${searchResultHtml([
      ["Source A", "https://example.com/a"],
      ["Source B", "https://example.com/b"],
      ["Source C", "https://example.com/c"],
      ["Source D", "https://example.com/d"],
      ["Source E", "https://example.com/e"]
    ])}<!--${"q".repeat(900 * 1024)}-->`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.startsWith("https://html.duckduckgo.com")
        ? new Response(queryBody, { status: 200, headers: { "Content-Type": "text/html" } })
        : new Response("e".repeat(500 * 1024), {
            status: 200,
            headers: { "Content-Type": "text/plain" }
          });
    }));

    const result = await searchWebEvidence({ queries: ["one", "two", "three"], maxSources: 5 });

    expect(result.sources).toHaveLength(5);
    expect(result.failedSourceCount).toBe(1);
    expect(result.timedOutSourceCount).toBe(0);
  });

  it("propagates an overall abort instead of converting it into partial success", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })
    ));

    const result = searchWebEvidence({ queries: ["ocean buoy"], signal: controller.signal });
    controller.abort(new DOMException("aborted", "AbortError"));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});

function searchResultHtml(results: Array<[string, string]>): string {
  return results.map(([title, url]) => `
    <div class="result results_links results_links_deep web-result">
      <div class="links_main links_deep result__body">
        <h2 class="result__title"><a class="result__a" href="${url}">${title}</a></h2>
        <a class="result__snippet">Snippet</a>
      </div>
    </div>
  `).join("\n");
}
