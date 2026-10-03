"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { AssetSourceType } from "@/domain/morpho/types";
import type { ImageAssetDimensions } from "@/infrastructure/assets/localAssetWorkflow";
import { isImportResourcePolicyError } from "@/domain/morpho/importResourcePolicy";
import {
  parseDocumentFile,
  type DocumentParseResult
} from "@/domain/morpho/documentParsing";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import {
  readImageBlobDimensions,
  saveBlobAsLocalAsset,
  type SaveLocalAssetResult
} from "@/infrastructure/assets/localAssetWorkflow";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  createStaleWorkspaceImportExecutionError,
  executeWorkspaceImport,
  isStaleWorkspaceImportExecutionError,
  type WorkspaceImportExecutionPorts,
  type WorkspaceImportExecutionSession,
  type WorkspaceImportRequest
} from "./workspaceImportExecution";

export type WorkspaceImportControllerServices = Readonly<{
  saveAsset: (
    file: File,
    sourceType: AssetSourceType,
    dimensions?: ImageAssetDimensions
  ) => Promise<SaveLocalAssetResult>;
  readImageDimensions: (file: File) => Promise<ImageAssetDimensions>;
  deleteAsset: (storageKey: string) => Promise<void>;
  parseDocumentFile: (file: File) => Promise<DocumentParseResult>;
  saveDocumentExtract: (file: File) => Promise<SaveLocalAssetResult>;
  now: () => number;
}>;

export type UseWorkspaceImportControllerInput = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  commitManualWorkspace?: <T>(transform: WorkspaceCommitTransform<T>, label?: string) => T;
  captureAttention?: () => () => boolean;
  selectObjects: (objectIds: string[]) => void;
  onImportRejected?: (message: string) => void;
  services?: Partial<WorkspaceImportControllerServices>;
}>;

export type WorkspaceImportController = Readonly<{
  importRequest: (request: WorkspaceImportRequest) => Promise<void>;
  captureImportSession: () => WorkspaceImportSessionHandle | null;
}>;

export type WorkspaceImportSessionHandle = Readonly<{
  importRequest: (request: WorkspaceImportRequest) => Promise<void>;
}>;

const defaultServices: WorkspaceImportControllerServices = {
  saveAsset: (file, sourceType, dimensions) =>
    saveBlobAsLocalAsset(indexedDbBlobStore, file, sourceType, {
      knownImageDimensions: dimensions
    }),
  readImageDimensions: readImageBlobDimensions,
  deleteAsset: (storageKey) => indexedDbBlobStore.delete(storageKey),
  parseDocumentFile,
  saveDocumentExtract: (file) =>
    saveBlobAsLocalAsset(indexedDbBlobStore, file, "documentExtract"),
  now: () => Date.now()
};

export function useWorkspaceImportController({
  projectId,
  workspaceReady,
  commitWorkspace: commitWorkspaceInput,
  commitManualWorkspace: commitManualWorkspaceInput,
  captureAttention,
  selectObjects: selectObjectsInput,
  onImportRejected,
  services: serviceOverrides
}: UseWorkspaceImportControllerInput): WorkspaceImportController {
  const session = useMemo<WorkspaceImportExecutionSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("workspace-import-session")
    }),
    [projectId, workspaceReady]
  );
  const currentSessionRef = useRef<WorkspaceImportExecutionSession>(session);
  const services = useMemo<WorkspaceImportControllerServices>(
    () => ({ ...defaultServices, ...serviceOverrides }),
    [serviceOverrides]
  );

  useLayoutEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  const isCurrentSession = useCallback(
    (expectedSession: WorkspaceImportExecutionSession): boolean => {
      const currentSession = currentSessionRef.current;
      return (
        currentSession === expectedSession &&
        currentSession.projectId === expectedSession.projectId &&
        currentSession.workspaceReady
      );
    },
    []
  );

  const assertCurrentSession = useCallback(
    (expectedSession: WorkspaceImportExecutionSession): void => {
      if (!isCurrentSession(expectedSession)) {
        throw createStaleWorkspaceImportExecutionError();
      }
    },
    [isCurrentSession]
  );

  const commitWorkspace = useCallback(
    <T,>(
      expectedSession: WorkspaceImportExecutionSession,
      transform: WorkspaceCommitTransform<T>
    ): T => {
      assertCurrentSession(expectedSession);
      return commitWorkspaceInput((current) => {
        assertCurrentSession(expectedSession);
        if (current.project.id !== expectedSession.projectId) {
          throw createStaleWorkspaceImportExecutionError();
        }
        return transform(current);
      });
    },
    [assertCurrentSession, commitWorkspaceInput]
  );

  const commitManualWorkspace = useCallback(<T,>(expectedSession: WorkspaceImportExecutionSession, transform: WorkspaceCommitTransform<T>): T => {
    assertCurrentSession(expectedSession);
    return (commitManualWorkspaceInput ?? commitWorkspaceInput)((current) => {
      assertCurrentSession(expectedSession);
      if (current.project.id !== expectedSession.projectId) throw createStaleWorkspaceImportExecutionError();
      return transform(current);
    });
  }, [assertCurrentSession, commitManualWorkspaceInput, commitWorkspaceInput]);

  const selectObjects = useCallback(
    (expectedSession: WorkspaceImportExecutionSession, objectIds: string[]): void => {
      if (!isCurrentSession(expectedSession)) {
        return;
      }
      selectObjectsInput([...objectIds]);
    },
    [isCurrentSession, selectObjectsInput]
  );

  const ports = useMemo<WorkspaceImportExecutionPorts>(
    () => ({
      getCurrentSession: () => currentSessionRef.current,
      assertCurrentSession,
      commitWorkspace,
      commitManualWorkspace,
      selectObjects,
      saveAsset: services.saveAsset,
      readImageDimensions: services.readImageDimensions,
      deleteAsset: services.deleteAsset,
      parseDocumentFile: services.parseDocumentFile,
      saveDocumentExtract: services.saveDocumentExtract,
      now: services.now
    }),
    [assertCurrentSession, commitWorkspace, commitManualWorkspace, selectObjects, services]
  );

  const executeImportRequest = useCallback(
    async (
      request: WorkspaceImportRequest,
      expectedSession: WorkspaceImportExecutionSession
    ): Promise<void> => {
      try {
        const allowed = captureAttention?.() ?? (() => true);
        const guardTransform = <T,>(transform: WorkspaceCommitTransform<T>): WorkspaceCommitTransform<T> => (current) => {
          const result = transform(current);
          if (allowed()) return result;
          const ids = current.ui.lastSelectionIds.filter((id) => result.workspace.objects[id]?.visibility === "active");
          return { ...result, workspace: { ...result.workspace, ui: { ...result.workspace.ui, lastSelectionIds: ids } } };
        };
        const commitManual = ports.commitManualWorkspace;
        await executeWorkspaceImport(request, {
          ...ports,
          commitWorkspace: (session, transform) => ports.commitWorkspace(session, guardTransform(transform)),
          commitManualWorkspace: commitManual ? (session, transform) => commitManual(session, guardTransform(transform)) : undefined,
          selectObjects: (session, ids) => { if (allowed()) ports.selectObjects(session, ids); }
        }, expectedSession);
      } catch (error) {
        if (isStaleWorkspaceImportExecutionError(error)) {
          return;
        }
        if (isImportResourcePolicyError(error)) {
          onImportRejected?.(error.message);
          return;
        }
        throw error;
      }
    },
    [captureAttention, onImportRejected, ports]
  );

  const importRequest = useCallback(
    (request: WorkspaceImportRequest): Promise<void> =>
      executeImportRequest(request, ports.getCurrentSession()),
    [executeImportRequest, ports]
  );

  const captureImportSession = useCallback((): WorkspaceImportSessionHandle | null => {
    const expectedSession = ports.getCurrentSession();
    if (!isCurrentSession(expectedSession)) {
      return null;
    }
    return {
      importRequest: (request) => executeImportRequest(request, expectedSession)
    };
  }, [executeImportRequest, isCurrentSession, ports]);

  return { importRequest, captureImportSession };
}
