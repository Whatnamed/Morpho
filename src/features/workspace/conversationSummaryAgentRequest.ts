import type {
  ConversationCompactionPlan,
  ConversationMessageForContext
} from "@/domain/morpho/conversationCompaction";
import { providerInputSnapshotText } from "@/domain/morpho/providerInputSnapshot";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type { AgentRuntimeMode } from "@/shared/agentRuntimeItem";
import {
  buildAgentCompactionDescriptor,
  hashConversationSummaryForReceipt
} from "@/shared/agentCompactionProtocol";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { buildAgentCheckpointCompactionInput } from "./morphoAgent";

export function buildConversationSummaryAgentRequest(input: {
  plan: ConversationCompactionPlan;
  projectId: string;
  agentTurnId: string;
  mode: AgentRuntimeMode;
  leaseId?: string;
  leaseSequence?: number;
  continuationToken?: string;
  retainedTailItems?: readonly unknown[];
}) {
  const retainedTailItems = input.retainedTailItems ?? [];
  const descriptor = buildAgentCompactionDescriptor({
    sourceStartMessageId: input.plan.sourceStartMessageId,
    sourceEndMessageId: input.plan.sourceEndMessageId,
    sourceMessageCount: input.plan.sourceMessageCount,
    sourceMessageIdsHash: input.plan.sourceMessageIdsHash,
    retainedTail: retainedTailItems,
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
    compactionDescriptor: descriptor
  };
}

export function buildConversationCompactionTailItems(input: {
  messages: readonly ConversationMessageForContext[];
  continuationItems: readonly unknown[];
}): unknown[] {
  return [
    ...input.messages.map((message) => conversationMessageToProviderInput(message)),
    ...input.continuationItems
  ];
}

function conversationMessageToProviderInput(message: ConversationMessageForContext): ResponseMessageInput {
  if (message.role === "user" && message.providerInputSnapshot) {
    const textParts = providerInputSnapshotText(message.providerInputSnapshot);
    if (textParts.length > 0) {
      return {
        role: "user",
        content: textParts.map((text) => ({ type: "input_text" as const, text }))
      };
    }
  }
  return {
    role: message.role,
    content: [{
      type: message.role === "assistant" ? "output_text" as const : "input_text" as const,
      text: message.body
    }]
  };
}
