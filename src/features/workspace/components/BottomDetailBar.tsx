"use client";

import { GitBranch, Info, MessageSquareText, PenLine, Sparkles } from "lucide-react";
import { useState } from "react";

import type { MorphoObject, MorphoRelation } from "@/domain/morpho/types";
import { getObjectTypeLabel } from "../workspaceUi";

type BottomDetailBarProps = {
  selectedObjects: MorphoObject[];
  relations: MorphoRelation[];
  onAskAi: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
};

const tabs = ["信息", "来源", "版本", "关联", "决策"] as const;
type DetailTab = (typeof tabs)[number];

export function BottomDetailBar({
  selectedObjects,
  relations,
  onAskAi,
  onLocalEdit,
  onReferenceIntent
}: BottomDetailBarProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("信息");

  if (selectedObjects.length === 0) {
    return null;
  }

  const primary = selectedObjects[0];
  const related = relations.filter(
    (relation) => relation.fromObjectId === primary.id || relation.toObjectId === primary.id
  );

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
        <div className="detail-content">{renderDetail(activeTab, primary, related, selectedObjects.length)}</div>
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
          {primary.type === "image" ? (
            <>
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

function renderDetail(tab: DetailTab, object: MorphoObject, relations: MorphoRelation[], selectedCount: number) {
  if (selectedCount > 1) {
    return "多选仅作为当前 AI 输入和局部操作范围，不会改变这些对象的阶段语义或关系。";
  }

  if (tab === "信息") {
    return (
      <>
        <strong>{getObjectTypeLabel(object)}</strong> · {object.summary}
      </>
    );
  }

  if (tab === "来源") {
    const source = relations.find((relation) => relation.kind === "source");
    return source ? source.note : "没有直接来源对象，或来源信息尚未展开。";
  }

  if (tab === "版本") {
    const versions = relations.filter((relation) => relation.kind === "version");
    return versions.length > 0
      ? versions.map((relation) => relation.note).join(" ")
      : "仅显示直接父版本、当前对象和直接子结果；当前没有直接版本关系。";
  }

  if (tab === "关联") {
    return relations.length > 0 ? relations.map((relation) => relation.note).join(" ") : "没有直接关联。";
  }

  return "关键决定需要用户明确确认；AI 不会因为选择对象而自动改变主方向、默认参考或交付引用。";
}
