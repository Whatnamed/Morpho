"use client";

import { BookOpen } from "lucide-react";
import { useState } from "react";

import type {
  DecisionRecord,
  DirectionLineageRecord,
  MorphoObject,
  MorphoRelation,
  MorphoWorkspace,
  VisualBranchRecord,
  ResearchObject,
  AssetRecord
} from "@/domain/morpho/types";
import type { DesignTraceResult } from "@/domain/morpho/designTrace";
import {
  resolveDocumentFragmentLocation,
  resolveDocumentFragmentSourceAvailability,
  type DocumentReaderInitialLocation
} from "../documentFragments";
import { getObjectTypeLabel } from "../workspaceUi";

type ResearchSourceKind = "finding" | "opportunity" | "constraint" | "openQuestion" | "evidence";

type BottomDetailBarProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  assets: Record<string, AssetRecord>;
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
    sourceKind: ResearchSourceKind;
    index: number;
  }) => void;
  onCopyItemToDraft: (text: string) => void;
  onContinueQuestion: (text: string) => void;
};

const tabs = ["信息", "来源", "版本", "关联", "决策"] as const;
type DetailTab = (typeof tabs)[number];

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
  hasPendingDesignDefinitionRevisionDraft,
  relations,
  directionLineage,
  visualBranches,
  decisionRecords,
  activeDesignTrace,
  onOpenDocumentReader,
  onRenameVisualBranch,
  onArchiveVisualBranch,
  onRestoreVisualBranch
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

  return (
    <>
      <div className="detail-popover" aria-label="对象详情">
        <div className="detail-tabs">
          {tabs.map((tab) => (
            <button
              className={`detail-tab ${activeTab === tab ? "active" : ""}`}
              type="button"
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="detail-content">
          {renderDetail({
            workspace,
            tab: activeTab,
            object: primary,
            relations: related,
            decisionRecords: relatedDecisions,
            directionLineage,
            visualBranches,
            assets,
            selectedCount: selectedObjects.length,
            hasPendingDesignDefinitionRevisionDraft,
            fragmentSourceState,
            fragmentLocation: fragmentInitialLocation,
            onRenameVisualBranch,
            onArchiveVisualBranch,
            onRestoreVisualBranch
          })}
          {activeDesignTrace ? <DesignTraceSummary trace={activeDesignTrace} /> : null}
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
      </div>
    </>
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
  selectedCount: number;
  hasPendingDesignDefinitionRevisionDraft: boolean;
  fragmentSourceState: ReturnType<typeof resolveDocumentFragmentSourceAvailability> | null;
  fragmentLocation: DocumentReaderInitialLocation | null;
  onRenameVisualBranch: BottomDetailBarProps["onRenameVisualBranch"];
  onArchiveVisualBranch: BottomDetailBarProps["onArchiveVisualBranch"];
  onRestoreVisualBranch: BottomDetailBarProps["onRestoreVisualBranch"];
}) {
  const {
    tab,
    workspace,
    object,
    relations,
    directionLineage,
    visualBranches,
    assets,
    decisionRecords,
    selectedCount,
    hasPendingDesignDefinitionRevisionDraft,
    fragmentSourceState,
    fragmentLocation
  } = input;
  if (selectedCount > 1) {
    return "多选当前只作为 AI 输入与局部比较范围，不会因为同时选中就自动改变对象语义、方向状态或交付关系。";
  }

  if (tab === "信息") {
    if (object.type === "research") {
      return <ResearchCompactDetail object={object} />;
    }

    if (object.type === "keyConclusion") {
      return (
        <>
          <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
          <span className="detail-meta">
            来源：{object.sourceObjectIds.join("、") || "无"} · 引用：{object.citationIds.join("、") || "无"} · 状态：
            {object.state}
          </span>
          {object.supersededById ? <span className="detail-meta">已替代为：{object.supersededById}</span> : null}
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
      return <ResearchSourceDetail object={object} relations={relations} />;
    }

    if (object.type === "documentFragment") {
      return (
        <>
          <strong>文档片段来源</strong>
          <span className="detail-meta">来源文件对象：{object.source.fileObjectId}</span>
          <span className="detail-meta">来源解析资源：{object.source.sourceExtractAssetId}</span>
          <span className="detail-meta">来源快照：{object.source.fileTitle}</span>
          <span className="detail-meta">
            block：{object.source.blockIds.join("、")} · offset：{object.source.startOffset}-{object.source.endOffset}
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

    const sourceRelations = relations.filter(
      (relation) =>
        relation.kind === "source" ||
        relation.kind === "supports" ||
        relation.kind === "supportsConclusion" ||
        relation.kind === "documentFragmentExtractedFromFile"
    );
    return sourceRelations.length > 0
      ? sourceRelations.map((relation) => relation.note).join(" ")
      : "当前没有展开的直接来源说明。";
  }

  if (tab === "版本") {
    if (object.type === "designDefinition") {
      return buildDesignDefinitionVersionDetail(object.revisionIds.length, hasPendingDesignDefinitionRevisionDraft);
    }

    if (object.type === "conceptDirection") {
      return buildConceptDirectionVersionDetail(object.revisionIds, object.currentRevisionId);
    }

    const versions = relations.filter((relation) => relation.kind === "version");
    return versions.length > 0 ? versions.map((relation) => relation.note).join(" ") : "当前没有直接版本关系。";
  }

  if (tab === "关联") {
    if (object.type === "conceptDirection") {
      const relationDetail = relations.length > 0 ? relations.map((relation) => relation.note).join(" ") : "";
      const lineageDetail = buildConceptDirectionLineageDetail(object.id, directionLineage);
      return [relationDetail, lineageDetail].filter(Boolean).join(" ");
    }

    return relations.length > 0 ? relations.map((relation) => relation.note).join(" ") : "当前没有直接关联。";
  }

  return decisionRecords.length > 0
    ? decisionRecords.map((record) => `${record.summary}${record.reason ? `，${record.reason}` : ""}`).join(" ")
    : "关键决策需要用户明确确认；AI 不会因为选中对象而自动改变主方向、默认参考或交付引用。";
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

function ResearchSourceDetail({ object, relations }: { object: ResearchObject; relations: MorphoRelation[] }) {
  const sourceRelations = relations.filter(
    (relation) => relation.kind === "source" || relation.kind === "supports" || relation.kind === "supportsConclusion"
  );

  return (
    <div className="research-detail research-detail-compact">
      <strong>研究来源</strong>
      {object.provenance ? (
        <span className="detail-meta">
          来源对象：{object.provenance.sourceObjectIds.join("、") || "无"} · 引用：
          {object.provenance.citationIds.join("、") || "无"} · 联网：{object.provenance.didUseWebSearch ? "是" : "否"}
        </span>
      ) : (
        <span className="detail-meta">当前研究对象没有记录来源快照。</span>
      )}
      {object.evidence && object.evidence.length > 0 ? (
        <span className="detail-meta">
          证据：{object.evidence.length} 条 · {object.evidence[0]?.claim}
        </span>
      ) : null}
      {sourceRelations.length > 0 ? <span className="detail-meta">{sourceRelations.map((relation) => relation.note).join(" ")}</span> : null}
    </div>
  );
}
