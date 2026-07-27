import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { buildReadSelectedContextResult } from "./agentReadContextResult";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

describe("read selected context result", () => {
  it("projects the bounded task context without sharing mutable arrays", () => {
    const workspace = createTestWorkspace();
    const selectedObjectId = Object.values(workspace.objects).find(
      (object) => object.visibility === "active"
    )?.id;
    expect(selectedObjectId).toBeDefined();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "Discuss the selection",
      selectedObjectIds: [selectedObjectId!]
    });

    const result = buildReadSelectedContextResult(context, buildProviderTaskContext(context));

    expect(result.objectIds).toEqual(context.objectIds);
    expect(result.objectIds).not.toBe(context.objectIds);
    expect(result.imageObjectIds).toEqual(context.imageObjectIds);
    expect(result.objectSummaries).toEqual(
      context.semanticSummaries.map(({ id, type, title, summary, detail }) => ({
        id,
        type,
        title,
        summary,
        detail
      }))
    );
  });
});
