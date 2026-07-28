import type { ConversationMessageForContext } from "@/domain/morpho/conversationCompaction";
import type {
  ConversationSummaryRevision,
  MorphoWorkspace,
  ProviderOutputSnapshot,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import type { ProviderCitation } from "@/server/ai/types";
import type { AgentCanonicalRuntimeItem } from "@/shared/agentRuntimeItem";
import type { AgentServerDirective } from "@/shared/agentStreamProtocol";
import type { AgentContextBudgetState } from "@/shared/providerInputBudget";
import type { RequiredAgentReadState } from "./agentTaskStrategy";
import type { AgentTurnWorkLedger } from "./agentTurnMessages";
import type { ProviderRequestBoundaryState } from "./providerContextFrames";

export type AgentTurnState = {
  agentTurnLeaseId?: string;
  nextAgentLeaseSequence?: number;
  agentContinuationToken?: string;
  /** Latest server-issued proof authorized to close this ordinary Agent turn. */
  turnClosureToken?: string;
  /** Stable across the single network recovery attempt for turn closure. */
  closureRequestId?: string;
  /** Exact serialized Closure request retained until the server confirms it. */
  closureRequestBody?: string;
  /** Terminal Provider failure recorded by the server for the current Lease sequence. */
  providerFailureOutcome?: "cancelledDuringProvider" | "failedDuringProvider";
  /** Exact manifest from the latest signed Provider response in this turn. */
  latestProviderTranscriptManifestHash?: string;
  providerTranscriptReset: boolean;
  webSearchSequenceResyncUsed: boolean;
  webSearchLeaseStateRecoveryUsed: boolean;
  workspaceAtAgentStart: MorphoWorkspace;
  latestProviderRequestState?: ProviderRequestBoundaryState;
  latestAssistantProviderOutputSnapshot?: ProviderOutputSnapshot;
  canonicalRuntimeItem?: AgentCanonicalRuntimeItem;
};

export type AgentTurnConversationContext = {
  laneKey: string;
  summaryRevision?: ConversationSummaryRevision;
  messages: ConversationMessageForContext[];
  rawMessageCount: number;
  coveredMessageCount: number;
  estimatedInputTokens: number;
  pressure: "normal" | "prepare" | "compact";
};

export type AgentTurnRuntimeState = {
  conversationContext: AgentTurnConversationContext;
  conversationInput: unknown[];
  readonly turnContinuationItems: unknown[];
  finalText: string;
  collectedCitations: ProviderCitation[];
  hasWebSearchEvidence: boolean;
  requiredReadState: RequiredAgentReadState;
  memoryUpdateReminderInserted: boolean;
  readonly handledMemoryCandidateIndexes: Set<number>;
  readonly memoryUpdateEntryIds: Set<string>;
  readonly memoryUpdateKeys: Set<ProjectMemoryKey>;
  readonly stageRecordUpdateKeys: Set<StageRecordKey>;
  contextBudgetState: AgentContextBudgetState;
  highestPressure: "normal" | "prepare" | "compact";
  modelTurnCount: number;
  toolArgumentRepairCount: number;
  previousToolSignature?: string;
  repeatedToolCallCount: number;
  latestProviderResponseId?: string;
  emergencyGuardTriggered: boolean;
  continuationCompactionCount: number;
  lastCompactionItemCount?: number;
  lastCompactionTokenCount?: number;
  requestSequence: number;
  readonly streamedFinalTextByAttempt: Map<string, string>;
  pendingServerDirective?: AgentServerDirective;
  hasAgentToolResult: boolean;
  readonly agentWorkLedger: AgentTurnWorkLedger;
  pendingConfirmationCreated: boolean;
};

export function createAgentTurnState(workspace: MorphoWorkspace): AgentTurnState {
  return {
    providerTranscriptReset: false,
    webSearchSequenceResyncUsed: false,
    webSearchLeaseStateRecoveryUsed: false,
    workspaceAtAgentStart: workspace
  };
}

export function createAgentTurnRuntimeState(input: {
  conversationContext: AgentTurnConversationContext;
  conversationInput: unknown[];
  requiredReadState: RequiredAgentReadState;
  contextBudgetState: AgentContextBudgetState;
  agentWorkLedger: AgentTurnWorkLedger;
}): AgentTurnRuntimeState {
  return {
    conversationContext: input.conversationContext,
    conversationInput: input.conversationInput,
    turnContinuationItems: [],
    finalText: "",
    collectedCitations: [],
    hasWebSearchEvidence: false,
    requiredReadState: input.requiredReadState,
    memoryUpdateReminderInserted: false,
    handledMemoryCandidateIndexes: new Set(),
    memoryUpdateEntryIds: new Set(),
    memoryUpdateKeys: new Set(),
    stageRecordUpdateKeys: new Set(),
    contextBudgetState: input.contextBudgetState,
    highestPressure: input.conversationContext.pressure,
    modelTurnCount: 0,
    toolArgumentRepairCount: 0,
    repeatedToolCallCount: 0,
    emergencyGuardTriggered: false,
    continuationCompactionCount: 0,
    requestSequence: 0,
    streamedFinalTextByAttempt: new Map(),
    hasAgentToolResult: false,
    agentWorkLedger: input.agentWorkLedger,
    pendingConfirmationCreated: false
  };
}
