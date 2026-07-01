import type { AiWorkIntent, MorphoObjectId, MorphoWorkspace } from "../../domain/morpho/types";
import { resolveComparisonSelection } from "../../domain/morpho/comparisonAnalysis";
import { containsStructuredBlock } from "../../domain/morpho/structuredBlocks";

const BLOCKING_PROPOSAL_BLOCKS = ["morphoDesignDefinitionProposal", "morphoConceptDirectionProposal"] as const;

export type SameReplyStructuredWritePolicy = {
  hasBlockingProposalBlock: boolean;
  allowComparisonAnalysis: boolean;
  allowSemanticPatch: boolean;
  allowConversationCheckpoint: boolean;
  allowComparisonDecisionEntry: boolean;
};

export type AiSendPreflightResult =
  | { status: "ready" }
  | {
      status: "blocked";
      aiOpen: true;
      contextWarning: string;
      aiDraft: string;
    };

export function buildSameReplyStructuredWritePolicy(
  assistantText: string,
  executionWorkIntent: AiWorkIntent
): SameReplyStructuredWritePolicy {
  const hasBlockingProposalBlock = BLOCKING_PROPOSAL_BLOCKS.some((marker) => containsStructuredBlock(assistantText, marker));
  return {
    hasBlockingProposalBlock,
    allowComparisonAnalysis: executionWorkIntent === "comparison" && !hasBlockingProposalBlock,
    allowSemanticPatch: !hasBlockingProposalBlock,
    allowConversationCheckpoint: !hasBlockingProposalBlock,
    allowComparisonDecisionEntry: executionWorkIntent === "comparison" && !hasBlockingProposalBlock
  };
}

export function prepareAiSendBeforeProvider(input: {
  workspace: MorphoWorkspace;
  selectedObjectIds: MorphoObjectId[];
  executionWorkIntent: AiWorkIntent;
  draft: string;
}): AiSendPreflightResult {
  if (input.executionWorkIntent !== "comparison") {
    return { status: "ready" };
  }

  const selection = resolveComparisonSelection(input.workspace, input.selectedObjectIds);
  if (selection.status === "ready") {
    return { status: "ready" };
  }

  return {
    status: "blocked",
    aiOpen: true,
    contextWarning: localizeComparisonSelectionReason(selection.reason),
    aiDraft: input.draft
  };
}

export function localizeComparisonSelectionReason(reason: string): string {
  return `无法发起 Compare：${reason}`;
}
