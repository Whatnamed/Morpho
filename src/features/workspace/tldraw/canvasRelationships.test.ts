import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { collectDirectCanvasEdges } from "./canvasRelationships";

describe("collectDirectCanvasEdges", () => {
  it("aggregates direct semantic relationships without recursively expanding a trace", () => {
    const workspace = createInitialWorkspace();

    const edges = collectDirectCanvasEdges(workspace);

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromObjectId: "definition-current",
          toObjectId: "direction-soft-rail",
          relationKind: "definitionBase",
          primary: true
        }),
        expect.objectContaining({
          fromObjectId: "direction-soft-rail",
          toObjectId: "image-soft-rail-preview",
          relationKind: "directionOwnership",
          primary: true
        }),
        expect.objectContaining({
          fromObjectId: "image-soft-rail-preview",
          toObjectId: "image-soft-rail-v2",
          relationKind: "version",
          primary: true
        }),
        expect.objectContaining({
          fromObjectId: "research-night-path",
          toObjectId: "definition-current",
          relationKind: "definitionRevisionSource",
          primary: true
        })
      ])
    );
  });

  it("keeps the first generation reference primary and marks other references secondary", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-night-scenario"];
    if (image?.type !== "image") {
      throw new Error("Expected seeded image object.");
    }

    const edges = collectDirectCanvasEdges({
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

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromObjectId: "image-rail-detail",
          toObjectId: "image-night-scenario",
          relationKind: "generationReference",
          primary: true
        }),
        expect.objectContaining({
          fromObjectId: "image-support-island-preview",
          toObjectId: "image-night-scenario",
          relationKind: "generationReference",
          primary: false
        })
      ])
    );
  });

  it("deduplicates the same direct relationship by object pair while retaining the strongest semantic kind", () => {
    const workspace = createInitialWorkspace();
    const edges = collectDirectCanvasEdges({
      ...workspace,
      relations: [
        ...workspace.relations,
        {
          id: "duplicate-generation-reference",
          kind: "usesReference",
          fromObjectId: "image-soft-rail-preview",
          toObjectId: "image-soft-rail-v2",
          note: "Duplicate direct semantic relationship."
        }
      ]
    });

    const pairEdges = edges.filter(
      (edge) => edge.fromObjectId === "image-soft-rail-preview" && edge.toObjectId === "image-soft-rail-v2"
    );
    expect(pairEdges).toHaveLength(1);
    expect(pairEdges[0]).toMatchObject({ relationKind: "version", primary: true });
  });
});
