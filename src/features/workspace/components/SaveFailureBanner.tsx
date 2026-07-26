"use client";

import { useState } from "react";

import {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import { describeSaveFailure } from "@/features/workspace/saveFailureNotice";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import type { StorageWriteFailureKind } from "@/infrastructure/persistence/localProjectStore";

/**
 * Shown when a local save fails.
 *
 * The export deliberately runs against the in-memory workspace, not the copy on
 * disk: the whole point of this banner is that the two have diverged, and the
 * in-memory one is the version the user would otherwise lose. Building the zip
 * only reads IndexedDB and allocates in memory, so it still works when
 * localStorage is the thing that is full.
 */
export function SaveFailureBanner({
  kind,
  stage,
  workspace
}: {
  kind: StorageWriteFailureKind;
  stage: "workspace" | "catalog" | undefined;
  workspace: MorphoWorkspace;
}) {
  const notice = describeSaveFailure(kind, stage);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const exportBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportEditableProjectBackupBundle(workspace, {
        blobStore: indexedDbBlobStore,
        chat: "full",
        projectContinuity: "current"
      });
      if (result.status !== "ok") {
        setMessage({ tone: result.status === "blocked" ? "warning" : "error", text: result.reason });
        return;
      }

      downloadProjectBundleFile(result.file);
      setMessage({ tone: "success", text: "备份已导出，包含当前尚未保存的修改。" });
    } catch {
      setMessage({ tone: "error", text: "导出备份失败。请不要关闭页面，可以再试一次。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-banner is-error" role="alert">
      <strong>{notice.title}</strong>
      <span>{notice.body}</span>
      {notice.isWorkAtRisk ? (
        <button className="workspace-banner-dismiss" type="button" disabled={busy} onClick={() => void exportBackup()}>
          {busy ? "正在导出备份…" : "导出备份"}
        </button>
      ) : null}
      {message ? <span className={`workspace-banner-message ${message.tone}`}>{message.text}</span> : null}
    </div>
  );
}
