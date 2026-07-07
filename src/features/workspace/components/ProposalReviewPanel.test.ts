import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "@/domain/operations/operations";

import { ProposalReviewPanel } from "./ProposalReviewPanel";

describe("ProposalReviewPanel", () => {
  it("renders the full editor in a fixed workspace review layer", () => {
    const workspace = createInitialWorkspace();
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-review-panel-definition",
      title: "Canvas reviewed definition",
      summary: "The proposal body should be edited outside the chat stream.",
      projectGoal: "Keep chat readable while editing proposal content.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Review"],
      coreProblem: "Chat should not become a long form.",
      designPrinciples: ["Review from canvas"],
      constraints: ["Keep one proposal id"],
      avoidDirections: ["Duplicate drafts"],
      opportunities: ["Edit the same draft"],
      openQuestions: ["Apply or keep discussing?"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 320, y: 240 }
    });

    const html = renderToStaticMarkup(
      createElement(ProposalReviewPanel, {
        workspace: proposed.workspace,
        proposal: proposed.proposal,
        onApply: () => undefined,
        onReject: () => undefined,
        onContinueDiscussion: () => undefined,
        onRegenerate: () => undefined,
        onSaveResearchDraft: () => undefined,
        onSaveDesignDefinitionDraft: () => undefined,
        onSaveConceptDirectionDraft: () => undefined
      })
    );

    expect(html).toContain("proposal-review-panel");
    expect(html).toContain("proposal-card");
    expect(html).toContain("Canvas reviewed definition");
    expect(html).toContain("Chat should not become a long form.");
  });
});
