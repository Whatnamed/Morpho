"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { AssetSourceType } from "@/domain/morpho/types";
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
    sourceType: AssetSourceType
  ) => Promise<SaveLocalAssetResult>;
  parseDocumentFile: (file: File) => Promise<DocumentParseResult>;
  saveDocumentExtract: (file: File) => Promise<SaveLocalAssetResult>;
  now: () => number;
}>;

export type UseWorkspaceImportControllerInput = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  selectObjects: (objectIds: string[]) => void;
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
  saveAsset: (file, sourceType) =>
    saveBlobAsLocalAsset(indexedDbBlobStore, file, sourceType, {
      readImageDimensions: readImageBlobDimensions
    }),
  parseDocumentFile,
  saveDocumentExtract: (file) =>
    saveBlobAsLocalAsset(indexedDbBlobStore, file, "documentExtract"),
  now: () => Date.now()
};

export function useWorkspaceImportController({
  projectId,
  workspaceReady,
  commitWorkspace: commitWorkspaceInput,
  selectObjects: selectObjectsInput,
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
      selectObjects,
      saveAsset: services.saveAsset,
      parseDocumentFile: services.parseDocumentFile,
      saveDocumentExtract: services.saveDocumentExtract,
      now: services.now
    }),
    [assertCurrentSession, commitWorkspace, selectObjects, services]
  );

  const executeImportRequest = useCallback(
    async (
      request: WorkspaceImportRequest,
      expectedSession: WorkspaceImportExecutionSession
    ): Promise<void> => {
      try {
        await executeWorkspaceImport(request, ports, expectedSession);
      } catch (error) {
        if (isStaleWorkspaceImportExecutionError(error)) {
          return;
        }
        throw error;
      }
    },
    [ports]
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
