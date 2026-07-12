"use client";

import { Droplets, EyeOff, LockKeyhole, LockKeyholeOpen, PaintBucket, Palette, RotateCcw, Scan } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { StageRegionBorderStyle, StageRegionColorKey, StageRegionRecord } from "@/domain/morpho/types";
import { getStageRegionColorPreset, STAGE_REGION_COLOR_PRESETS } from "@/domain/morpho/stageRegions";
import type { SelectionToolbarPlacement } from "../selectionToolbar";
import { CanvasIconButton } from "./CanvasIconButton";

type OpenPopover = "color" | "opacity" | "border" | null;

export type StageRegionToolbarProps = {
  region: StageRegionRecord;
  placement: SelectionToolbarPlacement;
  canFit: boolean;
  onUpdateStyle: (
    patch: Partial<Pick<StageRegionRecord, "colorKey" | "fillOpacity" | "backgroundVisible" | "borderStyle" | "locked">>,
    historyLabel: string
  ) => void;
  onBeginOpacity: () => void;
  onPreviewOpacity: (value: number) => void;
  onCommitOpacity: () => void;
  onCancelOpacity: () => void;
  onMeasure?: (size: { w: number; h: number }) => void;
  isMeasuring?: boolean;
  onFit: () => void;
  onResetStyle: () => void;
};

export function StageRegionToolbar({
  region,
  placement,
  canFit,
  onUpdateStyle,
  onBeginOpacity,
  onPreviewOpacity,
  onCommitOpacity,
  onCancelOpacity,
  onMeasure,
  isMeasuring = false,
  onFit,
  onResetStyle
}: StageRegionToolbarProps) {
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [previewOpacity, setPreviewOpacity] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const color = getStageRegionColorPreset(region.colorKey ?? "warmSand");
  const borderStyle = region.borderStyle ?? "solid";
  const fillOpacity = previewOpacity ?? region.fillOpacity ?? 16;
  const backgroundVisible = region.backgroundVisible ?? true;
  const locked = region.locked ?? false;
  const latestCommitRef = useRef(onCommitOpacity);

  useEffect(() => {
    latestCommitRef.current = onCommitOpacity;
  }, [onCommitOpacity]);
  useEffect(() => () => latestCommitRef.current(), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !onMeasure) return;
    let last = "";
    const report = () => {
      const { width, height } = root.getBoundingClientRect();
      const next = `${Math.round(width)}:${Math.round(height)}`;
      if (next !== last) {
        last = next;
        onMeasure({ w: Math.round(width), h: Math.round(height) });
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => observer.disconnect();
  }, [onMeasure]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        if (openPopover === "opacity") {
          onCommitOpacity();
          setPreviewOpacity(null);
        }
        setOpenPopover(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
  }, [onCommitOpacity, openPopover]);

  const togglePopover = (next: Exclude<OpenPopover, null>) => {
    setOpenPopover((current) => {
      if (current === "opacity") {
        onCommitOpacity();
        setPreviewOpacity(null);
      }
      return current === next ? null : next;
    });
  };

  const commitOpacity = () => {
    onCommitOpacity();
    setPreviewOpacity(null);
  };

  const cancelOpacity = () => {
    onCancelOpacity();
    setPreviewOpacity(null);
  };

  return (
    <div
      ref={rootRef}
      className={`stage-region-toolbar selection-toolbar ${placement.placement}`}
      aria-label={`${region.title}分区工具`}
      style={{ left: placement.x, top: placement.y, visibility: isMeasuring ? "hidden" : "visible" }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="selection-toolbar-group" role="group" aria-label="分区样式">
        <div className="canvas-toolbar-popover-anchor">
          <CanvasIconButton
            label="颜色"
            active={openPopover === "color"}
            aria-expanded={openPopover === "color"}
            aria-haspopup="dialog"
            onClick={() => togglePopover("color")}
          >
            <Palette size={16} />
            <span className="stage-color-dot" style={{ backgroundColor: color.border }} aria-hidden="true" />
          </CanvasIconButton>
          {openPopover === "color" ? (
            <div className="stage-toolbar-popover stage-color-popover" role="dialog" aria-label="分区颜色">
              {STAGE_REGION_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`stage-color-swatch ${preset.key === region.colorKey ? "is-selected" : ""}`}
                  aria-label={preset.label}
                  aria-pressed={preset.key === region.colorKey}
                  data-tooltip={preset.label}
                  onClick={() => {
                    onUpdateStyle({ colorKey: preset.key }, "设置分区颜色");
                    setOpenPopover(null);
                  }}
                >
                  <span style={{ backgroundColor: preset.border }} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="canvas-toolbar-popover-anchor">
          <CanvasIconButton
            label="透明度"
            active={openPopover === "opacity"}
            aria-expanded={openPopover === "opacity"}
            aria-haspopup="dialog"
            onClick={() => togglePopover("opacity")}
          >
            <Droplets size={16} />
          </CanvasIconButton>
          {openPopover === "opacity" ? (
            <div className="stage-toolbar-popover stage-opacity-popover" role="dialog" aria-label="分区背景透明度">
              <output aria-live="polite">{fillOpacity}%</output>
              <input
                aria-label="背景不透明度"
                type="range"
                min="0"
                max="100"
                step="1"
                value={fillOpacity}
                onPointerDown={onBeginOpacity}
                onPointerUp={commitOpacity}
                onPointerCancel={cancelOpacity}
                onFocus={onBeginOpacity}
                onBlur={commitOpacity}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelOpacity();
                    return;
                  }
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                    onBeginOpacity();
                  }
                }}
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                    commitOpacity();
                  }
                }}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setPreviewOpacity(value);
                  onPreviewOpacity(value);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="canvas-toolbar-popover-anchor">
          <CanvasIconButton
            label="边框"
            active={openPopover === "border"}
            aria-expanded={openPopover === "border"}
            aria-haspopup="dialog"
            onClick={() => togglePopover("border")}
          >
            <BorderStyleIcon borderStyle={borderStyle} />
          </CanvasIconButton>
          {openPopover === "border" ? (
            <div className="stage-toolbar-popover stage-border-popover" role="dialog" aria-label="分区边框">
              <BorderOption
                borderStyle="none"
                current={borderStyle}
                onSelect={(value) => {
                  onUpdateStyle({ borderStyle: value }, "设置分区边框");
                  setOpenPopover(null);
                }}
              />
              <BorderOption
                borderStyle="solid"
                current={borderStyle}
                onSelect={(value) => {
                  onUpdateStyle({ borderStyle: value }, "设置分区边框");
                  setOpenPopover(null);
                }}
              />
              <BorderOption
                borderStyle="dashed"
                current={borderStyle}
                onSelect={(value) => {
                  onUpdateStyle({ borderStyle: value }, "设置分区边框");
                  setOpenPopover(null);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <span className="selection-toolbar-divider" aria-hidden="true" />

      <div className="selection-toolbar-group is-secondary" role="group" aria-label="分区操作">
        <CanvasIconButton
          label={backgroundVisible ? "隐藏背景" : "显示背景"}
          active={backgroundVisible}
          pressed={backgroundVisible}
          onClick={() => onUpdateStyle({ backgroundVisible: !backgroundVisible }, "切换分区背景")}
        >
          {backgroundVisible ? <PaintBucket size={16} /> : <EyeOff size={16} />}
        </CanvasIconButton>
        <CanvasIconButton
          label={locked ? "解锁分区" : "锁定分区"}
          active={locked}
          pressed={locked}
          onClick={() => onUpdateStyle({ locked: !locked }, locked ? "解锁分区" : "锁定分区")}
        >
          {locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </CanvasIconButton>
        <CanvasIconButton label="适应内容" disabled={locked || !canFit} onClick={onFit}>
          <Scan size={16} />
        </CanvasIconButton>
        <CanvasIconButton label="恢复默认样式" onClick={onResetStyle}>
          <RotateCcw size={16} />
        </CanvasIconButton>
      </div>
    </div>
  );
}

function BorderOption({
  borderStyle,
  current,
  onSelect
}: {
  borderStyle: StageRegionBorderStyle;
  current: StageRegionBorderStyle;
  onSelect: (value: StageRegionBorderStyle) => void;
}) {
  const labels: Record<StageRegionBorderStyle, string> = {
    none: "无边框",
    solid: "实线边框",
    dashed: "虚线边框"
  };
  return (
    <button
      type="button"
      className={`stage-border-option ${current === borderStyle ? "is-selected" : ""}`}
      aria-label={labels[borderStyle]}
      aria-pressed={current === borderStyle}
      data-tooltip={labels[borderStyle]}
      onClick={() => onSelect(borderStyle)}
    >
      <BorderStyleIcon borderStyle={borderStyle} />
    </button>
  );
}

function BorderStyleIcon({ borderStyle }: { borderStyle: StageRegionBorderStyle }) {
  if (borderStyle === "none") {
    return (
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
        <rect x="3.25" y="4.5" width="13.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.4 16.1 16.6 3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (borderStyle === "dashed") {
    return (
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
        <rect x="3.25" y="4.5" width="13.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="3.25" y="4.5" width="13.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
