import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import {
  readImageBlobDimensions,
  saveBlobAsLocalAsset,
  type SaveLocalAssetResult
} from "@/infrastructure/assets/localAssetWorkflow";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import {
  createStaleVisualGenerationExecutionError,
  executeWorkspaceVisualGenerationPlan,
  type ImageTaskStatus,
  type WorkspaceVisualGenerationExecutionPorts,
  type WorkspaceVisualGenerationExecutionSession
} from "./workspaceVisualGenerationExecution";
import type { ImageGenerationSettings } from "./imageGenerationSettings";
import type { PendingImageGenerationSlot } from "./pendingImageGenerationSlots";

export type WorkspaceVisualGenerationControllerServices = {
  fetch: typeof fetch;
  saveGeneratedAsset: (file: File) => Promise<SaveLocalAssetResult>;
  readReferenceAsset: (storageKey: string) => Promise<Blob | null>;
  now: () => number;
  randomSuffix: () => string;
};

export type UseWorkspaceVisualGenerationControllerInput = {
  projectId: string;
  workspaceReady: boolean;
  effectiveImageGenerationSettings: ImageGenerationSettings;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  setPendingImageGenerationSlots: (
    update: (current: PendingImageGenerationSlot[]) => PendingImageGenerationSlot[]
  ) => void;
  setImageTaskStatus: (status: ImageTaskStatus | null) => void;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  services?: Partial<WorkspaceVisualGenerationControllerServices>;
};

export type WorkspaceVisualGenerationController = {
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
};

const defaultServices: WorkspaceVisualGenerationControllerServices = {
  fetch: (...args) => globalThis.fetch(...args),
  saveGeneratedAsset: (file) =>
    saveBlobAsLocalAsset(indexedDbBlobStore, file, "aiGeneratedImage", {
      readImageDimensions: readImageBlobDimensions
    }),
  readReferenceAsset: (storageKey) => indexedDbBlobStore.get(storageKey),
  now: () => Date.now(),
  randomSuffix: () => Math.random().toString(36).slice(2, 8)
};

function resolveServices(
  overrides: Partial<WorkspaceVisualGenerationControllerServices> | undefined
): WorkspaceVisualGenerationControllerServices {
  return {
    ...defaultServices,
    ...overrides
  };
}

export function useWorkspaceVisualGenerationController(
  input: UseWorkspaceVisualGenerationControllerInput
): WorkspaceVisualGenerationController {
  const {
    projectId,
    workspaceReady,
    effectiveImageGenerationSettings,
    commitWorkspace: commitWorkspaceInput,
    setPendingImageGenerationSlots: setPendingImageGenerationSlotsInput,
    setImageTaskStatus: setImageTaskStatusInput,
    selectObjects: selectObjectsInput,
    focusObject: focusObjectInput
  } = input;
  const serviceFetch = input.services?.fetch;
  const serviceNow = input.services?.now;
  const serviceRandomSuffix = input.services?.randomSuffix;
  const serviceReadReferenceAsset = input.services?.readReferenceAsset;
  const serviceSaveGeneratedAsset = input.services?.saveGeneratedAsset;
  const services = useMemo(
    () => serviceFetch || serviceNow || serviceRandomSuffix || serviceReadReferenceAsset || serviceSaveGeneratedAsset
      ? resolveServices({
          ...(serviceFetch ? { fetch: serviceFetch } : {}),
          ...(serviceNow ? { now: serviceNow } : {}),
          ...(serviceRandomSuffix ? { randomSuffix: serviceRandomSuffix } : {}),
          ...(serviceReadReferenceAsset ? { readReferenceAsset: serviceReadReferenceAsset } : {}),
          ...(serviceSaveGeneratedAsset ? { saveGeneratedAsset: serviceSaveGeneratedAsset } : {})
        })
      : defaultServices,
    [
      serviceFetch,
      serviceNow,
      serviceRandomSuffix,
      serviceReadReferenceAsset,
      serviceSaveGeneratedAsset
    ]
  );

  const session = useMemo<WorkspaceVisualGenerationExecutionSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("visual-generation-session")
    }),
    [projectId, workspaceReady]
  );
  const currentSessionRef = useRef(session);

  useLayoutEffect(() => {
    currentSessionRef.current = session;
    if (!session.workspaceReady) {
      setPendingImageGenerationSlotsInput(() => []);
      setImageTaskStatusInput(null);
    }
  }, [setImageTaskStatusInput, setPendingImageGenerationSlotsInput, session]);

  const getCurrentSession = useCallback(() => currentSessionRef.current, []);
  const assertCurrentSession = useCallback(
    (expectedSession: WorkspaceVisualGenerationExecutionSession) => {
      const currentSession = currentSessionRef.current;
      if (
        currentSession !== expectedSession ||
        !currentSession.workspaceReady ||
        currentSession.projectId !== expectedSession.projectId
      ) {
        throw createStaleVisualGenerationExecutionError();
      }
    },
    []
  );
  const commitWorkspace = useCallback(
    <T,>(expectedSession: WorkspaceVisualGenerationExecutionSession, transform: WorkspaceCommitTransform<T>) => {
      assertCurrentSession(expectedSession);
      return commitWorkspaceInput((current) => {
        assertCurrentSession(expectedSession);
        if (current.project.id !== expectedSession.projectId) {
          throw createStaleVisualGenerationExecutionError();
        }
        return transform(current);
      });
    },
    [assertCurrentSession, commitWorkspaceInput]
  );
  const updatePendingImageGenerationSlots = useCallback(
    (
      expectedSession: WorkspaceVisualGenerationExecutionSession,
      update: (current: PendingImageGenerationSlot[]) => PendingImageGenerationSlot[]
    ) => {
      assertCurrentSession(expectedSession);
      setPendingImageGenerationSlotsInput((current) => {
        assertCurrentSession(expectedSession);
        return update(current);
      });
    },
    [assertCurrentSession, setPendingImageGenerationSlotsInput]
  );
  const setImageTaskStatus = useCallback(
    (expectedSession: WorkspaceVisualGenerationExecutionSession, status: ImageTaskStatus | null) => {
      assertCurrentSession(expectedSession);
      setImageTaskStatusInput(status);
    },
    [assertCurrentSession, setImageTaskStatusInput]
  );
  const selectObjects = useCallback(
    (expectedSession: WorkspaceVisualGenerationExecutionSession, objectIds: string[]) => {
      assertCurrentSession(expectedSession);
      selectObjectsInput(objectIds);
    },
    [assertCurrentSession, selectObjectsInput]
  );
  const focusObject = useCallback(
    (expectedSession: WorkspaceVisualGenerationExecutionSession, objectId: string) => {
      assertCurrentSession(expectedSession);
      focusObjectInput(objectId);
    },
    [assertCurrentSession, focusObjectInput]
  );
  const ports = useMemo<WorkspaceVisualGenerationExecutionPorts>(
    () => ({
      fetch: services.fetch,
      getCurrentSession,
      assertCurrentSession,
      commitWorkspace,
      updatePendingImageGenerationSlots,
      setImageTaskStatus,
      saveGeneratedAsset: services.saveGeneratedAsset,
      readReferenceAsset: services.readReferenceAsset,
      selectObjects,
      focusObject,
      now: services.now,
      randomSuffix: services.randomSuffix
    }),
    [
      assertCurrentSession,
      commitWorkspace,
      focusObject,
      getCurrentSession,
      selectObjects,
      services,
      setImageTaskStatus,
      updatePendingImageGenerationSlots
    ]
  );
  const executeVisualGenerationPlan = useCallback<ExecuteAgentVisualGenerationPlan>(
    (executionInput) => executeWorkspaceVisualGenerationPlan(
      executionInput,
      effectiveImageGenerationSettings,
      ports
    ),
    [effectiveImageGenerationSettings, ports]
  );

  return { executeVisualGenerationPlan };
}
