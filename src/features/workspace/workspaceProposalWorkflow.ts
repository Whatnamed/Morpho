import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  rejectArtifactProposal,
  updateConceptDirectionProposalDraft,
  updateDesignDefinitionProposalDraft,
  updateResearchAnalysisProposalDraft
} from "@/domain/operations/operations";
import type {
  ArtifactProposal,
  ConceptDirectionProposal,
  DesignDefinitionProposal,
  ResearchAnalysisProposal
} from "@/domain/operations/types";

export type ProposalApplyWorkflowOptions = Readonly<{
  allowSourceChanged?: boolean;
}>;

export type ProposalApplyWorkflowResult =
  | {
      status: "applied";
      workspace: MorphoWorkspace;
      proposalId: string;
      selectionObjectIds: string[];
      focusObjectId?: string;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      proposalId: string;
      reason: string;
      shouldResetComposer: boolean;
    }
  | {
      status: "unsupported";
      workspace: MorphoWorkspace;
      proposalId: string;
      reason: string;
    };

export type ProposalRejectWorkflowResult =
  | {
      status: "rejected";
      workspace: MorphoWorkspace;
      proposalId: string;
    }
  | {
      status: "ignored";
      workspace: MorphoWorkspace;
      proposalId: string;
    };

export type ResearchProposalDraftInput = Pick<
  ResearchAnalysisProposal,
  "title" | "summary" | "findings" | "opportunities" | "constraints" | "openQuestions" | "evidence"
>;

export type DesignDefinitionProposalDraftInput = Pick<
  DesignDefinitionProposal,
  | "title"
  | "summary"
  | "projectGoal"
  | "targetUsers"
  | "primaryScenarios"
  | "coreProblem"
  | "designPrinciples"
  | "constraints"
  | "avoidDirections"
  | "opportunities"
  | "openQuestions"
  | "changeNote"
>;

export type ConceptDirectionProposalDraftInput = Pick<ConceptDirectionProposal, "title" | "summary" | "directions">;

export type ProposalDraftUpdate =
  | {
      type: "researchAnalysis";
      proposalId: string;
      input: ResearchProposalDraftInput;
    }
  | {
      type: "designDefinition";
      proposalId: string;
      input: DesignDefinitionProposalDraftInput;
    }
  | {
      type: "conceptDirection";
      proposalId: string;
      input: ConceptDirectionProposalDraftInput;
    };

export function applyArtifactProposalWorkflow(
  workspace: MorphoWorkspace,
  proposalId: string,
  options: ProposalApplyWorkflowOptions = {}
): ProposalApplyWorkflowResult {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.status !== "pending") {
    return {
      status: "blocked",
      workspace,
      proposalId,
      reason: "草案不存在或已被处理。",
      shouldResetComposer: false
    };
  }

  switch (proposal.type) {
    case "researchAnalysis": {
      const result = applyResearchAnalysisProposal(workspace, proposal.id, {
        position: resolveProposalDraftPosition(workspace, proposal.id, getProposalFallbackPosition(workspace, 220, 180)),
        allowSourceChanged: options.allowSourceChanged
      });
      if (result.status === "blocked") {
        return blockedApplyResult(result.workspace, proposal, result.reason);
      }

      const appliedWorkspace = appendProposalAssistantNotice(
        result.workspace,
        "research-proposal-applied",
        `已保存到画布：研究卡「${result.researchObject.title}」。我已选中并定位到它。`,
        proposal.id
      );
      return {
        status: "applied",
        workspace: appliedWorkspace,
        proposalId: proposal.id,
        selectionObjectIds: [result.researchObject.id],
        focusObjectId: result.researchObject.id
      };
    }
    case "designDefinition": {
      const result = applyDesignDefinitionProposal(workspace, proposal.id, {
        allowSourceChanged: options.allowSourceChanged
      });
      if (result.status === "blocked") {
        return blockedApplyResult(result.workspace, proposal, result.reason);
      }

      const appliedWorkspace = appendProposalAssistantNotice(
        result.workspace,
        "design-definition-proposal-applied",
        `已应用到画布：设计定义「${result.designDefinitionObject.title}」。我已选中并定位到它。`,
        proposal.id
      );
      return {
        status: "applied",
        workspace: appliedWorkspace,
        proposalId: proposal.id,
        selectionObjectIds: [result.designDefinitionObject.id],
        focusObjectId: result.designDefinitionObject.id
      };
    }
    case "conceptDirection": {
      const result = applyConceptDirectionProposal(workspace, proposal.id, {
        position: resolveProposalDraftPosition(workspace, proposal.id, getProposalFallbackPosition(workspace, 260, 220)),
        allowSourceChanged: options.allowSourceChanged
      });
      if (result.status === "blocked") {
        return blockedApplyResult(result.workspace, proposal, result.reason);
      }

      const selectionObjectIds = result.directions.map((direction) => direction.id);
      const appliedWorkspace = appendProposalAssistantNotice(
        result.workspace,
        "concept-direction-proposal-applied",
        `已应用到画布：${result.directions.length} 个概念方向。我已选中并定位到第一个方向。`,
        proposal.id
      );
      return {
        status: "applied",
        workspace: appliedWorkspace,
        proposalId: proposal.id,
        selectionObjectIds,
        focusObjectId: selectionObjectIds[0]
      };
    }
    case "deliveryPlan":
      return {
        status: "unsupported",
        workspace,
        proposalId: proposal.id,
        reason: "交付草案暂不支持直接应用。"
      };
  }
}

export function rejectArtifactProposalWorkflow(
  workspace: MorphoWorkspace,
  proposalId: string,
  rejectedReason: string
): ProposalRejectWorkflowResult {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.status !== "pending") {
    return {
      status: "ignored",
      workspace,
      proposalId
    };
  }

  return {
    status: "rejected",
    workspace: rejectArtifactProposal(workspace, proposalId, rejectedReason),
    proposalId
  };
}

export function updateArtifactProposalDraft(workspace: MorphoWorkspace, update: ProposalDraftUpdate): MorphoWorkspace {
  switch (update.type) {
    case "researchAnalysis":
      return updateResearchAnalysisProposalDraft(workspace, update.proposalId, update.input);
    case "designDefinition":
      return updateDesignDefinitionProposalDraft(workspace, update.proposalId, update.input);
    case "conceptDirection":
      return updateConceptDirectionProposalDraft(workspace, update.proposalId, update.input);
  }
}

function blockedApplyResult(
  workspace: MorphoWorkspace,
  proposal: ArtifactProposal,
  reason: string
): Extract<ProposalApplyWorkflowResult, { status: "blocked" }> {
  const suffix = proposal.type === "researchAnalysis" ? "请重新整理来源后再确认。" : "请复核后再确认。";
  return {
    status: "blocked",
    workspace: appendProposalAssistantFailure(workspace, `${proposal.type}-proposal-failed`, `${reason} ${suffix}`, proposal.id),
    proposalId: proposal.id,
    reason,
    shouldResetComposer: true
  };
}

function getProposalFallbackPosition(workspace: MorphoWorkspace, xOffset: number, yOffset: number): { x: number; y: number } {
  return {
    x: workspace.canvas.view.x + xOffset,
    y: workspace.canvas.view.y + yOffset
  };
}

function resolveProposalDraftPosition(
  workspace: MorphoWorkspace,
  proposalId: string,
  fallback: { x: number; y: number }
): { x: number; y: number } {
  return workspace.canvas.instances.find((instance) => instance.objectId === proposalId)?.position ?? fallback;
}

function appendProposalAssistantFailure(
  workspace: MorphoWorkspace,
  prefix: string,
  body: string,
  proposalId: string
): MorphoWorkspace {
  return appendProposalAssistantMessage(workspace, {
    prefix,
    body,
    proposalId,
    status: "failed"
  });
}

function appendProposalAssistantNotice(
  workspace: MorphoWorkspace,
  prefix: string,
  body: string,
  proposalId: string
): MorphoWorkspace {
  return appendProposalAssistantMessage(workspace, {
    prefix,
    body,
    proposalId,
    status: "done"
  });
}

function appendProposalAssistantMessage(
  workspace: MorphoWorkspace,
  input: {
    prefix: string;
    body: string;
    proposalId: string;
    status: "done" | "failed";
  }
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `${input.prefix}-${Date.now()}`,
          role: "assistant",
          body: input.body,
          status: input.status,
          createdAt: new Date().toISOString(),
          proposalId: input.proposalId
        }
      ]
    }
  };
}
