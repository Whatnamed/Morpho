"use client";

import { Boxes, EyeOff, Map, NotebookText, Plus, Search } from "lucide-react";

import type { LeftRailAnchor } from "../leftRailPopoverPlacement";

export type DrawerMode = "map" | "assets" | "hidden" | "search" | "records" | null;

type LeftRailProps = {
  activeDrawer: DrawerMode;
  onDrawerChange: (drawer: DrawerMode, anchor?: LeftRailAnchor) => void;
  onAddToCanvas: () => void;
};

export function LeftRail({ activeDrawer, onDrawerChange, onAddToCanvas }: LeftRailProps) {
  const toggle = (drawer: Exclude<DrawerMode, null>, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    onDrawerChange(
      activeDrawer === drawer ? null : drawer,
      activeDrawer === drawer
        ? undefined
        : {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height
          }
    );
  };

  return (
    <aside className="left-rail" aria-label="工作台导航">
      <button className="rail-button create" type="button" aria-label="添加到画布" title="添加到画布" onClick={onAddToCanvas}>
        <Plus size={16} />
        <span className="tooltip">添加到画布</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "map" ? "active" : ""}`}
        type="button"
        aria-label="项目地图"
        aria-pressed={activeDrawer === "map"}
        title="项目地图"
        onClick={(event) => toggle("map", event.currentTarget)}
      >
        <Map size={16} />
        <span className="tooltip">项目地图</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "assets" ? "active" : ""}`}
        type="button"
        aria-label="资产"
        aria-pressed={activeDrawer === "assets"}
        title="资产"
        onClick={(event) => toggle("assets", event.currentTarget)}
      >
        <Boxes size={16} />
        <span className="tooltip">资产</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "hidden" ? "active" : ""}`}
        type="button"
        aria-label="已隐藏内容"
        aria-pressed={activeDrawer === "hidden"}
        title="已隐藏内容"
        onClick={(event) => toggle("hidden", event.currentTarget)}
      >
        <EyeOff size={16} />
        <span className="tooltip">已隐藏内容</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "records" ? "active" : ""}`}
        type="button"
        aria-label="项目记录"
        aria-pressed={activeDrawer === "records"}
        title="项目记录"
        onClick={(event) => toggle("records", event.currentTarget)}
      >
        <NotebookText size={16} />
        <span className="tooltip">项目记录</span>
      </button>
      <div className="rail-separator" />
      <button
        className={`rail-button ${activeDrawer === "search" ? "active" : ""}`}
        type="button"
        aria-label="项目内搜索"
        aria-pressed={activeDrawer === "search"}
        title="项目内搜索"
        onClick={(event) => toggle("search", event.currentTarget)}
      >
        <Search size={16} />
        <span className="tooltip">项目内搜索</span>
      </button>
    </aside>
  );
}
