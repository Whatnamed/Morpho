"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { ContinuityManualState, ContinuityRecordEntry, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type {
  ContinuitySourceRef,
  ProjectFocusArea,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import { getContinuityEntryEligibility, resolveContinuityValidity } from "@/domain/morpho/projectContinuity";
import {
  classifyDecisionRecords,
  decisionKindLabel,
  decisionStateLabel,
  type ClassifiedDecisionRecord
} from "@/domain/morpho/decisionRecords";
import {
  getCurrentProjectMemoryRevision,
  getCurrentStageRecordRevision,
  getProjectMemoryHistory,
  getStageRecordHistory,
  reconcileProjectMemory
} from "@/domain/morpho/projectMemory";
import {
  getWorkspaceAssetItems,
  searchWorkspace,
  type WorkspaceAssetItem,
  type WorkspaceSearchObjectSource
} from "@/domain/morpho/queries";
import type { DrawerMode } from "./LeftRail";
import { getKeyConclusionCategoryLabel, getObjectTypeLabel } from "../workspaceUi";
import {
  getLeftRailPopoverPosition,
  type LeftRailAnchor,
  type LeftRailPopoverPosition
} from "../leftRailPopoverPlacement";

type OverlayDrawersProps = {
  mode: DrawerMode;
  workspace: MorphoWorkspace;
  highlightedRecordIds: string[];
  onClose: () => void;
  onFocusArea: (area: "research" | "definition" | "visual" | "delivery" | "overview") => void;
  onRestoreObject: (objectId: string) => void;
  onLocateObject: (objectId: string) => void;
  onSetContinuityEntryManualState: (entryId: string, manualState: ContinuityManualState) => void;
  anchor?: LeftRailAnchor | null;
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
  onSetContinuityEntryManualState,
  anchor = null
}: OverlayDrawersProps) {
  const [query, setQuery] = useState("");
  const [assetFilter, setAssetFilter] = useState("全部");
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [showAllObjectResults, setShowAllObjectResults] = useState(false);
  const [showAllDeliveryResults, setShowAllDeliveryResults] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const [panelPosition, setPanelPosition] = useState<LeftRailPopoverPosition | null>(null);
  const updatePanelPosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const next = getLeftRailPopoverPosition({
      anchor,
      panel: { width: panel.offsetWidth, height: panel.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    });
    setPanelPosition((current) => (current?.top === next.top && current.left === next.left ? current : next));
  }, [anchor]);

  useLayoutEffect(() => {
    updatePanelPosition();
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const observer = new ResizeObserver(updatePanelPosition);
    observer.observe(panel);
    window.addEventListener("resize", updatePanelPosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [mode, updatePanelPosition]);

  const anchoredStyle = panelPosition
    ? { top: panelPosition.top, left: panelPosition.left, right: "auto", bottom: "auto" }
    : { top: 84, left: 84, right: "auto", bottom: "auto" };

  if (mode === "map") {
    return (
      <section ref={panelRef} className="project-map" aria-label="项目地图" style={anchoredStyle}>
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
      <Drawer title="资产" onClose={onClose} panelRef={panelRef} style={anchoredStyle}>
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
        panelRef={panelRef}
        style={anchoredStyle}
      />
    );
  }

  if (mode === "hidden") {
    const hiddenObjects = Object.values(workspace.objects).filter((object) => object.visibility === "hidden");

    return (
      <Drawer title="已隐藏内容" onClose={onClose} panelRef={panelRef} style={anchoredStyle}>
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
  onSetContinuityEntryManualState,
  panelRef,
  style
}: {
  workspace: MorphoWorkspace;
  highlightedRecordIds: string[];
  onClose: () => void;
  onLocateObject: (objectId: string) => void;
  onSetContinuityEntryManualState: (entryId: string, manualState: ContinuityManualState) => void;
  panelRef: React.RefObject<HTMLElement | null>;
  style: React.CSSProperties;
}) {
  const [activeTab, setActiveTab] = useState<"memory" | "stages" | "history">("memory");
  const highlighted = new Set(highlightedRecordIds);
  const resolvedWorkspace = reconcileProjectMemory(resolveContinuityValidity(workspace));
  const reviewItems = resolvedWorkspace.projectContinuity.recordEntries
    .filter((entry) => getContinuityEntryEligibility(entry).canEnterReviewList)
    .slice(-6)
    .reverse();
  const historicalDecisions = classifyDecisionRecords(resolvedWorkspace)
    .filter((item) => item.state !== "current")
    .slice(-12)
    .reverse();

  return (
    <Drawer title="项目记录" onClose={onClose} panelRef={panelRef} style={style}>
      <div className="drawer-filter-row" role="tablist" aria-label="项目记录视图">
        {([
          ["memory", "当前项目记忆"],
          ["stages", "阶段记录"],
          ["history", "历史与来源"]
        ] as const).map(([value, label]) => (
          <button
            className={`filter-chip ${activeTab === value ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            key={value}
            onClick={() => setActiveTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "memory" ? (
        <CurrentProjectMemory workspace={resolvedWorkspace} onLocateObject={onLocateObject} />
      ) : null}
      {activeTab === "stages" ? (
        <CurrentStageRecords workspace={resolvedWorkspace} onLocateObject={onLocateObject} />
      ) : null}
      {activeTab === "history" ? (
        <>
          <div className="result-group-title">当前工作重点</div>
          <section className="continuity-record continuity-record-focus" aria-label="当前工作重点">
            <div className="continuity-record-kicker">
              <span>{focusAreaLabel(workspace.projectContinuity.currentFocus.area)}</span>
              <span className="continuity-record-time">{formatDrawerDate(workspace.projectContinuity.currentFocus.updatedAt)}</span>
            </div>
            <p className="continuity-record-summary">{workspace.projectContinuity.currentFocus.note}</p>
            <ContinuitySourceRefs refs={focusSourceRefs(workspace)} onLocateObject={onLocateObject} />
          </section>

          <div className="result-group-title">待复核</div>
          {reviewItems.length > 0 ? (
            <ContinuityEntryRows
              entries={reviewItems}
              highlightedRecordIds={highlighted}
              onLocateObject={onLocateObject}
              onSetContinuityEntryManualState={onSetContinuityEntryManualState}
            />
          ) : (
            <p className="drawer-muted">当前没有待复核或来源不可用的记录。</p>
          )}

          <div className="result-group-title">历史决定</div>
          {historicalDecisions.length > 0 ? (
            <DecisionHistoryRows
              items={historicalDecisions}
              workspace={resolvedWorkspace}
              onLocateObject={onLocateObject}
            />
          ) : (
            <p className="drawer-muted">当前没有已替代或待复核的决定。</p>
          )}

          <div className="result-group-title">近期记录</div>
          {resolvedWorkspace.projectContinuity.recordEntries.length > 0 ? (
            <ContinuityEntryRows
              entries={[...resolvedWorkspace.projectContinuity.recordEntries].slice(-12).reverse()}
              highlightedRecordIds={highlighted}
              onLocateObject={onLocateObject}
              onSetContinuityEntryManualState={onSetContinuityEntryManualState}
            />
          ) : (
            <p className="drawer-muted">当前还没有保存的项目记录。</p>
          )}
        </>
      ) : null}
    </Drawer>
  );
}

function DecisionHistoryRows({
  items,
  workspace,
  onLocateObject
}: {
  items: ClassifiedDecisionRecord[];
  workspace: MorphoWorkspace;
  onLocateObject: (objectId: string) => void;
}) {
  return (
    <div className="continuity-record-list">
      {items.map(({ record, state, reason }) => (
        <article className="continuity-record" key={record.id}>
          <div className="continuity-record-kicker">
            <span>{decisionKindLabel(record.kind)}</span>
            <span className="continuity-record-status">{decisionStateLabel(state)}</span>
            <span className="continuity-record-time">{formatDrawerDate(record.createdAt)}</span>
          </div>
          <p className="continuity-record-summary">{record.summary}</p>
          {record.reason ? <p className="drawer-muted">原因：{record.reason}</p> : null}
          {reason ? <p className="drawer-muted">当前状态：{reason}</p> : null}
          <ContinuitySourceRefs refs={decisionSourceRefs(record, workspace)} onLocateObject={onLocateObject} />
        </article>
      ))}
    </div>
  );
}

function decisionSourceRefs(
  record: ClassifiedDecisionRecord["record"],
  workspace: MorphoWorkspace
): ContinuitySourceRef[] {
  const objectIds = [...new Set([record.objectSnapshot?.id, ...record.relatedObjectIds].filter((id): id is string => Boolean(id)))];
  return [
    {
      kind: "decision",
      id: record.id,
      snapshot: { title: record.summary, status: record.kind },
      sourceAvailability: "active"
    },
    ...objectIds.map((objectId) => {
      const object = workspace.objects[objectId];
      return {
        kind: "object" as const,
        id: objectId,
        snapshot: { title: object?.title ?? record.objectSnapshot?.title ?? objectId, objectType: object?.type },
        sourceAvailability: object ? (object.visibility === "hidden" ? "hidden" : "active") : "missing"
      } satisfies ContinuitySourceRef;
    })
  ];
}

const PROJECT_MEMORY_KEYS: ProjectMemoryKey[] = [
  "projectOverview",
  "designBrief",
  "userPreferences",
  "decisionLog",
  "rejectedDirections",
  "openQuestions",
  "outputPlan"
];

const STAGE_RECORD_KEYS: StageRecordKey[] = [
  "startAndInput",
  "exploration",
  "research",
  "designDefinition",
  "directionAndVisual",
  "deliveryPreparation"
];

function CurrentProjectMemory({
  workspace,
  onLocateObject
}: {
  workspace: MorphoWorkspace;
  onLocateObject: (objectId: string) => void;
}) {
  return (
    <div className="continuity-record-list" role="tabpanel">
      {PROJECT_MEMORY_KEYS.map((key) => {
        const document = workspace.projectMemory.documents[key];
        const revision = getCurrentProjectMemoryRevision(workspace.projectMemory, key);
        const historyCount = getProjectMemoryHistory(workspace.projectMemory, key).length;
        return (
          <article className="continuity-record" key={key}>
            <div className="continuity-record-kicker">
              <span>{document.title}</span>
              {revision?.reviewRequired ? <span className="continuity-record-status">待复核</span> : null}
              <span className="continuity-record-time">{revision ? formatDrawerDate(revision.createdAt) : "尚未形成"}</span>
            </div>
            {revision ? (
              <>
                {revision.sections.map((section) => (
                  <section key={section.key}>
                    <div className="result-group-title">{section.title}</div>
                    {section.items.map((item) => <p className="continuity-record-summary" key={item}>{item}</p>)}
                  </section>
                ))}
                <ContinuitySourceRefs refs={revision.sourceRefs} onLocateObject={onLocateObject} />
                {historyCount > 1 ? <p className="drawer-muted">已有 {historyCount} 个可追溯修订</p> : null}
              </>
            ) : (
              <p className="drawer-muted">当前没有有效内容。</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function CurrentStageRecords({
  workspace,
  onLocateObject
}: {
  workspace: MorphoWorkspace;
  onLocateObject: (objectId: string) => void;
}) {
  const records = STAGE_RECORD_KEYS.map((stage) => ({
    stage,
    revision: getCurrentStageRecordRevision(workspace.projectMemory, stage),
    historyCount: getStageRecordHistory(workspace.projectMemory, stage).length
  })).filter((record) => Boolean(record.revision));

  if (records.length === 0) {
    return <p className="drawer-muted" role="tabpanel">当前还没有已发生阶段的有效记录。</p>;
  }
  return (
    <div className="continuity-record-list" role="tabpanel">
      {records.map(({ stage, revision, historyCount }) => (
        <article className="continuity-record" key={stage}>
          <div className="continuity-record-kicker">
            <span>{stageLabel(stage)}</span>
            {revision?.reviewRequired ? <span className="continuity-record-status">待复核</span> : null}
            <span className="continuity-record-time">{revision ? formatDrawerDate(revision.createdAt) : ""}</span>
          </div>
          {revision
            ? Object.entries(revision.sections).map(([section, items]) => (
                <section key={section}>
                  <div className="result-group-title">{stageSectionLabel(section)}</div>
                  {items?.map((item) => <p className="continuity-record-summary" key={item}>{item}</p>)}
                </section>
              ))
            : null}
          {revision ? <ContinuitySourceRefs refs={revision.sourceRefs} onLocateObject={onLocateObject} /> : null}
          {historyCount > 1 ? <p className="drawer-muted">已有 {historyCount} 个可追溯修订</p> : null}
        </article>
      ))}
    </div>
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
    <div className="continuity-record-list">
      {entries.map((entry) => {
        const eligibility = getContinuityEntryEligibility(entry);
        return (
          <article
            className={`continuity-record ${highlightedRecordIds.has(entry.id) ? "highlighted-record" : ""}`}
            key={entry.id}
          >
            <div className="continuity-record-kicker">
              <span>{stageLabel(entry.stage)}</span>
              <span>{categoryLabel(entry.category)}</span>
              {eligibility.uiLabel ? <span className="continuity-record-status">{eligibility.uiLabel}</span> : null}
              <span className="continuity-record-time">{formatDrawerDate(entry.updatedAt || entry.createdAt)}</span>
            </div>
            <p className="continuity-record-summary">{entry.summary}</p>
            {entry.origin === "conversationSemanticPatch" ? (
              <div className="continuity-meta-row">
                <span>对话 · {semanticKindLabel(entry.semanticKind)}</span>
                <span>{manualStateLabel(entry.manualState)}</span>
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
          </article>
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

  const visibleRefs = refs.slice(0, 3);
  const hiddenCount = Math.max(0, refs.length - visibleRefs.length);

  return (
    <ul className="continuity-source-list" aria-label="来源">
      {visibleRefs.map((ref) => {
        const fullLabel = sourceRefLabel(ref);
        if (ref.kind === "object" && ref.sourceAvailability === "active") {
          return (
            <li key={`${ref.kind}-${ref.id}`}>
              <button
                className="continuity-source-item is-action"
                type="button"
                title={fullLabel}
                onClick={() => onLocateObject(ref.id)}
              >
                <span className="continuity-source-kind">{sourceKindLabel(ref.kind)}</span>
                <span className="continuity-source-text">{sourceRefDisplayTitle(ref)}</span>
              </button>
            </li>
          );
        }

        return (
          <li key={`${ref.kind}-${ref.id}`}>
            <span className="continuity-source-item" title={ref.snapshot?.summarySnippet ?? fullLabel}>
              <span className="continuity-source-kind">{sourceKindLabel(ref.kind)}</span>
              <span className="continuity-source-text">{sourceRefDisplayTitle(ref)}</span>
              {sourceAvailabilitySuffix(ref) ? (
                <span className="continuity-source-flag">{sourceAvailabilitySuffix(ref)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
      {hiddenCount > 0 ? (
        <li className="continuity-source-more">另有 {hiddenCount} 项来源</li>
      ) : null}
    </ul>
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

function Drawer({
  title,
  children,
  onClose,
  panelRef,
  style
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
  style: React.CSSProperties;
}) {
  return (
    <section ref={panelRef} className="side-drawer" aria-label={title} style={style}>
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
              <span>{object.type === "keyConclusion" ? getKeyConclusionCategoryLabel(object.category) : getObjectTypeLabel(object)}</span>
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
      {results.map((result) => {
        const source = result.kind === "object" ? result.source : undefined;
        return (
          <div className="result-row" key={result.kind === "object" ? result.objectId : result.referenceId}>
            <div className="asset-kind-mark">{result.kind === "object" ? "对象" : "交付"}</div>
            <div className="asset-row-body">
              <div className="row-title-line">
                <strong>{result.title}</strong>
                {result.hidden ? <span className="row-status-chip">已隐藏</span> : null}
              </div>
              <p className="row-note">{result.summary}</p>
              <div className="row-meta">
                <span>
                  {result.kind === "object"
                    ? result.category
                      ? getKeyConclusionCategoryLabel(result.category)
                      : "画布内容"
                    : "交付引用快照"}
                </span>
                {source ? <span>{searchSourceLabel(source)}</span> : null}
                {result.hidden ? <span>恢复后可回到画布</span> : null}
              </div>
              {result.kind === "object" ? (
                <div className="row-action-line">
                  <button className="plain-button row-action" type="button" onClick={() => onLocateObject(result.objectId)}>
                    定位
                  </button>
                  {source && source.status === "active" ? (
                    <button
                      className="plain-button row-action"
                      type="button"
                      onClick={() => onLocateObject(source.fileObjectId)}
                    >
                      定位来源文档
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function searchSourceLabel(source: WorkspaceSearchObjectSource): string {
  const name = source.fileName ? ` · ${source.fileName}` : "";
  const state = source.status === "hidden" ? "（来源已隐藏）" : source.status === "missing" ? "（来源已不可用）" : "";
  return `来源：${source.fileTitle}${name}${state}`;
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

function stageSectionLabel(section: string): string {
  switch (section) {
    case "goalAndStatus":
      return "目标与状态";
    case "outputs":
      return "产出";
    case "decisions":
      return "决定";
    case "rejected":
      return "淘汰与不采用";
    case "preferences":
      return "偏好";
    case "constraints":
      return "约束";
    case "openRisks":
      return "开放问题与风险";
    case "nextFocus":
      return "下一重点";
    default:
      return section;
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
    case "object":
      return "对象";
    case "revision":
      return "版本";
    case "operation":
      return "任务";
    case "branch":
      return "分支";
    case "decision":
      return "决策";
    case "citation":
      return "引用";
    case "deliveryReference":
      return "交付";
    case "message":
      return "表达";
    default:
      return "来源";
  }
}

function sourceRefDisplayTitle(ref: ContinuitySourceRef): string {
  if (ref.kind === "message") {
    return ref.snapshot?.summarySnippet ?? ref.snapshot?.title ?? ref.id;
  }
  if (ref.kind === "operation") {
    return operationDisplayTitle(ref.snapshot?.title ?? ref.id);
  }
  return ref.snapshot?.title ?? ref.id;
}

function sourceAvailabilitySuffix(ref: ContinuitySourceRef): string {
  if (ref.sourceAvailability === "hidden") {
    return "已隐藏";
  }
  if (ref.sourceAvailability === "missing") {
    return "不可用";
  }
  return "";
}

function sourceRefLabel(ref: ContinuitySourceRef): string {
  const title = sourceRefDisplayTitle(ref);
  const flag = sourceAvailabilitySuffix(ref);
  const kind = sourceKindLabel(ref.kind);
  return flag ? `${kind}：${title} · ${flag}` : `${kind}：${title}`;
}

function operationDisplayTitle(raw: string): string {
  const normalized = raw.toLowerCase();
  if (normalized.includes("designdefinition")) {
    return "设计定义";
  }
  if (normalized.includes("conceptdirection")) {
    return "概念方向";
  }
  if (normalized.includes("imagegeneration") || normalized.includes("image_generation")) {
    return "图像生成";
  }
  if (normalized.includes("research")) {
    return "研究任务";
  }
  if (normalized.includes("comparison") || normalized.includes("compare")) {
    return "比较分析";
  }
  if (normalized.includes("delivery")) {
    return "交付准备";
  }
  if (/operation/i.test(raw) || /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(raw)) {
    return "后台任务";
  }
  return raw;
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

function truncateLabel(value: string, maxLength: number): string {
  const chars = Array.from(value.trim());
  if (chars.length <= maxLength) {
    return value.trim();
  }
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
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
