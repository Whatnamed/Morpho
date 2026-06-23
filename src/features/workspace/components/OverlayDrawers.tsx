"use client";

import { X } from "lucide-react";

import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { DrawerMode } from "./LeftRail";
import { getObjectTypeLabel } from "../workspaceUi";

type OverlayDrawersProps = {
  mode: DrawerMode;
  workspace: MorphoWorkspace;
  onClose: () => void;
  onFocusArea: (area: "research" | "definition" | "visual" | "delivery" | "overview") => void;
};

const mapItems = [
  { label: "输入与调研", area: "research" as const },
  { label: "设计定义", area: "definition" as const },
  { label: "方向与视觉发展", area: "visual" as const },
  { label: "交付准备", area: "delivery" as const }
];

export function OverlayDrawers({ mode, workspace, onClose, onFocusArea }: OverlayDrawersProps) {
  if (mode === "map") {
    return (
      <section className="project-map" aria-label="项目地图">
        <div className="map-title">项目地图</div>
        <button className="map-item" type="button" onClick={() => onFocusArea("overview")}>
          项目概览 <span>↗</span>
        </button>
        {mapItems.map((item) => (
          <button className="map-item" type="button" key={item.area} onClick={() => onFocusArea(item.area)}>
            {item.label} <span>↗</span>
          </button>
        ))}
        <div className="map-rule" />
        <button className="map-item" type="button" onClick={onClose}>
          收起地图 <span>×</span>
        </button>
      </section>
    );
  }

  if (mode === "assets") {
    const assets = Object.values(workspace.objects).filter(
      (object) => object.type === "image" || object.type === "file"
    );

    return (
      <Drawer title="资产" onClose={onClose}>
        <p className="drawer-muted">只显示原始资料、文件与 AI 生成图片；方向、结论和设计定义仍留在画布中。</p>
        <div className="drawer-filter-row" aria-label="资产筛选">
          {["全部", "原始资料", "生成结果", "文档", "已用于交付"].map((filter, index) => (
            <button className={`filter-chip ${index === 0 ? "active" : ""}`} type="button" key={filter}>
              {filter}
            </button>
          ))}
        </div>
        <ObjectRows objects={assets.slice(0, 8)} />
      </Drawer>
    );
  }

  if (mode === "hidden") {
    return (
      <Drawer title="已隐藏内容" onClose={onClose}>
        <p className="drawer-muted">隐藏内容没有被删除，也不会作为 AI 默认输入。这里先保留恢复入口的产品边界。</p>
        <div className="asset-list">
          <div className="asset-row">
            <div className="asset-thumb" />
            <div>
              <strong>旧版扶手参考</strong>
              <span>已隐藏 · 可恢复并定位</span>
            </div>
          </div>
        </div>
      </Drawer>
    );
  }

  if (mode === "search") {
    const results = Object.values(workspace.objects).filter((object) =>
      `${object.title} ${object.summary}`.includes("暖") || `${object.title} ${object.summary}`.includes("柔光")
    );

    return (
      <section className="search-layer" aria-label="项目内搜索">
        <div className="search-head">
          <div>
            <div className="search-title">项目内搜索</div>
            <div className="drawer-muted">示例关键词：暖光</div>
          </div>
          <button className="icon-button" type="button" aria-label="关闭搜索" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <input className="search-input" defaultValue="暖光" aria-label="搜索关键词" />
        <div className="search-results">
          <div className="result-group-title">画布内容</div>
          <ObjectRows objects={results.slice(0, 4)} rowClassName="result-row" />
          <div className="result-group-title">交付引用</div>
          <ObjectRows objects={Object.values(workspace.objects).filter((object) => object.type === "delivery")} rowClassName="result-row" />
        </div>
      </section>
    );
  }

  return null;
}

function Drawer({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <section className="side-drawer" aria-label={title}>
      <div className="drawer-head">
        <div className="drawer-title">{title}</div>
        <button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {children}
    </section>
  );
}

function ObjectRows({ objects, rowClassName = "asset-row" }: { objects: MorphoObject[]; rowClassName?: string }) {
  return (
    <div className="asset-list">
      {objects.map((object) => (
        <div className={rowClassName} key={object.id}>
          <div className="asset-thumb" />
          <div>
            <strong>{object.title}</strong>
            <span>{getObjectTypeLabel(object)} · 定位 / 查看来源 / 查看用于哪里</span>
          </div>
        </div>
      ))}
    </div>
  );
}
