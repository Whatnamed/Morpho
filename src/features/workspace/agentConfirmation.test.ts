import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { MorphoAgentToolArguments } from "./morphoAgent";
import { buildPendingAgentActionConfirmation } from "./agentConfirmation";

describe("agent confirmation construction", () => {
  it("binds concept-direction proposals to the current design-definition revision", () => {
    const initial = createInitialWorkspace();
    const definition = Object.values(initial.objects).find((object) => object.type === "designDefinition");
    if (!definition || definition.type !== "designDefinition") {
      throw new Error("Expected a design definition in the test workspace.");
    }
    const workspace = {
      ...initial,
      workingState: {
        ...initial.workingState,
        currentDesignDefinitionId: definition.id
      }
    };
    const parsed: Extract<MorphoAgentToolArguments, { name: "create_concept_direction_proposal" }> = {
      name: "create_concept_direction_proposal",
      args: {
        title: "方向草案",
        summary: "基于当前设计定义提出方向草案。",
        directions: []
      }
    };

    const confirmation = buildPendingAgentActionConfirmation({
      parsed,
      workspace,
      draft: "提出一个新的概念方向",
      contextObjectIds: [],
      citations: [],
      selectedObjects: [],
      selectedObjectIds: [],
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      imageAttachmentObjectIds: [],
      documentExtractObjectIds: [],
      documentFragmentExtractObjectIds: []
    });

    expect(confirmation).toMatchObject({
      kind: "agentCreateConceptDirectionProposal",
      basedOnDesignDefinitionId: definition.id,
      basedOnRevisionId: definition.currentRevisionId
    });
  });

  it("does not attach design-definition base facts to research confirmations", () => {
    const workspace = createInitialWorkspace();
    const parsed: Extract<MorphoAgentToolArguments, { name: "create_research_analysis" }> = {
      name: "create_research_analysis",
      args: {
        title: "研究草案",
        summary: "研究摘要。",
        findings: [],
        opportunities: [],
        constraints: [],
        openQuestions: [],
        evidence: []
      }
    };

    const confirmation = buildPendingAgentActionConfirmation({
      parsed,
      workspace,
      draft: "整理研究",
      contextObjectIds: [],
      citations: [],
      selectedObjects: [],
      selectedObjectIds: [],
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      imageAttachmentObjectIds: [],
      documentExtractObjectIds: [],
      documentFragmentExtractObjectIds: []
    });

    expect(confirmation).not.toHaveProperty("basedOnDesignDefinitionId");
    expect(confirmation).not.toHaveProperty("basedOnRevisionId");
  });
});
