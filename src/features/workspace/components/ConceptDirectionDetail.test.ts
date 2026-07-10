import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";

import { ConceptDirectionDetail } from "./ConceptDirectionDetail";

describe("ConceptDirectionDetail", () => {
  it("renders the complete current direction revision in a dedicated detail surface", () => {
    const workspace = createInitialWorkspace();
    const object = workspace.objects["direction-soft-rail"];
    if (!object || object.type !== "conceptDirection") {
      throw new Error("Expected concept direction.");
    }
    const revision = workspace.directionRevisions[object.currentRevisionId];
    if (!revision) {
      throw new Error("Expected current concept direction revision.");
    }

    const html = renderToStaticMarkup(createElement(ConceptDirectionDetail, { object, revision }));

    expect(html).toContain(revision.conceptStatement);
    expect(html).toContain(revision.strategy);
    expect(html).toContain(revision.differentiators[0]);
    expect(html).toContain(revision.openQuestions[0]);
  });
});
