import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AiTaskMode, MorphoWorkspace } from "@/domain/morpho/types";
import { interruptActiveOperations } from "@/domain/operations/operations";
import type {
  PendingAiConfirmation,
  PendingConfirmationRequestResult
} from "./workspaceConfirmation";
import { getLatestFailedAgentTurnDraft, updateAiMessage } from "./aiConversationMessages";
import { completeAgentTrace } from "./agentMessageTrace";
import {
  createAgentTurnHostSessionDetachedError,
  isAgentTurnHostSessionDetachedError,
  type AgentTurnHost
} from "./agentTurnHost";
import {
  acknowledgeMorphoAgentPendingConfirmation,
  cancelMorphoAgentTurn,
  detachMorphoAgentTurnForPageUnload,
  recoverMorphoAgentTurn,
  resumeMorphoAgentTurn,
  runManualCompactionTurn,
  runMorphoAgentTurn
} from "./agentTurnRunner";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { WorkspacePersistenceState } from "./workspacePersistence";
import { parseManualCompactCommand } from "./manualConversationCompaction";
import {
  createWorkspaceAgentRuntimeSession,
  type WorkspaceAgentRuntimeSession
} from "./workspaceAgentRuntimeSession";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import type { ImageTaskStatus } from "./workspaceVisualGenerationExecution";

export type WorkspaceAgentRuntimeControllerServices = {
  fetch: typeof fetch;
  now: () => number;
  randomSuffix: () => string;
};

export type ImageTaskStatusUpdate =
  | ImageTaskStatus
  | null
  | ((current: ImageTaskStatus | null) => ImageTaskStatus | null);

export type UseWorkspaceAgentRuntimeControllerInput = {
  projectId: string;
  workspaceReady: boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  persistWorkspace: () => WorkspacePersistenceState;
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
  setContextWarning: (value: string | undefined) => void;
  clearPendingDeliveryDraftTarget: () => void;
  setDraft: (value: string) => void;
  setTaskMode: (value: AiTaskMode) => void;
  openConversation: () => void;
  requestPendingConfirmation: (value: PendingAiConfirmation) => PendingConfirmationRequestResult;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  openProposal: (proposalId: string) => void;
  setImageTaskStatus: (update: ImageTaskStatusUpdate) => void;
  services?: Partial<WorkspaceAgentRuntimeControllerServices>;
};

export type WorkspaceAgentRuntimeController = {
  isStreaming: boolean;
  showFailure: boolean;
  showRecoveryPending: boolean;
  send: (input: RunMorphoAgentTurnAPlusInput) => Promise<void>;
  retryRecovery: () => Promise<void>;
  editFailedTurn: () => boolean;
  cancel: () => Promise<void>;
  acknowledgePendingConfirmation: () => Promise<boolean>;
  beginLocalAbortableTask: () => {
    controller: AbortController;
    signal: AbortSignal;
    isCurrent: () => boolean;
  } | null;
  finishLocalAbortableTask: (controller: AbortController) => void;
};

type OwnedSlot<T> = {
  session: WorkspaceAgentRuntimeSession;
  value: T;
};

type RuntimeDisplayState = {
  session: WorkspaceAgentRuntimeSession | null;
  isStreaming: boolean;
  showFailure: boolean;
  showRecoveryPending: boolean;
};

type RuntimeDisplayPatch = Partial<Omit<RuntimeDisplayState, "session">>;

const defaultServices: WorkspaceAgentRuntimeControllerServices = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  randomSuffix: () => Math.random().toString(36).slice(2, 8)
};

export function useWorkspaceAgentRuntimeController(
  input: UseWorkspaceAgentRuntimeControllerInput
): WorkspaceAgentRuntimeController {
  const {
    projectId,
    workspaceReady,
    commitWorkspace: commitWorkspaceInput,
    readWorkspace: readWorkspaceInput,
    persistWorkspace: persistWorkspaceInput,
    executeVisualGenerationPlan,
    setContextWarning: setContextWarningInput,
    clearPendingDeliveryDraftTarget,
    setDraft,
    setTaskMode,
    openConversation,
    requestPendingConfirmation,
    selectObjects,
    focusObject,
    openProposal,
    setImageTaskStatus: setImageTaskStatusInput
  } = input;
  const serviceFetch = input.services?.fetch;
  const serviceNow = input.services?.now;
  const serviceRandomSuffix = input.services?.randomSuffix;
  const services = useMemo<WorkspaceAgentRuntimeControllerServices>(
    () => ({
      ...defaultServices,
      ...(serviceFetch ? { fetch: serviceFetch } : {}),
      ...(serviceNow ? { now: serviceNow } : {}),
      ...(serviceRandomSuffix ? { randomSuffix: serviceRandomSuffix } : {})
    }),
    [serviceFetch, serviceNow, serviceRandomSuffix]
  );

  const [runtimeDisplayState, setRuntimeDisplayState] = useState<RuntimeDisplayState>({
    session: null,
    isStreaming: false,
    showFailure: false,
    showRecoveryPending: false
  });
  const runtimeStateRef = useRef({ isStreaming: false, showRecoveryPending: false });

  const session = useMemo(
    () => createWorkspaceAgentRuntimeSession(projectId, workspaceReady),
    [projectId, workspaceReady]
  );
  const isStreaming = runtimeDisplayState.session === session
    ? runtimeDisplayState.isStreaming
    : false;
  const showFailure = runtimeDisplayState.session === session
    ? runtimeDisplayState.showFailure
    : false;
  const showRecoveryPending = runtimeDisplayState.session === session
    ? runtimeDisplayState.showRecoveryPending
    : false;
  const currentSessionRef = useRef<WorkspaceAgentRuntimeSession | null>(null);
  const activeHostRef = useRef<AgentTurnHost | null>(null);
  const renderedHostRef = useRef<AgentTurnHost | null>(null);
  const abortSlotRef = useRef<OwnedSlot<AbortController> | null>(null);
  const streamFlushSlotRef = useRef<OwnedSlot<() => void> | null>(null);
  const lastSubmittedTurnRef = useRef<OwnedSlot<{ draft: string; taskMode: AiTaskMode }> | null>(null);

  const updateRuntimeDisplay = useCallback(
    (expectedSession: WorkspaceAgentRuntimeSession, patch: RuntimeDisplayPatch): void => {
      setRuntimeDisplayState((current) => {
        if (currentSessionRef.current !== expectedSession) return current;
        const base = current.session === expectedSession
          ? current
          : {
              session: expectedSession,
              isStreaming: false,
              showFailure: false,
              showRecoveryPending: false
            };
        return { ...base, ...patch };
      });
    },
    []
  );

  useLayoutEffect(() => {
    runtimeStateRef.current = { isStreaming, showRecoveryPending };
  }, [isStreaming, showRecoveryPending]);

  const isCurrentSession = useCallback((expectedSession: WorkspaceAgentRuntimeSession): boolean => {
    const current = currentSessionRef.current;
    return (
      current === expectedSession &&
      current.workspaceReady &&
      current.projectId === expectedSession.projectId
    );
  }, []);

  const assertCurrentSession = useCallback(
    (expectedSession: WorkspaceAgentRuntimeSession): void => {
      if (!isCurrentSession(expectedSession)) {
        throw createAgentTurnHostSessionDetachedError();
      }
    },
    [isCurrentSession]
  );

  const createOwnedAbortSlot = useCallback(
    (expectedSession: WorkspaceAgentRuntimeSession) => ({
      get: () => {
        if (!isCurrentSession(expectedSession)) return null;
        const owned = abortSlotRef.current;
        return owned?.session === expectedSession ? owned.value : null;
      },
      set: (value: AbortController | null) => {
        if (value === null) {
          if (abortSlotRef.current?.session === expectedSession) {
            abortSlotRef.current = null;
          }
          return;
        }
        if (!isCurrentSession(expectedSession)) return;
        abortSlotRef.current = { session: expectedSession, value };
      }
    }),
    [isCurrentSession]
  );

  const createOwnedStreamFlushSlot = useCallback(
    (expectedSession: WorkspaceAgentRuntimeSession) => ({
      get: () => {
        if (!isCurrentSession(expectedSession)) return null;
        const owned = streamFlushSlotRef.current;
        return owned?.session === expectedSession ? owned.value : null;
      },
      set: (value: (() => void) | null) => {
        if (value === null) {
          if (streamFlushSlotRef.current?.session === expectedSession) {
            streamFlushSlotRef.current = null;
          }
          return;
        }
        if (!isCurrentSession(expectedSession)) return;
        streamFlushSlotRef.current = { session: expectedSession, value };
      }
    }),
    [isCurrentSession]
  );

  const host = useMemo<AgentTurnHost>(() => {
    const guardedCommitWorkspace = <T,>(transform: WorkspaceCommitTransform<T>): T => {
      assertCurrentSession(session);
      return commitWorkspaceInput((current) => {
        assertCurrentSession(session);
        if (current.project.id !== session.projectId) {
          throw createAgentTurnHostSessionDetachedError();
        }
        return transform(current);
      });
    };
    const guardedReadWorkspace = (): MorphoWorkspace => {
      assertCurrentSession(session);
      const current = readWorkspaceInput();
      assertCurrentSession(session);
      if (current.project.id !== session.projectId) {
        throw createAgentTurnHostSessionDetachedError();
      }
      return current;
    };
    const guardedPersistWorkspace = (): WorkspacePersistenceState => {
      guardedReadWorkspace();
      const persisted = persistWorkspaceInput();
      assertCurrentSession(session);
      return persisted;
    };
    const guard = <T,>(effect: () => T, fallback: T): T => {
      if (!isCurrentSession(session)) return fallback;
      return effect();
    };

    return {
      commitWorkspace: guardedCommitWorkspace,
      readWorkspace: guardedReadWorkspace,
      persistWorkspace: guardedPersistWorkspace,
      ui: {
        setContextWarning: (value) => guard(() => setContextWarningInput(value), undefined),
        clearPendingDeliveryDraftTarget: () => guard(clearPendingDeliveryDraftTarget, undefined),
        setStreaming: (value) => guard(() => updateRuntimeDisplay(session, { isStreaming: value }), undefined),
        setDraft: (value) => guard(() => setDraft(value), undefined),
        setTaskMode: (value) => guard(() => setTaskMode(value), undefined),
        openConversation: () => guard(openConversation, undefined),
        showFailure: () => guard(() => {
          updateRuntimeDisplay(session, { showFailure: true, showRecoveryPending: false });
        }, undefined),
        showRecoveryPending: () => guard(() => {
          updateRuntimeDisplay(session, { showFailure: false, showRecoveryPending: true });
        }, undefined),
        requestPendingConfirmation: (value) => guard(
          () => requestPendingConfirmation(value),
          { status: "rejected", code: "confirmation_session_stale", origin: "agent" }
        ),
        selectObjects: (objectIds) => guard(() => selectObjects(objectIds), undefined),
        focusObject: (objectId) => guard(() => focusObject(objectId), undefined),
        openProposal: (proposalId) => guard(() => openProposal(proposalId), undefined)
      },
      abortSlot: createOwnedAbortSlot(session),
      streamFlushSlot: createOwnedStreamFlushSlot(session),
      fetch: services.fetch,
      executeVisualGenerationPlan,
      now: services.now,
      randomSuffix: services.randomSuffix
    };
  }, [
    assertCurrentSession,
    clearPendingDeliveryDraftTarget,
    commitWorkspaceInput,
    createOwnedAbortSlot,
    createOwnedStreamFlushSlot,
    executeVisualGenerationPlan,
    focusObject,
    isCurrentSession,
    openConversation,
    openProposal,
    persistWorkspaceInput,
    readWorkspaceInput,
    selectObjects,
    services,
    session,
    setContextWarningInput,
    setDraft,
    requestPendingConfirmation,
    setTaskMode,
    updateRuntimeDisplay
  ]);

  useLayoutEffect(() => {
    renderedHostRef.current = host;
    if (currentSessionRef.current === session) {
      activeHostRef.current = host;
    }
  }, [host, session]);

  const detachSession = useCallback((
    expectedSession: WorkspaceAgentRuntimeSession,
    expectedHost: AgentTurnHost
  ): void => {
    const flush = streamFlushSlotRef.current?.session === expectedSession
      ? streamFlushSlotRef.current.value
      : null;
    const controller = abortSlotRef.current?.session === expectedSession
      ? abortSlotRef.current.value
      : null;
    currentSessionRef.current = null;
    flush?.();
    expectedHost.streamFlushSlot.set(null);
    controller?.abort(createAgentTurnHostSessionDetachedError());
    expectedHost.abortSlot.set(null);
    detachMorphoAgentTurnForPageUnload(expectedSession.projectId);
  }, []);

  useLayoutEffect(() => {
    const previousSession = currentSessionRef.current;
    const previousHost = activeHostRef.current;
    if (previousSession && previousHost && previousSession !== session) {
      detachSession(previousSession, previousHost);
    }
    currentSessionRef.current = session;
    activeHostRef.current = renderedHostRef.current;
    setContextWarningInput(undefined);

    return () => {
      if (currentSessionRef.current === session && activeHostRef.current) {
        detachSession(session, activeHostRef.current);
      }
    };
  }, [detachSession, session, setContextWarningInput]);

  const recoveredSessionRef = useRef<WorkspaceAgentRuntimeSession | null>(null);
  useEffect(() => {
    if (!session.workspaceReady || currentSessionRef.current !== session || recoveredSessionRef.current === session) {
      return;
    }
    const expectedHost = activeHostRef.current;
    if (!expectedHost) return;
    recoveredSessionRef.current = session;
    void recoverMorphoAgentTurn(session.projectId, expectedHost).catch((error: unknown) => {
      if (
        isAgentTurnHostSessionDetachedError(error) ||
        currentSessionRef.current !== session
      ) {
        return;
      }
      expectedHost.ui.showFailure();
    });
  }, [session]);

  const send = useCallback(async (input: RunMorphoAgentTurnAPlusInput): Promise<void> => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedSession.workspaceReady || !expectedHost) return;
    const draft = input.draft.trim();
    if (!draft || runtimeStateRef.current.isStreaming) return;
    const turnInput = { ...input, draft };
    lastSubmittedTurnRef.current = {
      session: expectedSession,
      value: { draft, taskMode: input.taskMode }
    };

    try {
      if (runtimeStateRef.current.showRecoveryPending) {
        const recoveryResult = await resumeMorphoAgentTurn(expectedSession.projectId, expectedHost);
        if (currentSessionRef.current !== expectedSession) return;
        if (recoveryResult === "pending") {
          updateRuntimeDisplay(expectedSession, { showFailure: false, showRecoveryPending: true });
          return;
        }
        if (recoveryResult === "failed") {
          updateRuntimeDisplay(expectedSession, { showRecoveryPending: false, showFailure: true });
          return;
        }
        updateRuntimeDisplay(expectedSession, { showRecoveryPending: false, showFailure: false });
      }
      if (currentSessionRef.current !== expectedSession) return;
      if (parseManualCompactCommand(draft).matched) {
        await runManualCompactionTurn(turnInput, expectedHost);
      } else {
        await runMorphoAgentTurn(turnInput, expectedHost);
      }
    } catch (error) {
      if (isAgentTurnHostSessionDetachedError(error)) return;
      throw error;
    }
  }, [updateRuntimeDisplay]);

  const retryRecovery = useCallback(async (): Promise<void> => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedSession.workspaceReady || !expectedHost) return;
    updateRuntimeDisplay(expectedSession, { showFailure: false });
    try {
      const result = await resumeMorphoAgentTurn(expectedSession.projectId, expectedHost);
      if (currentSessionRef.current !== expectedSession) return;
      updateRuntimeDisplay(expectedSession, {
        showRecoveryPending: result === "pending",
        showFailure: result === "failed"
      });
    } catch (error) {
      if (isAgentTurnHostSessionDetachedError(error)) return;
      throw error;
    }
  }, [updateRuntimeDisplay]);

  const editFailedTurn = useCallback((): boolean => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedSession.workspaceReady || !expectedHost || showRecoveryPending) return false;
    const failedTurn = getLatestFailedAgentTurnDraft(expectedHost.readWorkspace());
    const fallback = lastSubmittedTurnRef.current?.session === expectedSession
      ? lastSubmittedTurnRef.current.value
      : null;
    const draft = failedTurn?.draft ?? fallback?.draft;
    const taskMode = failedTurn?.taskMode ?? fallback?.taskMode;
    if (!draft || !taskMode) return false;

    setDraft(draft);
    setTaskMode(taskMode);
    openConversation();
    updateRuntimeDisplay(expectedSession, { showFailure: false, showRecoveryPending: false });
    return true;
  }, [openConversation, setDraft, setTaskMode, showRecoveryPending, updateRuntimeDisplay]);

  const cancel = useCallback(async (): Promise<void> => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedSession.workspaceReady || !expectedHost) return;
    if (await cancelMorphoAgentTurn(expectedSession.projectId)) return;
    if (currentSessionRef.current !== expectedSession) return;

    expectedHost.streamFlushSlot.get()?.();
    expectedHost.streamFlushSlot.set(null);
    expectedHost.abortSlot.get()?.abort();
    expectedHost.abortSlot.set(null);
    updateRuntimeDisplay(expectedSession, { isStreaming: false });
    setImageTaskStatusInput((current) =>
      current && isActiveImageTaskStatus(current.state)
        ? {
            state: "cancelled",
            message: "当前 AI 任务已停止。原输入、已保存对象和已有结果会保留。"
          }
        : current
    );
    try {
      expectedHost.commitWorkspace((current) => {
        const activeMessage = [...current.ai.messages]
          .reverse()
          .find((message) => message.status === "streaming" && message.agentTrace);
        let next = current;
        if (activeMessage?.agentTrace) {
          next = updateAiMessage(
            next,
            activeMessage.id,
            activeMessage.body || "当前 Agent 回合已取消。原输入、选择和已完成步骤已保留。",
            "cancelled",
            {
              agentTrace: completeAgentTrace(activeMessage.agentTrace, "cancelled", new Date().toISOString())
            }
          );
        }
        next = interruptActiveOperations(next, "用户停止了当前 AI 任务。原输入、已保存对象和已有结果会保留。");
        return { workspace: next, value: undefined };
      });
    } catch (error) {
      if (!isAgentTurnHostSessionDetachedError(error)) throw error;
    }
  }, [setImageTaskStatusInput, updateRuntimeDisplay]);

  const acknowledgePendingConfirmation = useCallback(async (): Promise<boolean> => {
    const expectedSession = currentSessionRef.current;
    if (!expectedSession || !expectedSession.workspaceReady) return false;
    try {
      const acknowledged = await acknowledgeMorphoAgentPendingConfirmation(expectedSession.projectId);
      return currentSessionRef.current === expectedSession ? acknowledged : false;
    } catch (error) {
      if (isAgentTurnHostSessionDetachedError(error)) return false;
      throw error;
    }
  }, []);

  const beginLocalAbortableTask = useCallback(() => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedSession.workspaceReady || !expectedHost) {
      return null;
    }
    const controller = new AbortController();
    expectedHost.abortSlot.set(controller);
    if (expectedHost.abortSlot.get() !== controller) {
      return null;
    }
    updateRuntimeDisplay(expectedSession, { isStreaming: true, showFailure: false });
    return {
      controller,
      signal: controller.signal,
      isCurrent: () => currentSessionRef.current === expectedSession && expectedHost.abortSlot.get() === controller
    };
  }, [updateRuntimeDisplay]);

  const finishLocalAbortableTask = useCallback((controller: AbortController): void => {
    const expectedSession = currentSessionRef.current;
    const expectedHost = activeHostRef.current;
    if (!expectedSession || !expectedHost || !isCurrentSession(expectedSession)) return;
    if (expectedHost.abortSlot.get() !== controller) return;
    expectedHost.abortSlot.set(null);
    updateRuntimeDisplay(expectedSession, { isStreaming: false });
  }, [isCurrentSession, updateRuntimeDisplay]);

  return {
    isStreaming,
    showFailure,
    showRecoveryPending,
    send,
    retryRecovery,
    editFailedTurn,
    cancel,
    acknowledgePendingConfirmation,
    beginLocalAbortableTask,
    finishLocalAbortableTask
  };
}

function isActiveImageTaskStatus(state: ImageTaskStatus["state"]): boolean {
  return state === "preparing" || state === "submitting" || state === "waiting" || state === "downloading";
}
