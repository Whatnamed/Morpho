import type { AiTaskMode, MorphoWorkspace } from "@/domain/morpho/types";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { WorkspacePersistenceState } from "./workspacePersistence";

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
  setPendingConfirmation: (value: PendingAiConfirmation) => void;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  openProposal: (proposalId: string) => void;
};

export type AgentTurnHost = {
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  /** A+ requires an explicit durable flush; legacy B callers may omit it. */
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
 * A+ callers must keep an explicit resume affordance when an external action
 * is still running or its response is ambiguous. Legacy test/host ports that
 * predate the optional method retain the old failure affordance as a safe
 * fallback instead of silently losing the recovery entry point.
 */
export function showAgentTurnRecoveryPending(ui: AgentTurnUiPort): void {
  if (ui.showRecoveryPending) {
    ui.showRecoveryPending();
    return;
  }
  ui.showFailure();
}
