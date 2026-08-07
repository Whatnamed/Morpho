import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace, createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  recordConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordResearchAnalysisProposal
} from "@/domain/operations/operations";
import type { DeliveryPlanProposal } from "@/domain/operations/types";
import {
  applyArtifactProposalWorkflow,
  rejectArtifactProposalWorkflow,
  updateArtifactProposalDraft
} from "./workspaceProposalWorkflow";

describe("workspace proposal workflow core", () => {
  it("normalizes Research, Design Definition, and Concept Direction apply outcomes", () => {
    const researchProposal = recordResearchAnalysisProposal(createBlankWorkspace("project-research"), {
      proposalId: "proposal-research-workflow",
      operationId: "operation-research-workflow",
      title: "研究草案",
      summary: "研究摘要",
      findings: ["发现"],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: []
    });
    const researchResult = applyArtifactProposalWorkflow(researchProposal.workspace, researchProposal.proposal.id);

    if (researchResult.status !== "applied") {
      throw new Error(`Expected research apply, received ${researchResult.status}.`);
    }
    expect(researchResult).toMatchObject({
      proposalId: researchProposal.proposal.id,
      selectionObjectIds: [expect.any(String)],
      focusObjectId: expect.any(String)
    });
    expect(researchResult.workspace.artifactProposals[researchProposal.proposal.id]?.status).toBe("applied");
    expect(researchResult.workspace.ui.lastSelectionIds).toEqual(researchResult.selectionObjectIds);
    expect(researchResult.workspace.ai.messages.at(-1)).toMatchObject({
      status: "done",
      proposalId: researchProposal.proposal.id
    });

    const designProposal = recordDesignDefinitionProposal(createBlankWorkspace("project-definition"), {
      proposalId: "proposal-definition-workflow",
      operationId: "operation-definition-workflow",
      title: "设计定义草案",
      summary: "设计定义摘要",
      projectGoal: "目标",
      targetUsers: ["用户"],
      primaryScenarios: ["场景"],
      coreProblem: "问题",
      designPrinciples: ["原则"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: []
    });
    const designResult = applyArtifactProposalWorkflow(designProposal.workspace, designProposal.proposal.id);

    if (designResult.status !== "applied") {
      throw new Error(`Expected design-definition apply, received ${designResult.status}.`);
    }
    expect(designResult.selectionObjectIds).toEqual([designResult.focusObjectId]);
    expect(designResult.workspace.ui.lastSelectionIds).toEqual(designResult.selectionObjectIds);

    const conceptProposal = recordConceptDirectionProposal(createBlankWorkspace("project-direction"), {
      proposalId: "proposal-direction-workflow",
      operationId: "operation-direction-workflow",
      title: "概念方向草案",
      summary: "概念方向摘要",
      applicationMode: "create",
      parentDirectionIds: [],
      directions: [createDirectionDraft("方向 A"), createDirectionDraft("方向 B")],
      sourceObjectIds: [],
      citations: []
    });
    const conceptResult = applyArtifactProposalWorkflow(conceptProposal.workspace, conceptProposal.proposal.id);

    if (conceptResult.status !== "applied") {
      throw new Error(`Expected concept-direction apply, received ${conceptResult.status}.`);
    }
    expect(conceptResult.selectionObjectIds).toHaveLength(2);
    expect(conceptResult.focusObjectId).toBe(conceptResult.selectionObjectIds[0]);
    expect(conceptResult.selectionObjectIds.map((id) => conceptResult.workspace.objects[id]?.type)).toEqual([
      "conceptDirection",
      "conceptDirection"
    ]);
  });

  it("keeps sourceChanged blocked until the user explicitly allows it", () => {
    const workspace = createBlankWorkspace("project-source-review");
    workspace.objects["source-text"] = {
          id: "source-text",
          type: "text",
          title: "来源",
          summary: "原始摘要",
          body: "原始正文",
      createdBy: "user",
      visibility: "active"
    };
    const proposed = recordResearchAnalysisProposal(workspace, {
      proposalId: "proposal-source-review",
      operationId: "operation-source-review",
      title: "带来源的研究草案",
      summary: "摘要",
      findings: ["发现"],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      sourceObjectIds: ["source-text"],
      citations: []
    });
    const source = proposed.workspace.objects["source-text"];
    if (source?.type !== "text") {
      throw new Error("Expected the source text object.");
    }
    const changedWorkspace: MorphoWorkspace = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        "source-text": {
          ...source,
          body: "修改后的正文"
        }
      }
    };

    const blocked = applyArtifactProposalWorkflow(changedWorkspace, proposed.proposal.id);
    expect(blocked.status).toBe("blocked");
    expect(blocked.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
      status: "pending",
      reviewState: "sourceChanged"
    });
    expect(blocked.workspace.ai.messages.at(-1)).toMatchObject({ status: "failed" });

    const allowed = applyArtifactProposalWorkflow(blocked.workspace, proposed.proposal.id, {
      allowSourceChanged: true
    });
    expect(allowed.status).toBe("applied");
  });

  it("keeps superseded and unavailable bases blocked", () => {
    const base = createInitialWorkspace();
    const definition = base.objects["definition-current"];
    if (definition?.type !== "designDefinition") {
      throw new Error("Expected the initial test definition.");
    }

    const proposed = recordDesignDefinitionProposal(base, {
      proposalId: "proposal-definition-review",
      operationId: "operation-definition-review",
      workIntent: "reviseDesignDefinition",
      title: "设计定义修订",
      summary: "修订摘要",
      projectGoal: "目标",
      targetUsers: [],
      primaryScenarios: [],
      coreProblem: "问题",
      designPrinciples: [],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      basedOnDesignDefinitionId: definition.id,
      basedOnRevisionId: definition.currentRevisionId,
      sourceObjectIds: [],
      citations: []
    });
    const supersededWorkspace: MorphoWorkspace = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        [definition.id]: { ...definition, currentRevisionId: "definition-revision-new" }
      }
    };
    const superseded = applyArtifactProposalWorkflow(supersededWorkspace, proposed.proposal.id);
    expect(superseded.status).toBe("blocked");
    expect(superseded.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
      reviewState: "baseSuperseded"
    });

    const unavailableWorkspace: MorphoWorkspace = {
      ...proposed.workspace,
      objects: Object.fromEntries(Object.entries(proposed.workspace.objects).filter(([id]) => id !== definition.id))
    };
    const unavailable = applyArtifactProposalWorkflow(unavailableWorkspace, proposed.proposal.id);
    expect(unavailable.status).toBe("blocked");
    expect(unavailable.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
      reviewState: "targetUnavailable"
    });
  });

  it("keeps deliveryPlan unsupported instead of inventing an apply path", () => {
    const workspace = createBlankWorkspace("project-delivery-proposal");
    const proposal: DeliveryPlanProposal = {
      id: "proposal-delivery-plan",
      type: "deliveryPlan",
      status: "pending",
      reviewState: "ready",
      sourceSnapshots: [],
      sourceObjectIds: [],
      citationIds: [],
      createdAt: "2026-08-07T00:00:00.000Z",
      title: "交付草案",
      summary: "交付摘要",
      items: []
    };
    workspace.artifactProposals[proposal.id] = proposal;

    const result = applyArtifactProposalWorkflow(workspace, proposal.id);
    expect(result).toEqual({
      status: "unsupported",
      workspace,
      proposalId: proposal.id,
      reason: "交付草案暂不支持直接应用。"
    });
  });

  it("centralizes reject and draft update dispatch without applying a proposal", () => {
    const proposed = recordResearchAnalysisProposal(createBlankWorkspace("project-draft"), {
      proposalId: "proposal-draft-workflow",
      operationId: "operation-draft-workflow",
      title: "原标题",
      summary: "原摘要",
      findings: ["原发现"],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: []
    });
    const updated = updateArtifactProposalDraft(proposed.workspace, {
      type: "researchAnalysis",
      proposalId: proposed.proposal.id,
      input: {
        title: "新标题",
        summary: "新摘要",
        findings: ["新发现"],
        opportunities: [],
        constraints: [],
        openQuestions: [],
        evidence: []
      }
    });
    expect(updated.artifactProposals[proposed.proposal.id]).toMatchObject({
      status: "pending",
      title: "新标题",
      summary: "新摘要"
    });
    expect(Object.values(updated.objects).some((object) => object.type === "research")).toBe(false);

    const rejected = rejectArtifactProposalWorkflow(updated, proposed.proposal.id, "用户明确放弃当前草案。");
    expect(rejected.status).toBe("rejected");
    expect(rejected.workspace.artifactProposals[proposed.proposal.id]?.status).toBe("rejected");
    expect(rejected.workspace.objects[proposed.proposal.id]).toBeUndefined();
  });
});

function createDirectionDraft(title: string) {
  return {
    title,
    summary: `${title} 摘要`,
    conceptStatement: `${title} 说明`,
    keywords: [title],
    strategy: `${title} 策略`,
    differentiators: [`${title} 差异`],
    visualSignals: [`${title} 视觉信号`],
    risks: [],
    openQuestions: []
  };
}
