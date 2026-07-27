import type { AiTaskMode, MorphoWorkspace } from "@/domain/morpho/types";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

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
  setPendingConfirmation: (value: PendingAiConfirmation) => void;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  openProposal: (proposalId: string) => void;
};

export type AgentTurnHost = {
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  ui: AgentTurnUiPort;
  abortSlot: MutableSlot<AbortController | null>;
  streamFlushSlot: MutableSlot<(() => void) | null>;
  fetch: typeof fetch;
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
  now: () => number;
  randomSuffix: () => string;
};
