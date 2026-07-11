import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { collectDirectCanvasEdges } from "./canvasRelationships";
import { canvasEdgeKey, collectPrimaryCanvasEdges, selectFirstBatchDirectionPreviewIds } from "./primaryCanvasEdges";

describe("primary canvas edges", () => {
  it("includes the five permanent primary families from the seed workspace", () => {
    const workspace = createInitialWorkspace();
    const edges = collectPrimaryCanvasEdges(workspace);
    const keys = edges.map((edge) => canvasEdgeKey(edge.fromObjectId, edge.toObjectId));

    expect(keys).toEqual(
      expect.arrayContaining([
        "research-night-path|definition-current",
        "definition-current|direction-soft-rail",
        "direction-soft-rail|image-soft-rail-preview",
        "image-soft-rail-preview|image-soft-rail-v2"
      ])
    );
  });

  it("excludes secondary multi-reference and non-primary generation refs", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-night-scenario"];
    if (image?.type !== "image") {
      throw new Error("Expected seeded image.");
    }

    const edges = collectPrimaryCanvasEdges({
      ...workspace,
      objects: {
        ...workspace.objects,
        [image.id]: {
          ...image,
          generation: {
            ...image.generation!,
            referenceObjectIds: ["image-rail-detail", "image-support-island-preview"]
          }
        }
      }
    });

    const keys = edges.map((edge) => canvasEdgeKey(edge.fromObjectId, edge.toObjectId));
    expect(keys).toContain("image-rail-detail|image-night-scenario");
    expect(keys).not.toContain("image-support-island-preview|image-night-scenario");
  });

  it("does not promote raw research source bags that are not definition inputs", () => {
    const workspace = createInitialWorkspace();
    const all = collectDirectCanvasEdges(workspace);
    const primary = collectPrimaryCanvasEdges(workspace);
    const researchSourceOnly = all.filter((edge) => edge.relationKind === "researchSource");
    for (const edge of researchSourceOnly) {
      expect(primary).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromObjectId: edge.fromObjectId,
            toObjectId: edge.toObjectId,
            relationKind: "researchSource"
          })
        ])
      );
    }
  });

  it("picks a stable first-batch direction preview independent of array order", () => {
    const workspace = createInitialWorkspace();
    const a = selectFirstBatchDirectionPreviewIds(workspace, "direction-soft-rail");
    const b = selectFirstBatchDirectionPreviewIds(workspace, "direction-soft-rail");
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(1);
  });
});
