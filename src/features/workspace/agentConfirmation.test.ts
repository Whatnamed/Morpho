import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { MorphoAgentToolArguments, RequestConfirmationArgs } from "./morphoAgent";
import { buildPendingAgentActionConfirmation, buildRequestedAgentActionConfirmation } from "./agentConfirmation";

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

  it("binds Agent confirmations to the current default reference and direction status", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-support-island"];
    const defaultReference = Object.values(workspace.objects).find(
      (object) => object.type === "image" && object.isDefaultReference
    );
    if (!direction || direction.type !== "conceptDirection" || !defaultReference || defaultReference.type !== "image") {
      throw new Error("Expected direction and default reference fixtures.");
    }

    const directionConfirmation = buildRequestedAgentActionConfirmation({
      args: {
        action: "setDirectionPrimary",
        targetObjectId: direction.id,
        reason: "设为主方向",
        impact: "更新方向状态"
      } satisfies RequestConfirmationArgs,
      workspace,
      draft: "设为主方向",
      contextObjectIds: [],
      selectedObjects: [direction]
    });
    const referenceConfirmation = buildRequestedAgentActionConfirmation({
      args: {
        action: "setDefaultReference",
        targetObjectId: defaultReference.id,
        reason: "设为默认参考",
        impact: "更新后续默认参考"
      } satisfies RequestConfirmationArgs,
      workspace,
      draft: "设为默认参考",
      contextObjectIds: [],
      selectedObjects: [defaultReference]
    });

    expect(directionConfirmation).toMatchObject({
      boundTargetStatus: direction.status,
      previousReferenceObjectId: defaultReference.id
    });
    expect(referenceConfirmation).toMatchObject({
      previousReferenceObjectId: defaultReference.id
    });
  });
});
