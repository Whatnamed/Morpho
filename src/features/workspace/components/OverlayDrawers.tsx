"use client";

import { useState } from "react";
import { X } from "lucide-react";

import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { ContinuitySourceRef, ProjectFocusArea, ProjectMemoryViewKey, StageRecordKey } from "@/domain/morpho/types";
import { deriveProjectMemoryViews, getContinuityRecordGroups } from "@/domain/morpho/projectContinuity";
import { getWorkspaceAssetItems, searchWorkspace, type WorkspaceAssetItem } from "@/domain/morpho/queries";
import type { DrawerMode } from "./LeftRail";
import { getObjectTypeLabel } from "../workspaceUi";

type OverlayDrawersProps = {
  mode: DrawerMode;
  workspace: MorphoWorkspace;
  onClose: () => void;
  onFocusArea: (area: "research" | "definition" | "visual" | "delivery" | "overview") => void;
  onRestoreObject: (objectId: string) => void;
  onLocateObject: (objectId: string) => void;
};

const mapItems = [
  { label: "输入与调研", area: "research" as const },
  { label: "设计定义", area: "definition" as const },
  { label: "方向与视觉发展", area: "visual" as const },
  { label: "交付准备", area: "delivery" as const }
];

export function OverlayDrawers({ mode, workspace, onClose, onFocusArea, onRestoreObject, onLocateObject }: OverlayDrawersProps) {
  const [query, setQuery] = useState("暖光");
  const [assetFilter, setAssetFilter] = useState("全部");

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
    const assets = getWorkspaceAssetItems(workspace).filter((item) => matchesAssetFilter(item, assetFilter));

    return (
      <Drawer title="资产" onClose={onClose}>
        <p className="drawer-muted">只显示原始资料、文件与 AI 生成图片；方向、结论和设计定义仍留在画布中。</p>
        <div className="drawer-filter-row" aria-label="资产筛选">
          {["全部", "原始资料", "生成结果", "文档", "已用于交付"].map((filter, index) => (
            <button
              className={`filter-chip ${assetFilter === filter || (index === 0 && assetFilter === "") ? "active" : ""}`}
              type="button"
              key={filter}
              onClick={() => setAssetFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <AssetRows items={assets.slice(0, 10)} onLocateObject={onLocateObject} />
      </Drawer>
    );
  }

  if (mode === "records") {
    return <ProjectRecordDrawer workspace={workspace} onClose={onClose} onLocateObject={onLocateObject} />;
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
    const searchResults = searchWorkspace(workspace, query);
    const objectResults = searchResults.filter((result) => result.kind === "object");
    const deliveryReferenceResults = searchResults.filter((result) => result.kind === "deliveryReference");

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
          <SearchRows results={objectResults.slice(0, 8)} onLocateObject={onLocateObject} />
          <div className="result-group-title">交付引用</div>
          <SearchRows results={deliveryReferenceResults.slice(0, 5)} onLocateObject={onLocateObject} />
        </div>
      </section>
    );
  }

  return null;
}

function ProjectRecordDrawer({
  workspace,
  onClose,
  onLocateObject
}: {
  workspace: MorphoWorkspace;
  onClose: () => void;
  onLocateObject: (objectId: string) => void;
}) {
  const groups = getContinuityRecordGroups(workspace);
  const memoryViews = deriveProjectMemoryViews(workspace);
  const reviewItems = workspace.projectContinuity.recordEntries
    .filter((entry) => entry.validity === "reviewRequired" || entry.validity === "sourceUnavailable")
    .slice(-6)
    .reverse();
  const stages: StageRecordKey[] = [
    "startAndInput",
    "exploration",
    "research",
    "designDefinition",
    "directionAndVisual",
    "deliveryPreparation"
  ];
  const memoryKeys: ProjectMemoryViewKey[] = [
    "projectOverview",
    "designDefinition",
    "preferencesAndAvoids",
    "decisionLog",
    "rejectedDirections",
    "openQuestions",
    "deliveryPlan"
  ];

  return (
    <Drawer title="项目记录" onClose={onClose}>
      <section className="asset-list" aria-label="当前工作重点">
        <div className="result-row">
          <div className="asset-thumb" />
          <div>
            <strong>{focusAreaLabel(workspace.projectContinuity.currentFocus.area)}</strong>
            <span>
              {workspace.projectContinuity.currentFocus.note} · {formatDrawerDate(workspace.projectContinuity.currentFocus.updatedAt)}
            </span>
            <SourceRefs refs={focusSourceRefs(workspace)} onLocateObject={onLocateObject} />
          </div>
        </div>
      </section>

      <div className="result-group-title">待复核项</div>
      {reviewItems.length > 0 ? (
        <ContinuityEntryRows entries={reviewItems} onLocateObject={onLocateObject} />
      ) : (
        <p className="drawer-muted">当前没有待复核或来源不可用的连续性记录。</p>
      )}

      <div className="result-group-title">阶段记录</div>
      {stages.map((stage) => (
        <section className="asset-list" key={stage} aria-label={groups[stage].title}>
          <div className="drawer-muted">{groups[stage].title}</div>
          {groups[stage].entries.length > 0 ? (
            <ContinuityEntryRows entries={groups[stage].entries.slice(0, 4)} onLocateObject={onLocateObject} />
          ) : (
            <p className="drawer-muted">{groups[stage].emptyMessage}</p>
          )}
        </section>
      ))}

      <div className="result-group-title">项目记忆投影</div>
      {memoryKeys.map((key) => {
        const view = memoryViews[key];
        return (
          <section className="asset-list" key={key} aria-label={view.title}>
            <div className="drawer-muted">{view.title}</div>
            {view.items.length > 0 ? (
              view.items.slice(0, 4).map((item) => (
                <div className="result-row" key={item.id}>
                  <div className="asset-thumb" />
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {validityLabel(item.validity, item.sourceRefs)} · {item.summary}
                    </span>
                    <SourceRefs refs={item.sourceRefs} onLocateObject={onLocateObject} />
                  </div>
                </div>
              ))
            ) : (
              <p className="drawer-muted">{view.emptyMessage}</p>
            )}
          </section>
        );
      })}
    </Drawer>
  );
}

function ContinuityEntryRows({
  entries,
  onLocateObject
}: {
  entries: ReturnType<typeof getContinuityRecordGroups>[StageRecordKey]["entries"];
  onLocateObject: (objectId: string) => void;
}) {
  return (
    <div className="asset-list">
      {entries.map((entry) => (
        <div className="result-row" key={entry.id}>
          <div className="asset-thumb" />
          <div>
            <strong>
              {stageLabel(entry.stage)} · {categoryLabel(entry.category)}
            </strong>
            <span>
              {validityLabel(entry.validity, entry.sourceRefs)} · {entry.summary}
            </span>
            <SourceRefs refs={entry.sourceRefs} onLocateObject={onLocateObject} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceRefs({ refs, onLocateObject }: { refs: ContinuitySourceRef[]; onLocateObject: (objectId: string) => void }) {
  if (refs.length === 0) {
    return null;
  }

  return (
    <div className="drawer-filter-row" aria-label="来源">
      {refs.slice(0, 6).map((ref) =>
        ref.kind === "object" ? (
          <button className="filter-chip" type="button" key={`${ref.kind}-${ref.id}`} onClick={() => onLocateObject(ref.id)}>
            来源：{ref.snapshot?.title ?? ref.id}
          </button>
        ) : (
          <span className="filter-chip" key={`${ref.kind}-${ref.id}`}>
            {sourceKindLabel(ref.kind)}：{ref.snapshot?.title ?? ref.id}
          </span>
        )
      )}
    </div>
  );
}

function focusSourceRefs(workspace: MorphoWorkspace): ContinuitySourceRef[] {
  return workspace.projectContinuity.currentFocus.sourceObjectIds
    .map((objectId): ContinuitySourceRef | undefined => {
      const object = workspace.objects[objectId];
      return object
        ? ({
            kind: "object",
            id: object.id,
            snapshot: {
              title: object.title,
              objectType: object.type,
              visibility: object.visibility,
              summarySnippet: object.summary
            }
          } satisfies ContinuitySourceRef)
        : undefined;
    })
    .filter(isContinuitySourceRef);
}

function isContinuitySourceRef(ref: ContinuitySourceRef | undefined): ref is ContinuitySourceRef {
  return Boolean(ref);
}

function AssetRows({
  items,
  onLocateObject
}: {
  items: WorkspaceAssetItem[];
  onLocateObject: (objectId: string) => void;
}) {
  if (items.length === 0) {
    return <p className="drawer-muted">当前没有符合筛选的资产。</p>;
  }

  return (
    <div className="asset-list">
      {items.map((item) => {
        const firstObject = item.objects[0];
        return (
          <div className="asset-row" key={item.asset.id}>
            <div className="asset-thumb" />
            <div>
              <strong>{item.asset.fileName}</strong>
              <span>
                {assetSourceLabel(item.asset.sourceType)} · {item.asset.mimeType}
                {item.usedInDeliveryReferenceIds.length > 0 ? " · 已用于交付" : ""} · 定位已有画布实例 / 拖入可创建新实例
              </span>
              {firstObject ? (
                <button className="plain-button" type="button" onClick={() => onLocateObject(firstObject.id)}>
                  定位
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
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

function SearchRows({
  results,
  onLocateObject
}: {
  results: ReturnType<typeof searchWorkspace>;
  onLocateObject: (objectId: string) => void;
}) {
  if (results.length === 0) {
    return <p className="drawer-muted">没有匹配结果。</p>;
  }

  return (
    <div className="asset-list">
      {results.map((result) => (
        <div className="result-row" key={result.kind === "object" ? result.objectId : result.referenceId}>
          <div className="asset-thumb" />
          <div>
            <strong>{result.title}</strong>
            <span>
              {result.summary}
              {result.hidden ? " · 已隐藏" : ""} · 查看来源 / 查看版本 / 查看用于哪里
            </span>
            {result.kind === "object" ? (
              <button className="plain-button" type="button" onClick={() => onLocateObject(result.objectId)}>
                定位
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function focusAreaLabel(area: ProjectFocusArea): string {
  return stageLabel(area);
}

function stageLabel(stage: StageRecordKey): string {
  switch (stage) {
    case "startAndInput":
      return "开始与输入";
    case "exploration":
      return "探索";
    case "research":
      return "调研";
    case "designDefinition":
      return "设计定义";
    case "directionAndVisual":
      return "方向与视觉";
    case "deliveryPreparation":
      return "交付准备";
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "output":
      return "产出";
    case "decision":
      return "决策";
    case "rejection":
      return "淘汰";
    case "preference":
      return "偏好";
    case "constraint":
      return "约束";
    case "openQuestion":
      return "待确认";
    case "nextFocus":
      return "下一重点";
    default:
      return "系统记录";
  }
}

function validityLabel(validity: string, refs: ContinuitySourceRef[] = []): string {
  const hasHiddenSource = refs.some((ref) => ref.sourceAvailability === "hidden");
  if (hasHiddenSource && validity === "current") {
    return "当前有效 · 来源已隐藏";
  }
  switch (validity) {
    case "current":
      return "当前有效";
    case "reviewRequired":
      return "待复核";
    case "superseded":
      return "已被更新替代";
    case "sourceUnavailable":
      return "来源不可用";
    default:
      return validity;
  }
}

function sourceKindLabel(kind: ContinuitySourceRef["kind"]): string {
  switch (kind) {
    case "revision":
      return "版本";
    case "operation":
      return "任务";
    case "branch":
      return "视觉分支";
    case "decision":
      return "决策";
    case "citation":
      return "来源引用";
    case "deliveryReference":
      return "交付引用";
    default:
      return "来源";
  }
}

function formatDrawerDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function matchesAssetFilter(item: WorkspaceAssetItem, filter: string): boolean {
  if (filter === "全部" || filter === "") {
    return true;
  }

  if (filter === "原始资料") {
    return item.asset.sourceType === "originalImage" || item.asset.sourceType === "originalFile" || item.asset.sourceType === "originalLink";
  }

  if (filter === "生成结果") {
    return item.asset.sourceType === "aiGeneratedImage";
  }

  if (filter === "文档") {
    return item.asset.sourceType === "originalFile" || item.asset.sourceType === "documentExtract";
  }

  return item.usedInDeliveryReferenceIds.length > 0;
}

function assetSourceLabel(sourceType: WorkspaceAssetItem["asset"]["sourceType"]): string {
  switch (sourceType) {
    case "originalImage":
      return "原始图片";
    case "originalFile":
      return "原始文件";
    case "originalLink":
      return "原始链接";
    case "aiGeneratedImage":
      return "生成图片";
    case "documentExtract":
      return "文档提取";
  }
}
