"use client";

import { useCallback, useRef, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
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
};

export type UseDeliveryOutputControllerInput = {
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
  exportDeliveryOutputPackage
};

export function useDeliveryOutputController({
  workspace,
  blobStore = indexedDbBlobStore,
  services = defaultServices
}: UseDeliveryOutputControllerInput): DeliveryOutputController {
  const [isOpen, setIsOpen] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<DeliveryOutputControllerMessage | null>(null);
  const [preflight, setPreflight] = useState<InspectDeliveryOutputResult | null>(null);
  const inspectRequestRef = useRef(0);
  const activeOperationRef = useRef<symbol | null>(null);

  const open = useCallback(() => {
    setMessage(null);
    setPreflight(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setMessage(null);
    setPreflight(null);
    setIsOpen((current) => !current);
  }, []);

  const runInspect = useCallback(
    async (deliveryObjectId: string) => {
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
        if (inspectRequestRef.current !== requestId) {
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
        if (inspectRequestRef.current !== requestId) {
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
        if (inspectRequestRef.current === requestId && activeOperationRef.current === operation) {
          activeOperationRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    [blobStore, services, workspace]
  );

  const inspect = useCallback((deliveryObjectId: string) => runInspect(deliveryObjectId), [runInspect]);

  const exportPackage = useCallback(
    async (deliveryObjectId: string) => {
      if (activeOperationRef.current) {
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
          download: true
        });
        if (result.status !== "ok") {
          setMessage({
            tone: result.status === "blocked" ? "warning" : "error",
            text: result.reason
          });
          return;
        }
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
        setMessage({
          tone: "error",
          text: "交付输出包导出失败，请稍后重试。"
        });
      } finally {
        if (activeOperationRef.current === operation) {
          activeOperationRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    [blobStore, services, workspace]
  );

  return {
    isOpen,
    busyLabel,
    message,
    preflight,
    open,
    close,
    toggle,
    inspect,
    exportPackage
  };
}
