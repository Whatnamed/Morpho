"use client";

import { useState } from "react";
import { X } from "lucide-react";

import type { ContinuityManualState, ContinuityRecordEntry, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { ContinuitySourceRef, ProjectFocusArea, StageRecordKey } from "@/domain/morpho/types";
import { getContinuityEntryEligibility, resolveContinuityValidity } from "@/domain/morpho/projectContinuity";
import { getWorkspaceAssetItems, searchWorkspace, type WorkspaceAssetItem } from "@/domain/morpho/queries";
import type { DrawerMode } from "./LeftRail";
import { getObjectTypeLabel } from "../workspaceUi";

type OverlayDrawersProps = {
  mode: DrawerMode;
  workspace: MorphoWorkspace;
  highlightedRecordIds: string[];
  onClose: () => void;
  onFocusArea: (area: "research" | "definition" | "visual" | "delivery" | "overview") => void;
  onRestoreObject: (objectId: string) => void;
  onLocateObject: (objectId: string) => void;
  onSetContinuityEntryManualState: (entryId: string, manualState: ContinuityManualState) => void;
};

const mapItems = [
  { label: "输入与调研", area: "research" as const },
  { label: "设计定义", area: "definition" as const },
  { label: "方向与视觉发展", area: "visual" as const },
  { label: "交付准备", area: "delivery" as const }
];

export function OverlayDrawers({
  mode,
  workspace,
  highlightedRecordIds,
  onClose,
  onFocusArea,
  onRestoreObject,
  onLocateObject,
  onSetContinuityEntryManualState
}: OverlayDrawersProps) {
  const [query, setQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState("全部");
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [showAllObjectResults, setShowAllObjectResults] = useState(false);
  const [showAllDeliveryResults, setShowAllDeliveryResults] = useState(false);

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
    const visibleAssets = showAllAssets ? assets : assets.slice(0, 10);

    return (
      <Drawer title="资产" onClose={onClose}>
        <p className="drawer-muted">只显示原始资料、文件与 AI 生成图片；方向、结论和设计定义仍留在画布中。共 {assets.length} 项。</p>
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
        <AssetRows items={visibleAssets} onLocateObject={onLocateObject} />
        {assets.length > 10 ? (
          <button className="plain-button drawer-more-button" type="button" onClick={() => setShowAllAssets((current) => !current)}>
            {showAllAssets ? "收起" : `显示全部 ${assets.length} 项`}
          </button>
        ) : null}
      </Drawer>
    );
  }

  if (mode === "records") {
    return (
      <ProjectRecordDrawer
        workspace={workspace}
        highlightedRecordIds={highlightedRecordIds}
        onClose={onClose}
        onLocateObject={onLocateObject}
        onSetContinuityEntryManualState={onSetContinuityEntryManualState}
      />
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
    const trimmedQuery = query.trim();
    const searchResults = trimmedQuery ? searchWorkspace(workspace, trimmedQuery) : [];
    const objectResults = searchResults.filter((result) => result.kind === "object");
    const deliveryReferenceResults = searchResults.filter((result) => result.kind === "deliveryReference");
    const visibleObjectResults = showAllObjectResults ? objectResults : objectResults.slice(0, 8);
    const visibleDeliveryReferenceResults = showAllDeliveryResults
      ? deliveryReferenceResults
      : deliveryReferenceResults.slice(0, 5);

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
          {!trimmedQuery ? (
            <p className="drawer-muted">输入关键词后搜索画布对象、隐藏对象和交付引用快照。</p>
          ) : (
            <>
              <div className="result-group-title">画布内容 · {objectResults.length}</div>
              <SearchRows results={visibleObjectResults} onLocateObject={onLocateObject} />
              {objectResults.length > 8 ? (
                <button className="plain-button drawer-more-button" type="button" onClick={() => setShowAllObjectResults((current) => !current)}>
                  {showAllObjectResults ? "收起" : `显示全部 ${objectResults.length} 条`}
                </button>
              ) : null}
              <div className="result-group-title">交付引用 · {deliveryReferenceResults.length}</div>
              <SearchRows results={visibleDeliveryReferenceResults} onLocateObject={onLocateObject} />
              {deliveryReferenceResults.length > 5 ? (
                <button className="plain-button drawer-more-button" type="button" onClick={() => setShowAllDeliveryResults((current) => !current)}>
                  {showAllDeliveryResults ? "收起" : `显示全部 ${deliveryReferenceResults.length} 条`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>
    );
  }

  return null;
}

function ProjectRecordDrawer({
  workspace,
  highlightedRecordIds,
  onClose,
  onLocateObject,
  onSetContinuityEntryManualState
}: {
  workspace: MorphoWorkspace;
  highlightedRecordIds: string[];
  onClose: () => void;
  onLocateObject: (objectId: string) => void;
  onSetContinuityEntryManualState: (entryId: string, manualState: ContinuityManualState) => void;
}) {
  const highlighted = new Set(highlightedRecordIds);
  const resolvedWorkspace = resolveContinuityValidity(workspace);
  const reviewItems = resolvedWorkspace.projectContinuity.recordEntries
    .filter((entry) => getContinuityEntryEligibility(entry).canEnterReviewList)
    .slice(-6)
    .reverse();

  return (
    <Drawer title="项目线索" onClose={onClose}>
      <p className="drawer-muted">这里只显示由用户表达或明确动作保存下来的可复核线索，不暴露内部阶段记录或项目记忆文件。</p>
      <section className="asset-list" aria-label="当前工作线索">
        <div className="result-row">
          <div className="asset-thumb" />
          <div>
            <strong>{focusAreaLabel(workspace.projectContinuity.currentFocus.area)}</strong>
            <span>
              {workspace.projectContinuity.currentFocus.note} · {formatDrawerDate(workspace.projectContinuity.currentFocus.updatedAt)}
            </span>
            <ContinuitySourceRefs refs={focusSourceRefs(workspace)} onLocateObject={onLocateObject} />
          </div>
        </div>
      </section>

      <div className="result-group-title">待复核线索</div>
      {reviewItems.length > 0 ? (
        <ContinuityEntryRows
          entries={reviewItems}
          highlightedRecordIds={highlighted}
          onLocateObject={onLocateObject}
          onSetContinuityEntryManualState={onSetContinuityEntryManualState}
        />
      ) : (
        <p className="drawer-muted">当前没有待复核或来源不可用的项目线索。</p>
      )}

      <div className="result-group-title">近期线索</div>
      {resolvedWorkspace.projectContinuity.recordEntries.length > 0 ? (
        <ContinuityEntryRows
          entries={[...resolvedWorkspace.projectContinuity.recordEntries].slice(-12).reverse()}
          highlightedRecordIds={highlighted}
          onLocateObject={onLocateObject}
          onSetContinuityEntryManualState={onSetContinuityEntryManualState}
        />
      ) : (
        <p className="drawer-muted">当前还没有保存的项目线索。</p>
      )}
    </Drawer>
  );
}

function ContinuityEntryRows({
  entries,
  highlightedRecordIds,
  onLocateObject,
  onSetContinuityEntryManualState
}: {
  entries: ContinuityRecordEntry[];
  onLocateObject: (objectId: string) => void;
  highlightedRecordIds: Set<string>;
  onSetContinuityEntryManualState: (entryId: string, manualState: ContinuityManualState) => void;
}) {
  return (
    <div className="asset-list">
      {entries.map((entry) => {
        const eligibility = getContinuityEntryEligibility(entry);
        return (
          <div className={`result-row ${highlightedRecordIds.has(entry.id) ? "highlighted-record" : ""}`} key={entry.id}>
            <div className="asset-thumb" />
            <div>
              <strong>
                {stageLabel(entry.stage)} · {categoryLabel(entry.category)}
              </strong>
              <span>
                {eligibility.uiLabel} · {entry.summary}
              </span>
              {entry.origin === "conversationSemanticPatch" ? (
                <div className="continuity-meta-row">
                  <span>来自明确对话 · {semanticKindLabel(entry.semanticKind)}</span>
                  <span>状态：{manualStateLabel(entry.manualState)}</span>
                </div>
              ) : null}
              {entry.evidenceQuote ? <blockquote className="continuity-quote">{entry.evidenceQuote}</blockquote> : null}
              <ContinuitySourceRefs refs={entry.sourceRefs} onLocateObject={onLocateObject} />
              {entry.origin === "conversationSemanticPatch" ? (
                <div className="continuity-actions">
                  <button
                    className="plain-button"
                    type="button"
                    disabled={entry.manualState === "notApplicable"}
                    onClick={() => onSetContinuityEntryManualState(entry.id, "notApplicable")}
                  >
                    不再适用
                  </button>
                  <button
                    className="plain-button"
                    type="button"
                    disabled={entry.manualState === "withdrawn"}
                    onClick={() => onSetContinuityEntryManualState(entry.id, "withdrawn")}
                  >
                    撤回记录
                  </button>
                  <button
                    className="plain-button"
                    type="button"
                    disabled={entry.manualState === "active"}
                    onClick={() => onSetContinuityEntryManualState(entry.id, "active")}
                  >
                    恢复为当前有效
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContinuitySourceRefs({
  refs,
  onLocateObject
}: {
  refs: ContinuitySourceRef[];
  onLocateObject: (objectId: string) => void;
}) {
  if (refs.length === 0) {
    return null;
  }

  return (
    <div className="drawer-filter-row" aria-label="来源">
      {refs.slice(0, 6).map((ref) => {
        const label = sourceRefLabel(ref);
        if (ref.kind === "object" && ref.sourceAvailability === "active") {
          return (
            <button className="filter-chip" type="button" key={`${ref.kind}-${ref.id}`} onClick={() => onLocateObject(ref.id)}>
              {label}
            </button>
          );
        }

        return (
          <span className="filter-chip" key={`${ref.kind}-${ref.id}`} title={ref.snapshot?.summarySnippet}>
            {label}
          </span>
        );
      })}
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
            },
            sourceAvailability: object.visibility === "hidden" ? "hidden" : "active"
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
            <div className="asset-kind-mark">{assetSourceShortLabel(item.asset.sourceType)}</div>
            <div className="asset-row-body">
              <div className="row-title-line">
                <strong>{item.asset.fileName}</strong>
                {item.usedInDeliveryReferenceIds.length > 0 ? <span className="row-status-chip">已用于交付</span> : null}
              </div>
              <div className="row-meta">
                <span>{assetSourceLabel(item.asset.sourceType)}</span>
                <span>{formatMimeLabel(item.asset.mimeType)}</span>
                <span>{item.objects.length > 0 ? `${item.objects.length} 个画布实例` : "尚未放入画布"}</span>
              </div>
              <p className="row-note">资产保留为项目材料；定位会跳到已有画布实例。</p>
              {firstObject ? (
                <button className="plain-button row-action" type="button" onClick={() => onLocateObject(firstObject.id)}>
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
          <div className="asset-kind-mark">{objectTypeShortLabel(object)}</div>
          <div className="asset-row-body">
            <div className="row-title-line">
              <strong>{object.title}</strong>
              {object.visibility === "hidden" ? <span className="row-status-chip">已隐藏</span> : null}
            </div>
            <div className="row-meta">
              <span>{getObjectTypeLabel(object)}</span>
              <span>{object.visibility === "hidden" ? "不参与默认 AI 语境" : "画布对象"}</span>
            </div>
            {onObjectAction ? (
              <button className="plain-button row-action" type="button" onClick={() => onObjectAction(object.id)}>
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
          <div className="asset-kind-mark">{result.kind === "object" ? "对象" : "交付"}</div>
          <div className="asset-row-body">
            <div className="row-title-line">
              <strong>{result.title}</strong>
              {result.hidden ? <span className="row-status-chip">已隐藏</span> : null}
            </div>
            <p className="row-note">{result.summary}</p>
            <div className="row-meta">
              <span>{result.kind === "object" ? "画布内容" : "交付引用快照"}</span>
              {result.hidden ? <span>恢复后可回到画布</span> : null}
            </div>
            {result.kind === "object" ? (
              <button className="plain-button row-action" type="button" onClick={() => onLocateObject(result.objectId)}>
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

function objectTypeShortLabel(object: MorphoObject): string {
  const label = getObjectTypeLabel(object);
  return label.slice(0, 2);
}

function assetSourceShortLabel(sourceType: WorkspaceAssetItem["asset"]["sourceType"]): string {
  switch (sourceType) {
    case "aiGeneratedImage":
      return "AI";
    case "documentExtract":
      return "文本";
    case "originalFile":
      return "文件";
    case "originalLink":
      return "链接";
    case "originalImage":
      return "图片";
  }
}

function formatMimeLabel(mimeType: string): string {
  const [category, subtype] = mimeType.split("/");
  if (!category || !subtype) {
    return mimeType;
  }

  return subtype.toUpperCase();
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
    case "message":
      return "用户表达";
    default:
      return "来源";
  }
}

function sourceRefLabel(ref: ContinuitySourceRef): string {
  const title = ref.snapshot?.title ?? ref.id;
  const prefix = sourceKindLabel(ref.kind);
  if (ref.kind === "message") {
    return `${prefix}：${ref.snapshot?.summarySnippet ?? title}`;
  }
  if (ref.sourceAvailability === "hidden") {
    return `${prefix}：${title} · 来源已隐藏`;
  }
  if (ref.sourceAvailability === "missing") {
    return `${prefix}：${title} · 来源不可用`;
  }
  return `${prefix}：${title}`;
}

function semanticKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "preference":
      return "偏好";
    case "constraint":
      return "约束";
    case "avoidance":
      return "避免项";
    case "openQuestion":
      return "待确认";
    case "decisionReason":
      return "决策理由";
    case "rejectionReason":
      return "淘汰理由";
    default:
      return "语义记录";
  }
}

function manualStateLabel(state: ContinuityManualState): string {
  switch (state) {
    case "active":
      return "当前有效";
    case "notApplicable":
      return "不再适用";
    case "withdrawn":
      return "已撤回";
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
