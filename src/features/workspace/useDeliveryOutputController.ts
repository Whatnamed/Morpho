"use client";

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  downloadDeliveryOutputFile,
  exportDeliveryOutputPackage,
  inspectDeliveryOutputPackage,
  type InspectDeliveryOutputResult
} from "@/features/delivery-output/deliveryOutputClient";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

export type DeliveryOutputControllerMessage = {
  tone: "neutral" | "success" | "warning" | "error";
  text: string;
};

export type DeliveryOutputControllerServices = {
  inspectDeliveryOutputPackage: typeof inspectDeliveryOutputPackage;
  exportDeliveryOutputPackage: typeof exportDeliveryOutputPackage;
  downloadDeliveryOutputFile: typeof downloadDeliveryOutputFile;
};

export type UseDeliveryOutputControllerInput = {
  projectId: string;
  workspaceReady: boolean;
  workspace: MorphoWorkspace;
  blobStore?: BlobStore;
  services?: DeliveryOutputControllerServices;
};

export type DeliveryOutputController = {
  isOpen: boolean;
  busyLabel: string | null;
  message: DeliveryOutputControllerMessage | null;
  preflight: InspectDeliveryOutputResult | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  inspect: (deliveryObjectId: string) => Promise<void>;
  exportPackage: (deliveryObjectId: string) => Promise<void>;
};

const defaultServices: DeliveryOutputControllerServices = {
  inspectDeliveryOutputPackage,
  exportDeliveryOutputPackage,
  downloadDeliveryOutputFile
};

type DeliveryOutputSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export function useDeliveryOutputController({
  projectId,
  workspaceReady,
  workspace,
  blobStore = indexedDbBlobStore,
  services = defaultServices
}: UseDeliveryOutputControllerInput): DeliveryOutputController {
  const session = useMemo<DeliveryOutputSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("delivery-output-session")
    }),
    [projectId, workspaceReady]
  );
  const [isOpen, setIsOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<DeliveryOutputControllerMessage | null>(null);
  const [preflight, setPreflight] = useState<InspectDeliveryOutputResult | null>(null);
  const inspectRequestRef = useRef(0);
  const activeOperationRef = useRef<symbol | null>(null);
  const currentSessionRef = useRef<DeliveryOutputSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);
  const [committedSession, commitSession] = useReducer(
    (_current: DeliveryOutputSession, next: DeliveryOutputSession) => next,
    session
  );

  const isCurrentSession = useCallback((expectedSession: DeliveryOutputSession): boolean => {
    return (
      currentSessionRef.current === expectedSession &&
      expectedSession.workspaceReady &&
      latestWorkspaceRef.current.project.id === expectedSession.projectId
    );
  }, []);

  const sessionIsVisible =
    committedSession === session && session.workspaceReady && workspace.project.id === session.projectId;

  useLayoutEffect(() => {
    const sessionChanged = currentSessionRef.current !== session;
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
    if (sessionChanged || !session.workspaceReady) {
      activeOperationRef.current = null;
      inspectRequestRef.current += 1;
      setIsOpen(false);
      setBusyLabel(null);
      setMessage(null);
      setPreflight(null);
    }
    if (committedSession !== session) {
      commitSession(session);
    }
  }, [committedSession, commitSession, session, workspace]);

  const open = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setMessage(null);
    setPreflight(null);
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
    setPreflight(null);
    setIsOpen((current) => !current);
  }, [isCurrentSession, session]);

  const runInspect = useCallback(
    async (deliveryObjectId: string) => {
      const expectedSession = session;
      if (!isCurrentSession(expectedSession)) {
        return;
      }
      const requestId = inspectRequestRef.current + 1;
      inspectRequestRef.current = requestId;
      const operation = Symbol("delivery-output-inspect");
      activeOperationRef.current = operation;
      setBusyLabel("正在检查素材状态…");
      setMessage(null);
      try {
        const result = await services.inspectDeliveryOutputPackage(workspace, {
          deliveryObjectId,
          blobStore
        });
        if (!isCurrentSession(expectedSession) || inspectRequestRef.current !== requestId) {
          return;
        }
        setPreflight(result);
        if (result.status === "blocked" || result.status === "failed") {
          setMessage({
            tone: result.status === "blocked" ? "warning" : "error",
            text: result.reason
          });
        }
      } catch {
        if (!isCurrentSession(expectedSession) || inspectRequestRef.current !== requestId) {
          return;
        }
        const text = "导出前检查失败，请稍后重试。";
        setPreflight({
          status: "failed",
          reason: text,
          diagnostics: []
        });
        setMessage({ tone: "error", text });
      } finally {
        if (
          isCurrentSession(expectedSession) &&
          inspectRequestRef.current === requestId &&
          activeOperationRef.current === operation
        ) {
          activeOperationRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    [blobStore, isCurrentSession, services, session, workspace]
  );

  const inspect = useCallback((deliveryObjectId: string) => runInspect(deliveryObjectId), [runInspect]);

  const exportPackage = useCallback(
    async (deliveryObjectId: string) => {
      const expectedSession = session;
      if (!isCurrentSession(expectedSession) || activeOperationRef.current) {
        return;
      }
      const operation = Symbol("delivery-output-export");
      activeOperationRef.current = operation;
      setBusyLabel("正在导出交付输出包…");
      setMessage(null);
      try {
        const result = await services.exportDeliveryOutputPackage(workspace, {
          deliveryObjectId,
          blobStore,
          download: false
        });
        if (!isCurrentSession(expectedSession) || activeOperationRef.current !== operation) {
          return;
        }
        if (result.status !== "ok") {
          setMessage({
            tone: result.status === "blocked" ? "warning" : "error",
            text: result.reason
          });
          return;
        }
        services.downloadDeliveryOutputFile(result.file);
        setPreflight({
          status: "ok",
          manifest: result.manifest,
          diagnostics: result.diagnostics,
          summary: result.summary
        });
        setMessage({
          tone: result.summary.missingOrMismatchedAssets > 0 ? "warning" : "success",
          text:
            result.summary.missingOrMismatchedAssets > 0
              ? `输出包已导出，但有 ${result.summary.missingOrMismatchedAssets} 项素材未完整带出。请查看压缩包中的 asset-index.md 和 gaps-and-next-steps.md。`
              : "输出包已导出。包含章节结构、素材、图注、来源映射和待补内容。"
        });
      } catch {
        if (!isCurrentSession(expectedSession) || activeOperationRef.current !== operation) {
          return;
        }
        setMessage({
          tone: "error",
          text: "交付输出包导出失败，请稍后重试。"
        });
      } finally {
        if (isCurrentSession(expectedSession) && activeOperationRef.current === operation) {
          activeOperationRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    [blobStore, isCurrentSession, services, session, workspace]
  );

  return {
    isOpen: sessionIsVisible ? isOpen : false,
    busyLabel: sessionIsVisible ? busyLabel : null,
    message: sessionIsVisible ? message : null,
    preflight: sessionIsVisible ? preflight : null,
    open,
    close,
    toggle,
    inspect,
    exportPackage
  };
}
