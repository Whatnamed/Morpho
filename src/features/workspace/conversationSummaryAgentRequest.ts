import type { ConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";
import type { AgentRuntimeMode } from "@/shared/agentRuntimeItem";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { buildAgentCheckpointCompactionInput } from "./morphoAgent";

export function buildConversationSummaryAgentRequest(input: {
  plan: ConversationCompactionPlan;
  projectId: string;
  agentTurnId: string;
  mode: AgentRuntimeMode;
  leaseId?: string;
  leaseSequence?: number;
}) {
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
          leaseSequence: input.leaseSequence
        }
      : {}),
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: input.mode,
    capabilityIntent: { comparisonAnalysis: false as const },
    directive: { kind: "conversationSummary" as const }
  };
}
