import {
  applyResearchAnalysisProposal,
  recordResearchAnalysisProposal,
  type RecordResearchProposalInput
} from "../../domain/operations/operations";
import type { CanvasPoint, MorphoWorkspace } from "../../domain/morpho/types";

import {
  applyConversationSemanticPatchFromReply,
  type ConversationSemanticPatchClientResult
} from "./workspaceSemanticPatch";
import type { TaskContextResult } from "./taskContext";

export type ApplyResearchProposalWithSemanticPatchInput = {
  workspace: MorphoWorkspace;
  proposal: RecordResearchProposalInput;
  position: CanvasPoint;
  context: TaskContextResult;
  draft: string;
  userMessageId: string;
  userMessageCreatedAt: string;
  assistantText: string;
};

export type ApplyResearchProposalWithSemanticPatchResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      researchObjectId: string;
      proposalCitationIds: string[];
      semanticPatch: ConversationSemanticPatchClientResult;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
      proposalCitationIds: string[];
      semanticPatch: ConversationSemanticPatchClientResult;
    };

export function applyResearchProposalWithSemanticPatch(
  input: ApplyResearchProposalWithSemanticPatchInput
): ApplyResearchProposalWithSemanticPatchResult {
  const proposed = recordResearchAnalysisProposal(input.workspace, input.proposal);
  const applied = applyResearchAnalysisProposal(proposed.workspace, proposed.proposal.id, {
    position: input.position
  });
  const workspaceAfterResearch = applied.workspace;
  const semanticPatch = applyConversationSemanticPatchFromReply({
    workspace: workspaceAfterResearch,
    taskMode: "researchOperation",
    context: input.context,
    draft: input.draft,
    userMessageId: input.userMessageId,
    userMessageCreatedAt: input.userMessageCreatedAt,
    assistantText: input.assistantText
  });

  if (applied.status !== "updated") {
    return {
      status: "blocked",
      workspace: semanticPatch.workspace,
      reason: applied.reason,
      proposalCitationIds: proposed.proposal.citationIds,
      semanticPatch
    };
  }

  return {
    status: "updated",
    workspace: semanticPatch.workspace,
    researchObjectId: applied.researchObject.id,
    proposalCitationIds: proposed.proposal.citationIds,
    semanticPatch
  };
}
