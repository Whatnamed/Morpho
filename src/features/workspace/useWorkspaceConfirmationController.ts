"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  getPendingConfirmationOrigin,
  type PendingAiConfirmation,
  type PendingConfirmationRequestResult
} from "./workspaceConfirmation";

type ConfirmationSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export type UseWorkspaceConfirmationControllerInput = Readonly<{
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
}>;

export type WorkspaceConfirmationController = Readonly<{
  pendingConfirmation: PendingAiConfirmation | null;
  requestPendingConfirmation: (value: PendingAiConfirmation) => PendingConfirmationRequestResult;
  updatePendingConfirmation: (
    updater: (current: PendingAiConfirmation) => PendingAiConfirmation,
    expected?: PendingAiConfirmation
  ) => boolean;
  clearPendingConfirmation: (expected?: PendingAiConfirmation) => boolean;
}>;

export function useWorkspaceConfirmationController({
  projectId,
  workspace,
  workspaceReady
}: UseWorkspaceConfirmationControllerInput): WorkspaceConfirmationController {
  const session = useMemo<ConfirmationSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("workspace-confirmation-session")
    }),
    [projectId, workspaceReady]
  );
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const currentSessionRef = useRef<ConfirmationSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);
  const pendingConfirmationRef = useRef<PendingAiConfirmation | null>(pendingConfirmation);
  const previousSessionRef = useRef<ConfirmationSession>(session);

  useLayoutEffect(() => {
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
    pendingConfirmationRef.current = pendingConfirmation;
  }, [pendingConfirmation, session, workspace]);

  useEffect(() => {
    if (previousSessionRef.current === session) {
      return;
    }

    previousSessionRef.current = session;
    pendingConfirmationRef.current = null;
    setPendingConfirmation(null);
  }, [session]);

  const isCurrentSession = useCallback((expectedSession: ConfirmationSession): boolean => {
    const current = currentSessionRef.current;
    return (
      current === expectedSession &&
      expectedSession.workspaceReady &&
      latestWorkspaceRef.current.project.id === expectedSession.projectId
    );
  }, []);

  const requestPendingConfirmation = useCallback(
    (value: PendingAiConfirmation): PendingConfirmationRequestResult => {
      const origin = getPendingConfirmationOrigin(value);
      if (!isCurrentSession(session)) {
        return { status: "rejected", code: "confirmation_session_stale", origin };
      }
      if (pendingConfirmationRef.current !== null) {
        return { status: "rejected", code: "confirmation_slot_occupied", origin };
      }

      pendingConfirmationRef.current = value;
      setPendingConfirmation(value);
      return { status: "accepted", origin };
    },
    [isCurrentSession, session]
  );

  const updatePendingConfirmation = useCallback(
    (
      updater: (current: PendingAiConfirmation) => PendingAiConfirmation,
      expected?: PendingAiConfirmation
    ): boolean => {
      if (!isCurrentSession(session)) {
        return false;
      }
      const current = pendingConfirmationRef.current;
      if (!current || (expected && current !== expected)) {
        return false;
      }
      const next = updater(current);
      pendingConfirmationRef.current = next;
      setPendingConfirmation(next);
      return true;
    },
    [isCurrentSession, session]
  );

  const clearPendingConfirmation = useCallback(
    (expected?: PendingAiConfirmation): boolean => {
      if (!isCurrentSession(session)) {
        return false;
      }
      const current = pendingConfirmationRef.current;
      if (!current || (expected && current !== expected)) {
        return false;
      }
      pendingConfirmationRef.current = null;
      setPendingConfirmation(null);
      return true;
    },
    [isCurrentSession, session]
  );

  return {
    pendingConfirmation,
    requestPendingConfirmation,
    updatePendingConfirmation,
    clearPendingConfirmation
  };
}
