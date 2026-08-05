"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import { shouldAcceptDocumentReaderLoadResult } from "./documentReader";
import { loadDocumentReaderExtractWithRecovery } from "./documentReaderRecovery";
import {
  buildDocumentFragmentDraft,
  createDocumentFragmentWithContinuity,
  resolveDocumentFragmentSelection,
  type DocumentReaderInitialLocation
} from "./documentFragments";
import {
  loadDocumentSourcePreview,
  revokeDocumentSourcePreview,
  type DocumentSourcePreview
} from "./documentSourcePreview";
import { commitWorkspaceStateNow } from "./workspaceCommitBoundary";

export type DocumentReaderExtractFragmentResult =
  | { status: "created"; fragmentId: string }
  | { status: "blocked"; reason: string };

export type DocumentReaderControllerState = {
  fileObjectId: string;
  requestId: number;
  status: "loading" | "loaded" | "blocked" | "error";
  text: string;
  message?: string;
  extractAsset?: AssetRecord;
  sourcePreview?: DocumentSourcePreview;
  createdFragmentId?: string;
  initialLocation?: DocumentReaderInitialLocation | null;
};

export type DocumentReaderControllerServices = {
  loadDocumentReaderExtractWithRecovery: typeof loadDocumentReaderExtractWithRecovery;
  loadDocumentSourcePreview: typeof loadDocumentSourcePreview;
};

export type UseDocumentReaderControllerInput = {
  workspace: MorphoWorkspace;
  updateWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>;
  blobStore?: BlobStore;
  services?: DocumentReaderControllerServices;
  onViewCreatedFragment?: (fragmentId: string) => void;
};

export type DocumentReaderController = {
  state: DocumentReaderControllerState | null;
  isOpen: boolean;
  open: (fileObjectId: string, initialLocation?: DocumentReaderInitialLocation | null) => void;
  close: () => void;
  extractFragment: (input: {
    blockIds: string[];
    title: string;
    summary: string;
  }) => DocumentReaderExtractFragmentResult;
  viewCreatedFragment: (fragmentId: string) => void;
};

const defaultServices: DocumentReaderControllerServices = {
  loadDocumentReaderExtractWithRecovery,
  loadDocumentSourcePreview
};

type ReadyDocumentSourcePreview = Extract<DocumentSourcePreview, { status: "ready" }>;

type DocumentSourcePreviewLease = {
  preview: ReadyDocumentSourcePreview;
  released: boolean;
};

function releasePreviewLease(lease: DocumentSourcePreviewLease | null): void {
  if (!lease || lease.released) {
    return;
  }

  lease.released = true;
  revokeDocumentSourcePreview(lease.preview);
}

export function useDocumentReaderController({
  workspace,
  updateWorkspace,
  blobStore = indexedDbBlobStore,
  services = defaultServices,
  onViewCreatedFragment
}: UseDocumentReaderControllerInput): DocumentReaderController {
  const [state, setState] = useState<DocumentReaderControllerState | null>(null);
  const stateRef = useRef<DocumentReaderControllerState | null>(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ownedSourcePreviewRef = useRef<DocumentSourcePreviewLease | null>(null);
  const mountedRef = useRef(true);

  const replaceState = useCallback((next: DocumentReaderControllerState | null) => {
    stateRef.current = next;
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const updateState = useCallback(
    (
      updater: (
        current: DocumentReaderControllerState | null
      ) => DocumentReaderControllerState | null
    ) => {
      replaceState(updater(stateRef.current));
    },
    [replaceState]
  );

  const releaseOwnedSourcePreview = useCallback(() => {
    const lease = ownedSourcePreviewRef.current;
    ownedSourcePreviewRef.current = null;
    releasePreviewLease(lease);
  }, []);

  const invalidateReader = useCallback(
    (clearState: boolean) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestIdRef.current += 1;
      releaseOwnedSourcePreview();
      if (clearState) {
        replaceState(null);
      }
    },
    [releaseOwnedSourcePreview, replaceState]
  );

  const close = useCallback(() => {
    invalidateReader(true);
  }, [invalidateReader]);

  const isCurrentRequest = useCallback(
    (fileObjectId: string, requestId: number, abortController: AbortController) =>
      mountedRef.current &&
      abortControllerRef.current === abortController &&
      shouldAcceptDocumentReaderLoadResult(
        {
          openFileObjectId: stateRef.current?.fileObjectId ?? null,
          requestId: stateRef.current?.requestId ?? requestIdRef.current
        },
        { fileObjectId, requestId }
      ) &&
      requestIdRef.current === requestId,
    []
  );

  const open = useCallback(
    (fileObjectId: string, initialLocation?: DocumentReaderInitialLocation | null) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      releaseOwnedSourcePreview();

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      replaceState({
        fileObjectId,
        requestId,
        status: "loading",
        text: "",
        initialLocation
      });

      const workspaceSnapshot = workspace;
      let sourcePreviewLease: DocumentSourcePreviewLease | null = null;
      const sourcePreviewPromise = services
        .loadDocumentSourcePreview(
          workspaceSnapshot,
          fileObjectId,
          blobStore,
          abortController.signal
        )
        .then((sourcePreview) => {
          if (sourcePreview.status === "ready") {
            const lease: DocumentSourcePreviewLease = {
              preview: sourcePreview,
              released: false
            };
            sourcePreviewLease = lease;
            if (isCurrentRequest(fileObjectId, requestId, abortController)) {
              ownedSourcePreviewRef.current = lease;
            } else {
              releasePreviewLease(lease);
            }
          }
          return sourcePreview;
        });

      void Promise.all([
        services.loadDocumentReaderExtractWithRecovery(
          workspaceSnapshot,
          fileObjectId,
          blobStore,
          abortController.signal,
          updateWorkspace
        ),
        sourcePreviewPromise
      ])
        .then(([result, sourcePreview]) => {
          if (!isCurrentRequest(fileObjectId, requestId, abortController)) {
            releasePreviewLease(sourcePreviewLease);
            return;
          }

          updateState((current) => {
            if (!current || current.fileObjectId !== fileObjectId || current.requestId !== requestId) {
              if (ownedSourcePreviewRef.current === sourcePreviewLease) {
                ownedSourcePreviewRef.current = null;
              }
              releasePreviewLease(sourcePreviewLease);
              return current;
            }
            if (result.status === "loaded") {
              return {
                ...current,
                status: "loaded",
                text: result.text,
                extractAsset: result.asset,
                sourcePreview,
                initialLocation,
                message: undefined
              };
            }
            return {
              ...current,
              status: result.status,
              text: "",
              extractAsset: undefined,
              sourcePreview,
              initialLocation: undefined,
              message: result.message
            };
          });
        })
        .catch((error: unknown) => {
          if (ownedSourcePreviewRef.current === sourcePreviewLease) {
            ownedSourcePreviewRef.current = null;
          }
          releasePreviewLease(sourcePreviewLease);
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (!isCurrentRequest(fileObjectId, requestId, abortController)) {
            return;
          }

          abortController.abort();
          abortControllerRef.current = null;
          requestIdRef.current += 1;
          updateState((current) =>
            current && current.fileObjectId === fileObjectId && current.requestId === requestId
              ? {
                  ...current,
                  status: "error",
                  text: "",
                  message: error instanceof Error ? error.message : "文档阅读器打开失败。"
                }
              : current
          );
        });
    },
    [blobStore, isCurrentRequest, releaseOwnedSourcePreview, replaceState, services, updateState, updateWorkspace, workspace]
  );

  const extractFragment = useCallback(
    (input: {
      blockIds: string[];
      title: string;
      summary: string;
    }): DocumentReaderExtractFragmentResult => {
      const reader = stateRef.current;
      if (!reader || reader.status !== "loaded") {
        return { status: "blocked", reason: "Document reader is not ready." };
      }

      const result = commitWorkspaceStateNow<DocumentReaderExtractFragmentResult>(updateWorkspace, (current) => {
        const file = current.objects[reader.fileObjectId];
        if (!file || file.type !== "file") {
          return {
            workspace: current,
            value: {
              status: "blocked" as const,
              reason: "Document fragment source file is unavailable."
            }
          };
        }

        const selection = resolveDocumentFragmentSelection(current, {
          fileObjectId: file.id,
          extractAssetId: reader.extractAsset?.id ?? file.extractedAssetId ?? "",
          blockIds: input.blockIds,
          title: input.title,
          sourceText: reader.text
        });
        if (selection.status !== "ready") {
          return {
            workspace: current,
            value: { status: "blocked" as const, reason: selection.reason }
          };
        }

        const draft = buildDocumentFragmentDraft(current, selection, {
          title: input.title,
          summary: input.summary
        });
        if (draft.status !== "ready") {
          return {
            workspace: current,
            value: { status: "blocked" as const, reason: draft.reason }
          };
        }

        const created = createDocumentFragmentWithContinuity(current, draft.draft);
        return {
          workspace: created.workspace,
          value: { status: "created" as const, fragmentId: created.fragment.id }
        };
      });

      updateState((current) => {
        if (!current || current.fileObjectId !== reader.fileObjectId || current.requestId !== reader.requestId) {
          return current;
        }
        if (result.status === "created") {
          return {
            ...current,
            status: "loaded",
            createdFragmentId: result.fragmentId,
            message: "已提取到画布"
          };
        }
        return {
          ...current,
          status: "loaded",
          message: result.reason,
          createdFragmentId: undefined
        };
      });
      return result;
    },
    [updateState, updateWorkspace]
  );

  const viewCreatedFragment = useCallback(
    (fragmentId: string) => {
      close();
      onViewCreatedFragment?.(fragmentId);
    },
    [close, onViewCreatedFragment]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateReader(false);
    };
  }, [invalidateReader]);

  return {
    state,
    isOpen: state !== null,
    open,
    close,
    extractFragment,
    viewCreatedFragment
  };
}
