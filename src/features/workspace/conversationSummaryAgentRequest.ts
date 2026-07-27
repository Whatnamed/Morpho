import type {
  ConversationCompactionPlan,
  ConversationMessageForContext
} from "@/domain/morpho/conversationCompaction";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type { AgentRuntimeMode } from "@/shared/agentRuntimeItem";
import {
  buildAgentCompactionDescriptor,
  buildAgentTranscriptManifest,
  hashConversationSummaryForReceipt,
  type AgentContextStateMarker
} from "@/shared/agentCompactionProtocol";
import { createAgentStrategyMarker } from "@/shared/agentStrategyItem";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  buildAgentCheckpointCompactionInput,
  buildConversationSummarySourceProviderInput
} from "./morphoAgent";

export function buildConversationSummaryAgentRequest(input: {
  plan: ConversationCompactionPlan;
  projectId: string;
  agentTurnId: string;
  mode: AgentRuntimeMode;
  leaseId?: string;
  leaseSequence?: number;
  continuationToken?: string;
  retainedTailItems?: readonly unknown[];
  contextMarkers?: readonly AgentContextStateMarker[];
  previousTranscriptManifestHash?: string;
  previousTranscriptSnapshotToken?: string;
}) {
  const retainedTailItems = input.retainedTailItems ?? [];
  const summaryInput = buildAgentCheckpointCompactionInput({
    previousSummaryRevision: input.plan.previousSummaryRevision,
    messages: input.plan.sourceMessages,
    sourceStartMessageId: input.plan.sourceStartMessageId,
    sourceEndMessageId: input.plan.sourceEndMessageId,
    sourceMessageCount: input.plan.sourceMessageCount
  });
  const descriptor = buildAgentCompactionDescriptor({
    sourceStartMessageId: input.plan.sourceStartMessageId,
    sourceEndMessageId: input.plan.sourceEndMessageId,
    sourceMessageCount: input.plan.sourceMessageCount,
    sourceMessageIdsHash: input.plan.sourceMessageIdsHash,
    retainedTail: retainedTailItems,
    sourceInput: summaryInput,
    sourceManifest: buildAgentTranscriptManifest(
      input.plan.sourceMessages.flatMap((message) => buildConversationSummarySourceProviderInput(message))
    ),
    contextMarkers: input.contextMarkers,
    previousTranscriptManifestHash: input.previousTranscriptManifestHash,
    ...(input.plan.previousSummaryRevision
      ? {
          previousSummaryHash: hashConversationSummaryForReceipt(input.plan.previousSummaryRevision.summary),
          previousSummaryRevisionId: input.plan.previousSummaryRevision.id
        }
      : {}),
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION
  });
  return {
    input: buildAgentCheckpointCompactionInput({
      previousSummaryRevision: input.plan.previousSummaryRevision,
      messages: input.plan.sourceMessages,
      sourceStartMessageId: input.plan.sourceStartMessageId,
      sourceEndMessageId: input.plan.sourceEndMessageId,
      sourceMessageCount: input.plan.sourceMessageCount
    }),
    projectId: input.projectId,
    agentTurnId: input.agentTurnId,
    continuation: false as const,
    ...(input.leaseId
      ? {
          leaseContinuation: true as const,
          leaseId: input.leaseId,
          leaseSequence: input.leaseSequence,
          ...(input.continuationToken ? { continuationToken: input.continuationToken } : {})
        }
      : {}),
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: input.mode,
    capabilityIntent: { comparisonAnalysis: false as const },
    directive: { kind: "conversationSummary" as const },
    compactionDescriptor: descriptor,
    compactionRetainedTail: retainedTailItems,
    ...(input.contextMarkers ? { compactionContextMarkers: [...input.contextMarkers] } : {}),
    ...(input.previousTranscriptSnapshotToken
      ? { previousTranscriptSnapshotToken: input.previousTranscriptSnapshotToken }
      : {})
  };
}

export function buildConversationCompactionTailItems(input: {
  messages: readonly ConversationMessageForContext[];
  continuationItems: readonly unknown[];
}): unknown[] {
  return [
    ...input.messages.flatMap((message) => conversationMessageToProviderInput(message)),
    ...input.continuationItems
  ];
}

function conversationMessageToProviderInput(message: ConversationMessageForContext): unknown[] {
  const strategy = message.role === "user" && message.taskStrategy
    ? [createAgentStrategyMarker({ strategy: message.taskStrategy, anchorMessageId: message.id })]
    : [];
  return [
    ...strategy,
    ...buildConversationSummarySourceProviderInput(message)
  ];
}
