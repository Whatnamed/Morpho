import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeftRail } from "./LeftRail";

describe("LeftRail", () => {
  it("keeps project-home actions out of the canvas rail", () => {
    const html = renderToStaticMarkup(
      createElement(LeftRail, {
        activeDrawer: null,
        onDrawerChange: () => undefined,
        onAddToCanvas: () => undefined
      })
    );

    expect(html).not.toContain("项目入口");
    expect(html).not.toContain("FolderSearch");
  });

  it("exposes project records alongside search and assets", () => {
    const html = renderToStaticMarkup(
      createElement(LeftRail, {
        activeDrawer: "records",
        onDrawerChange: () => undefined,
        onAddToCanvas: () => undefined
      })
    );

    expect(html).toContain("项目记录");
    expect(html).toContain("项目内搜索");
    expect(html).toContain('aria-pressed="true"');
  });
});
