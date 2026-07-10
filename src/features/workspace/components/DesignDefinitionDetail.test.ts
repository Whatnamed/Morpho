import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";

import { DesignDefinitionDetail } from "./DesignDefinitionDetail";

describe("DesignDefinitionDetail", () => {
  it("renders the full current revision instead of only the canvas summary", () => {
    const workspace = createInitialWorkspace();
    const object = workspace.objects["definition-current"];
    if (!object || object.type !== "designDefinition") {
      throw new Error("Expected current design definition.");
    }
    const revision = workspace.designDefinitionRevisions[object.currentRevisionId];
    if (!revision) {
      throw new Error("Expected current design definition revision.");
    }

    const html = renderToStaticMarkup(createElement(DesignDefinitionDetail, { object, revision }));

    expect(html).toContain(revision.projectGoal);
    expect(html).toContain(revision.coreProblem);
    expect(html).toContain(revision.designPrinciples[0]);
    expect(html).toContain(revision.openQuestions[0]);
  });
});
