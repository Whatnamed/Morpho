"use client";

import { Archive, ChevronDown, Download, Home, Import, PackageOpen, Search, SquareDashedMousePointer } from "lucide-react";
import { useRef } from "react";

type TopControlsProps = {
  projectTitle: string;
  onImportFiles: (files: File[]) => void;
  onSearch: () => void;
  onFocusOverview: () => void;
  onOpenDeliveryPreparation: () => void;
  onOpenProjectBundles: () => void;
  onOpenDeliveryOutput: () => void;
  projectMenuOpen?: boolean;
  projectRenameDraft?: string;
  onProjectMenuToggle?: () => void;
  onProjectRenameDraftChange?: (value: string) => void;
  onProjectRenameConfirm?: () => void;
  onOpenProjectHome?: () => void;
  persistenceError?: string;
};

export function TopControls({
  projectTitle,
  onImportFiles,
  onSearch,
  onFocusOverview,
  onOpenDeliveryPreparation,
  onOpenProjectBundles,
  onOpenDeliveryOutput,
  projectMenuOpen = false,
  projectRenameDraft = projectTitle,
  onProjectMenuToggle,
  onProjectRenameDraftChange,
  onProjectRenameConfirm,
  onOpenProjectHome,
  persistenceError
}: TopControlsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div className="floating-cluster top-left">
        <div className="wordmark">Morpho</div>
        <button
          className="project-name project-menu-trigger"
          type="button"
          aria-expanded={projectMenuOpen}
          aria-haspopup="menu"
          onClick={onProjectMenuToggle}
        >
          <span className="project-dot" />
          <strong>{projectTitle}</strong>
          <span className="project-subtitle">· 概念工作台</span>
          <ChevronDown size={13} />
          {persistenceError ? (
            <span className="save-warning" title={persistenceError}>
              本地保存失败
            </span>
          ) : null}
        </button>
        {projectMenuOpen ? (
          <div className="project-menu" role="menu" aria-label="项目操作">
            <div className="project-menu-title">项目操作</div>
            <label className="project-menu-field">
              <span>重命名项目</span>
              <input
                value={projectRenameDraft}
                onChange={(event) => onProjectRenameDraftChange?.(event.currentTarget.value)}
              />
            </label>
            <button className="project-menu-action" type="button" onClick={onProjectRenameConfirm}>
              保存名称
            </button>
            <button className="project-menu-action" type="button" onClick={onOpenProjectHome}>
              <Home size={14} />
              返回项目首页
            </button>
            <button className="project-menu-action" type="button" onClick={onOpenProjectBundles}>
              <Archive size={14} />
              项目归档与恢复
            </button>
            <button className="project-menu-action" type="button" onClick={() => fileInputRef.current?.click()}>
              <Import size={14} />
              导入资料
            </button>
          </div>
        ) : null}
      </div>
      <div className="floating-cluster top-right">
        <div className="toolbar-group" role="group" aria-label="视图">
          <button className="icon-button" type="button" aria-label="搜索" title="搜索" onClick={onSearch}>
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" aria-label="回到项目概览" title="回到项目概览" onClick={onFocusOverview}>
            <SquareDashedMousePointer size={16} />
          </button>
        </div>
        <div className="cluster-divider" />
        <div className="toolbar-group" role="group" aria-label="资料与交付">
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
          <button className="plain-button" type="button" onClick={onOpenProjectBundles}>
            <Archive size={14} />
            归档
          </button>
        </div>
        <div className="cluster-divider" />
        <button className="brand-button" type="button" onClick={onOpenDeliveryOutput}>
          <Download size={14} />
          输出
        </button>
      </div>
    </>
  );
}
