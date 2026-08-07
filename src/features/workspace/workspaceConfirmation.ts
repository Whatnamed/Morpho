import type { AssignableKeyConclusionCategory } from "@/domain/morpho/types";
import type {
  CreateComparisonAnalysisArgs,
  CreateConceptDirectionProposalArgs,
  CreateDesignDefinitionProposalArgs,
  CreateResearchAnalysisArgs,
  RequestConfirmationArgs
} from "./morphoAgent";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import type { ProviderCitation } from "@/server/ai/types";
import {
  isComparisonPendingConfirmation,
  type PendingComparisonConfirmation
} from "./comparisonDecision";

export type PendingAiConfirmation =
  | {
      kind: "setDefaultReference";
      targetObjectId: string;
      targetTitle: string;
      previousReferenceObjectId: string;
      previousReferenceTitle: string;
      reviewImageCount: number;
      reviewCollectionCount: number;
      reviewImageIds: string[];
      reviewCollectionIds: string[];
    }
  | {
      kind: "deleteObject";
      targetObjectId: string;
      targetTitle: string;
      reasons: string[];
    }
  | {
      kind: "batchGenerateVisuals";
      targetTitle: string;
      itemCount: number;
      reason: string;
      impact: string;
      draft: string;
      plan: VisualGenerationPlan;
      sourceObjectIds: string[];
      selectedDirectionIds: string[];
      selectedImageIds: string[];
    }
  | {
      kind: "createKeyConclusion";
      sourceObjectIds: string[];
      sourceTitle: string;
      conclusionTitle: string;
      body: string;
      summary: string;
      category: AssignableKeyConclusionCategory | null;
      citationIds: string[];
      confidence: "supported" | "partial" | "needsVerification";
      state?: "active" | "needsVerification";
      note: string;
    }
  | {
      kind: "agentCreateResearchAnalysis";
      targetTitle: string;
      reason: string;
      impact: string;
      draft: string;
      args: CreateResearchAnalysisArgs;
      sourceObjectIds: string[];
      citations: ProviderCitation[];
    }
  | {
      kind: "agentCreateDesignDefinitionProposal";
      targetTitle: string;
      reason: string;
      impact: string;
      draft: string;
      args: CreateDesignDefinitionProposalArgs;
      sourceObjectIds: string[];
      citations: ProviderCitation[];
      basedOnDesignDefinitionId?: string;
      basedOnRevisionId?: string;
    }
  | {
      kind: "agentCreateConceptDirectionProposal";
      targetTitle: string;
      reason: string;
      impact: string;
      draft: string;
      args: CreateConceptDirectionProposalArgs;
      sourceObjectIds: string[];
      citations: ProviderCitation[];
      basedOnDesignDefinitionId?: string;
      basedOnRevisionId?: string;
    }
  | {
      kind: "agentCreateComparisonAnalysis";
      targetTitle: string;
      reason: string;
      impact: string;
      args: CreateComparisonAnalysisArgs;
      selectedObjectIds: string[];
      userMessageId: string;
      assistantMessageId: string;
      imageAttachmentObjectIds: string[];
      documentExtractObjectIds: string[];
      documentFragmentExtractObjectIds: string[];
    }
  | {
      kind: "agentGenerateVisuals";
      targetTitle: string;
      reason: string;
      impact: string;
      draft: string;
      plan: VisualGenerationPlan;
      sourceObjectIds: string[];
      selectedDirectionIds: string[];
      selectedImageIds: string[];
    }
  | {
      kind: "agentRequestedAction";
      targetTitle: string;
      reason: string;
      impact: string;
      action: RequestConfirmationArgs["action"];
      targetObjectId?: string;
      visualPlan?: VisualGenerationPlan;
      draft: string;
      sourceObjectIds: string[];
      selectedDirectionIds: string[];
      selectedImageIds: string[];
    }
  | PendingComparisonConfirmation;

export type PendingConfirmationOrigin = "local" | "agent" | "compare";

export type PendingConfirmationRequestResult =
  | {
      status: "accepted";
      origin: PendingConfirmationOrigin;
    }
  | {
      status: "rejected";
      code: "confirmation_slot_occupied" | "confirmation_session_stale";
      origin: PendingConfirmationOrigin;
    };

export function getPendingConfirmationOrigin(
  confirmation: PendingAiConfirmation
): PendingConfirmationOrigin {
  if (isComparisonPendingConfirmation(confirmation)) {
    return "compare";
  }
  return confirmation.kind.startsWith("agent") ? "agent" : "local";
}

export function isAgentPendingConfirmation(
  confirmation: PendingAiConfirmation
): confirmation is Extract<PendingAiConfirmation, { kind: `agent${string}` }> {
  return getPendingConfirmationOrigin(confirmation) === "agent";
}

export { isComparisonPendingConfirmation };
