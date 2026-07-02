"use client";

import { Download, FileArchive, RotateCcw, Upload, X } from "lucide-react";
import { useRef } from "react";

type ProjectBundlePanelProps = {
  archiveIncludeFullChat: boolean;
  archiveIncludeContinuity: boolean;
  backupIncludeFullChat: boolean;
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
  onRestoreBackup: (file: File) => void;
};

export function ProjectBundlePanel({
  archiveIncludeFullChat,
  archiveIncludeContinuity,
  backupIncludeFullChat,
  busyLabel,
  message,
  onClose,
  onArchiveIncludeFullChatChange,
  onArchiveIncludeContinuityChange,
  onBackupIncludeFullChatChange,
  onExportArchive,
  onExportBackup,
  onRestoreBackup
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
        <p className="archive-panel-muted">用于未来恢复为新的独立项目副本。默认保留当前连续性，不会覆盖现有项目。</p>
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
              onRestoreBackup(selected);
            }
            event.currentTarget.value = "";
          }}
        />
        <button className="plain-button archive-action" type="button" disabled={isBusy} onClick={() => restoreInputRef.current?.click()}>
          <Upload size={14} />
          恢复备份
        </button>
      </div>

      {busyLabel ? <div className="archive-panel-status">{busyLabel}</div> : null}
      {message ? <div className={`archive-panel-message ${message.tone}`}>{message.text}</div> : null}
    </section>
  );
}
