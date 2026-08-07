import { useCallback, useMemo } from "react";

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
  executeWorkspaceVisualGenerationPlan,
  type ImageTaskStatus,
  type WorkspaceVisualGenerationExecutionPorts
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
  effectiveImageGenerationSettings: ImageGenerationSettings;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  updateWorkspace: (update: (current: MorphoWorkspace) => MorphoWorkspace) => void;
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

  const executeVisualGenerationPlan = useCallback<ExecuteAgentVisualGenerationPlan>(
    (executionInput) => {
      const ports: WorkspaceVisualGenerationExecutionPorts = {
        fetch: services.fetch,
        commitWorkspace: input.commitWorkspace,
        updateWorkspace: input.updateWorkspace,
        updatePendingImageGenerationSlots: input.setPendingImageGenerationSlots,
        setImageTaskStatus: input.setImageTaskStatus,
        saveGeneratedAsset: services.saveGeneratedAsset,
        readReferenceAsset: services.readReferenceAsset,
        selectObjects: input.selectObjects,
        focusObject: input.focusObject,
        now: services.now,
        randomSuffix: services.randomSuffix
      };
      return executeWorkspaceVisualGenerationPlan(
        executionInput,
        input.effectiveImageGenerationSettings,
        ports
      );
    },
    [
      input.commitWorkspace,
      input.focusObject,
      input.selectObjects,
      input.setImageTaskStatus,
      input.setPendingImageGenerationSlots,
      input.updateWorkspace,
      input.effectiveImageGenerationSettings,
      services
    ]
  );

  return { executeVisualGenerationPlan };
}
