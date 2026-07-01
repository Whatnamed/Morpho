import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../../domain/morpho/workspace";

import { getObjectTypeLabel, getSuggestionsForSelection } from "./workspaceUi";

describe("workspace suggestions", () => {
  it("labels document fragments distinctly from generic objects", () => {
    const workspace = createInitialWorkspace();

    expect(
      getObjectTypeLabel({
        id: "fragment-a",
        type: "documentFragment",
        title: "Fragment",
        summary: "Summary",
        body: "Body",
        createdBy: "user",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        visibility: "active",
        source: {
          fileObjectId: "file-course-brief",
          fileTitle: "Course brief",
          sourceExtractAssetId: "asset-document-extract-a",
          startOffset: 0,
          endOffset: 4,
          blockIds: ["block-1"]
        }
      })
    ).toBe("文档片段");
    expect(workspace.objects["file-course-brief"]).toBeDefined();
  });

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
