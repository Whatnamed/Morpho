"use client";

import { Download, FileWarning, PackageCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DeliveryObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { DeliveryOutputExportSummary, InspectDeliveryOutputResult } from "@/features/delivery-output/deliveryOutputClient";
import { deliveryFormatLabel, getDeliveryObjects } from "../deliveryPreparationUi";

type DeliveryOutputPanelProps = {
  workspace: MorphoWorkspace;
  selectedObjectIds: string[];
  activeDeliveryObjectId: string | null;
  busyLabel: string | null;
  message: {
    tone: "neutral" | "success" | "warning" | "error";
    text: string;
  } | null;
  preflight: InspectDeliveryOutputResult | null;
  onClose: () => void;
  onInspect: (deliveryObjectId: string) => void;
  onExport: (deliveryObjectId: string) => void;
};

export function DeliveryOutputPanel({
  workspace,
  selectedObjectIds,
  activeDeliveryObjectId,
  busyLabel,
  message,
  preflight,
  onClose,
  onInspect,
  onExport
}: DeliveryOutputPanelProps) {
  const deliveryObjects = useMemo(() => getDeliveryObjects(workspace), [workspace]);
  const defaultDeliveryId = resolveDefaultDeliveryId(deliveryObjects, selectedObjectIds, activeDeliveryObjectId, workspace);
  const [manualSelectedDeliveryId, setManualSelectedDeliveryId] = useState<string | null>(null);
  const selectedDeliveryId = deliveryObjects.some((delivery) => delivery.id === manualSelectedDeliveryId)
    ? manualSelectedDeliveryId
    : defaultDeliveryId;
  const selectedDelivery = deliveryObjects.find((delivery) => delivery.id === selectedDeliveryId) ?? null;
  const selectedDeliveryIdForInspect = selectedDelivery?.id ?? null;
  const isBusy = Boolean(busyLabel);
  const canExport = Boolean(
    selectedDelivery &&
      preflight?.status === "ok" &&
      preflight.manifest.delivery.id === selectedDelivery.id &&
      preflight.manifest.integrity.status !== "blocked" &&
      !isBusy
  );

  useEffect(() => {
    if (selectedDeliveryIdForInspect) {
      onInspect(selectedDeliveryIdForInspect);
    }
  }, [onInspect, selectedDeliveryIdForInspect]);

  return (
    <section className="archive-panel delivery-output-panel" aria-label="交付输出">
      <div className="archive-panel-head">
        <div>
          <div className="archive-panel-title">交付输出</div>
          <p className="archive-panel-muted">选择一个已整理的交付准备包，导出给 Figma / PPT 继续排版的 zip。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭输出面板" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {deliveryObjects.length === 0 ? (
        <div className="delivery-output-empty">
          <PackageCheck size={18} />
          <strong>还没有交付准备包。</strong>
          <span>请先在“交付准备”中整理章节和稳定引用。</span>
        </div>
      ) : (
        <>
          <div className="archive-panel-section">
            <div className="archive-panel-section-title">
              <PackageCheck size={14} />
              选择交付准备包
            </div>
            <div className="delivery-output-list">
              {deliveryObjects.map((delivery) => (
                <button
                  key={delivery.id}
                  className={`delivery-output-row ${delivery.id === selectedDeliveryId ? "active" : ""}`}
                  type="button"
                  onClick={() => setManualSelectedDeliveryId(delivery.id)}
                >
                  <strong>{delivery.title}</strong>
                  <span>{deliveryFormatLabel(delivery.format)}</span>
                  <small>
                    章节 {delivery.sections.length} · 稳定引用 {delivery.references.length} · open gaps{" "}
                    {delivery.gaps.filter((gap) => gap.status === "open").length} · 未应用草稿{" "}
                    {pendingDraftCount(workspace, delivery.id)}
                  </small>
                </button>
              ))}
            </div>
          </div>

          <div className="archive-panel-section">
            <div className="archive-panel-section-title">
              <FileWarning size={14} />
              导出前检查
            </div>
            {renderPreflight(preflight, selectedDelivery)}
          </div>

          <button
            className="brand-button archive-action"
            type="button"
            disabled={!canExport}
            onClick={() => selectedDelivery && onExport(selectedDelivery.id)}
          >
            <Download size={14} />
            导出交付输出包
          </button>
        </>
      )}

      {busyLabel ? <div className="archive-panel-status">{busyLabel}</div> : null}
      {message ? <div className={`archive-panel-message ${message.tone}`}>{message.text}</div> : null}
    </section>
  );
}

function renderPreflight(preflight: InspectDeliveryOutputResult | null, selectedDelivery: DeliveryObject | null) {
  if (!selectedDelivery) {
    return <p className="archive-panel-muted">请选择一个交付准备包。</p>;
  }
  if (!preflight) {
    return <p className="archive-panel-muted">正在读取素材状态…</p>;
  }
  if (preflight.status === "ok" && preflight.manifest.delivery.id !== selectedDelivery.id) {
    return <p className="archive-panel-muted">正在读取素材状态…</p>;
  }
  if (preflight.status === "blocked" || preflight.status === "failed") {
    return <div className="archive-panel-message error">{preflight.reason}</div>;
  }
  return (
    <div className="delivery-output-summary">
      <dl>
        <SummaryItem label="章节" value={preflight.summary.sections} />
        <SummaryItem label="稳定引用" value={preflight.summary.references} />
        <SummaryItem label="可打包本地素材" value={preflight.summary.embeddedAssets} />
        <SummaryItem label="仅链接 / 无需本地文件" value={preflight.summary.referenceOnlyOrNoBinary} />
        <SummaryItem label="缺失或大小异常素材" value={preflight.summary.missingOrMismatchedAssets} />
        <SummaryItem label="待补内容" value={preflight.summary.openGaps} />
        <SummaryItem label="未应用章节草稿" value={preflight.summary.pendingDrafts} />
      </dl>
      {warningText(preflight.summary) ? <p>{warningText(preflight.summary)}</p> : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function warningText(summary: DeliveryOutputExportSummary): string | null {
  if (summary.missingOrMismatchedAssets > 0) {
    return `有 ${summary.missingOrMismatchedAssets} 项素材未能完整从当前浏览器本地存储读取。仍可导出输出结构、文案和来源映射；缺失素材会在输出包中明确标记。`;
  }
  if (summary.references > 0 && summary.embeddedAssets === 0) {
    return "当前没有可带走的本地素材；输出包会保留章节、文案、链接和来源映射。";
  }
  return null;
}

function resolveDefaultDeliveryId(
  deliveryObjects: DeliveryObject[],
  selectedObjectIds: string[],
  activeDeliveryObjectId: string | null,
  workspace: MorphoWorkspace
): string | null {
  if (activeDeliveryObjectId && deliveryObjects.some((delivery) => delivery.id === activeDeliveryObjectId)) {
    return activeDeliveryObjectId;
  }
  const selectedDeliveryId = selectedObjectIds.find((objectId) => workspace.objects[objectId]?.type === "delivery");
  if (selectedDeliveryId && deliveryObjects.some((delivery) => delivery.id === selectedDeliveryId)) {
    return selectedDeliveryId;
  }
  return deliveryObjects[0]?.id ?? null;
}

function pendingDraftCount(workspace: MorphoWorkspace, deliveryObjectId: string): number {
  return Object.values(workspace.deliverySectionDrafts).filter(
    (draft) => draft.deliveryObjectId === deliveryObjectId && draft.status === "pending"
  ).length;
}
