import type { AiTaskMode, MorphoWorkspace } from "@/domain/morpho/types";
import type {
  PendingAiConfirmation,
  PendingConfirmationRequestResult
} from "./workspaceConfirmation";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { WorkspacePersistenceState } from "./workspacePersistence";

export const AGENT_TURN_HOST_SESSION_DETACHED_CODE = "agent_turn_host_session_detached" as const;

export type AgentTurnHostSessionDetachedError = Error & {
  code: typeof AGENT_TURN_HOST_SESSION_DETACHED_CODE;
};

export function createAgentTurnHostSessionDetachedError(): AgentTurnHostSessionDetachedError {
  const error = new Error("Agent 页面会话已脱离当前项目。") as AgentTurnHostSessionDetachedError;
  error.name = "AgentTurnHostSessionDetachedError";
  error.code = AGENT_TURN_HOST_SESSION_DETACHED_CODE;
  return error;
}

export function isAgentTurnHostSessionDetachedError(
  value: unknown
): value is AgentTurnHostSessionDetachedError {
  return (
    value instanceof Error &&
    (value as Partial<AgentTurnHostSessionDetachedError>).code === AGENT_TURN_HOST_SESSION_DETACHED_CODE
  );
}

export type MutableSlot<T> = {
  get: () => T;
  set: (value: T) => void;
};

export type AgentTurnUiPort = {
  setContextWarning: (value: string | undefined) => void;
  clearPendingDeliveryDraftTarget: () => void;
  setStreaming: (value: boolean) => void;
  setDraft: (value: string) => void;
  setTaskMode: (value: AiTaskMode) => void;
  openConversation: () => void;
  showFailure: () => void;
  /** Keep a query-only external action visible without presenting it as terminal failure. */
  showRecoveryPending?: () => void;
  requestPendingConfirmation: (value: PendingAiConfirmation) => PendingConfirmationRequestResult;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  openProposal: (proposalId: string) => void;
};

export type AgentTurnHost = {
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  /** Production hosts provide an explicit durable flush; lightweight test hosts may omit it. */
  persistWorkspace?: () => WorkspacePersistenceState;
  ui: AgentTurnUiPort;
  abortSlot: MutableSlot<AbortController | null>;
  streamFlushSlot: MutableSlot<(() => void) | null>;
  fetch: typeof fetch;
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
  now: () => number;
  randomSuffix: () => string;
};

/**
 * Runtime callers must keep an explicit resume affordance when an external
 * action is still running or its response is ambiguous. Minimal test hosts
 * without the optional method retain the failure affordance as a safe fallback
 * instead of silently losing the recovery entry point.
 */
export function showAgentTurnRecoveryPending(ui: AgentTurnUiPort): void {
  if (ui.showRecoveryPending) {
    ui.showRecoveryPending();
    return;
  }
  ui.showFailure();
}
