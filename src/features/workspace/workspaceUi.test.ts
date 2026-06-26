import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";

import { getSuggestionsForSelection } from "./workspaceUi";

describe("workspace suggestions", () => {
  it("keeps research-driven design-definition suggestions on revise intent when a current definition exists", () => {
    const workspace = createInitialWorkspace();
    const research = workspace.objects["research-night-path"];

    if (!research || research.type !== "research") {
      throw new Error("Expected seed workspace to include the research-night-path object.");
    }

    const suggestion = getSuggestionsForSelection([research], {
      hasCurrentDesignDefinition: Boolean(workspace.workingState.currentDesignDefinitionId)
    }).find((item) => item.label === "继续修改定义");

    expect(suggestion).toMatchObject({
      workIntent: "reviseDesignDefinition"
    });
  });

  it("keeps key-conclusion design-definition suggestions on revise intent when a current definition exists", () => {
    const workspace = createInitialWorkspace();
    const keyConclusion = workspace.objects["insight-continuous-support"];

    if (!keyConclusion || keyConclusion.type !== "keyConclusion") {
      throw new Error("Expected seed workspace to include the insight-continuous-support object.");
    }

    const suggestion = getSuggestionsForSelection([keyConclusion], {
      hasCurrentDesignDefinition: Boolean(workspace.workingState.currentDesignDefinitionId)
    }).find((item) => item.label === "继续修改定义");

    expect(suggestion).toMatchObject({
      workIntent: "reviseDesignDefinition"
    });
  });
});
