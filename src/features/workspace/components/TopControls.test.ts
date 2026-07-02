import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TopControls } from "./TopControls";

describe("TopControls", () => {
  it("renders the output action with a real handler prop", () => {
    const onOpenDeliveryOutput = vi.fn();

    const html = renderToStaticMarkup(
      createElement(TopControls, {
        projectTitle: "夜航 / Nightrail",
        onImportFiles: () => undefined,
        onSearch: () => undefined,
        onFocusOverview: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onOpenProjectBundles: () => undefined,
        onOpenDeliveryOutput
      })
    );

    expect(html).toContain("输出");
  });
});
