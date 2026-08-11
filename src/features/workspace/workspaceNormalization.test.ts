import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "@/domain/morpho/workspace";
import { ensureWorkspaceStageRegionsIfWritable } from "./workspaceNormalization";

describe("workspace normalization capability", () => {
  it("does not materialize stage regions in a read-only session", () => {
    const workspace = {
      ...createBlankWorkspace("project-a"),
      canvas: {
        ...createBlankWorkspace("project-a").canvas,
        stageRegions: []
      }
    };

    expect(ensureWorkspaceStageRegionsIfWritable(workspace, false)).toBe(workspace);
  });

  it("materializes legacy stage regions once mutation capability is available", () => {
    const base = createBlankWorkspace("project-a");
    const workspace = {
      ...base,
      canvas: {
        ...base.canvas,
        stageRegions: []
      }
    };

    const normalized = ensureWorkspaceStageRegionsIfWritable(workspace, true);
    expect(normalized).not.toBe(workspace);
    expect(normalized.canvas.stageRegions).toHaveLength(4);
  });
});
