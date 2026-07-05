import { describe, expect, it } from "vitest";

import { parseDuckDuckGoResults } from "./webSearch";

describe("web search parsing", () => {
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
});
