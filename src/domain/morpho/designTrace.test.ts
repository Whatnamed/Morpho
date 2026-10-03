import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "./workspace";
import { traceDesignChain } from "./designTrace";

describe("design chain trace", () => {
  it("keeps recorded legacy versions without treating current ownership as a historical cause", () => {
    const workspace = createInitialWorkspace();
    const trace = traceDesignChain(workspace, "image-night-scenario");

    expect(trace.objectIds).toEqual(
      expect.arrayContaining([
        "image-night-scenario",
        "image-soft-rail-v2",
        "image-soft-rail-preview"
      ])
    );
    expect(trace.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromObjectId: "image-soft-rail-v2",
          toObjectId: "image-night-scenario",
          kind: "version"
        }),
        expect.objectContaining({
          fromObjectId: "direction-soft-rail",
          toObjectId: "image-night-scenario",
          kind: "directionOwnership"
        })
      ])
    );
    expect(trace.objectIds).not.toContain("direction-soft-rail");
    expect(trace.edges.some((edge) => edge.kind === "definitionBase")).toBe(false);
    expect(trace.decisions.map((decision) => decision.kind)).toContain("setDefaultReference");
    expect(trace.orderedSummary.join("\n")).toContain("柔光轨道");
  });

  it("is pure and bounded against cycles", () => {
    const workspace = createInitialWorkspace();
    const cyclicWorkspace = {
      ...workspace,
      relations: [
        ...workspace.relations,
        {
          id: "rel-cycle-a",
          kind: "source" as const,
          fromObjectId: "definition-current",
          toObjectId: "image-night-scenario",
          note: "测试循环边。"
        },
        {
          id: "rel-cycle-b",
          kind: "source" as const,
          fromObjectId: "image-night-scenario",
          toObjectId: "definition-current",
          note: "测试循环边。"
        }
      ]
    };
    const before = structuredClone(cyclicWorkspace);

    const trace = traceDesignChain(cyclicWorkspace, "image-night-scenario", { maxDepth: 4, maxNodes: 8 });

    expect(cyclicWorkspace).toEqual(before);
    expect(trace.objectIds.length).toBeLessThanOrEqual(8);
    expect(new Set(trace.objectIds).size).toBe(trace.objectIds.length);
  });
});
