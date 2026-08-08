"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import type { DeliveryObject, DeliveryReferenceId, MorphoObjectId, MorphoWorkspace } from "@/domain/morpho/types";
import {
  addDeliveryGap,
  addObjectsToDeliverySection,
  applyDeliverySectionDraft,
  createDeliveryPreparation,
  createDeliverySection,
  discardDeliverySectionDraft,
  moveDeliveryReference,
  moveDeliverySection,
  refreshDeliveryReferenceSnapshot,
  removeDeliveryGap,
  removeDeliveryReference,
  removeDeliverySection,
  setDeliveryGapStatus,
  updateDeliveryReferenceEditorial,
  updateDeliverySection
} from "@/domain/morpho/deliveryPreparation";

import { buildDeliverySectionContext, getDeliveryObjects } from "./deliveryPreparationUi";
import { commitWorkspaceStateNow } from "./workspaceCommitBoundary";

export type DeliveryPreparationMutationResult =
  | { status: "updated" }
  | { status: "blocked"; reason: string };

export type DeliveryCreatedResult =
  | { status: "created"; deliveryObjectId: MorphoObjectId }
  | { status: "blocked"; reason: string };

export type DeliveryReferencesMutationResult =
  | { status: "updated"; createdReferenceIds: DeliveryReferenceId[] }
  | { status: "blocked"; reason: string };

export type DeliveryGapMutationResult =
  | { status: "updated"; gapId: string }
  | { status: "blocked"; reason: string };

export type DeliverySectionDraftRequestResult =
  | {
      status: "ready";
      target: {
        deliveryObjectId: string;
        sectionId: string;
      };
      prompt: string;
    }
  | { status: "blocked"; reason: string };

export type DeliveryPreparationControllerInput = {
  projectId: string;
  workspaceReady: boolean;
  workspace: MorphoWorkspace;
  updateWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>;
  onBlocked?: (reason: string | undefined) => void;
  onDeliveryCreated?: (deliveryObjectId: string) => void;
};

export type UseDeliveryPreparationControllerInput = DeliveryPreparationControllerInput;

export type DeliveryPreparationController = {
  isOpen: boolean;
  activeDeliveryObjectId: string | null;
  activeSectionId: string | null;
  pendingDraftTarget: {
    deliveryObjectId: string;
    sectionId: string;
  } | null;
  open: (deliveryObjectId?: string) => void;
  close: () => void;
  selectDelivery: (deliveryObjectId: string) => void;
  selectSection: (sectionId: string | null) => void;
  clearPendingDraftTarget: () => void;
  createDelivery: (input: { title: string; format: DeliveryObject["format"] }) => DeliveryCreatedResult;
  addSelectedObjects: (input: {
    deliveryObjectId: string;
    sectionId: string;
    sourceObjectIds: string[];
  }) => DeliveryReferencesMutationResult;
  createSection: (input: { deliveryObjectId: string; title: string; purpose?: string }) => DeliveryPreparationMutationResult;
  updateSection: (input: {
    deliveryObjectId: string;
    sectionId: string;
    title?: string;
    purpose?: string;
    narrative?: string;
  }) => DeliveryPreparationMutationResult;
  moveSection: (input: { deliveryObjectId: string; sectionId: string; toIndex: number }) => DeliveryPreparationMutationResult;
  removeSection: (input: { deliveryObjectId: string; sectionId: string }) => DeliveryPreparationMutationResult;
  moveReference: (input: {
    deliveryObjectId: string;
    referenceId: string;
    toSectionId: string;
    toIndex: number;
  }) => DeliveryPreparationMutationResult;
  removeReference: (input: { deliveryObjectId: string; referenceId: string }) => DeliveryPreparationMutationResult;
  updateReferenceEditorial: (input: {
    deliveryObjectId: string;
    referenceId: string;
    caption?: string;
    note?: string;
  }) => DeliveryPreparationMutationResult;
  refreshReference: (input: { deliveryObjectId: string; referenceId: string }) => DeliveryPreparationMutationResult;
  addGap: (input: { deliveryObjectId: string; sectionId?: string; label: string }) => DeliveryGapMutationResult;
  setGapStatus: (input: { deliveryObjectId: string; gapId: string; status: "open" | "resolved" }) => DeliveryPreparationMutationResult;
  removeGap: (input: { deliveryObjectId: string; gapId: string }) => DeliveryPreparationMutationResult;
  applyDraft: (input: { deliveryObjectId: string; draftId: string }) => DeliveryPreparationMutationResult;
  discardDraft: (input: { deliveryObjectId: string; draftId: string }) => DeliveryPreparationMutationResult;
  requestSectionDraft: (input: { deliveryObjectId: string; sectionId: string }) => DeliverySectionDraftRequestResult;
};

type DeliveryDomainOperationResult =
  | ReturnType<typeof createDeliveryPreparation>
  | ReturnType<typeof addObjectsToDeliverySection>
  | ReturnType<typeof createDeliverySection>
  | ReturnType<typeof updateDeliverySection>
  | ReturnType<typeof moveDeliverySection>
  | ReturnType<typeof removeDeliverySection>
  | ReturnType<typeof moveDeliveryReference>
  | ReturnType<typeof removeDeliveryReference>
  | ReturnType<typeof updateDeliveryReferenceEditorial>
  | ReturnType<typeof refreshDeliveryReferenceSnapshot>
  | ReturnType<typeof addDeliveryGap>
  | ReturnType<typeof setDeliveryGapStatus>
  | ReturnType<typeof removeDeliveryGap>
  | ReturnType<typeof applyDeliverySectionDraft>
  | ReturnType<typeof discardDeliverySectionDraft>;

type DeliveryDomainOperationPublicResult<T> = T extends { workspace: MorphoWorkspace } ? Omit<T, "workspace"> : never;

type DeliveryPreparationSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export function useDeliveryPreparationController({
  projectId,
  workspaceReady,
  workspace,
  updateWorkspace,
  onBlocked,
  onDeliveryCreated
}: UseDeliveryPreparationControllerInput): DeliveryPreparationController {
  const session = useMemo<DeliveryPreparationSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("delivery-preparation-session")
    }),
    [projectId, workspaceReady]
  );
  const [isOpenState, setIsOpenState] = useState(false);
  const [requestedActiveDeliveryObjectId, setRequestedActiveDeliveryObjectId] = useState<string | null>(null);
  const [activeSectionIdState, setActiveSectionIdState] = useState<string | null>(null);
  const [pendingDraftTargetState, setPendingDraftTargetState] = useState<{
    deliveryObjectId: string;
    sectionId: string;
  } | null>(null);
  const currentSessionRef = useRef<DeliveryPreparationSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);

  const isCurrentSession = useCallback((expectedSession: DeliveryPreparationSession): boolean => {
    return (
      currentSessionRef.current === expectedSession &&
      expectedSession.workspaceReady &&
      latestWorkspaceRef.current.project.id === expectedSession.projectId
    );
  }, []);

  useLayoutEffect(() => {
    const sessionChanged = currentSessionRef.current !== session;
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
    if (sessionChanged || !session.workspaceReady) {
      setIsOpenState(false);
      setRequestedActiveDeliveryObjectId(null);
      setActiveSectionIdState(null);
      setPendingDraftTargetState(null);
      onBlocked?.(undefined);
    }
  }, [onBlocked, session, workspace]);

  const workspaceMatchesProject = workspace.project.id === projectId;
  const deliveryObjects = useMemo(
    () => (workspaceMatchesProject ? getDeliveryObjects(workspace) : []),
    [workspace, workspaceMatchesProject]
  );
  const activeDeliveryObjectId = useMemo(
    () =>
      requestedActiveDeliveryObjectId && deliveryObjects.some((delivery) => delivery.id === requestedActiveDeliveryObjectId)
        ? requestedActiveDeliveryObjectId
        : deliveryObjects[0]?.id ?? null,
    [deliveryObjects, requestedActiveDeliveryObjectId]
  );
  const activeSectionId = useMemo(() => {
    if (!activeDeliveryObjectId || !activeSectionIdState) {
      return null;
    }
    const delivery = deliveryObjects.find((candidate) => candidate.id === activeDeliveryObjectId);
    return delivery?.sections.some((section) => section.id === activeSectionIdState) ? activeSectionIdState : null;
  }, [activeDeliveryObjectId, activeSectionIdState, deliveryObjects]);
  // The ref marks the project/readiness session whose reset effect has committed; it is not a render data source.
  // eslint-disable-next-line react-hooks/refs
  const sessionMatchesProject = currentSessionRef.current === session && session.workspaceReady && workspaceMatchesProject;

  const readLatestWorkspace = useCallback(
    () => commitWorkspaceStateNow(updateWorkspace, (current) => ({ workspace: current, value: current })),
    [updateWorkspace]
  );

  const runDomainOperation = useCallback(
    <T extends DeliveryDomainOperationResult>(
      operation: (current: MorphoWorkspace) => T
    ): DeliveryDomainOperationPublicResult<T> => {
      const expectedSession = session;
      const blockedReason = "交付准备会话已失效。";
      if (!isCurrentSession(expectedSession)) {
        onBlocked?.(blockedReason);
        return { status: "blocked", reason: blockedReason } as DeliveryDomainOperationPublicResult<T>;
      }
      const committed = commitWorkspaceStateNow(updateWorkspace, (current) => {
        if (!isCurrentSession(expectedSession) || current.project.id !== expectedSession.projectId) {
          return {
            workspace: current,
            value: { status: "blocked", workspace: current, reason: blockedReason } as T
          };
        }
        const operationResult = operation(current);
        return {
          workspace: operationResult.status === "updated" ? operationResult.workspace : current,
          value: operationResult
        };
      });
      onBlocked?.(committed.status === "blocked" ? committed.reason : undefined);
      const { workspace: committedWorkspace, ...publicResult } = committed;
      void committedWorkspace;
      return publicResult as DeliveryDomainOperationPublicResult<T>;
    },
    [isCurrentSession, onBlocked, session, updateWorkspace]
  );

  const open = useCallback((deliveryObjectId?: string) => {
    if (!isCurrentSession(session)) {
      return;
    }
    if (deliveryObjectId !== undefined) {
      setRequestedActiveDeliveryObjectId(deliveryObjectId);
    }
    setIsOpenState(true);
  }, [isCurrentSession, session]);

  const close = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setIsOpenState(false);
  }, [isCurrentSession, session]);

  const selectDelivery = useCallback((deliveryObjectId: string) => {
    if (!isCurrentSession(session)) {
      return;
    }
    setRequestedActiveDeliveryObjectId(deliveryObjectId);
    setActiveSectionIdState(null);
  }, [isCurrentSession, session]);

  const selectSection = useCallback((sectionId: string | null) => {
    if (!isCurrentSession(session)) {
      return;
    }
    setActiveSectionIdState(sectionId);
  }, [isCurrentSession, session]);

  const clearPendingDraftTarget = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setPendingDraftTargetState(null);
  }, [isCurrentSession, session]);

  const createDelivery = useCallback(
    (input: { title: string; format: DeliveryObject["format"] }): DeliveryCreatedResult => {
      const result = runDomainOperation<ReturnType<typeof createDeliveryPreparation>>((current) =>
        createDeliveryPreparation(current, {
          title: input.title,
          format: input.format,
          position: {
            x: current.canvas.view.x + 220,
            y: current.canvas.view.y + 180
          }
        })
      );
      if (result.status === "updated") {
        setRequestedActiveDeliveryObjectId(result.deliveryObjectId);
        setActiveSectionIdState(null);
        onDeliveryCreated?.(result.deliveryObjectId);
        return { status: "created", deliveryObjectId: result.deliveryObjectId };
      }
      return { status: "blocked", reason: result.reason };
    },
    [onDeliveryCreated, runDomainOperation]
  );

  const addSelectedObjects = useCallback(
    (input: { deliveryObjectId: string; sectionId: string; sourceObjectIds: string[] }): DeliveryReferencesMutationResult =>
      runDomainOperation<ReturnType<typeof addObjectsToDeliverySection>>((current) => addObjectsToDeliverySection(current, input)),
    [runDomainOperation]
  );

  const createSection = useCallback(
    (input: { deliveryObjectId: string; title: string; purpose?: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof createDeliverySection>>((current) => createDeliverySection(current, input)),
    [runDomainOperation]
  );

  const updateSection = useCallback(
    (input: {
      deliveryObjectId: string;
      sectionId: string;
      title?: string;
      purpose?: string;
      narrative?: string;
    }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof updateDeliverySection>>((current) => updateDeliverySection(current, input)),
    [runDomainOperation]
  );

  const moveSection = useCallback(
    (input: { deliveryObjectId: string; sectionId: string; toIndex: number }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof moveDeliverySection>>((current) => moveDeliverySection(current, input)),
    [runDomainOperation]
  );

  const removeSection = useCallback(
    (input: { deliveryObjectId: string; sectionId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof removeDeliverySection>>((current) => removeDeliverySection(current, input)),
    [runDomainOperation]
  );

  const moveReference = useCallback(
    (input: { deliveryObjectId: string; referenceId: string; toSectionId: string; toIndex: number }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof moveDeliveryReference>>((current) => moveDeliveryReference(current, input)),
    [runDomainOperation]
  );

  const removeReference = useCallback(
    (input: { deliveryObjectId: string; referenceId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof removeDeliveryReference>>((current) => removeDeliveryReference(current, input)),
    [runDomainOperation]
  );

  const updateReferenceEditorial = useCallback(
    (input: { deliveryObjectId: string; referenceId: string; caption?: string; note?: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof updateDeliveryReferenceEditorial>>((current) => updateDeliveryReferenceEditorial(current, input)),
    [runDomainOperation]
  );

  const refreshReference = useCallback(
    (input: { deliveryObjectId: string; referenceId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof refreshDeliveryReferenceSnapshot>>((current) =>
        refreshDeliveryReferenceSnapshot(current, {
          ...input,
          reason: "用户在交付准备面板中确认更新为当前版本。"
        })
      ),
    [runDomainOperation]
  );

  const addGap = useCallback(
    (input: { deliveryObjectId: string; sectionId?: string; label: string }): DeliveryGapMutationResult =>
      runDomainOperation<ReturnType<typeof addDeliveryGap>>((current) => addDeliveryGap(current, { ...input, origin: "manual" })),
    [runDomainOperation]
  );

  const setGapStatus = useCallback(
    (input: { deliveryObjectId: string; gapId: string; status: "open" | "resolved" }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof setDeliveryGapStatus>>((current) => setDeliveryGapStatus(current, input)),
    [runDomainOperation]
  );

  const removeGap = useCallback(
    (input: { deliveryObjectId: string; gapId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof removeDeliveryGap>>((current) => removeDeliveryGap(current, input)),
    [runDomainOperation]
  );

  const applyDraft = useCallback(
    (input: { deliveryObjectId: string; draftId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof applyDeliverySectionDraft>>((current) => applyDeliverySectionDraft(current, input)),
    [runDomainOperation]
  );

  const discardDraft = useCallback(
    (input: { deliveryObjectId: string; draftId: string }): DeliveryPreparationMutationResult =>
      runDomainOperation<ReturnType<typeof discardDeliverySectionDraft>>((current) => discardDeliverySectionDraft(current, input)),
    [runDomainOperation]
  );

  const requestSectionDraft = useCallback(
    (input: { deliveryObjectId: string; sectionId: string }): DeliverySectionDraftRequestResult => {
      if (!isCurrentSession(session)) {
        const reason = "交付准备会话已失效。";
        onBlocked?.(reason);
        return { status: "blocked", reason };
      }
      const current = readLatestWorkspace();
      if (!isCurrentSession(session)) {
        const reason = "交付准备会话已失效。";
        onBlocked?.(reason);
        return { status: "blocked", reason };
      }
      const delivery = current.objects[input.deliveryObjectId];
      if (!delivery || delivery.type !== "delivery") {
        const reason = "交付准备包不可用。";
        onBlocked?.(reason);
        return { status: "blocked", reason };
      }
      const context = buildDeliverySectionContext(current, delivery, input.sectionId);
      if (!context || context.references.length === 0) {
        const reason = "请先为本章节加入至少一项交付引用。";
        onBlocked?.(reason);
        return { status: "blocked", reason };
      }
      setPendingDraftTargetState(input);
      setRequestedActiveDeliveryObjectId(input.deliveryObjectId);
      onBlocked?.(undefined);
      return {
        status: "ready",
        target: input,
        prompt: `请基于“${context.sectionTitle}”这一节的交付引用快照，生成一份本节说明草稿，并给出必要的图注和待补内容建议。`
      };
    },
    [isCurrentSession, onBlocked, readLatestWorkspace, session]
  );

  return {
    isOpen: sessionMatchesProject ? isOpenState : false,
    activeDeliveryObjectId: sessionMatchesProject ? activeDeliveryObjectId : null,
    activeSectionId: sessionMatchesProject ? activeSectionId : null,
    pendingDraftTarget: sessionMatchesProject ? pendingDraftTargetState : null,
    open,
    close,
    selectDelivery,
    selectSection,
    clearPendingDraftTarget,
    createDelivery,
    addSelectedObjects,
    createSection,
    updateSection,
    moveSection,
    removeSection,
    moveReference,
    removeReference,
    updateReferenceEditorial,
    refreshReference,
    addGap,
    setGapStatus,
    removeGap,
    applyDraft,
    discardDraft,
    requestSectionDraft
  };
}
