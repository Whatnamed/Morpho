"use client";

import { Ban, Droplets, EyeOff, LockKeyhole, LockKeyholeOpen, PaintBucket, Palette, RotateCcw, Scan, Square, SquareDashed } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  onFit: () => void;
  onResetStyle: () => void;
};

export function StageRegionToolbar({ region, placement, canFit, onUpdateStyle, onFit, onResetStyle }: StageRegionToolbarProps) {
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const color = getStageRegionColorPreset(region.colorKey ?? "warmSand");
  const borderStyle = region.borderStyle ?? "solid";
  const fillOpacity = region.fillOpacity ?? 16;
  const backgroundVisible = region.backgroundVisible ?? true;
  const locked = region.locked ?? false;

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenPopover(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, { capture: true });
  }, []);

  const togglePopover = (next: Exclude<OpenPopover, null>) => {
    setOpenPopover((current) => (current === next ? null : next));
  };

  return (
    <div
      ref={rootRef}
      className={`stage-region-toolbar selection-toolbar ${placement.placement}`}
      aria-label={`${region.title}分区工具`}
      style={{ left: placement.x, top: placement.y }}
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
                onChange={(event) => onUpdateStyle({ fillOpacity: Number(event.currentTarget.value) }, "调整分区透明度")}
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
    return <Ban size={16} />;
  }
  if (borderStyle === "dashed") {
    return <SquareDashed size={16} />;
  }
  return <Square size={16} />;
}
