"use client";

import { Archive, Download, Import, PackageOpen, Search, SquareDashedMousePointer } from "lucide-react";
import { useRef } from "react";

type TopControlsProps = {
  projectTitle: string;
  onImportFiles: (files: File[]) => void;
  onSearch: () => void;
  onFocusOverview: () => void;
  onOpenDeliveryPreparation: () => void;
};

export function TopControls({ projectTitle, onImportFiles, onSearch, onFocusOverview, onOpenDeliveryPreparation }: TopControlsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div className="floating-cluster top-left">
        <div className="wordmark">Morpho</div>
        <div className="project-name">
          <span className="project-dot" />
          <strong>{projectTitle}</strong>
          <span>· 概念工作台</span>
        </div>
      </div>
      <div className="floating-cluster top-right">
        <button className="icon-button" type="button" aria-label="搜索" title="搜索" onClick={onSearch}>
          <Search size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="回到项目概览"
          title="回到项目概览"
          onClick={onFocusOverview}
        >
          <SquareDashedMousePointer size={16} />
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            if (files.length > 0) {
              onImportFiles(files);
            }
            event.currentTarget.value = "";
          }}
        />
        <button className="plain-button" type="button" onClick={() => fileInputRef.current?.click()}>
          <Import size={14} />
          导入
        </button>
        <button className="plain-button" type="button" onClick={onOpenDeliveryPreparation}>
          <PackageOpen size={14} />
          交付准备
        </button>
        <button className="plain-button" type="button">
          <Archive size={14} />
          归档
        </button>
        <div className="cluster-divider" />
        <button className="brand-button" type="button">
          <Download size={14} />
          输出
        </button>
      </div>
    </>
  );
}
