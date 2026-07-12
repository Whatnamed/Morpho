import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ensureStageRegions, getStageRegions } from "@/domain/morpho/stageRegions";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { StageRegionToolbar } from "./StageRegionToolbar";

describe("StageRegionToolbar", () => {
  it("uses icon-only controls with accessible labels", () => {
    const region = getStageRegions(ensureStageRegions(createInitialWorkspace()))[0];
    const html = renderToStaticMarkup(
      createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: true,
        onUpdateStyle: () => undefined,
        onBeginOpacity: () => undefined,
        onPreviewOpacity: () => undefined,
        onCommitOpacity: () => undefined,
        onCancelOpacity: () => undefined,
        onFit: () => undefined,
        onResetStyle: () => undefined
      })
    );

    for (const label of ["颜色", "透明度", "边框", "隐藏背景", "锁定分区", "适应内容", "恢复默认样式"]) {
      expect(html).toContain(`aria-label=\"${label}\"`);
    }
    expect(html).not.toContain(">颜色<");
    expect(html).not.toContain(">透明度<");
    expect(html).not.toContain(">边框<");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("disables fit when locked or when a region has no visible members", () => {
    const region = { ...getStageRegions(ensureStageRegions(createInitialWorkspace()))[0], locked: true };
    const html = renderToStaticMarkup(
      createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: false,
        onUpdateStyle: () => undefined,
        onBeginOpacity: () => undefined,
        onPreviewOpacity: () => undefined,
        onCommitOpacity: () => undefined,
        onCancelOpacity: () => undefined,
        onFit: () => undefined,
        onResetStyle: () => undefined
      })
    );
    expect(html).toContain('aria-label="适应内容"');
    expect(html).toContain("disabled=\"\"");
  });
});
