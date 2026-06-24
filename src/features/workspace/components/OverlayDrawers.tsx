"use client";

import { useState } from "react";
import { X } from "lucide-react";

import type { DeliveryReference, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { DrawerMode } from "./LeftRail";
import { getObjectTypeLabel } from "../workspaceUi";

type OverlayDrawersProps = {
  mode: DrawerMode;
  workspace: MorphoWorkspace;
  onClose: () => void;
  onFocusArea: (area: "research" | "definition" | "visual" | "delivery" | "overview") => void;
  onRestoreObject: (objectId: string) => void;
};

const mapItems = [
  { label: "输入与调研", area: "research" as const },
  { label: "设计定义", area: "definition" as const },
  { label: "方向与视觉发展", area: "visual" as const },
  { label: "交付准备", area: "delivery" as const }
];

export function OverlayDrawers({ mode, workspace, onClose, onFocusArea, onRestoreObject }: OverlayDrawersProps) {
  const [query, setQuery] = useState("暖光");

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
      (object) => object.visibility === "active" && (object.type === "image" || object.type === "file")
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
    const hiddenObjects = Object.values(workspace.objects).filter((object) => object.visibility === "hidden");

    return (
      <Drawer title="已隐藏内容" onClose={onClose}>
        <p className="drawer-muted">隐藏内容没有被删除，也不会作为 AI 默认输入。恢复后才会重新出现在画布中。</p>
        {hiddenObjects.length > 0 ? (
          <ObjectRows objects={hiddenObjects} onObjectAction={onRestoreObject} actionLabel="恢复并定位" />
        ) : (
          <p className="drawer-muted">当前没有隐藏对象。</p>
        )}
      </Drawer>
    );
  }

  if (mode === "search") {
    const objectResults = searchObjects(Object.values(workspace.objects), query);
    const deliveryReferenceResults = searchDeliveryReferences(Object.values(workspace.deliveryReferences), query);

    return (
      <section className="search-layer" aria-label="项目内搜索">
        <div className="search-head">
          <div>
            <div className="search-title">项目内搜索</div>
            <div className="drawer-muted">搜索画布对象、隐藏对象和交付引用快照</div>
          </div>
          <button className="icon-button" type="button" aria-label="关闭搜索" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <input
          className="search-input"
          value={query}
          aria-label="搜索关键词"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="search-results">
          <div className="result-group-title">画布内容</div>
          <ObjectRows objects={objectResults.slice(0, 6)} rowClassName="result-row" />
          <div className="result-group-title">交付引用</div>
          <DeliveryReferenceRows references={deliveryReferenceResults.slice(0, 5)} />
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

function ObjectRows({
  objects,
  rowClassName = "asset-row",
  onObjectAction,
  actionLabel
}: {
  objects: MorphoObject[];
  rowClassName?: string;
  onObjectAction?: (objectId: string) => void;
  actionLabel?: string;
}) {
  return (
    <div className="asset-list">
      {objects.map((object) => (
        <div className={rowClassName} key={object.id}>
          <div className="asset-thumb" />
          <div>
            <strong>{object.title}</strong>
            <span>
              {getObjectTypeLabel(object)}
              {object.visibility === "hidden" ? " · 已隐藏" : ""} · 定位 / 查看来源 / 查看用于哪里
            </span>
            {onObjectAction ? (
              <button className="plain-button" type="button" onClick={() => onObjectAction(object.id)}>
                {actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DeliveryReferenceRows({ references }: { references: DeliveryReference[] }) {
  if (references.length === 0) {
    return <p className="drawer-muted">没有匹配的交付引用。</p>;
  }

  return (
    <div className="asset-list">
      {references.map((reference) => (
        <div className="result-row" key={reference.id}>
          <div className="asset-thumb" />
          <div>
            <strong>{reference.snapshot.title}</strong>
            <span>{reference.snapshot.caption ?? reference.snapshot.summary ?? "交付引用快照"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function searchObjects(objects: MorphoObject[], query: string): MorphoObject[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return objects.slice(0, 8);
  }

  return objects.filter((object) =>
    [object.title, object.summary, object.type, object.visibility, getObjectTypeLabel(object)]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

function searchDeliveryReferences(references: DeliveryReference[], query: string): DeliveryReference[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return references;
  }

  return references.filter((reference) =>
    [
      reference.snapshot.title,
      reference.snapshot.summary ?? "",
      reference.snapshot.caption ?? "",
      reference.snapshot.sourceType
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}
