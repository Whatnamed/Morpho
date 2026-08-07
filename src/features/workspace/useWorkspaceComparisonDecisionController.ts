"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import type { AiTaskMode, MorphoWorkspace } from "@/domain/morpho/types";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
import type {
  PendingConfirmationRequestResult
} from "./workspaceConfirmation";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  applyConfirmedComparisonDecision,
  isComparisonPendingConfirmation,
  prepareComparisonDecision,
  type ComparisonActionRequest,
  type PendingComparisonConfirmation
} from "./comparisonDecision";

type ComparisonDecisionSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

type CommitValue<T> =
  | {
      committed: true;
      result: T;
    }
  | {
      committed: false;
    };

export type UseWorkspaceComparisonDecisionControllerInput = Readonly<{
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  pendingConfirmation: PendingAiConfirmation | null;
  requestPendingConfirmation: (value: PendingAiConfirmation) => PendingConfirmationRequestResult;
  updatePendingConfirmation: (
    updater: (current: PendingAiConfirmation) => PendingAiConfirmation,
    expected?: PendingAiConfirmation
  ) => boolean;
  clearPendingConfirmation: (expected?: PendingAiConfirmation) => boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  pushUndoSnapshot: () => void;
  setSelectedObjectIds: Dispatch<SetStateAction<string[]>>;
  requestObjectFocus: (objectId: string) => void;
  showNotice: (message: string) => void;
  setAiDraft: (draft: string) => void;
  setTaskMode: (taskMode: AiTaskMode) => void;
  openAiPanel: () => void;
}>;

export type WorkspaceComparisonDecisionController = Readonly<{
  pendingConfirmation: PendingAiConfirmation | null;
  requestAction: (analysisId: string, action: ComparisonActionRequest, objectId?: string) => void;
  updatePendingReason: (patch: { userReason: string }) => void;
  confirm: () => void;
  cancel: () => void;
}>;

export function useWorkspaceComparisonDecisionController({
  projectId,
  workspace,
  workspaceReady,
  pendingConfirmation,
  requestPendingConfirmation,
  updatePendingConfirmation,
  clearPendingConfirmation,
  commitWorkspace: commitWorkspaceInput,
  pushUndoSnapshot,
  setSelectedObjectIds,
  requestObjectFocus,
  showNotice,
  setAiDraft,
  setTaskMode,
  openAiPanel
}: UseWorkspaceComparisonDecisionControllerInput): WorkspaceComparisonDecisionController {
  const session = useMemo<ComparisonDecisionSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("workspace-comparison-decision-session")
    }),
    [projectId, workspaceReady]
  );
  const currentSessionRef = useRef<ComparisonDecisionSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);
  const latestPendingConfirmationRef = useRef<PendingAiConfirmation | null>(pendingConfirmation);
  const pendingOwnerSessionRef = useRef<ComparisonDecisionSession | null>(null);
  const previousSessionRef = useRef<ComparisonDecisionSession>(session);
  const resolvingConfirmationRef = useRef<PendingComparisonConfirmation | null>(null);
  const [pendingOwnerSessionState, setPendingOwnerSessionState] = useState<ComparisonDecisionSession | null>(null);

  useLayoutEffect(() => {
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
    latestPendingConfirmationRef.current = pendingConfirmation;
  }, [pendingConfirmation, session, workspace]);

  useEffect(() => {
    if (previousSessionRef.current === session) {
      return;
    }

    previousSessionRef.current = session;
    pendingOwnerSessionRef.current = null;
    setPendingOwnerSessionState(null);
    if (isComparisonPendingConfirmation(pendingConfirmation)) {
      clearPendingConfirmation(pendingConfirmation);
    }
  }, [clearPendingConfirmation, pendingConfirmation, session]);

  const isCurrentSession = useCallback((expectedSession: ComparisonDecisionSession): boolean => {
    const currentSession = currentSessionRef.current;
    return (
      currentSession === expectedSession &&
      expectedSession.workspaceReady &&
      latestWorkspaceRef.current.project.id === expectedSession.projectId
    );
  }, []);

  const ownsPendingConfirmation = useCallback(
    (_confirmation: PendingComparisonConfirmation): boolean =>
      pendingOwnerSessionRef.current === null || pendingOwnerSessionRef.current === session,
    [session]
  );

  const commitWorkflow = useCallback(
    <T,>(
      expectedSession: ComparisonDecisionSession,
      transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }
    ): T | undefined => {
      if (!isCurrentSession(expectedSession)) {
        return undefined;
      }

      const committed = commitWorkspaceInput<CommitValue<T>>((current) => {
        if (!isCurrentSession(expectedSession) || current.project.id !== expectedSession.projectId) {
          return {
            workspace: current,
            value: { committed: false }
          };
        }

        const result = transform(current);
        return {
          workspace: result.workspace,
          value: {
            committed: true,
            result: result.value
          }
        };
      });

      return committed.committed ? committed.result : undefined;
    },
    [commitWorkspaceInput, isCurrentSession]
  );

  const requestAction = useCallback(
    (analysisId: string, action: ComparisonActionRequest, objectId?: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      if (latestPendingConfirmationRef.current !== null) {
        showNotice("请先处理当前待确认操作，再发起 Compare 决策。");
        return;
      }

      const prepared = prepareComparisonDecision(latestWorkspaceRef.current, analysisId, action, objectId);
      if (prepared.status === "blocked") {
        showNotice(prepared.reason);
        return;
      }

      const requested = requestPendingConfirmation(prepared.confirmation);
      if (requested.status !== "accepted") {
        showNotice("请先处理当前待确认操作，再发起 Compare 决策。");
        return;
      }
      pendingOwnerSessionRef.current = session;
      setPendingOwnerSessionState(session);
      openAiPanel();
    },
    [isCurrentSession, openAiPanel, requestPendingConfirmation, session, showNotice]
  );

  const updatePendingReason = useCallback(
    (patch: { userReason: string }) => {
      if (
        !isCurrentSession(session) ||
        !pendingConfirmation ||
        !isComparisonPendingConfirmation(pendingConfirmation) ||
        !ownsPendingConfirmation(pendingConfirmation)
      ) {
        return;
      }

      updatePendingConfirmation(
        (current) =>
          isComparisonPendingConfirmation(current)
            ? {
                ...current,
                userReason: patch.userReason
              }
            : current,
        pendingConfirmation
      );
    },
    [isCurrentSession, ownsPendingConfirmation, pendingConfirmation, session, updatePendingConfirmation]
  );

  const confirm = useCallback(() => {
    if (
      !pendingConfirmation ||
      !isComparisonPendingConfirmation(pendingConfirmation) ||
      !isCurrentSession(session) ||
      !ownsPendingConfirmation(pendingConfirmation)
    ) {
      return;
    }
    if (resolvingConfirmationRef.current === pendingConfirmation) {
      return;
    }

    const preflight = applyConfirmedComparisonDecision(latestWorkspaceRef.current, pendingConfirmation);
    if (preflight.status === "blocked") {
      showNotice(preflight.reason);
      return;
    }

    resolvingConfirmationRef.current = pendingConfirmation;
    // The preflight is synchronous and uses the same current workspace that will be committed.
    // The functional commit below still revalidates against the authoritative state boundary.
    pushUndoSnapshot();
    const result = commitWorkflow(session, (current) => {
      const applied = applyConfirmedComparisonDecision(current, pendingConfirmation);
      return {
        workspace: applied.workspace,
        value: applied
      };
    });
    if (!result || result.status === "blocked") {
      resolvingConfirmationRef.current = null;
      if (result?.status === "blocked") {
        showNotice(result.reason);
      }
      return;
    }

    pendingOwnerSessionRef.current = null;
    setPendingOwnerSessionState(null);
    clearPendingConfirmation(pendingConfirmation);
    resolvingConfirmationRef.current = null;
    setAiDraft("");
    setTaskMode("chatAnalysis");
    if (result.selectionObjectIds) {
      setSelectedObjectIds(result.selectionObjectIds);
    }
    if (result.focusObjectId) {
      requestObjectFocus(result.focusObjectId);
    }
    showNotice(result.notice);
  }, [
    commitWorkflow,
    isCurrentSession,
    ownsPendingConfirmation,
    pendingConfirmation,
    pushUndoSnapshot,
    requestObjectFocus,
    session,
    setAiDraft,
    clearPendingConfirmation,
    setSelectedObjectIds,
    setTaskMode,
    showNotice
  ]);

  const cancel = useCallback(() => {
    if (
      !pendingConfirmation ||
      !isComparisonPendingConfirmation(pendingConfirmation) ||
      !isCurrentSession(session) ||
      !ownsPendingConfirmation(pendingConfirmation)
    ) {
      return;
    }
    if (resolvingConfirmationRef.current === pendingConfirmation) {
      return;
    }

    pendingOwnerSessionRef.current = null;
    setPendingOwnerSessionState(null);
    clearPendingConfirmation(pendingConfirmation);
  }, [clearPendingConfirmation, isCurrentSession, ownsPendingConfirmation, pendingConfirmation, session]);

  const visiblePendingConfirmation =
    pendingConfirmation &&
    isComparisonPendingConfirmation(pendingConfirmation) &&
    pendingOwnerSessionState !== null &&
    pendingOwnerSessionState !== session
      ? null
      : pendingConfirmation;

  return {
    pendingConfirmation: visiblePendingConfirmation,
    requestAction,
    updatePendingReason,
    confirm,
    cancel
  };
}
