"use client";

import { FilePlus2, GripVertical, PackageOpen, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { DeliveryObject, DeliveryReference, DeliverySection, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import {
  buildDeliveryReferenceRefreshPreview,
  canRefreshDeliveryReference,
  canAddObjectToDelivery,
  deliveryFormatLabel,
  deliverySourceStateLabel,
  getDeliveryReferenceLocationTarget,
  getDeliveryObjects,
  getDeliverySectionReferences
} from "../deliveryPreparationUi";
import { resolveDeliveryReferenceState } from "@/domain/morpho/deliveryPreparation";
import { getObjectTypeLabel } from "../workspaceUi";

type DeliveryPreparationPanelProps = {
  workspace: MorphoWorkspace;
  selectedObjects: MorphoObject[];
  activeDeliveryObjectId: string | null;
  isStreaming: boolean;
  onClose: () => void;
  onCreateDelivery: (input: { title: string; format: DeliveryObject["format"] }) => void;
  onSelectDelivery: (deliveryObjectId: string) => void;
  onLocateObject: (objectId: string) => void;
  onAddSelectedObjects: (input: { deliveryObjectId: string; sectionId: string; sourceObjectIds: string[] }) => void;
  onCreateSection: (input: { deliveryObjectId: string; title: string; purpose?: string }) => void;
  onUpdateSection: (input: { deliveryObjectId: string; sectionId: string; title?: string; purpose?: string; narrative?: string }) => void;
  onMoveSection: (input: { deliveryObjectId: string; sectionId: string; toIndex: number }) => void;
  onRemoveSection: (input: { deliveryObjectId: string; sectionId: string }) => void;
  onMoveReference: (input: { deliveryObjectId: string; referenceId: string; toSectionId: string; toIndex: number }) => void;
  onRemoveReference: (input: { deliveryObjectId: string; referenceId: string }) => void;
  onUpdateReferenceEditorial: (input: { deliveryObjectId: string; referenceId: string; caption?: string; note?: string }) => void;
  onRefreshReference: (input: { deliveryObjectId: string; referenceId: string }) => void;
  onAddGap: (input: { deliveryObjectId: string; sectionId?: string; label: string }) => void;
  onSetGapStatus: (input: { deliveryObjectId: string; gapId: string; status: "open" | "resolved" }) => void;
  onRemoveGap: (input: { deliveryObjectId: string; gapId: string }) => void;
  onRequestSectionDraft: (input: { deliveryObjectId: string; sectionId: string }) => void;
  onApplyDraft: (input: { deliveryObjectId: string; draftId: string }) => void;
  onDiscardDraft: (input: { deliveryObjectId: string; draftId: string }) => void;
};

export function DeliveryPreparationPanel({
  workspace,
  selectedObjects,
  activeDeliveryObjectId,
  isStreaming,
  onClose,
  onCreateDelivery,
  onSelectDelivery,
  onLocateObject,
  onAddSelectedObjects,
  onCreateSection,
  onUpdateSection,
  onMoveSection,
  onRemoveSection,
  onMoveReference,
  onRemoveReference,
  onUpdateReferenceEditorial,
  onRefreshReference,
  onAddGap,
  onSetGapStatus,
  onRemoveGap,
  onRequestSectionDraft,
  onApplyDraft,
  onDiscardDraft
}: DeliveryPreparationPanelProps) {
  const deliveryObjects = useMemo(() => getDeliveryObjects(workspace), [workspace]);
  const activeDelivery =
    deliveryObjects.find((delivery) => delivery.id === activeDeliveryObjectId) ?? deliveryObjects[0] ?? null;
  const [draftTitle, setDraftTitle] = useState("课程阶段展示");
  const [draftFormat, setDraftFormat] = useState<DeliveryObject["format"]>("presentation");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [gapLabel, setGapLabel] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionPurpose, setSectionPurpose] = useState("");
  const [preferNewestSectionDeliveryId, setPreferNewestSectionDeliveryId] = useState<string | null>(null);

  const newestSection =
    activeDelivery && preferNewestSectionDeliveryId === activeDelivery.id
      ? [...activeDelivery.sections].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  const activeSection = activeDelivery?.sections.find((section) => section.id === activeSectionId) ?? newestSection ?? activeDelivery?.sections[0];
  const addableSelectedObjects = selectedObjects.filter(canAddObjectToDelivery);
  const activeDrafts = activeDelivery
    ? Object.values(workspace.deliverySectionDrafts)
        .filter((draft) => draft.deliveryObjectId === activeDelivery.id && draft.status === "pending")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <section className="delivery-panel" aria-label="交付准备">
      <div className="delivery-panel-head">
        <div>
          <span className="delivery-eyebrow">交付准备</span>
          <h2>章节、引用与待补内容</h2>
          <p>这里整理可继续编辑的交付内容，不做最终排版、导出或归档。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭交付准备" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="delivery-panel-grid">
        <aside className="delivery-sidebar">
          <section className="delivery-create-card">
            <div className="delivery-card-title">
              <PackageOpen size={15} />
              新建交付准备包
            </div>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.currentTarget.value)} aria-label="交付准备标题" />
            <select
              value={draftFormat}
              onChange={(event) => setDraftFormat(event.currentTarget.value as DeliveryObject["format"])}
              aria-label="交付形式"
            >
              <option value="presentation">演示文稿</option>
              <option value="board">展板</option>
            </select>
            <button className="brand-button" type="button" onClick={() => onCreateDelivery({ title: draftTitle, format: draftFormat })}>
              <Plus size={14} />
              新建
            </button>
          </section>

          <div className="delivery-list-title">已有准备包</div>
          {deliveryObjects.map((delivery) => (
            <button
              className={`delivery-package-row ${activeDelivery?.id === delivery.id ? "active" : ""}`}
              key={delivery.id}
              type="button"
              onClick={() => onSelectDelivery(delivery.id)}
            >
              <strong>{delivery.title}</strong>
              <span>
                {deliveryFormatLabel(delivery.format)} · {delivery.sections.length} 节 · {delivery.references.length} 引用
              </span>
            </button>
          ))}
        </aside>

        {activeDelivery && activeSection ? (
          <div className="delivery-main">
            <div className="delivery-meta-row">
              <strong>{activeDelivery.title}</strong>
              <span>{deliveryFormatLabel(activeDelivery.format)}</span>
              <span>{activeDelivery.gaps.filter((gap) => gap.status === "open").length} 项待补</span>
            </div>

            <div className="delivery-section-tabs" aria-label="交付章节">
              {activeDelivery.sections.map((section, index) => (
                <button
                  className={`delivery-section-tab ${section.id === activeSection.id ? "active" : ""}`}
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSectionId(section.id);
                    setPreferNewestSectionDeliveryId(null);
                  }}
                >
                  <span>{index + 1}</span>
                  {section.title}
                </button>
              ))}
            </div>

            <section className="delivery-section-create">
              <div className="delivery-card-title">新增章节</div>
              <input
                value={sectionTitle}
                onChange={(event) => setSectionTitle(event.currentTarget.value)}
                placeholder="章节标题"
                aria-label="新增章节标题"
              />
              <textarea
                value={sectionPurpose}
                onChange={(event) => setSectionPurpose(event.currentTarget.value)}
                placeholder="可选：本章节目的"
                aria-label="新增章节目的"
              />
              <button
                className="plain-button"
                type="button"
                disabled={!sectionTitle.trim()}
                onClick={() => {
                  onCreateSection({
                    deliveryObjectId: activeDelivery.id,
                    title: sectionTitle,
                    purpose: sectionPurpose
                  });
                  setSectionTitle("");
                  setSectionPurpose("");
                  setActiveSectionId(null);
                  setPreferNewestSectionDeliveryId(activeDelivery.id);
                }}
              >
                <Plus size={14} />
                新增章节
              </button>
            </section>

            <SectionEditor
              delivery={activeDelivery}
              section={activeSection}
              onUpdateSection={onUpdateSection}
              onMoveSection={onMoveSection}
              onRemoveSection={onRemoveSection}
            />

            <div className="delivery-action-row">
              <button
                className="plain-button"
                type="button"
                disabled={addableSelectedObjects.length === 0}
                title={addableSelectedObjects.length === 0 ? "请选择 active 的非交付对象" : "把当前选择保存为稳定交付引用"}
                onClick={() =>
                  onAddSelectedObjects({
                    deliveryObjectId: activeDelivery.id,
                    sectionId: activeSection.id,
                    sourceObjectIds: addableSelectedObjects.map((object) => object.id)
                  })
                }
              >
                <FilePlus2 size={14} />
                加入当前选中对象
              </button>
              <button
                className="plain-button"
                type="button"
                disabled={activeSection.referenceIds.length === 0 || isStreaming}
                onClick={() => onRequestSectionDraft({ deliveryObjectId: activeDelivery.id, sectionId: activeSection.id })}
              >
                <Sparkles size={14} />
                生成本节说明草稿
              </button>
            </div>

            <ReferenceList
              workspace={workspace}
              delivery={activeDelivery}
              section={activeSection}
              onLocateObject={onLocateObject}
              onMoveReference={onMoveReference}
              onRemoveReference={onRemoveReference}
              onUpdateReferenceEditorial={onUpdateReferenceEditorial}
              onRefreshReference={onRefreshReference}
            />

            <section className="delivery-gaps">
              <div className="delivery-card-title">待补内容</div>
              <div className="delivery-gap-input">
                <input value={gapLabel} onChange={(event) => setGapLabel(event.currentTarget.value)} placeholder="例如：补充安装示意图" />
                <button
                  className="plain-button"
                  type="button"
                  onClick={() => {
                    onAddGap({ deliveryObjectId: activeDelivery.id, sectionId: activeSection.id, label: gapLabel });
                    setGapLabel("");
                  }}
                >
                  添加
                </button>
              </div>
              {activeDelivery.gaps
                .filter((gap) => !gap.sectionId || gap.sectionId === activeSection.id)
                .map((gap) => (
                  <div className={`delivery-gap-row ${gap.status}`} key={gap.id}>
                    <span>{gap.label}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onSetGapStatus({
                          deliveryObjectId: activeDelivery.id,
                          gapId: gap.id,
                          status: gap.status === "open" ? "resolved" : "open"
                        })
                      }
                    >
                      {gap.status === "open" ? "标记解决" : "重新打开"}
                    </button>
                    <button type="button" onClick={() => onRemoveGap({ deliveryObjectId: activeDelivery.id, gapId: gap.id })}>
                      移除
                    </button>
                  </div>
                ))}
            </section>

            {activeDrafts.length > 0 ? (
              <section className="delivery-draft-stack">
                <div className="delivery-card-title">交付说明草稿</div>
                {activeDrafts.map((draft) => (
                  <article className="delivery-draft-card" key={draft.id}>
                    <strong>{draft.title ?? activeDelivery.sections.find((section) => section.id === draft.sectionId)?.title ?? "章节草稿"}</strong>
                    <p>{draft.narrative}</p>
                    {draft.captions.length > 0 ? <span>图注建议：{draft.captions.length} 条</span> : null}
                    {draft.suggestedGaps.length > 0 ? <span>待补建议：{draft.suggestedGaps.map((gap) => gap.label).join(" / ")}</span> : null}
                    <div className="delivery-action-row">
                      <button className="brand-button" type="button" onClick={() => onApplyDraft({ deliveryObjectId: activeDelivery.id, draftId: draft.id })}>
                        应用草稿
                      </button>
                      <button className="plain-button" type="button" onClick={() => onDiscardDraft({ deliveryObjectId: activeDelivery.id, draftId: draft.id })}>
                        放弃
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="delivery-empty">
            <PackageOpen size={30} />
            <strong>还没有交付准备包</strong>
            <p>新建后会得到一组可编辑章节，再由你明确选择哪些画布对象加入哪个章节。</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionEditor({
  delivery,
  section,
  onUpdateSection,
  onMoveSection,
  onRemoveSection
}: {
  delivery: DeliveryObject;
  section: DeliverySection;
  onUpdateSection: DeliveryPreparationPanelProps["onUpdateSection"];
  onMoveSection: DeliveryPreparationPanelProps["onMoveSection"];
  onRemoveSection: DeliveryPreparationPanelProps["onRemoveSection"];
}) {
  return (
    <section className="delivery-section-editor">
      <input
        value={section.title}
        aria-label="章节标题"
        onChange={(event) =>
          onUpdateSection({ deliveryObjectId: delivery.id, sectionId: section.id, title: event.currentTarget.value })
        }
      />
      <textarea
        value={section.purpose ?? ""}
        aria-label="章节目的"
        placeholder="章节目的或说明"
        onChange={(event) =>
          onUpdateSection({ deliveryObjectId: delivery.id, sectionId: section.id, purpose: event.currentTarget.value })
        }
      />
      <textarea
        value={section.narrative ?? ""}
        aria-label="章节说明"
        placeholder="用户确认后的章节说明会写在这里。AI 草稿不会自动应用。"
        onChange={(event) =>
          onUpdateSection({ deliveryObjectId: delivery.id, sectionId: section.id, narrative: event.currentTarget.value })
        }
      />
      <div className="delivery-action-row">
        <button
          type="button"
          className="plain-button"
          disabled={section.order <= 0}
          onClick={() => onMoveSection({ deliveryObjectId: delivery.id, sectionId: section.id, toIndex: section.order - 1 })}
        >
          <GripVertical size={14} />
          上移
        </button>
        <button
          type="button"
          className="plain-button"
          disabled={section.order >= delivery.sections.length - 1}
          onClick={() => onMoveSection({ deliveryObjectId: delivery.id, sectionId: section.id, toIndex: section.order + 1 })}
        >
          下移
        </button>
        <button
          type="button"
          className="plain-button danger"
          disabled={section.referenceIds.length > 0 || delivery.gaps.some((gap) => gap.sectionId === section.id && gap.status === "open")}
          onClick={() => onRemoveSection({ deliveryObjectId: delivery.id, sectionId: section.id })}
        >
          <Trash2 size={14} />
          删除空章节
        </button>
      </div>
    </section>
  );
}

function ReferenceList({
  workspace,
  delivery,
  section,
  onLocateObject,
  onMoveReference,
  onRemoveReference,
  onUpdateReferenceEditorial,
  onRefreshReference
}: {
  workspace: MorphoWorkspace;
  delivery: DeliveryObject;
  section: DeliverySection;
  onLocateObject: DeliveryPreparationPanelProps["onLocateObject"];
  onMoveReference: DeliveryPreparationPanelProps["onMoveReference"];
  onRemoveReference: DeliveryPreparationPanelProps["onRemoveReference"];
  onUpdateReferenceEditorial: DeliveryPreparationPanelProps["onUpdateReferenceEditorial"];
  onRefreshReference: DeliveryPreparationPanelProps["onRefreshReference"];
}) {
  const references = getDeliverySectionReferences(workspace, section);
  const [pendingRefreshReferenceId, setPendingRefreshReferenceId] = useState<string | null>(null);
  if (references.length === 0) {
    return <p className="delivery-muted">本节还没有交付引用。选择画布对象后点击“加入当前选中对象”。</p>;
  }

  return (
    <section className="delivery-reference-list" aria-label="交付引用">
      {references.map((reference, index) => {
        const source = reference.sourceObjectId ? workspace.objects[reference.sourceObjectId] : undefined;
        const state = resolveDeliveryReferenceState(workspace, reference.id);
        const locationTarget = getDeliveryReferenceLocationTarget(workspace, reference);
        const canRefresh = canRefreshDeliveryReference(workspace, reference);
        const refreshPreview =
          pendingRefreshReferenceId === reference.id ? buildDeliveryReferenceRefreshPreview(workspace, reference) : null;
        return (
          <article className="delivery-reference-card" key={reference.id}>
            <div className="delivery-reference-head">
              <div>
                <span className={`delivery-source-state ${state.status}`}>{deliverySourceStateLabel(state.status)}</span>
                <strong>{reference.snapshot.title}</strong>
                <p>
                  {reference.snapshot.sourceType} · {reference.snapshot.summary ?? "稳定快照"}
                </p>
              </div>
              {locationTarget ? (
                <button type="button" className="plain-button" onClick={() => onLocateObject(locationTarget.objectId)}>
                  {locationTarget.label}
                </button>
              ) : null}
            </div>
            {reference.snapshot.body ? (
              <p className="delivery-reference-body">
                {reference.snapshot.bodyKind === "excerpt" ? "交付引用摘录：" : "交付引用正文："}
                {reference.snapshot.body}
              </p>
            ) : null}
            {reference.snapshot.sourceFile ? (
              <span className="delivery-muted">
                来源文件快照：{reference.snapshot.sourceFile.title}
                {reference.snapshot.sourceFile.startOffset !== undefined
                  ? ` · 字符 ${reference.snapshot.sourceFile.startOffset}-${reference.snapshot.sourceFile.endOffset ?? ""}`
                  : ""}
              </span>
            ) : null}
            <input
              value={reference.editorial?.caption ?? ""}
              placeholder="图注 / 引用说明"
              onChange={(event) =>
                onUpdateReferenceEditorial({
                  deliveryObjectId: delivery.id,
                  referenceId: reference.id,
                  caption: event.currentTarget.value
                })
              }
            />
            <textarea
              value={reference.editorial?.note ?? ""}
              placeholder="内部备注"
              onChange={(event) =>
                onUpdateReferenceEditorial({
                  deliveryObjectId: delivery.id,
                  referenceId: reference.id,
                  note: event.currentTarget.value
                })
              }
            />
            <div className="delivery-action-row">
              <button
                type="button"
                className="plain-button"
                disabled={index <= 0}
                onClick={() =>
                  onMoveReference({ deliveryObjectId: delivery.id, referenceId: reference.id, toSectionId: section.id, toIndex: index - 1 })
                }
              >
                上移
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={index >= references.length - 1}
                onClick={() =>
                  onMoveReference({ deliveryObjectId: delivery.id, referenceId: reference.id, toSectionId: section.id, toIndex: index + 1 })
                }
              >
                下移
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={!canRefresh}
                onClick={() => setPendingRefreshReferenceId(reference.id)}
              >
                <RefreshCw size={14} />
                更新为当前版本
              </button>
              <select
                value=""
                aria-label="移动引用到其他章节"
                onChange={(event) => {
                  const targetSectionId = event.currentTarget.value;
                  const targetSection = delivery.sections.find((candidate) => candidate.id === targetSectionId);
                  if (!targetSection) {
                    return;
                  }
                  onMoveReference({
                    deliveryObjectId: delivery.id,
                    referenceId: reference.id,
                    toSectionId: targetSection.id,
                    toIndex: targetSection.referenceIds.length
                  });
                  event.currentTarget.value = "";
                }}
              >
                <option value="">移到其他章节</option>
                {delivery.sections
                  .filter((candidate) => candidate.id !== section.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="plain-button danger"
                onClick={() => onRemoveReference({ deliveryObjectId: delivery.id, referenceId: reference.id })}
              >
                移除引用
              </button>
            </div>
            {refreshPreview ? (
              <div className="delivery-refresh-preview">
                <strong>确认更新引用快照</strong>
                {refreshPreview.status === "ready" ? (
                  <>
                    <p>当前引用快照：{reference.snapshot.title}</p>
                    <p>当前来源版本：{refreshPreview.currentSnapshot.title}</p>
                    <span>变化项：{refreshPreview.changeLabels.join(" / ")}</span>
                    <div className="delivery-action-row">
                      <button className="plain-button" type="button" onClick={() => setPendingRefreshReferenceId(null)}>
                        取消
                      </button>
                      <button
                        className="brand-button"
                        type="button"
                        onClick={() => {
                          onRefreshReference({ deliveryObjectId: delivery.id, referenceId: reference.id });
                          setPendingRefreshReferenceId(null);
                        }}
                      >
                        确认更新
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{refreshPreview.reason}</p>
                    <button className="plain-button" type="button" onClick={() => setPendingRefreshReferenceId(null)}>
                      关闭
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {source ? <span className="delivery-muted">来源类型：{getObjectTypeLabel(source)}；刷新引用不会修改来源对象。</span> : null}
          </article>
        );
      })}
    </section>
  );
}
