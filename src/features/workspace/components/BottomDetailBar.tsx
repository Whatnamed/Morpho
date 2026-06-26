"use client";

import {
  Ban,
  EyeOff,
  Flag,
  GitBranch,
  Info,
  ListChecks,
  MessageSquareText,
  PenLine,
  Sparkles,
  Target,
  Trash2
} from "lucide-react";
import { useState } from "react";

import type {
  DecisionRecord,
  ImageRole,
  KeyConclusionObject,
  MorphoObject,
  MorphoRelation,
  ResearchObject
} from "@/domain/morpho/types";
import { getObjectTypeLabel, imageRoleLabel } from "../workspaceUi";

type ResearchSourceKind = "finding" | "opportunity" | "constraint" | "openQuestion" | "evidence";

type BottomDetailBarProps = {
  selectedObjects: MorphoObject[];
  hasPendingDesignDefinitionRevisionDraft: boolean;
  keyConclusionCandidates: KeyConclusionObject[];
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
  "deliveryAsset",
  "main",
  "scenario",
  "cmf",
  "detail",
  "diagram"
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

export function BottomDetailBar({
  selectedObjects,
  hasPendingDesignDefinitionRevisionDraft,
  keyConclusionCandidates,
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
            selectedCount: selectedObjects.length,
            hasPendingDesignDefinitionRevisionDraft,
            keyConclusionCandidates,
            supersededById,
            setSupersededById,
            onSaveKeyConclusionFromResearchItem,
            onCopyItemToDraft,
            onContinueQuestion
          })}
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

function renderDetail(input: {
  tab: DetailTab;
  object: MorphoObject;
  relations: MorphoRelation[];
  decisionRecords: DecisionRecord[];
  selectedCount: number;
  hasPendingDesignDefinitionRevisionDraft: boolean;
  keyConclusionCandidates: KeyConclusionObject[];
  supersededById: string;
  setSupersededById: (value: string) => void;
  onSaveKeyConclusionFromResearchItem: BottomDetailBarProps["onSaveKeyConclusionFromResearchItem"];
  onCopyItemToDraft: BottomDetailBarProps["onCopyItemToDraft"];
  onContinueQuestion: BottomDetailBarProps["onContinueQuestion"];
}) {
  const { tab, object, relations, decisionRecords, selectedCount, hasPendingDesignDefinitionRevisionDraft } = input;
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
      return buildDesignDefinitionVersionDetail(object.revisionIds.length, hasPendingDesignDefinitionRevisionDraft);
    }

    if (object.type === "conceptDirection") {
      return `当前方向共有 ${object.revisionIds.length} 个修订，当前修订为 ${object.currentRevisionId}。`;
    }

    const versions = relations.filter((relation) => relation.kind === "version");
    return versions.length > 0 ? versions.map((relation) => relation.note).join(" ") : "当前没有直接版本关系。";
  }

  if (tab === "关联") {
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
