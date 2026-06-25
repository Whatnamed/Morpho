"use client";

import {
  Ban,
  EyeOff,
  Flag,
  GitBranch,
  Info,
  MessageSquareText,
  PenLine,
  Sparkles,
  Target,
  Trash2
} from "lucide-react";
import { useState } from "react";

import type { DecisionRecord, ImageRole, MorphoObject, MorphoRelation } from "@/domain/morpho/types";
import { getObjectTypeLabel, imageRoleLabel } from "../workspaceUi";

type BottomDetailBarProps = {
  selectedObjects: MorphoObject[];
  relations: MorphoRelation[];
  decisionRecords: DecisionRecord[];
  onAskAi: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
  onHide: () => void;
  onDelete: () => void;
  onEliminateDirection: () => void;
  onSetDirectionPrimary: () => void;
  onSetDirectionAlternative: () => void;
  onRestoreDirectionAsAlternative: () => void;
  onSaveKeyConclusion: () => void;
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
  "deliveryAsset",
  "main",
  "scenario",
  "cmf",
  "detail",
  "diagram"
];

export function BottomDetailBar({
  selectedObjects,
  relations,
  decisionRecords,
  onAskAi,
  onLocalEdit,
  onReferenceIntent,
  onHide,
  onDelete,
  onEliminateDirection,
  onSetDirectionPrimary,
  onSetDirectionAlternative,
  onRestoreDirectionAsAlternative,
  onSaveKeyConclusion,
  onSetImageRole
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
  const showKeyConclusionAction = canSaveKeyConclusionFromObject(primary) && selectedObjects.length === 1;
  const showDirectionActions = primary.type === "conceptDirection" && selectedObjects.length === 1;

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
          {renderDetail(activeTab, primary, related, relatedDecisions, selectedObjects.length)}
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

          <button className="detail-action" type="button">
            <GitBranch size={15} />
            直接关系
          </button>

          {showKeyConclusionAction ? (
            <button className="detail-action" type="button" onClick={onSaveKeyConclusion}>
              <Target size={15} />
              保留为关键结论
            </button>
          ) : null}

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
        </div>
      </div>
    </>
  );
}

function renderDetail(
  tab: DetailTab,
  object: MorphoObject,
  relations: MorphoRelation[],
  decisionRecords: DecisionRecord[],
  selectedCount: number
) {
  if (selectedCount > 1) {
    return "多选当前只作为 AI 输入与局部比较范围，不会因为同时选中就自动改变对象语义、方向状态或交付关系。";
  }

  if (tab === "信息") {
    return (
      <>
        <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
        {object.type === "keyConclusion" ? (
          <span className="detail-meta">
            置信度：{object.confidence} · 状态：{object.state}
          </span>
        ) : null}
        {object.type === "image" && object.generation ? (
          <span className="detail-meta">
            生成：{object.generation.modelLabel} · {object.generation.aspectRatio}
            {object.generation.sizeOption ? ` · ${object.generation.sizeOption}` : ""} ·{" "}
            {object.generation.createdAt.slice(0, 10)}
          </span>
        ) : null}
        {object.type === "designDefinition" ? (
          <span className="detail-meta">当前修订：{object.currentRevisionId}</span>
        ) : null}
      </>
    );
  }

  if (tab === "来源") {
    const sourceRelations = relations.filter(
      (relation) => relation.kind === "source" || relation.kind === "supports" || relation.kind === "supportsConclusion"
    );
    return sourceRelations.length > 0
      ? sourceRelations.map((relation) => relation.note).join(" ")
      : "当前没有展开的直接来源说明。";
  }

  if (tab === "版本") {
    if (object.type === "designDefinition") {
      return `当前设计定义共有 ${object.revisionIds.length} 个修订，当前有效修订为 ${object.currentRevisionId}。`;
    }

    if (object.type === "conceptDirection") {
      return `当前方向共有 ${object.revisionIds.length} 个修订，当前修订为 ${object.currentRevisionId}。`;
    }

    const versions = relations.filter((relation) => relation.kind === "version");
    return versions.length > 0
      ? versions.map((relation) => relation.note).join(" ")
      : "当前没有直接版本关系。";
  }

  if (tab === "关联") {
    return relations.length > 0 ? relations.map((relation) => relation.note).join(" ") : "当前没有直接关联。";
  }

  return decisionRecords.length > 0
    ? decisionRecords
        .map((record) => `${record.summary}${record.reason ? `（${record.reason}）` : ""}`)
        .join(" ")
    : "关键决定需要用户明确确认；AI 不会因为选中对象而自动改主方向、默认参考或交付引用。";
}

function canSaveKeyConclusionFromObject(object: MorphoObject): boolean {
  return object.type === "research" || object.type === "text" || object.type === "link" || object.type === "file";
}
