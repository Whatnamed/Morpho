// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ensureStageRegions, getStageRegions } from "@/domain/morpho/stageRegions";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { StageRegionToolbar, type StageRegionOpenPopover } from "./StageRegionToolbar";

describe("StageRegionToolbar", () => {
  it("uses icon-only controls with accessible labels", () => {
    const region = getStageRegions(ensureStageRegions(createInitialWorkspace()))[0];
    const html = renderToStaticMarkup(
      createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: true,
        openPopover: null,
        onOpenPopoverChange: () => undefined,
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
    expect(html).toContain("stage-color-swatch-face");
    expect(html).not.toContain("lucide-palette");
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
        openPopover: null,
        onOpenPopoverChange: () => undefined,
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

  it("keeps the opacity panel markup when openPopover is controlled as opacity", () => {
    const region = getStageRegions(ensureStageRegions(createInitialWorkspace()))[0];
    const html = renderToStaticMarkup(
      createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: true,
        openPopover: "opacity",
        onOpenPopoverChange: () => undefined,
        onUpdateStyle: () => undefined,
        onBeginOpacity: () => undefined,
        onPreviewOpacity: () => undefined,
        onCommitOpacity: () => undefined,
        onCancelOpacity: () => undefined,
        onFit: () => undefined,
        onResetStyle: () => undefined
      })
    );
    expect(html).toContain('aria-label="分区背景透明度"');
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="背景不透明度"');
    expect(html).not.toContain('data-tooltip="透明度"');
  });

  it("uses icon changes for persisted background and lock state", () => {
    const region = {
      ...getStageRegions(ensureStageRegions(createInitialWorkspace()))[0],
      backgroundVisible: false,
      locked: true
    };
    const html = renderToStaticMarkup(
      createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: true,
        openPopover: null,
        onOpenPopoverChange: () => undefined,
        onUpdateStyle: () => undefined,
        onBeginOpacity: () => undefined,
        onPreviewOpacity: () => undefined,
        onCommitOpacity: () => undefined,
        onCancelOpacity: () => undefined,
        onFit: () => undefined,
        onResetStyle: () => undefined
      })
    );

    expect(html).toContain('aria-label="显示背景"');
    expect(html).toContain("lucide-eye-off");
    expect(html).toContain('aria-label="解锁分区"');
    expect(html).toContain("lucide-lock-keyhole");
  });

  it("keeps opacity open through repeated pointer commits and closes only outside or on Escape", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const region = getStageRegions(ensureStageRegions(createInitialWorkspace()))[0]!;
    const begin = vi.fn();
    const preview = vi.fn();
    const commit = vi.fn();
    const cancel = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
      const [openPopover, setOpenPopover] = useState<StageRegionOpenPopover>(null);
      return createElement(StageRegionToolbar, {
        region,
        placement: { x: 120, y: 220, placement: "above" },
        canFit: true,
        openPopover,
        onOpenPopoverChange: setOpenPopover,
        onUpdateStyle: () => undefined,
        onBeginOpacity: begin,
        onPreviewOpacity: preview,
        onCommitOpacity: commit,
        onCancelOpacity: cancel,
        onFit: () => undefined,
        onResetStyle: () => undefined
      });
    }

    const pointer = (type: string) =>
      new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0
      });
    const setRangeValue = (input: HTMLInputElement, value: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const query = <T extends Element>(selector: string) => {
      const element = container.querySelector<T>(selector);
      if (!element) {
        throw new Error(`Expected ${selector}`);
      }
      return element;
    };

    await act(async () => {
      root.render(createElement(Harness));
    });
    const opacityTrigger = query<HTMLButtonElement>('button[aria-label="透明度"]');
    await act(async () => {
      opacityTrigger.click();
    });
    expect(query('[role="dialog"][aria-label="分区背景透明度"]')).toBeDefined();
    expect(opacityTrigger.getAttribute("data-tooltip")).toBeNull();

    const range = query<HTMLInputElement>('input[aria-label="背景不透明度"]');
    await act(async () => {
      range.dispatchEvent(pointer("pointerdown"));
      setRangeValue(range, "32");
      range.dispatchEvent(pointer("pointerup"));
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenLastCalledWith(32);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"][aria-label="分区背景透明度"]')).not.toBeNull();

    await act(async () => {
      range.dispatchEvent(pointer("pointerdown"));
      setRangeValue(range, "48");
      range.dispatchEvent(pointer("pointerup"));
    });
    expect(preview).toHaveBeenLastCalledWith(48);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"][aria-label="分区背景透明度"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(pointer("pointerdown"));
    });
    expect(container.querySelector('[role="dialog"][aria-label="分区背景透明度"]')).toBeNull();

    await act(async () => {
      opacityTrigger.click();
    });
    const reopenedRange = query<HTMLInputElement>('input[aria-label="背景不透明度"]');
    await act(async () => {
      reopenedRange.dispatchEvent(pointer("pointerdown"));
      setRangeValue(reopenedRange, "61");
      reopenedRange.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"][aria-label="分区背景透明度"]')).toBeNull();

    const colorTrigger = query<HTMLButtonElement>('button[aria-label="颜色"]');
    await act(async () => {
      colorTrigger.click();
    });
    expect(query('[role="dialog"][aria-label="分区颜色"]')).toBeDefined();
    expect(colorTrigger.getAttribute("data-tooltip")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
