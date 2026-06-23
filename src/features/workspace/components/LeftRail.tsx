"use client";

import { Boxes, EyeOff, FolderSearch, Map, Plus, Search } from "lucide-react";

export type DrawerMode = "map" | "assets" | "hidden" | "search" | null;

type LeftRailProps = {
  activeDrawer: DrawerMode;
  onDrawerChange: (drawer: DrawerMode) => void;
};

export function LeftRail({ activeDrawer, onDrawerChange }: LeftRailProps) {
  const toggle = (drawer: Exclude<DrawerMode, null>) => {
    onDrawerChange(activeDrawer === drawer ? null : drawer);
  };

  return (
    <aside className="left-rail" aria-label="工作台导航">
      <button className="rail-button create" type="button" aria-label="添加到画布">
        <Plus size={16} />
        <span className="tooltip">添加到画布</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "map" ? "active" : ""}`}
        type="button"
        aria-label="项目地图"
        onClick={() => toggle("map")}
      >
        <Map size={16} />
        <span className="tooltip">项目地图</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "assets" ? "active" : ""}`}
        type="button"
        aria-label="资产"
        onClick={() => toggle("assets")}
      >
        <Boxes size={16} />
        <span className="tooltip">资产</span>
      </button>
      <button
        className={`rail-button ${activeDrawer === "hidden" ? "active" : ""}`}
        type="button"
        aria-label="已隐藏内容"
        onClick={() => toggle("hidden")}
      >
        <EyeOff size={16} />
        <span className="tooltip">已隐藏内容</span>
      </button>
      <div className="rail-separator" />
      <button
        className={`rail-button ${activeDrawer === "search" ? "active" : ""}`}
        type="button"
        aria-label="项目内搜索"
        onClick={() => toggle("search")}
      >
        <Search size={16} />
        <span className="tooltip">项目内搜索</span>
      </button>
      <button className="rail-button" type="button" aria-label="项目入口">
        <FolderSearch size={16} />
        <span className="tooltip">项目入口</span>
      </button>
    </aside>
  );
}
