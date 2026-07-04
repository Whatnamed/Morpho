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

  it("keeps project system actions in the project menu", () => {
    const html = renderToStaticMarkup(
      createElement(TopControls, {
        projectTitle: "夜航 / Nightrail",
        projectMenuOpen: true,
        projectRenameDraft: "夜航 / Nightrail",
        onProjectMenuToggle: () => undefined,
        onProjectRenameDraftChange: () => undefined,
        onProjectRenameConfirm: () => undefined,
        onOpenProjectHome: () => undefined,
        onImportFiles: () => undefined,
        onSearch: () => undefined,
        onFocusOverview: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onOpenProjectBundles: () => undefined,
        onOpenDeliveryOutput: () => undefined
      })
    );

    expect(html).toContain("项目操作");
    expect(html).toContain("重命名项目");
    expect(html).toContain("返回项目首页");
    expect(html).toContain("项目归档与恢复");
  });
});
