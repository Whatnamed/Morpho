"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { MorphoWorkspace, ResearchObject } from "@/domain/morpho/types";
import { getResearchItemParts } from "@/domain/operations/researchItems";
import { getResearchExtractionItems, type ResearchExtractionItem } from "../researchExtraction";

type ResearchDetailPanelProps = {
  workspace: MorphoWorkspace;
  research: ResearchObject;
  onClose: () => void;
  onApplySelection: (selectedKeys: string[]) => void;
};

const sectionOrder = ["发现", "设计机会", "现实约束", "待验证"] as const;

export function ResearchDetailPanel({ workspace, research, onClose, onApplySelection }: ResearchDetailPanelProps) {
  const items = useMemo(() => getResearchExtractionItems(workspace, research.id), [research.id, workspace]);
  const activeKeys = useMemo(() => new Set(items.filter((item) => item.activeObjectId).map((item) => item.key)), [items]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(activeKeys));

  const selectedCount = selectedKeys.size;
  const activeCount = activeKeys.size;
  const changed =
    selectedKeys.size !== activeKeys.size || [...selectedKeys].some((key) => !activeKeys.has(key));
  const itemsBySection = groupItemsBySection(items);

  const toggleItem = (item: ResearchExtractionItem) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(item.key)) {
        next.delete(item.key);
      } else {
        next.add(item.key);
      }
      return next;
    });
  };

  return (
    <div className="research-panel-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="research-panel"
        aria-label="研究与分析详情"
        role="dialog"
        aria-modal="true"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="research-panel-header">
          <div>
            <span>研究与分析</span>
            <h2>{research.title}</h2>
            <p>{research.summary}</p>
          </div>
          <button type="button" aria-label="关闭研究详情" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="research-panel-grid">
          {sectionOrder.map((label) => {
            const sectionItems = itemsBySection.get(label) ?? [];
            return (
              <section className="research-panel-section" key={label}>
                <div className="research-panel-section-title">
                  <h3>{label}</h3>
                  <span>{sectionItems.length}</span>
                </div>
                <div className="research-panel-items">
                  {sectionItems.length > 0 ? (
                    sectionItems.map((item) => {
                      const selected = selectedKeys.has(item.key);
                      return (
                        <button
                          className={`research-panel-item ${selected ? "selected" : ""}`}
                          type="button"
                          key={item.key}
                          onClick={() => toggleItem(item)}
                        >
                          <span className="research-panel-check" aria-hidden="true">
                            {selected ? <Check size={13} /> : null}
                          </span>
                          <ResearchPanelItemText text={item.text} />
                          {item.activeObjectId ? <span className="research-panel-item-state">已在画布</span> : null}
                          {!item.activeObjectId && item.hiddenObjectId ? (
                            <span className="research-panel-item-state muted">可恢复</span>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <p className="research-panel-empty">暂无条目</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="research-panel-footer">
          <div>
            <strong>已选 {selectedCount}</strong>
            <span>当前画布已有 {activeCount} 条摘录。取消已在画布的条目会先移出画布，可再次恢复。</span>
          </div>
          <div className="research-panel-actions">
            <button type="button" onClick={() => setSelectedKeys(new Set(activeKeys))} disabled={!changed}>
              <RotateCcw size={14} />
              还原
            </button>
            <button className="brand" type="button" onClick={() => onApplySelection([...selectedKeys])} disabled={!changed}>
              更新画布摘录
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ResearchPanelItemText({ text }: { text: string }) {
  const parts = getResearchItemParts(text);

  return (
    <span className="research-panel-item-text">
      <strong>{parts.title}</strong>
      {parts.detail ? <span>{parts.detail}</span> : null}
    </span>
  );
}

function groupItemsBySection(items: ResearchExtractionItem[]): Map<(typeof sectionOrder)[number], ResearchExtractionItem[]> {
  const grouped = new Map<(typeof sectionOrder)[number], ResearchExtractionItem[]>();
  for (const label of sectionOrder) {
    grouped.set(label, []);
  }

  for (const item of items) {
    const label = normalizeSectionLabel(item.label);
    grouped.get(label)?.push(item);
  }

  return grouped;
}

function normalizeSectionLabel(label: string): (typeof sectionOrder)[number] {
  if (label === "发现" || label === "设计机会" || label === "现实约束" || label === "待验证") {
    return label;
  }

  return "发现";
}
