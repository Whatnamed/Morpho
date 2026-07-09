import type { MorphoWorkspace, ProposalDraftObject } from "@/domain/morpho/types";
import {
  updateConceptDirectionProposalDraft,
  updateDesignDefinitionProposalDraft,
  updateResearchAnalysisProposalDraft
} from "@/domain/operations/operations";
import type { ReviseSelectedProposalDraftArgs } from "./morphoAgent";

export type ApplySelectedProposalDraftRevisionResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      proposalId: string;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export function applySelectedProposalDraftRevision(
  workspace: MorphoWorkspace,
  selectedObjectIds: string[],
  args: ReviseSelectedProposalDraftArgs
): ApplySelectedProposalDraftRevisionResult {
  const selectedProposalDrafts = selectedObjectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is ProposalDraftObject => object?.type === "proposalDraft" && object.visibility === "active");

  if (selectedProposalDrafts.length !== 1) {
    return {
      status: "blocked",
      workspace,
      reason: "需要且只能选中一张待确认草案后再修改。"
    };
  }

  const selectedDraft = selectedProposalDrafts[0];
  if (!selectedDraft || selectedDraft.proposalId !== args.proposalId) {
    return {
      status: "blocked",
      workspace,
      reason: "Agent 返回的草案目标不是当前选中的草案。"
    };
  }

  const proposal = workspace.artifactProposals[args.proposalId];
  if (!proposal || proposal.status !== "pending") {
    return {
      status: "blocked",
      workspace,
      reason: "当前草案不可用或已经不再等待编辑。"
    };
  }

  if (proposal.type !== args.proposalType || selectedDraft.proposalType !== args.proposalType) {
    return {
      status: "blocked",
      workspace,
      reason: "Agent 返回的草案类型与当前选中草案不一致。"
    };
  }

  switch (args.proposalType) {
    case "researchAnalysis":
      if (proposal.type !== "researchAnalysis") {
        return {
          status: "blocked",
          workspace,
          reason: "当前草案不是研究与分析草案。"
        };
      }
      return {
        status: "updated",
        workspace: updateResearchAnalysisProposalDraft(workspace, args.proposalId, {
          title: args.title,
          summary: args.summary,
          findings: args.findings,
          opportunities: args.opportunities,
          constraints: args.constraints,
          openQuestions: args.openQuestions,
          evidence: proposal.evidence
        }),
        proposalId: args.proposalId
      };
    case "designDefinition":
      return {
        status: "updated",
        workspace: updateDesignDefinitionProposalDraft(workspace, args.proposalId, args),
        proposalId: args.proposalId
      };
    case "conceptDirection":
      return {
        status: "updated",
        workspace: updateConceptDirectionProposalDraft(workspace, args.proposalId, {
          title: args.title,
          summary: args.summary,
          directions: args.directions
        }),
        proposalId: args.proposalId
      };
  }
}
