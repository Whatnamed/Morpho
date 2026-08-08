"use client";

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle,
  exportHumanReadableArchiveBundle,
  inspectEditableProjectBackupBundle,
  restoreEditableProjectBackupBundle,
  type InspectedEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

export type ProjectBundleControllerMessage = {
  tone: "neutral" | "success" | "warning" | "error";
  text: string;
};

export type ProjectBundleControllerServices = {
  downloadProjectBundleFile: typeof downloadProjectBundleFile;
  exportEditableProjectBackupBundle: typeof exportEditableProjectBackupBundle;
  exportHumanReadableArchiveBundle: typeof exportHumanReadableArchiveBundle;
  inspectEditableProjectBackupBundle: typeof inspectEditableProjectBackupBundle;
  restoreEditableProjectBackupBundle: typeof restoreEditableProjectBackupBundle;
};

export type UseProjectBundleControllerInput = {
  projectId: string;
  workspaceReady: boolean;
  workspace: MorphoWorkspace;
  onWorkspaceRestored: (result: { projectId: string; workspace: MorphoWorkspace }) => void;
  blobStore?: BlobStore;
  storage?: Storage;
  services?: ProjectBundleControllerServices;
};

export type ProjectBundleController = {
  isOpen: boolean;
  archiveIncludeFullChat: boolean;
  archiveIncludeContinuity: boolean;
  busyLabel: string | null;
  message: ProjectBundleControllerMessage | null;
  inspectedBackup: InspectedEditableProjectBackupBundle | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setArchiveIncludeFullChat: (include: boolean) => void;
  setArchiveIncludeContinuity: (include: boolean) => void;
  exportEditableBackup: () => Promise<void>;
  exportReadableArchive: () => Promise<void>;
  inspectBackup: (file: File) => Promise<void>;
  clearInspectedBackup: () => void;
  restoreBackup: () => Promise<void>;
};

type ActiveOperation = {
  kind: "archive" | "backup" | "inspect" | "restore";
  token: symbol;
};

type ProjectBundleSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

const defaultServices: ProjectBundleControllerServices = {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle,
  exportHumanReadableArchiveBundle,
  inspectEditableProjectBackupBundle,
  restoreEditableProjectBackupBundle
};

export function useProjectBundleController({
  projectId,
  workspaceReady,
  workspace,
  onWorkspaceRestored,
  blobStore = indexedDbBlobStore,
  storage,
  services = defaultServices
}: UseProjectBundleControllerInput): ProjectBundleController {
  const session = useMemo<ProjectBundleSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("project-bundle-session")
    }),
    [projectId, workspaceReady]
  );
  const [isOpen, setIsOpen] = useState(false);
  const [archiveIncludeFullChat, setArchiveIncludeFullChat] = useState(false);
  const [archiveIncludeContinuity, setArchiveIncludeContinuity] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<ProjectBundleControllerMessage | null>(null);
  const [inspectedBackup, setInspectedBackupState] = useState<InspectedEditableProjectBackupBundle | null>(null);
  const inspectedBackupRef = useRef<InspectedEditableProjectBackupBundle | null>(null);
  const inspectRequestRef = useRef(0);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const currentSessionRef = useRef<ProjectBundleSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);
  const [committedSession, commitSession] = useReducer(
    (_current: ProjectBundleSession, next: ProjectBundleSession) => next,
    session
  );

  const isCurrentSession = useCallback((expectedSession: ProjectBundleSession): boolean => {
    return (
      currentSessionRef.current === expectedSession &&
      expectedSession.workspaceReady &&
      latestWorkspaceRef.current.project.id === expectedSession.projectId
    );
  }, []);

  const sessionIsVisible =
    committedSession === session && session.workspaceReady && workspace.project.id === session.projectId;

  const setInspectedBackup = useCallback((next: InspectedEditableProjectBackupBundle | null) => {
    inspectedBackupRef.current = next;
    setInspectedBackupState(next);
  }, []);

  useLayoutEffect(() => {
    const sessionChanged = currentSessionRef.current !== session;
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
    if (sessionChanged || !session.workspaceReady) {
      activeOperationRef.current = null;
      inspectRequestRef.current += 1;
      setIsOpen(false);
      setArchiveIncludeFullChat(false);
      setArchiveIncludeContinuity(false);
      setBusyLabel(null);
      setMessage(null);
      setInspectedBackup(null);
    }
    if (committedSession !== session) {
      commitSession(session);
    }
  }, [committedSession, commitSession, session, setInspectedBackup, workspace]);

  const open = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setMessage(null);
    setIsOpen(true);
  }, [isCurrentSession, session]);

  const close = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setIsOpen(false);
  }, [isCurrentSession, session]);

  const toggle = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setMessage(null);
    setIsOpen((current) => !current);
  }, [isCurrentSession, session]);

  const setArchiveIncludeFullChatSafe = useCallback(
    (include: boolean) => {
      if (isCurrentSession(session)) {
        setArchiveIncludeFullChat(include);
      }
    },
    [isCurrentSession, session]
  );

  const setArchiveIncludeContinuitySafe = useCallback(
    (include: boolean) => {
      if (isCurrentSession(session)) {
        setArchiveIncludeContinuity(include);
      }
    },
    [isCurrentSession, session]
  );

  const beginExclusiveOperation = useCallback(
    (kind: ActiveOperation["kind"], label: string) => {
      if (!isCurrentSession(session) || activeOperationRef.current) {
        return null;
      }
      const operation: ActiveOperation = { kind, token: Symbol(`project-bundle-${kind}`) };
      activeOperationRef.current = operation;
      setBusyLabel(label);
      return operation;
    },
    [isCurrentSession, session]
  );

  const finishOperation = useCallback((operation: ActiveOperation) => {
    if (activeOperationRef.current?.token === operation.token) {
      activeOperationRef.current = null;
      setBusyLabel(null);
    }
  }, []);

  const exportReadableArchive = useCallback(async () => {
    const expectedSession = session;
    const operation = beginExclusiveOperation("archive", "正在导出可读归档…");
    if (!operation) {
      return;
    }
    setMessage(null);
    setInspectedBackup(null);
    try {
      const result = await services.exportHumanReadableArchiveBundle(workspace, {
        blobStore,
        chat: archiveIncludeFullChat ? "full" : "none",
        projectContinuity: archiveIncludeContinuity ? "current" : "none"
      });
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      if (result.status !== "ok") {
        setMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }
      services.downloadProjectBundleFile(result.file);
      setMessage({
        tone: result.diagnostics.some((diagnostic) => diagnostic.severity === "warning") ? "warning" : "success",
        text: summarizeBundleDiagnostics("归档已导出。", result.diagnostics)
      });
    } catch {
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      setMessage({
        tone: "error",
        text: "归档导出失败，请稍后重试。"
      });
    } finally {
      if (isCurrentSession(expectedSession)) {
        finishOperation(operation);
      }
    }
  }, [
    archiveIncludeContinuity,
    archiveIncludeFullChat,
    beginExclusiveOperation,
    blobStore,
    finishOperation,
    isCurrentSession,
    services,
    setInspectedBackup,
    session,
    workspace
  ]);

  const exportEditableBackup = useCallback(async () => {
    const expectedSession = session;
    const operation = beginExclusiveOperation("backup", "正在导出可编辑备份…");
    if (!operation) {
      return;
    }
    setMessage(null);
    setInspectedBackup(null);
    try {
      const result = await services.exportEditableProjectBackupBundle(workspace, {
        blobStore,
        chat: "full",
        projectContinuity: "current"
      });
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      if (result.status !== "ok") {
        setMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }
      services.downloadProjectBundleFile(result.file);
      setMessage({
        tone: result.diagnostics.some((diagnostic) => diagnostic.severity === "warning") ? "warning" : "success",
        text: summarizeBundleDiagnostics("备份已导出。", result.diagnostics)
      });
    } catch {
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      setMessage({
        tone: "error",
        text: "备份导出失败，请稍后重试。"
      });
    } finally {
      if (isCurrentSession(expectedSession)) {
        finishOperation(operation);
      }
    }
  }, [
    beginExclusiveOperation,
    blobStore,
    finishOperation,
    isCurrentSession,
    services,
    setInspectedBackup,
    session,
    workspace
  ]);

  const inspectBackup = useCallback(
    async (file: File) => {
      const expectedSession = session;
      if (!isCurrentSession(expectedSession)) {
        return;
      }
      if (activeOperationRef.current && activeOperationRef.current.kind !== "inspect") {
        return;
      }
      const requestId = inspectRequestRef.current + 1;
      inspectRequestRef.current = requestId;
      const operation: ActiveOperation = {
        kind: "inspect",
        token: Symbol("project-bundle-inspect")
      };
      activeOperationRef.current = operation;
      setBusyLabel("正在读取备份包…");
      setMessage(null);
      setInspectedBackup(null);
      try {
        const result = await services.inspectEditableProjectBackupBundle(file);
        if (!isCurrentSession(expectedSession) || inspectRequestRef.current !== requestId) {
          return;
        }
        if (result.status !== "ok") {
          setMessage({ tone: "error", text: result.reason });
          return;
        }
        setInspectedBackup(result.backup);
        setMessage({
          tone: result.preview.warningCount > 0 ? "warning" : "neutral",
          text:
            result.preview.warningCount > 0
              ? `备份已读取，有 ${result.preview.warningCount} 条 warning。确认后将恢复为新项目副本。`
              : "备份已读取。请确认后恢复为新项目副本。"
        });
      } catch {
        if (!isCurrentSession(expectedSession) || inspectRequestRef.current !== requestId) {
          return;
        }
        setMessage({
          tone: "error",
          text: "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。"
        });
      } finally {
        if (isCurrentSession(expectedSession) && inspectRequestRef.current === requestId) {
          finishOperation(operation);
        }
      }
    },
    [finishOperation, isCurrentSession, services, session, setInspectedBackup]
  );

  const clearInspectedBackup = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    inspectRequestRef.current += 1;
    if (activeOperationRef.current?.kind === "inspect") {
      activeOperationRef.current = null;
      setBusyLabel(null);
    }
    setInspectedBackup(null);
    setMessage(null);
  }, [isCurrentSession, session, setInspectedBackup]);

  const restoreBackup = useCallback(async () => {
    const expectedSession = session;
    if (!isCurrentSession(expectedSession)) {
      return;
    }
    const backup = inspectedBackupRef.current;
    if (!backup) {
      setMessage({
        tone: "error",
        text: "请先选择并预览一个可编辑备份包。"
      });
      return;
    }
    const operation = beginExclusiveOperation("restore", "正在恢复可编辑备份…");
    if (!operation) {
      return;
    }
    setMessage(null);
    try {
      const result = await services.restoreEditableProjectBackupBundle(backup, {
        blobStore,
        storage: resolveStorage(storage)
      });
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      if (result.status !== "ok") {
        setMessage({ tone: "error", text: result.reason });
        return;
      }
      setInspectedBackup(null);
      setIsOpen(false);
      setMessage({
        tone: "success",
        text: "备份已恢复为新的项目副本。"
      });
      onWorkspaceRestored({
        projectId: result.projectId,
        workspace: result.workspace
      });
    } catch {
      if (!isCurrentSession(expectedSession) || activeOperationRef.current?.token !== operation.token) {
        return;
      }
      setMessage({
        tone: "error",
        text: "恢复备份失败，请重新选择备份包后再试。"
      });
    } finally {
      if (isCurrentSession(expectedSession)) {
        finishOperation(operation);
      }
    }
  }, [
    beginExclusiveOperation,
    blobStore,
    finishOperation,
    isCurrentSession,
    onWorkspaceRestored,
    services,
    setInspectedBackup,
    session,
    storage
  ]);

  return {
    isOpen: sessionIsVisible ? isOpen : false,
    archiveIncludeFullChat: sessionIsVisible ? archiveIncludeFullChat : false,
    archiveIncludeContinuity: sessionIsVisible ? archiveIncludeContinuity : false,
    busyLabel: sessionIsVisible ? busyLabel : null,
    message: sessionIsVisible ? message : null,
    inspectedBackup: sessionIsVisible ? inspectedBackup : null,
    open,
    close,
    toggle,
    setArchiveIncludeFullChat: setArchiveIncludeFullChatSafe,
    setArchiveIncludeContinuity: setArchiveIncludeContinuitySafe,
    exportEditableBackup,
    exportReadableArchive,
    inspectBackup,
    clearInspectedBackup,
    restoreBackup
  };
}

function resolveStorage(storage: Storage | undefined): Storage {
  if (storage) {
    return storage;
  }
  if (typeof window !== "undefined") {
    return window.localStorage;
  }
  throw new Error("Browser storage is unavailable.");
}

function summarizeBundleDiagnostics(
  base: string,
  diagnostics: Array<{ severity: "info" | "warning" | "error" }>
): string {
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  if (errorCount > 0) {
    return `${base} 另有 ${errorCount} 条错误诊断。`;
  }
  if (warningCount > 0) {
    return `${base} 另有 ${warningCount} 条 warning，请检查包内说明。`;
  }
  return base;
}
