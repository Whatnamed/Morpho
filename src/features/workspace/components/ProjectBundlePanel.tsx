"use client";

import { Download, FileArchive, RotateCcw, Upload, X } from "lucide-react";
import { useRef } from "react";

import type { EditableProjectBackupInspectionPreview } from "@/features/archive/projectBundleClient";

type ProjectBundlePanelProps = {
  archiveIncludeFullChat: boolean;
  archiveIncludeContinuity: boolean;
  backupIncludeFullChat: boolean;
  restorePreview: EditableProjectBackupInspectionPreview | null;
  busyLabel: string | null;
  message: {
    tone: "neutral" | "success" | "warning" | "error";
    text: string;
  } | null;
  onClose: () => void;
  onArchiveIncludeFullChatChange: (checked: boolean) => void;
  onArchiveIncludeContinuityChange: (checked: boolean) => void;
  onBackupIncludeFullChatChange: (checked: boolean) => void;
  onExportArchive: () => void;
  onExportBackup: () => void;
  onInspectBackup: (file: File) => void;
  onCancelRestorePreview: () => void;
  onConfirmRestoreBackup: () => void;
};

export function ProjectBundlePanel({
  archiveIncludeFullChat,
  archiveIncludeContinuity,
  backupIncludeFullChat,
  restorePreview,
  busyLabel,
  message,
  onClose,
  onArchiveIncludeFullChatChange,
  onArchiveIncludeContinuityChange,
  onBackupIncludeFullChatChange,
  onExportArchive,
  onExportBackup,
  onInspectBackup,
  onCancelRestorePreview,
  onConfirmRestoreBackup
}: ProjectBundlePanelProps) {
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const isBusy = Boolean(busyLabel);

  return (
    <section className="archive-panel" aria-label="项目归档与恢复">
      <div className="archive-panel-head">
        <div>
          <div className="archive-panel-title">项目归档与恢复</div>
          <p className="archive-panel-muted">导出可阅读归档，或恢复一个新的可编辑项目副本。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭归档面板" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="archive-panel-section">
        <div className="archive-panel-section-title">
          <FileArchive size={14} />
          人类可读项目归档
        </div>
        <p className="archive-panel-muted">用于阅读、交接和复盘。缺失本地二进制时仍可导出，但会明确标记 warning。</p>
        <label className="archive-option">
          <input
            checked={archiveIncludeFullChat}
            type="checkbox"
            onChange={(event) => onArchiveIncludeFullChatChange(event.currentTarget.checked)}
          />
          <span>附带完整聊天记录</span>
        </label>
        <label className="archive-option">
          <input
            checked={archiveIncludeContinuity}
            type="checkbox"
            onChange={(event) => onArchiveIncludeContinuityChange(event.currentTarget.checked)}
          />
          <span>附带当前连续性记录</span>
        </label>
        <button className="brand-button archive-action" type="button" disabled={isBusy} onClick={onExportArchive}>
          <Download size={14} />
          导出归档
        </button>
      </div>

      <div className="archive-panel-section">
        <div className="archive-panel-section-title">
          <RotateCcw size={14} />
          可编辑项目备份
        </div>
        <p className="archive-panel-muted">用于恢复为新的独立项目副本。默认保留当前连续性，不会覆盖现有项目。</p>
        <label className="archive-option">
          <input
            checked={backupIncludeFullChat}
            type="checkbox"
            onChange={(event) => onBackupIncludeFullChatChange(event.currentTarget.checked)}
          />
          <span>附带完整聊天记录</span>
        </label>
        <button className="plain-button archive-action" type="button" disabled={isBusy} onClick={onExportBackup}>
          <Download size={14} />
          导出备份
        </button>
        <input
          ref={restoreInputRef}
          className="sr-only"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            if (selected) {
              onInspectBackup(selected);
            }
            event.currentTarget.value = "";
          }}
        />
        <button className="plain-button archive-action" type="button" disabled={isBusy} onClick={() => restoreInputRef.current?.click()}>
          <Upload size={14} />
          恢复备份
        </button>

        {restorePreview ? (
          <div className="restore-preview-card">
            <div className="restore-preview-title">恢复预览</div>
            <p className="archive-panel-muted">将创建新的独立项目副本，不会覆盖当前项目或其他已有项目。</p>
            <dl className="restore-preview-list">
              <div>
                <dt>原项目</dt>
                <dd>{restorePreview.sourceProjectTitle}</dd>
              </div>
              <div>
                <dt>导出时间</dt>
                <dd>{restorePreview.createdAt}</dd>
              </div>
              <div>
                <dt>聊天范围</dt>
                <dd>{restorePreview.chat === "full" ? "完整聊天" : "不含聊天"}</dd>
              </div>
              <div>
                <dt>连续性范围</dt>
                <dd>{restorePreview.projectContinuity === "current" ? "当前连续性" : "仅保留基础容器"}</dd>
              </div>
              <div>
                <dt>资产</dt>
                <dd>
                  共 {restorePreview.assets.total} 个，已打包 {restorePreview.assets.embedded} 个，链接{" "}
                  {restorePreview.assets.referenceOnly} 个，缺失 {restorePreview.assets.missing} 个，尺寸不一致{" "}
                  {restorePreview.assets.sizeMismatch} 个
                </dd>
              </div>
              <div>
                <dt>Warning</dt>
                <dd>{restorePreview.warningCount} 条</dd>
              </div>
            </dl>
            <div className="restore-preview-actions">
              <button className="plain-button" type="button" disabled={isBusy} onClick={onCancelRestorePreview}>
                取消
              </button>
              <button className="brand-button" type="button" disabled={isBusy} onClick={onConfirmRestoreBackup}>
                确认恢复
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {busyLabel ? <div className="archive-panel-status">{busyLabel}</div> : null}
      {message ? <div className={`archive-panel-message ${message.tone}`}>{message.text}</div> : null}
    </section>
  );
}
