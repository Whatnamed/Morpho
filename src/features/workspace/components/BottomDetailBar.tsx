"use client";

import { BookOpen } from "lucide-react";
import { useState } from "react";

import {
  ASSIGNABLE_KEY_CONCLUSION_CATEGORIES,
  isAssignableKeyConclusionCategory,
  type DecisionRecord,
  type DirectionLineageRecord,
  type ImageCollectionObject,
  type ImageObject,
  type MorphoObject,
  type MorphoRelation,
  type MorphoWorkspace,
  type VisualBranchRecord,
  type VisualReviewMark,
  type ResearchObject,
  type AssetRecord,
  type AssignableKeyConclusionCategory
} from "@/domain/morpho/types";
import type { DesignTraceResult } from "@/domain/morpho/designTrace";
import type { ResearchKeyConclusionSource } from "@/domain/morpho/workspace";
import {
  resolveDocumentFragmentLocation,
  resolveDocumentFragmentSourceAvailability,
  type DocumentReaderInitialLocation
} from "../documentFragments";
import { getKeyConclusionCategoryLabel, getObjectTypeLabel } from "../workspaceUi";

type BottomDetailBarProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  assets: Record<string, AssetRecord>;
  assetUrls?: Record<string, string>;
  hasPendingDesignDefinitionRevisionDraft: boolean;
  relations: MorphoRelation[];
  directionLineage: DirectionLineageRecord[];
  visualBranches: Record<string, VisualBranchRecord>;
  decisionRecords: DecisionRecord[];
  activeDesignTrace: DesignTraceResult | null;
  onRenameVisualBranch: (branchId: string) => void;
  onArchiveVisualBranch: (branchId: string) => void;
  onRestoreVisualBranch: (branchId: string) => void;
  onOpenDocumentReader: (fileObjectId: string, initialLocation?: DocumentReaderInitialLocation | null) => void;
  onSaveKeyConclusionFromResearchItem: (input: {
    researchObjectId: string;
  } & ResearchKeyConclusionSource) => void;
  onCopyItemToDraft: (text: string) => void;
  onContinueQuestion: (text: string) => void;
  onPreviewObject?: (objectId: string | null) => void;
  onLocateObject?: (objectId: string) => void;
  onKeepReviewedVisual?: (objectId: string) => void;
  onRegenerateReviewedVisual?: (objectId: string) => void;
  onSetKeyConclusionCategory?: (objectId: string, category: AssignableKeyConclusionCategory) => void;
};

const tabs = ["信息", "来源", "版本", "关联", "决策"] as const;
export type DetailTab = (typeof tabs)[number];

export type DetailRelationRow = {
  id: string;
  objectId?: string;
  object?: MorphoObject;
  label: string;
  title: string;
  meta: string;
};

type DetailTabAvailabilityInput = {
  workspace: MorphoWorkspace;
  object: MorphoObject;
  relations: MorphoRelation[];
  decisionRecords: DecisionRecord[];
  selectedCount: number;
  hasPendingDesignDefinitionRevisionDraft?: boolean;
  directionLineage?: DirectionLineageRecord[];
  hasActiveDesignTrace?: boolean;
};

export function buildDesignDefinitionInfoMeta(hasPendingDesignDefinitionRevisionDraft: boolean): string | undefined {
  return hasPendingDesignDefinitionRevisionDraft ? "有修订草稿" : undefined;
}

export function buildDesignDefinitionVersionDetail(
  revisionCount: number,
  hasPendingDesignDefinitionRevisionDraft: boolean
): string {
  return hasPendingDesignDefinitionRevisionDraft
    ? `当前设计定义共有 ${revisionCount} 个修订，当前有修订草稿待应用。`
    : `当前设计定义共有 ${revisionCount} 个修订。`;
}

export function buildConceptDirectionVersionDetail(revisionIds: string[], currentRevisionId: string): string {
  return `当前方向共有 ${revisionIds.length} 个修订，当前修订为 ${currentRevisionId}。`;
}

export function buildConceptDirectionLineageDetail(
  directionId: string,
  directionLineage: DirectionLineageRecord[]
): string {
  const records = directionLineage.filter(
    (record) => record.fromDirectionId === directionId || record.toDirectionId === directionId
  );
  return records.length > 0
    ? records.map((record) => `${record.kind}：${record.note}`).join(" ")
    : "当前方向没有已记录的 lineage。";
}

export function getAvailableDetailTabs(input: DetailTabAvailabilityInput): DetailTab[] {
  if (input.selectedCount > 1) {
    return ["信息"];
  }

  const available: DetailTab[] = ["信息"];
  const hasSource =
    buildSourceDetailRows(input).length > 0 ||
    (input.object.type === "research" && hasResearchSourceData(input.object)) ||
    input.object.type === "documentFragment";
  const hasVersion =
    buildVersionDetailRows(input).length > 0 ||
    (input.object.type === "designDefinition" &&
      (input.object.revisionIds.length > 1 || Boolean(input.hasPendingDesignDefinitionRevisionDraft))) ||
    (input.object.type === "conceptDirection" && input.object.revisionIds.length > 1);
  const hasRelated =
    buildRelatedDetailRows(input).length > 0 ||
    Boolean(input.hasActiveDesignTrace) ||
    (input.object.type === "conceptDirection" &&
      (input.directionLineage ?? []).some(
        (record) => record.fromDirectionId === input.object.id || record.toDirectionId === input.object.id
      ));

  if (hasSource) {
    available.push("来源");
  }
  if (hasVersion) {
    available.push("版本");
  }
  if (hasRelated) {
    available.push("关联");
  }
  if (input.decisionRecords.length > 0) {
    available.push("决策");
  }
  return available;
}

export function buildSourceDetailRows(input: Pick<DetailTabAvailabilityInput, "workspace" | "object" | "relations">): DetailRelationRow[] {
  return dedupeDetailRows(
    input.relations
      .filter(
        (relation) =>
          relation.toObjectId === input.object.id &&
          (relation.kind === "source" ||
            relation.kind === "supports" ||
            relation.kind === "supportsConclusion" ||
            relation.kind === "documentFragmentExtractedFromFile")
      )
      .map((relation) =>
        buildObjectDetailRow(
          input.workspace,
          relation.fromObjectId,
          sourceRelationLabel(relation.kind, input.workspace.objects[relation.fromObjectId])
        )
      )
  );
}

export function buildVersionDetailRows(input: Pick<DetailTabAvailabilityInput, "workspace" | "object" | "relations">): DetailRelationRow[] {
  const versionRelations = input.relations.filter((relation) => relation.kind === "version");
  const parentRows = versionRelations
    .filter((relation) => relation.toObjectId === input.object.id)
    .map((relation) => buildObjectDetailRow(input.workspace, relation.fromObjectId, "父版本"));
  const childRows = versionRelations
    .filter((relation) => relation.fromObjectId === input.object.id)
    .map((relation) => buildObjectDetailRow(input.workspace, relation.toObjectId, "子版本"));

  if (parentRows.length === 0 && childRows.length === 0) {
    return [];
  }

  return [
    ...dedupeDetailRows(parentRows),
    buildObjectDetailRow(input.workspace, input.object.id, "当前对象"),
    ...dedupeDetailRows(childRows)
  ];
}

export function buildRelatedDetailRows(input: Pick<DetailTabAvailabilityInput, "workspace" | "object" | "relations">): DetailRelationRow[] {
  const candidates = input.relations.flatMap((relation) => {
    if (relation.kind === "source" || relation.kind === "version" || relation.kind === "documentFragmentExtractedFromFile") {
      return [];
    }
    if (
      (relation.kind === "supports" || relation.kind === "supportsConclusion") &&
      relation.toObjectId === input.object.id
    ) {
      return [];
    }
    if (relation.fromObjectId !== input.object.id && relation.toObjectId !== input.object.id) {
      return [];
    }

    const isOutgoing = relation.fromObjectId === input.object.id;
    const otherObjectId = isOutgoing ? relation.toObjectId : relation.fromObjectId;
    const label = relatedRelationLabel(relation.kind, isOutgoing);
    return label ? [buildObjectDetailRow(input.workspace, otherObjectId, label)] : [];
  });

  return dedupeDetailRows(candidates);
}

export function getDocumentReaderActionState(
  object: MorphoObject,
  assets: Record<string, AssetRecord> = {}
): {
  visible: boolean;
  disabled: boolean;
  label: string;
  message: string;
} {
  if (object.type !== "file") {
    return {
      visible: false,
      disabled: true,
      label: "阅读解析内容",
      message: ""
    };
  }

  if (object.visibility !== "active") {
    return {
      visible: true,
      disabled: true,
      label: "阅读解析内容",
      message: "该文件已隐藏；请先恢复对象，再打开本地解析文本"
    };
  }

  if (object.parseStatus === "parsing") {
    return {
      visible: true,
      disabled: true,
      label: "阅读解析内容",
      message: "正在解析，完成后可阅读"
    };
  }

  if (object.parseStatus === "failed") {
    return {
      visible: true,
      disabled: true,
      label: "阅读解析内容",
      message: object.parseError || "解析失败，当前没有可读的本地解析文本"
    };
  }

  if (object.parseStatus === "parsed" && object.extractedAssetId) {
    const extractAsset = assets[object.extractedAssetId];
    if (!extractAsset || extractAsset.sourceType !== "documentExtract") {
      return {
        visible: true,
        disabled: true,
        label: "阅读解析内容",
        message: "本地解析文本资源不可用，当前无法阅读"
      };
    }

    return {
      visible: true,
      disabled: false,
      label: "阅读解析内容",
      message: "打开本地解析文本阅读面板"
    };
  }

  if (object.parseStatus === "parsed") {
    return {
      visible: true,
      disabled: true,
      label: "阅读解析内容",
      message: "本地解析文本资源不可用，当前无法阅读"
    };
  }

  return {
    visible: true,
    disabled: true,
    label: "阅读解析内容",
    message: "该文件尚未生成可读的本地解析文本"
  };
}

function describeDocumentFragmentSourceAvailability(
  state: ReturnType<typeof resolveDocumentFragmentSourceAvailability>
): string {
  switch (state.status) {
    case "active":
      return "来源可用";
    case "hidden":
    case "missing":
    case "assetMissing":
    case "assetMismatch":
      return state.reason;
  }
}

export function BottomDetailBar({
  workspace,
  selectedObjects,
  assets,
  assetUrls = {},
  hasPendingDesignDefinitionRevisionDraft,
  relations,
  directionLineage,
  visualBranches,
  decisionRecords,
  activeDesignTrace,
  onOpenDocumentReader,
  onRenameVisualBranch,
  onArchiveVisualBranch,
  onRestoreVisualBranch,
  onPreviewObject,
  onLocateObject,
  onKeepReviewedVisual,
  onRegenerateReviewedVisual,
  onSetKeyConclusionCategory
}: BottomDetailBarProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("信息");

  if (selectedObjects.length === 0) {
    return null;
  }

  const primary = selectedObjects[0];
  const related = relations.filter(
    (relation) => relation.fromObjectId === primary.id || relation.toObjectId === primary.id
  );
  const relatedDecisions = decisionRecords.filter(
    (record) => record.objectSnapshot?.id === primary.id || record.relatedObjectIds.includes(primary.id)
  );
  const documentReaderAction = getDocumentReaderActionState(primary, assets);
  const fragmentSourceState =
    primary.type === "documentFragment" ? resolveDocumentFragmentSourceAvailability(workspace, primary) : null;
  const fragmentLocation = primary.type === "documentFragment" ? resolveDocumentFragmentLocation(workspace, primary) : null;
  const fragmentInitialLocation: DocumentReaderInitialLocation | null =
    fragmentLocation?.status === "ready"
      ? {
          startOffset: fragmentLocation.startOffset,
          endOffset: fragmentLocation.endOffset,
          label: fragmentLocation.label
        }
      : null;
  const availableTabs = getAvailableDetailTabs({
    workspace,
    object: primary,
    relations: related,
    decisionRecords: relatedDecisions,
    selectedCount: selectedObjects.length,
    hasPendingDesignDefinitionRevisionDraft,
    directionLineage,
    hasActiveDesignTrace: Boolean(activeDesignTrace)
  });
  const visibleTab = availableTabs.includes(activeTab) ? activeTab : availableTabs[0] ?? "信息";

  const hasInlineActions = documentReaderAction.visible || primary.type === "documentFragment";

  return (
    <div className="detail-popover" aria-label="对象详情">
      <div className="detail-popover-head">
        <div className="detail-object-chip" title={primary.title}>
          <span className="detail-object-type">{getObjectTypeLabel(primary)}</span>
          <strong className="detail-object-title">
            {selectedObjects.length > 1 ? `已选 ${selectedObjects.length} 项` : primary.title}
          </strong>
        </div>
        <div className="detail-tabs" role="tablist" aria-label="详情分类">
          {availableTabs.map((tab) => (
            <button
              className={`detail-tab ${visibleTab === tab ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={visibleTab === tab}
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-content" role="tabpanel">
        <div className="detail-content-stack">
          {visibleTab === "信息" &&
          selectedObjects.length === 1 &&
          (primary.type === "image" || primary.type === "imageCollection") &&
          primary.pendingReview ? (
            <PendingReviewSection
              workspace={workspace}
              object={primary}
              pendingReview={primary.pendingReview}
              onKeepReviewedVisual={onKeepReviewedVisual}
              onRegenerateReviewedVisual={onRegenerateReviewedVisual}
              onPreviewObject={onPreviewObject}
              onLocateObject={onLocateObject}
            />
          ) : null}
          {renderDetail({
            workspace,
            tab: visibleTab,
            object: primary,
            relations: related,
            decisionRecords: relatedDecisions,
            directionLineage,
            visualBranches,
            assets,
            assetUrls,
            selectedCount: selectedObjects.length,
            hasPendingDesignDefinitionRevisionDraft,
            fragmentSourceState,
            fragmentLocation: fragmentInitialLocation,
            onRenameVisualBranch,
            onArchiveVisualBranch,
            onRestoreVisualBranch,
            onPreviewObject,
            onLocateObject,
            onSetKeyConclusionCategory
          })}
          {visibleTab === "关联" && activeDesignTrace ? <DesignTraceSummary trace={activeDesignTrace} /> : null}
        </div>
        {hasInlineActions ? (
          <div className="detail-content-actions">
            {documentReaderAction.visible ? (
              <button
                className="detail-inline-action"
                type="button"
                disabled={documentReaderAction.disabled}
                title={documentReaderAction.message}
                onClick={() => {
                  if (primary.type === "file") {
                    onOpenDocumentReader(primary.id);
                  }
                }}
              >
                <BookOpen size={14} />
                {documentReaderAction.label}
              </button>
            ) : null}
            {primary.type === "documentFragment" ? (
              <button
                className="detail-inline-action"
                type="button"
                disabled={!fragmentInitialLocation}
                title={fragmentSourceState ? describeDocumentFragmentSourceAvailability(fragmentSourceState) : "来源不可用"}
                onClick={() => onOpenDocumentReader(primary.source.fileObjectId, fragmentInitialLocation)}
              >
                <BookOpen size={14} />
                查看原文定位
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 待复核素材“查看被用在哪里”的确定性用途清单：交付引用、所属合集、后续延展图。 */
export function buildVisualUsageRows(workspace: MorphoWorkspace, objectId: string): DetailRelationRow[] {
  const rows: DetailRelationRow[] = [];

  for (const reference of Object.values(workspace.deliveryReferences)) {
    if (reference.sourceObjectId !== objectId) {
      continue;
    }
    const deliveryObject = reference.deliveryObjectId ? workspace.objects[reference.deliveryObjectId] : undefined;
    rows.push({
      id: `usage-delivery-${reference.id}`,
      objectId: deliveryObject?.id,
      object: deliveryObject,
      label: "交付引用",
      title: deliveryObject?.title ?? "交付准备",
      meta: `引用快照：${reference.snapshot.title}`
    });
  }

  for (const object of Object.values(workspace.objects)) {
    if (object.type === "imageCollection" && object.visibility === "active" && object.memberObjectIds.includes(objectId)) {
      rows.push({
        id: `usage-collection-${object.id}`,
        objectId: object.id,
        object,
        label: "所属合集",
        title: object.title,
        meta: `成员 ${object.memberObjectIds.length} 张`
      });
    }
  }

  for (const relation of workspace.relations) {
    if ((relation.kind === "version" || relation.kind === "source") && relation.fromObjectId === objectId) {
      const derived = workspace.objects[relation.toObjectId];
      if (derived && derived.visibility === "active") {
        rows.push({
          id: `usage-derived-${relation.id}`,
          objectId: derived.id,
          object: derived,
          label: "后续延展",
          title: derived.title,
          meta: getObjectTypeLabel(derived)
        });
      }
    }
  }

  return rows;
}

function PendingReviewSection({
  workspace,
  object,
  pendingReview,
  onKeepReviewedVisual,
  onRegenerateReviewedVisual,
  onPreviewObject,
  onLocateObject
}: {
  workspace: MorphoWorkspace;
  object: ImageObject | ImageCollectionObject;
  pendingReview: VisualReviewMark;
  onKeepReviewedVisual?: (objectId: string) => void;
  onRegenerateReviewedVisual?: (objectId: string) => void;
  onPreviewObject?: (objectId: string | null) => void;
  onLocateObject?: (objectId: string) => void;
}) {
  const [showUsage, setShowUsage] = useState(false);
  const previousReference = workspace.objects[pendingReview.previousDefaultReferenceId];
  const newReference = workspace.objects[pendingReview.newDefaultReferenceId];
  const usageRows = showUsage ? buildVisualUsageRows(workspace, object.id) : [];

  return (
    <div className="detail-review-section" aria-label="待复核">
      <div className="detail-review-head">
        <span className="detail-review-badge">待复核</span>
        <span className="detail-meta">
          后续默认参考已从「{previousReference?.title ?? "已删除对象"}」替换为「{newReference?.title ?? "已删除对象"}
          」，这{object.type === "imageCollection" ? "组" : "张"}素材由旧默认参考直接延展而来。
        </span>
      </div>
      <div className="detail-review-actions">
        <button className="detail-inline-action" type="button" onClick={() => onKeepReviewedVisual?.(object.id)}>
          保留
        </button>
        <button className="detail-inline-action" type="button" onClick={() => onRegenerateReviewedVisual?.(object.id)}>
          基于新默认参考重新生成
        </button>
        <button
          className="detail-inline-action"
          type="button"
          aria-expanded={showUsage}
          onClick={() => setShowUsage((value) => !value)}
        >
          {showUsage ? "收起用途" : "查看被用在哪里"}
        </button>
      </div>
      {showUsage ? (
        usageRows.length > 0 ? (
          <DetailRelationRows rows={usageRows} onPreviewObject={onPreviewObject} onLocateObject={onLocateObject} />
        ) : (
          <span className="detail-meta">当前没有交付引用、合集或后续延展使用它。</span>
        )
      ) : null}
    </div>
  );
}

function VisualBranchRows({
  branches,
  onRenameVisualBranch,
  onArchiveVisualBranch,
  onRestoreVisualBranch
}: {
  branches: VisualBranchRecord[];
  onRenameVisualBranch: BottomDetailBarProps["onRenameVisualBranch"];
  onArchiveVisualBranch: BottomDetailBarProps["onArchiveVisualBranch"];
  onRestoreVisualBranch: BottomDetailBarProps["onRestoreVisualBranch"];
}) {
  if (branches.length === 0) {
    return <span className="detail-meta">当前方向还没有视觉分支。</span>;
  }

  return (
    <section className="research-detail-group">
      <h4>视觉分支</h4>
      {branches.map((branch) => (
        <div className="research-item" key={branch.id}>
          <div className="research-item-body">
            <strong>{branch.label}</strong>
            <span className="detail-meta">
              {branch.rootObjectId ? `根图：${branch.rootObjectId} · ` : ""}
              {branch.archivedAt ? "已归档" : "可继续发展"}
            </span>
          </div>
          <div className="research-item-actions">
            <button type="button" onClick={() => onRenameVisualBranch(branch.id)}>
              改名
            </button>
            {branch.archivedAt ? (
              <button type="button" onClick={() => onRestoreVisualBranch(branch.id)}>
                恢复
              </button>
            ) : (
              <button type="button" onClick={() => onArchiveVisualBranch(branch.id)}>
                归档
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function DesignTraceSummary({ trace }: { trace: DesignTraceResult }) {
  return (
    <section className="design-trace-summary" aria-label="设计链路摘要">
      <h4>设计链路</h4>
      <div className="design-trace-stats">
        <span>{trace.objectIds.length} 个对象</span>
        <span>{trace.edges.length} 条关系</span>
        <span>{trace.decisions.length} 条决策</span>
        {trace.truncated ? <span>已按深度截断</span> : null}
      </div>
      <ol>
        {trace.orderedSummary.slice(0, 8).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      {trace.decisions.length > 0 ? (
        <div className="design-trace-decisions">
          {trace.decisions.slice(0, 4).map((decision) => (
            <span key={decision.id}>{decision.summary}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function renderDetail(input: {
  workspace: MorphoWorkspace;
  tab: DetailTab;
  object: MorphoObject;
  relations: MorphoRelation[];
  decisionRecords: DecisionRecord[];
  directionLineage: DirectionLineageRecord[];
  visualBranches: Record<string, VisualBranchRecord>;
  assets: Record<string, AssetRecord>;
  assetUrls: Record<string, string>;
  selectedCount: number;
  hasPendingDesignDefinitionRevisionDraft: boolean;
  fragmentSourceState: ReturnType<typeof resolveDocumentFragmentSourceAvailability> | null;
  fragmentLocation: DocumentReaderInitialLocation | null;
  onRenameVisualBranch: BottomDetailBarProps["onRenameVisualBranch"];
  onArchiveVisualBranch: BottomDetailBarProps["onArchiveVisualBranch"];
  onRestoreVisualBranch: BottomDetailBarProps["onRestoreVisualBranch"];
  onSetKeyConclusionCategory?: BottomDetailBarProps["onSetKeyConclusionCategory"];
  onPreviewObject?: (objectId: string | null) => void;
  onLocateObject?: (objectId: string) => void;
}) {
  const {
    tab,
    workspace,
    object,
    relations,
    directionLineage,
    visualBranches,
    assets,
    assetUrls,
    decisionRecords,
    selectedCount,
    hasPendingDesignDefinitionRevisionDraft,
    fragmentSourceState,
    fragmentLocation,
    onSetKeyConclusionCategory,
    onPreviewObject,
    onLocateObject
  } = input;
  if (selectedCount > 1) {
    return <MultiSelectionDetail selectedCount={selectedCount} />;
  }

  if (tab === "信息") {
    if (object.type === "research") {
      return <ResearchCompactDetail object={object} />;
    }

    if (object.type === "keyConclusion") {
      return (
        <>
          <strong>{getObjectTypeLabel(object)} · {getKeyConclusionCategoryLabel(object.category)}</strong> · {object.summary}
          <span className="detail-meta">
            来源：{object.sourceObjectIds.length} 项 · 引用：{object.citationIds.length} 项 · 状态：
            {object.state}
          </span>
          {object.category === "unknown" ? (
            <label className="detail-key-conclusion-category">
              <span>类别</span>
              <select
                aria-label="关键结论类别"
                value=""
                onChange={(event) => {
                  const category = event.currentTarget.value;
                  if (isAssignableKeyConclusionCategory(category)) {
                    onSetKeyConclusionCategory?.(object.id, category);
                  }
                }}
              >
                <option value="" disabled>
                  待分类
                </option>
                {ASSIGNABLE_KEY_CONCLUSION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {getKeyConclusionCategoryLabel(category)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {object.supersededById ? <span className="detail-meta">已有更新结论替代该条。</span> : null}
          {object.note ? <span className="detail-meta">备注：{object.note}</span> : null}
        </>
      );
    }

    if (object.type === "conceptDirection") {
      const branches = Object.values(visualBranches).filter((branch) => branch.directionId === object.id);
      const revision = workspace.directionRevisions[object.currentRevisionId];
      return (
        <>
          <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
          <span className="detail-meta">
            状态：{conceptDirectionStatusLabel(object.status)}
            {revision ? ` · 修订 ${revision.revisionNumber}` : ""}
          </span>
          <VisualBranchRows
            branches={branches}
            onRenameVisualBranch={input.onRenameVisualBranch}
            onArchiveVisualBranch={input.onArchiveVisualBranch}
            onRestoreVisualBranch={input.onRestoreVisualBranch}
          />
        </>
      );
    }

    if (object.type === "documentFragment") {
      return (
        <>
          <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
          <span className="detail-meta">来源文件：{object.source.fileTitle}</span>
          {object.source.fileName ? <span className="detail-meta">原始文件名：{object.source.fileName}</span> : null}
          <span className="detail-meta">
            解析片段：{object.source.blockIds.length} 个 block · 字符 {object.source.startOffset}-{object.source.endOffset}
          </span>
          <span className="detail-meta">
            来源状态：{fragmentSourceState ? describeDocumentFragmentSourceAvailability(fragmentSourceState) : "来源不可用"}
          </span>
          {fragmentLocation ? <span className="detail-meta">可回到原文：{fragmentLocation.label}</span> : null}
        </>
      );
    }

    return (
      <>
        <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
        {object.type === "image" && object.generation ? (
          <span className="detail-meta">
            生成：{object.generation.modelLabel} · {object.generation.aspectRatio}
            {object.generation.sizeOption ? ` · ${object.generation.sizeOption}` : ""} ·{" "}
            {object.generation.createdAt.slice(0, 10)}
          </span>
        ) : null}
        {object.type === "designDefinition" && buildDesignDefinitionInfoMeta(hasPendingDesignDefinitionRevisionDraft) ? (
          <span className="detail-meta">{buildDesignDefinitionInfoMeta(hasPendingDesignDefinitionRevisionDraft)}</span>
        ) : null}
        {object.type === "file" ? (
          <span className="detail-meta">{getDocumentReaderActionState(object, assets).message}</span>
        ) : null}
      </>
    );
  }

  if (tab === "来源") {
    if (object.type === "research") {
      return (
        <ResearchSourceDetail
          workspace={workspace}
          object={object}
          relations={relations}
          assetUrls={assetUrls}
          onPreviewObject={onPreviewObject}
          onLocateObject={onLocateObject}
        />
      );
    }

    if (object.type === "documentFragment") {
      return (
        <>
          <strong>文档片段来源</strong>
          <span className="detail-meta">来源文件：{object.source.fileTitle}</span>
          <span className="detail-meta">
            已提取 {object.source.blockIds.length} 个原文片段
          </span>
          <span className="detail-meta">
            定位状态：
            {fragmentLocation
              ? fragmentLocation.label
              : fragmentSourceState
                ? describeDocumentFragmentSourceAvailability(fragmentSourceState)
                : "来源不可用"}
          </span>
        </>
      );
    }

    return (
      <DetailRelationRows
        rows={buildSourceDetailRows({ workspace, object, relations })}
        assetUrls={assetUrls}
        onPreviewObject={onPreviewObject}
        onLocateObject={onLocateObject}
      />
    );
  }

  if (tab === "版本") {
    if (object.type === "designDefinition") {
      return (
        <RevisionDetailRows
          rows={buildDesignDefinitionRevisionRows(workspace, object.revisionIds, object.currentRevisionId)}
          pendingRevisionDraft={hasPendingDesignDefinitionRevisionDraft}
        />
      );
    }

    if (object.type === "conceptDirection") {
      return <RevisionDetailRows rows={buildConceptDirectionRevisionRows(workspace, object.revisionIds, object.currentRevisionId)} />;
    }

    return (
      <DetailRelationRows
        rows={buildVersionDetailRows({ workspace, object, relations })}
        assetUrls={assetUrls}
        onPreviewObject={onPreviewObject}
        onLocateObject={onLocateObject}
      />
    );
  }

  if (tab === "关联") {
    if (object.type === "conceptDirection") {
      return (
        <>
          <DetailRelationRows
            rows={buildRelatedDetailRows({ workspace, object, relations })}
            assetUrls={assetUrls}
            onPreviewObject={onPreviewObject}
            onLocateObject={onLocateObject}
          />
          <DirectionLineageRows directionId={object.id} directionLineage={directionLineage} />
        </>
      );
    }

    return (
      <DetailRelationRows
        rows={buildRelatedDetailRows({ workspace, object, relations })}
        assetUrls={assetUrls}
        onPreviewObject={onPreviewObject}
        onLocateObject={onLocateObject}
      />
    );
  }

  return <DecisionDetailRows decisionRecords={decisionRecords} />;
}

function MultiSelectionDetail({ selectedCount }: { selectedCount: number }) {
  return (
    <div className="detail-summary">
      <strong>已选 {selectedCount} 个对象</strong>
      <span className="detail-meta">当前选择会作为 AI 输入和局部分析范围。</span>
    </div>
  );
}

export function DetailRelationRows({
  rows,
  assetUrls = {},
  onPreviewObject,
  onLocateObject
}: {
  rows: DetailRelationRow[];
  assetUrls?: Record<string, string>;
  onPreviewObject?: (objectId: string | null) => void;
  onLocateObject?: (objectId: string) => void;
}) {
  return (
    <div className="detail-row-list">
      {rows.map((row) => {
        const referenceObject = row.objectId && row.object ? row.object : null;
        if (!referenceObject) {
          return (
            <div className="detail-row" key={`${row.label}-${row.id}`}>
              <span className="detail-row-label">{row.label}</span>
              <div className="detail-row-body">
                <strong>{row.title}</strong>
                <span>{row.meta}</span>
              </div>
            </div>
          );
        }

        return (
          <button
            className="detail-row detail-object-reference"
            data-object-id={referenceObject.id}
            key={`${row.label}-${row.id}`}
            type="button"
            onBlur={() => onPreviewObject?.(null)}
            onClick={() => onLocateObject?.(referenceObject.id)}
            onFocus={() => onPreviewObject?.(referenceObject.id)}
            onPointerEnter={() => onPreviewObject?.(referenceObject.id)}
            onPointerLeave={() => onPreviewObject?.(null)}
          >
            <span className="detail-row-label">{row.label}</span>
            <div className="detail-object-reference-body">
              <DetailObjectThumbnail assetUrls={assetUrls} object={referenceObject} />
              <div className="detail-row-body">
                <strong>{row.title}</strong>
                <span>{row.meta}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DetailObjectThumbnail({ object, assetUrls }: { object: MorphoObject; assetUrls: Record<string, string> }) {
  const assetUrl = object.type === "image" && object.assetId ? assetUrls[object.assetId] : undefined;
  if (assetUrl) {
    return (
      <span className="detail-object-thumbnail detail-object-thumbnail-image" aria-hidden="true">
        {/* Blob URLs come from local IndexedDB and cannot be optimized by next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl} alt="" />
      </span>
    );
  }

  return (
    <span className={`detail-object-thumbnail detail-object-thumbnail-${object.type}`} aria-hidden="true">
      {getObjectTypeLabel(object).slice(0, 1)}
    </span>
  );
}

function RevisionDetailRows({
  rows,
  pendingRevisionDraft = false
}: {
  rows: DetailRelationRow[];
  pendingRevisionDraft?: boolean;
}) {
  return (
    <>
      <DetailRelationRows rows={rows} />
      {pendingRevisionDraft ? <span className="detail-meta">有修订草稿待应用。</span> : null}
    </>
  );
}

function DecisionDetailRows({ decisionRecords }: { decisionRecords: DecisionRecord[] }) {
  return (
    <div className="detail-row-list">
      {decisionRecords.map((record) => (
        <div className="detail-row" key={record.id}>
          <span className="detail-row-label">已确认</span>
          <div className="detail-row-body">
            <strong>{record.summary}</strong>
            {record.reason ? <span>{record.reason}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DirectionLineageRows({
  directionId,
  directionLineage
}: {
  directionId: string;
  directionLineage: DirectionLineageRecord[];
}) {
  const records = directionLineage.filter(
    (record) => record.fromDirectionId === directionId || record.toDirectionId === directionId
  );
  if (records.length === 0) {
    return null;
  }

  return (
    <div className="detail-row-list">
      {records.map((record) => (
        <div className="detail-row" key={record.id}>
          <span className="detail-row-label">{directionLineageLabel(record.kind)}</span>
          <div className="detail-row-body">
            <span>{record.note}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildObjectDetailRow(workspace: MorphoWorkspace, objectId: string, label: string): DetailRelationRow {
  const relatedObject = workspace.objects[objectId];
  return {
    id: objectId,
    objectId: relatedObject?.id,
    object: relatedObject,
    label,
    title: relatedObject?.title ?? "已删除对象",
    meta: relatedObject ? getObjectTypeLabel(relatedObject) : "对象不可用"
  };
}

function buildDesignDefinitionRevisionRows(
  workspace: MorphoWorkspace,
  revisionIds: string[],
  currentRevisionId: string
): DetailRelationRow[] {
  return revisionIds
    .map((revisionId) => workspace.designDefinitionRevisions[revisionId])
    .filter(Boolean)
    .map((revision) => ({
      id: revision.id,
      label: revision.id === currentRevisionId ? "当前修订" : `修订 ${revision.revisionNumber}`,
      title: revision.title,
      meta: revision.id === currentRevisionId ? "当前有效内容" : "历史修订"
    }));
}

function buildConceptDirectionRevisionRows(
  workspace: MorphoWorkspace,
  revisionIds: string[],
  currentRevisionId: string
): DetailRelationRow[] {
  return revisionIds
    .map((revisionId) => workspace.directionRevisions[revisionId])
    .filter(Boolean)
    .map((revision) => ({
      id: revision.id,
      label: revision.id === currentRevisionId ? "当前修订" : `修订 ${revision.revisionNumber}`,
      title: revision.title,
      meta: revision.id === currentRevisionId ? "当前方向内容" : "历史修订"
    }));
}

function sourceRelationLabel(kind: MorphoRelation["kind"], sourceObject: MorphoObject | undefined): string {
  if (kind === "documentFragmentExtractedFromFile") {
    return "来源文件";
  }
  if (kind === "source") {
    return sourceObject?.type === "image" ? "起始图" : "来源对象";
  }
  return "上游依据";
}

function relatedRelationLabel(kind: MorphoRelation["kind"], isOutgoing: boolean): string | undefined {
  switch (kind) {
    case "belongsToDirection":
      return isOutgoing ? "归属方向" : "包含视觉素材";
    case "defaultReference":
      return isOutgoing ? "后续默认参考" : "默认参考图";
    case "deliveryReference":
      return isOutgoing ? "已用于交付" : "包含交付引用";
    case "usesReference":
      return isOutgoing ? "用于参考" : "被用作参考";
    case "supports":
    case "supportsConclusion":
      return isOutgoing ? "支持下游对象" : undefined;
    default:
      return undefined;
  }
}

function directionLineageLabel(kind: DirectionLineageRecord["kind"]): string {
  switch (kind) {
    case "derivedFromDirection":
      return "发展自";
    case "splitFromDirection":
      return "拆分自";
    case "mergedFromDirection":
      return "合并自";
    case "supersedesDirection":
      return "替代";
  }
}

function dedupeDetailRows(rows: DetailRelationRow[]): DetailRelationRow[] {
  const byObjectId = new Map<string, DetailRelationRow>();
  for (const row of rows) {
    const existing = byObjectId.get(row.id);
    if (!existing || detailRowPriority(row.label) > detailRowPriority(existing.label)) {
      byObjectId.set(row.id, row);
    }
  }
  return [...byObjectId.values()];
}

function detailRowPriority(label: string): number {
  switch (label) {
    case "后续默认参考":
    case "默认参考图":
      return 4;
    case "已用于交付":
    case "包含交付引用":
      return 3;
    case "归属方向":
    case "包含视觉素材":
      return 2;
    default:
      return 1;
  }
}

function hasResearchSourceData(object: ResearchObject): boolean {
  return Boolean(
    object.provenance &&
      (object.provenance.sourceObjectIds.length > 0 ||
        object.provenance.citationIds.length > 0 ||
        object.provenance.didUseWebSearch)
  );
}

function conceptDirectionStatusLabel(status: Extract<MorphoObject, { type: "conceptDirection" }>["status"]): string {
  switch (status) {
    case "pendingPreview":
      return "待预览";
    case "primary":
      return "主方向";
    case "alternative":
      return "备选方向";
    case "eliminated":
      return "已淘汰";
    case "needsReview":
      return "待复核";
  }
}

function ResearchCompactDetail({ object }: { object: ResearchObject }) {
  const totalItems = object.findings.length + object.opportunities.length + object.constraints.length + object.openQuestions.length;

  return (
    <div className="research-detail research-detail-compact">
      <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
      <span className="detail-meta">
        候选内容：发现 {object.findings.length} · 机会 {object.opportunities.length} · 约束 {object.constraints.length} · 待验证{" "}
        {object.openQuestions.length}
      </span>
      <span className="detail-meta">
        这些候选内容已在画布卡片上摘要显示；完整来源、证据和引用在“来源”中追溯。
        {totalItems > 4 ? ` 共 ${totalItems} 条。` : ""}
      </span>
    </div>
  );
}

function ResearchSourceDetail({
  workspace,
  object,
  relations,
  assetUrls,
  onPreviewObject,
  onLocateObject
}: {
  workspace: MorphoWorkspace;
  object: ResearchObject;
  relations: MorphoRelation[];
  assetUrls: Record<string, string>;
  onPreviewObject?: (objectId: string | null) => void;
  onLocateObject?: (objectId: string) => void;
}) {
  return (
    <div className="research-detail research-detail-compact">
      <strong>研究来源</strong>
      {object.provenance ? (
        <span className="detail-meta">
          来源对象 {object.provenance.sourceObjectIds.length} 项 · 引用 {object.provenance.citationIds.length} 项
          {object.provenance.didUseWebSearch ? " · 已使用联网检索" : ""}
        </span>
      ) : null}
      {object.evidence && object.evidence.length > 0 ? (
        <span className="detail-meta">
          证据：{object.evidence.length} 条 · {object.evidence[0]?.claim}
        </span>
      ) : null}
      <DetailRelationRows
        rows={buildSourceDetailRows({ workspace, object, relations })}
        assetUrls={assetUrls}
        onPreviewObject={onPreviewObject}
        onLocateObject={onLocateObject}
      />
    </div>
  );
}
