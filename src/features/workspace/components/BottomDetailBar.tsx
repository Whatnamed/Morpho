"use client";

import {
  Ban,
  BookOpen,
  EyeOff,
  Flag,
  GitBranch,
  GitMerge,
  History,
  Info,
  ListChecks,
  MessageSquareText,
  PackageOpen,
  PenLine,
  Sparkles,
  Target,
  Trash2
} from "lucide-react";
import { useState } from "react";

import type {
  DecisionRecord,
  DirectionLineageRecord,
  ImageRole,
  KeyConclusionObject,
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
import { getObjectTypeLabel, imageRoleLabel } from "../workspaceUi";

type ResearchSourceKind = "finding" | "opportunity" | "constraint" | "openQuestion" | "evidence";

type BottomDetailBarProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  assets: Record<string, AssetRecord>;
  hasPendingDesignDefinitionRevisionDraft: boolean;
  keyConclusionCandidates: KeyConclusionObject[];
  relations: MorphoRelation[];
  directionLineage: DirectionLineageRecord[];
  visualBranches: Record<string, VisualBranchRecord>;
  decisionRecords: DecisionRecord[];
  activeDesignTrace: DesignTraceResult | null;
  isDesignTraceActive: boolean;
  onToggleDesignTrace: () => void;
  onAskAi: () => void;
  onReviseDirection: () => void;
  onSplitDirection: () => void;
  onMergeDirections: () => void;
  onCreateVisualBranch: () => void;
  onRenameVisualBranch: (branchId: string) => void;
  onArchiveVisualBranch: (branchId: string) => void;
  onRestoreVisualBranch: (branchId: string) => void;
  onAssignImageToVisualBranch: (branchId: string) => void;
  onRemoveImageFromVisualBranch: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
  onOpenDocumentReader: (fileObjectId: string, initialLocation?: DocumentReaderInitialLocation | null) => void;
  onOpenDeliveryPreparation: (deliveryObjectId?: string) => void;
  onHide: () => void;
  onDelete: () => void;
  onEliminateDirection: () => void;
  onSetDirectionPrimary: () => void;
  onSetDirectionAlternative: () => void;
  onRestoreDirectionAsAlternative: () => void;
  onSaveKeyConclusionFromResearchItem: (input: {
    researchObjectId: string;
    sourceKind: ResearchSourceKind;
    index: number;
  }) => void;
  onCopyItemToDraft: (text: string) => void;
  onContinueQuestion: (text: string) => void;
  onSetKeyConclusionState: (
    keyConclusionId: string,
    nextState: KeyConclusionObject["state"],
    supersededById?: string
  ) => void;
  onSetImageRole: (role: ImageRole) => void;
};

const tabs = ["信息", "来源", "版本", "关联", "决策"] as const;
type DetailTab = (typeof tabs)[number];

const imageRoleOptions: ImageRole[] = [
  "reference",
  "preview",
  "conceptImage",
  "primaryVisual",
  "sceneVisual",
  "cmfStudy",
  "detailStudy",
  "structureDiagram",
  "interactionDiagram",
  "deliveryAsset"
];

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
  keyConclusionCandidates,
  relations,
  directionLineage,
  visualBranches,
  decisionRecords,
  activeDesignTrace,
  isDesignTraceActive,
  onToggleDesignTrace,
  onAskAi,
  onReviseDirection,
  onSplitDirection,
  onMergeDirections,
  onCreateVisualBranch,
  onRenameVisualBranch,
  onArchiveVisualBranch,
  onRestoreVisualBranch,
  onAssignImageToVisualBranch,
  onRemoveImageFromVisualBranch,
  onLocalEdit,
  onReferenceIntent,
  onOpenDocumentReader,
  onOpenDeliveryPreparation,
  onHide,
  onDelete,
  onEliminateDirection,
  onSetDirectionPrimary,
  onSetDirectionAlternative,
  onRestoreDirectionAsAlternative,
  onSaveKeyConclusionFromResearchItem,
  onCopyItemToDraft,
  onContinueQuestion,
  onSetKeyConclusionState,
  onSetImageRole
}: BottomDetailBarProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("信息");
  const [supersededById, setSupersededById] = useState("");

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
  const showDirectionActions = primary.type === "conceptDirection" && selectedObjects.length === 1;
  const selectedDirections = selectedObjects.filter((object) => object.type === "conceptDirection");
  const showMergeDirectionsAction = selectedDirections.length >= 2 && selectedDirections.length === selectedObjects.length;
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
  const imageBranchOptions =
    primary.type === "image" && primary.directionId
      ? Object.values(visualBranches).filter((branch) => branch.directionId === primary.directionId && !branch.archivedAt)
      : [];

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
            keyConclusionCandidates,
            supersededById,
            setSupersededById,
            onSaveKeyConclusionFromResearchItem,
            onCopyItemToDraft,
            onContinueQuestion,
            onRenameVisualBranch,
            onArchiveVisualBranch,
            onRestoreVisualBranch
          })}
          {activeDesignTrace ? <DesignTraceSummary trace={activeDesignTrace} /> : null}
        </div>
      </div>

      <div className="detail-bar" aria-label="选中对象操作">
        <div className="detail-object">
          <div className="detail-icon">
            <Info size={14} />
          </div>
          <span>{selectedObjects.length > 1 ? `已选 ${selectedObjects.length} 个对象` : primary.title}</span>
        </div>

        <div className="detail-actions">
          <button className="detail-action" type="button" onClick={onAskAi}>
            <MessageSquareText size={15} />
            询问 AI
          </button>

          {documentReaderAction.visible ? (
            <button
              className="detail-action"
              type="button"
              disabled={documentReaderAction.disabled}
              title={documentReaderAction.message}
              onClick={() => {
                if (primary.type === "file") {
                  onOpenDocumentReader(primary.id);
                }
              }}
            >
              <BookOpen size={15} />
              {documentReaderAction.label}
            </button>
          ) : null}

          {primary.type === "documentFragment" ? (
            <button
              className="detail-action"
              type="button"
              disabled={!fragmentInitialLocation}
              title={fragmentSourceState ? describeDocumentFragmentSourceAvailability(fragmentSourceState) : "来源不可用"}
              onClick={() => onOpenDocumentReader(primary.source.fileObjectId, fragmentInitialLocation)}
            >
              <BookOpen size={15} />
              查看原文定位
            </button>
          ) : null}

          {primary.type === "delivery" ? (
            <button className="detail-action brand" type="button" onClick={() => onOpenDeliveryPreparation(primary.id)}>
              <PackageOpen size={15} />
              打开交付准备
            </button>
          ) : null}

          <button className={`detail-action ${isDesignTraceActive ? "brand" : ""}`} type="button" onClick={onToggleDesignTrace}>
            <GitBranch size={15} />
            {isDesignTraceActive ? "关闭设计链路" : "查看设计链路"}
          </button>

          <button className="detail-action" type="button" onClick={onHide}>
            <EyeOff size={15} />
            隐藏
          </button>

          <button className="detail-action" type="button" onClick={onDelete}>
            <Trash2 size={15} />
            删除
          </button>

          {showDirectionActions && primary.status !== "primary" && primary.status !== "eliminated" ? (
            <button className="detail-action" type="button" onClick={onSetDirectionPrimary}>
              <Flag size={15} />
              设为主方向
            </button>
          ) : null}

          {showDirectionActions ? (
            <>
              <button className="detail-action" type="button" onClick={onReviseDirection}>
                <PenLine size={15} />
                修订方向
              </button>
              <button className="detail-action" type="button" onClick={onSplitDirection}>
                <GitBranch size={15} />
                拆分方向
              </button>
              <button className="detail-action" type="button" onClick={() => setActiveTab("版本")}>
                <History size={15} />
                查看修订历史
              </button>
              <button className="detail-action" type="button" onClick={() => setActiveTab("关联")}>
                <GitMerge size={15} />
                查看 lineage
              </button>
              <button className="detail-action" type="button" onClick={onCreateVisualBranch}>
                <Sparkles size={14} />
                创建视觉分支
              </button>
            </>
          ) : null}

          {showMergeDirectionsAction ? (
            <button className="detail-action" type="button" onClick={onMergeDirections}>
              <GitMerge size={15} />
              合并已选方向
            </button>
          ) : null}

          {showDirectionActions && primary.status !== "alternative" && primary.status !== "eliminated" ? (
            <button className="detail-action" type="button" onClick={onSetDirectionAlternative}>
              <GitBranch size={15} />
              转为备选
            </button>
          ) : null}

          {showDirectionActions && primary.status === "eliminated" ? (
            <button className="detail-action" type="button" onClick={onRestoreDirectionAsAlternative}>
              <GitBranch size={15} />
              恢复为备选
            </button>
          ) : null}

          {showDirectionActions && primary.status !== "eliminated" ? (
            <button className="detail-action" type="button" onClick={onEliminateDirection}>
              <Ban size={15} />
              淘汰方向
            </button>
          ) : null}

          {primary.type === "image" ? (
            <>
              <label className="detail-select">
                <span>角色</span>
                <select
                  value={primary.role}
                  onChange={(event) => onSetImageRole(event.currentTarget.value as ImageRole)}
                  aria-label="设置图片角色"
                >
                  {imageRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {imageRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
              {primary.directionId ? (
                <label className="detail-select">
                  <span>视觉分支</span>
                  <select
                    value={primary.visualBranchId ?? ""}
                    onChange={(event) => {
                      const branchId = event.currentTarget.value;
                      if (branchId) {
                        onAssignImageToVisualBranch(branchId);
                        return;
                      }
                      onRemoveImageFromVisualBranch();
                    }}
                    aria-label="设置图片视觉分支"
                  >
                    <option value="">未分组视觉探索</option>
                    {imageBranchOptions.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button className="detail-action" type="button" onClick={onLocalEdit}>
                <PenLine size={15} />
                局部修改
              </button>
              <button className="detail-action brand" type="button" onClick={onReferenceIntent}>
                <Sparkles size={14} />
                设为后续默认参考
              </button>
            </>
          ) : null}

          {primary.type === "keyConclusion" ? (
            <KeyConclusionActions
              keyConclusion={primary}
              candidates={keyConclusionCandidates}
              supersededById={supersededById}
              onSupersededByIdChange={setSupersededById}
              onSetKeyConclusionState={onSetKeyConclusionState}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function KeyConclusionActions({
  keyConclusion,
  candidates,
  supersededById,
  onSupersededByIdChange,
  onSetKeyConclusionState
}: {
  keyConclusion: KeyConclusionObject;
  candidates: KeyConclusionObject[];
  supersededById: string;
  onSupersededByIdChange: (value: string) => void;
  onSetKeyConclusionState: BottomDetailBarProps["onSetKeyConclusionState"];
}) {
  return (
    <>
      {keyConclusion.state !== "needsVerification" ? (
        <button
          className="detail-action"
          type="button"
          onClick={() => onSetKeyConclusionState(keyConclusion.id, "needsVerification")}
        >
          <ListChecks size={15} />
          标为待验证
        </button>
      ) : (
        <button className="detail-action" type="button" onClick={() => onSetKeyConclusionState(keyConclusion.id, "active")}>
          <ListChecks size={15} />
          恢复 active
        </button>
      )}

      {keyConclusion.state !== "archived" ? (
        <button className="detail-action" type="button" onClick={() => onSetKeyConclusionState(keyConclusion.id, "archived")}>
          <EyeOff size={15} />
          归档
        </button>
      ) : (
        <button className="detail-action" type="button" onClick={() => onSetKeyConclusionState(keyConclusion.id, "active")}>
          <EyeOff size={15} />
          恢复 active
        </button>
      )}

      {keyConclusion.state !== "superseded" ? (
        <>
          <label className="detail-select">
            <span>替代为</span>
            <select value={supersededById} onChange={(event) => onSupersededByIdChange(event.currentTarget.value)}>
              <option value="">请选择</option>
              {candidates
                .filter((candidate) => candidate.id !== keyConclusion.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="detail-action"
            type="button"
            disabled={!supersededById}
            onClick={() => onSetKeyConclusionState(keyConclusion.id, "superseded", supersededById || undefined)}
          >
            <Ban size={15} />
            标为已替代
          </button>
        </>
      ) : (
        <button className="detail-action" type="button" onClick={() => onSetKeyConclusionState(keyConclusion.id, "active")}>
          <Ban size={15} />
          恢复 active
        </button>
      )}
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
  keyConclusionCandidates: KeyConclusionObject[];
  supersededById: string;
  setSupersededById: (value: string) => void;
  onSaveKeyConclusionFromResearchItem: BottomDetailBarProps["onSaveKeyConclusionFromResearchItem"];
  onCopyItemToDraft: BottomDetailBarProps["onCopyItemToDraft"];
  onContinueQuestion: BottomDetailBarProps["onContinueQuestion"];
  onRenameVisualBranch: BottomDetailBarProps["onRenameVisualBranch"];
  onArchiveVisualBranch: BottomDetailBarProps["onArchiveVisualBranch"];
  onRestoreVisualBranch: BottomDetailBarProps["onRestoreVisualBranch"];
}) {
  const {
    tab,
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
      return (
        <ResearchDetail
          object={object}
          onSaveKeyConclusionFromResearchItem={input.onSaveKeyConclusionFromResearchItem}
          onCopyItemToDraft={input.onCopyItemToDraft}
          onContinueQuestion={input.onContinueQuestion}
        />
      );
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
      return (
        <>
          <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
          <span className="detail-meta">
            状态：{object.status} · 当前修订：{object.currentRevisionId}
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

function ResearchDetail({
  object,
  onSaveKeyConclusionFromResearchItem,
  onCopyItemToDraft,
  onContinueQuestion
}: {
  object: ResearchObject;
  onSaveKeyConclusionFromResearchItem: BottomDetailBarProps["onSaveKeyConclusionFromResearchItem"];
  onCopyItemToDraft: BottomDetailBarProps["onCopyItemToDraft"];
  onContinueQuestion: BottomDetailBarProps["onContinueQuestion"];
}) {
  return (
    <div className="research-detail">
      <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
      <ResearchGroup
        label="发现"
        items={object.findings}
        kind="finding"
        researchObjectId={object.id}
        onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
        onCopyItemToDraft={onCopyItemToDraft}
        onContinueQuestion={onContinueQuestion}
      />
      <ResearchGroup
        label="机会点"
        items={object.opportunities}
        kind="opportunity"
        researchObjectId={object.id}
        onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
        onCopyItemToDraft={onCopyItemToDraft}
        onContinueQuestion={onContinueQuestion}
      />
      <ResearchGroup
        label="约束"
        items={object.constraints}
        kind="constraint"
        researchObjectId={object.id}
        onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
        onCopyItemToDraft={onCopyItemToDraft}
        onContinueQuestion={onContinueQuestion}
      />
      <ResearchGroup
        label="待验证问题"
        items={object.openQuestions}
        kind="openQuestion"
        researchObjectId={object.id}
        onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
        onCopyItemToDraft={onCopyItemToDraft}
        onContinueQuestion={onContinueQuestion}
      />
      {object.evidence && object.evidence.length > 0 ? (
        <section className="research-detail-group">
          <h4>证据</h4>
          {object.evidence.map((item, index) => (
            <div className="research-item" key={`${object.id}-evidence-${index}`}>
              <div className="research-item-body">
                <strong>{item.claim}</strong>
                <span className="detail-meta">
                  来源：{item.sourceObjectIds.join("、") || "无"} · 引用：{item.citationIds.join("、") || "无"} · 置信度：
                  {item.confidence}
                </span>
              </div>
              <ResearchItemActions
                text={item.claim}
                researchObjectId={object.id}
                kind="evidence"
                index={index}
                onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
                onCopyItemToDraft={onCopyItemToDraft}
                onContinueQuestion={onContinueQuestion}
              />
            </div>
          ))}
        </section>
      ) : null}
      {object.provenance ? (
        <span className="detail-meta">
          来源对象：{object.provenance.sourceObjectIds.join("、") || "无"} · 引用：
          {object.provenance.citationIds.join("、") || "无"}
        </span>
      ) : null}
    </div>
  );
}

function ResearchGroup({
  label,
  items,
  kind,
  researchObjectId,
  onSaveKeyConclusionFromResearchItem,
  onCopyItemToDraft,
  onContinueQuestion
}: {
  label: string;
  items: string[];
  kind: Exclude<ResearchSourceKind, "evidence">;
  researchObjectId: string;
  onSaveKeyConclusionFromResearchItem: BottomDetailBarProps["onSaveKeyConclusionFromResearchItem"];
  onCopyItemToDraft: BottomDetailBarProps["onCopyItemToDraft"];
  onContinueQuestion: BottomDetailBarProps["onContinueQuestion"];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="research-detail-group">
      <h4>{label}</h4>
      {items.map((item, index) => (
        <div className="research-item" key={`${researchObjectId}-${kind}-${index}`}>
          <div className="research-item-body">
            <strong>{item}</strong>
          </div>
          <ResearchItemActions
            text={item}
            researchObjectId={researchObjectId}
            kind={kind}
            index={index}
            onSaveKeyConclusionFromResearchItem={onSaveKeyConclusionFromResearchItem}
            onCopyItemToDraft={onCopyItemToDraft}
            onContinueQuestion={onContinueQuestion}
          />
        </div>
      ))}
    </section>
  );
}

function ResearchItemActions({
  text,
  researchObjectId,
  kind,
  index,
  onSaveKeyConclusionFromResearchItem,
  onCopyItemToDraft,
  onContinueQuestion
}: {
  text: string;
  researchObjectId: string;
  kind: ResearchSourceKind;
  index: number;
  onSaveKeyConclusionFromResearchItem: BottomDetailBarProps["onSaveKeyConclusionFromResearchItem"];
  onCopyItemToDraft: BottomDetailBarProps["onCopyItemToDraft"];
  onContinueQuestion: BottomDetailBarProps["onContinueQuestion"];
}) {
  return (
    <div className="research-item-actions">
      <button type="button" onClick={() => onSaveKeyConclusionFromResearchItem({ researchObjectId, sourceKind: kind, index })}>
        <Target size={13} />
        保留为关键结论
      </button>
      <button type="button" onClick={() => onCopyItemToDraft(text)}>
        复制到输入框
      </button>
      <button type="button" onClick={() => onContinueQuestion(text)}>
        继续追问
      </button>
    </div>
  );
}
