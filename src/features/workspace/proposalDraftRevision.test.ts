import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  recordDesignDefinitionProposal,
  recordResearchAnalysisProposal,
  rejectArtifactProposal
} from "@/domain/operations/operations";

import { applySelectedProposalDraftRevision } from "./proposalDraftRevision";

describe("selected proposal draft revision", () => {
  it("updates the selected design-definition proposal in place without creating a new canvas object", () => {
    const proposed = recordDesignDefinitionProposal(createInitialWorkspace(), {
      proposalId: "proposal-definition-revise-in-place",
      operationId: "operation-definition-revise-in-place",
      workIntent: "createDesignDefinition",
      title: "Original definition",
      summary: "Original summary.",
      projectGoal: "Original goal.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Review"],
      coreProblem: "Original problem.",
      designPrinciples: ["Original principle"],
      constraints: ["Original constraint"],
      avoidDirections: ["Original avoid"],
      opportunities: ["Original opportunity"],
      openQuestions: ["Original question"],
      sourceObjectIds: ["research-night-path"],
      citations: [],
      position: { x: 120, y: 160 }
    });
    const originalInstances = proposed.workspace.canvas.instances;

    const result = applySelectedProposalDraftRevision(proposed.workspace, ["proposal-definition-revise-in-place"], {
      proposalId: "proposal-definition-revise-in-place",
      proposalType: "designDefinition",
      title: "Revised definition",
      summary: "Revised summary.",
      projectGoal: "Revised goal.",
      targetUsers: ["Designer", "Reviewer"],
      primaryScenarios: ["Review"],
      coreProblem: "Revised problem.",
      designPrinciples: ["Revised principle"],
      constraints: ["Revised constraint"],
      avoidDirections: ["Revised avoid"],
      opportunities: ["Revised opportunity"],
      openQuestions: ["Revised question"],
      changeNote: "Rewritten in place."
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      throw new Error(result.reason);
    }
    expect(Object.keys(result.workspace.artifactProposals)).toEqual(Object.keys(proposed.workspace.artifactProposals));
    expect(result.workspace.canvas.instances.map((instance) => instance.id)).toEqual(
      originalInstances.map((instance) => instance.id)
    );
    expect(result.workspace.artifactProposals["proposal-definition-revise-in-place"]).toMatchObject({
      title: "Revised definition",
      summary: "Revised summary.",
      projectGoal: "Revised goal."
    });
    expect(result.workspace.objects["proposal-definition-revise-in-place"]).toMatchObject({
      type: "proposalDraft",
      title: "Revised definition",
      summary: "Revised summary."
    });
  });

  it("preserves research evidence while revising selected research draft text", () => {
    const proposed = recordResearchAnalysisProposal(createInitialWorkspace(), {
      proposalId: "proposal-research-revise-in-place",
      operationId: "operation-research-revise-in-place",
      title: "Original research",
      summary: "Original summary.",
      findings: ["Original finding"],
      opportunities: ["Original opportunity"],
      constraints: ["Original constraint"],
      openQuestions: ["Original question"],
      evidence: [
        {
          claim: "Original evidence",
          confidence: "partial",
          citationUrls: [],
          sourceObjectIds: ["research-night-path"]
        }
      ],
      sourceObjectIds: ["research-night-path"],
      citations: [],
      position: { x: 120, y: 160 }
    });

    const result = applySelectedProposalDraftRevision(proposed.workspace, ["proposal-research-revise-in-place"], {
      proposalId: "proposal-research-revise-in-place",
      proposalType: "researchAnalysis",
      title: "Revised research",
      summary: "Revised summary.",
      findings: ["Revised finding"],
      opportunities: ["Revised opportunity"],
      constraints: ["Revised constraint"],
      openQuestions: ["Revised question"]
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      throw new Error(result.reason);
    }
    expect(result.workspace.artifactProposals["proposal-research-revise-in-place"]).toMatchObject({
      title: "Revised research",
      evidence: [
        {
          claim: "Original evidence",
          confidence: "partial",
          citationIds: [],
          sourceObjectIds: ["research-night-path"]
        }
      ]
    });
  });

  it("blocks revision unless exactly one pending proposal draft is selected and matched", () => {
    const first = recordDesignDefinitionProposal(createInitialWorkspace(), {
      proposalId: "proposal-definition-first",
      operationId: "operation-definition-first",
      workIntent: "createDesignDefinition",
      title: "First",
      summary: "First summary.",
      projectGoal: "Goal.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Review"],
      coreProblem: "Problem.",
      designPrinciples: ["Principle"],
      constraints: ["Constraint"],
      avoidDirections: ["Avoid"],
      opportunities: ["Opportunity"],
      openQuestions: ["Question"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 120, y: 160 }
    });
    const second = recordDesignDefinitionProposal(first.workspace, {
      proposalId: "proposal-definition-second",
      operationId: "operation-definition-second",
      workIntent: "createDesignDefinition",
      title: "Second",
      summary: "Second summary.",
      projectGoal: "Goal.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Review"],
      coreProblem: "Problem.",
      designPrinciples: ["Principle"],
      constraints: ["Constraint"],
      avoidDirections: ["Avoid"],
      opportunities: ["Opportunity"],
      openQuestions: ["Question"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 520, y: 160 }
    });
    const rejected = rejectArtifactProposal(second.workspace, "proposal-definition-first", "discarded");

    expect(
      applySelectedProposalDraftRevision(second.workspace, ["proposal-definition-first", "proposal-definition-second"], {
        proposalId: "proposal-definition-first",
        proposalType: "designDefinition",
        title: "Blocked",
        summary: "Blocked.",
        projectGoal: "Blocked.",
        targetUsers: ["Designer"],
        primaryScenarios: ["Review"],
        coreProblem: "Blocked.",
        designPrinciples: ["Blocked"],
        constraints: ["Blocked"],
        avoidDirections: ["Blocked"],
        opportunities: ["Blocked"],
        openQuestions: ["Blocked"]
      })
    ).toMatchObject({ status: "blocked" });
    expect(
      applySelectedProposalDraftRevision(rejected, ["proposal-definition-first"], {
        proposalId: "proposal-definition-first",
        proposalType: "designDefinition",
        title: "Blocked",
        summary: "Blocked.",
        projectGoal: "Blocked.",
        targetUsers: ["Designer"],
        primaryScenarios: ["Review"],
        coreProblem: "Blocked.",
        designPrinciples: ["Blocked"],
        constraints: ["Blocked"],
        avoidDirections: ["Blocked"],
        opportunities: ["Blocked"],
        openQuestions: ["Blocked"]
      })
    ).toMatchObject({ status: "blocked" });
  });
});
