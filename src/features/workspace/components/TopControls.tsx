"use client";

import { Archive, Download, Import, Search, SquareDashedMousePointer } from "lucide-react";

type TopControlsProps = {
  projectTitle: string;
  onSearch: () => void;
  onFocusOverview: () => void;
};

export function TopControls({ projectTitle, onSearch, onFocusOverview }: TopControlsProps) {
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
        <button className="plain-button" type="button">
          <Import size={14} />
          导入
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
