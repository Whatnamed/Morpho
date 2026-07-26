"use client";

import { useState } from "react";

import {
  exportEditableProjectBackupBundle,
  downloadProjectBundleFile
} from "@/features/archive/projectBundleClient";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { loadProjectWorkspace } from "@/infrastructure/persistence/localProjectStore";

/**
 * What the user sees when the workspace fails to render.
 *
 * The workspace holds a whole project in React state and writes it to
 * localStorage on a debounce, so a render crash is also the moment the user is
 * least able to protect their work: the canvas is gone, and with it every
 * in-app path to an export. This surface exists to give that path back.
 *
 * It reads the last persisted copy straight from localStorage rather than the
 * crashed component tree, so the export reflects what is actually saved and
 * cannot be poisoned by whatever state caused the crash. Recent unsaved edits
 * are therefore not guaranteed to be in it, and the copy says so instead of
 * implying a complete rescue.
 */
export function WorkspaceCrashRecovery({
  projectId,
  onRetry
}: {
  projectId?: string;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const exportBackup = async () => {
    if (!projectId) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const loaded = loadProjectWorkspace(window.localStorage, projectId);
      if (loaded.status !== "ok") {
        setMessage({
          tone: "error",
          text: `无法读取这个项目的本地存档：${loaded.reason}本地数据没有被修改。`
        });
        return;
      }

      const result = await exportEditableProjectBackupBundle(loaded.workspace, {
        blobStore: indexedDbBlobStore,
        chat: "full",
        projectContinuity: "current"
      });
      if (result.status !== "ok") {
        setMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }

      downloadProjectBundleFile(result.file);
      setMessage({ tone: "success", text: "备份已导出。可以在项目列表用“恢复项目备份”打开它。" });
    } catch {
      setMessage({ tone: "error", text: "导出备份失败。本地数据没有被修改，可以重试。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="crash-surface">
      <section className="crash-card">
        <span className="crash-kicker">工作台无法显示</span>
        <h1>这个项目暂时打不开了</h1>
        <p>
          界面出现了未预期的错误，已经停在这里。<strong>本地数据没有被删除或覆盖</strong>，项目内容仍然保存在这台设备的浏览器中。
        </p>
        <p className="crash-note">
          最近几秒内还没写入的改动可能没有保存。建议先导出一份备份，再重新加载。
        </p>

        <div className="crash-actions">
          <button className="brand-button" type="button" onClick={onRetry} disabled={busy}>
            重新加载工作台
          </button>
          {projectId ? (
            <button className="plain-button" type="button" onClick={() => void exportBackup()} disabled={busy}>
              {busy ? "正在导出备份…" : "导出可恢复备份"}
            </button>
          ) : null}
          {/* A hard navigation, not a router push: the client router is part of
              the tree that just failed, so it is not something to rely on here. */}
          <button className="plain-button" type="button" onClick={() => window.location.assign("/")}>
            返回项目列表
          </button>
        </div>

        {message ? <p className={`crash-message ${message.tone}`}>{message.text}</p> : null}
      </section>
    </main>
  );
}
