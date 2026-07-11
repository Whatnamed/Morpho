import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { canvasEdgeKey } from "./primaryCanvasEdges";
import { collectPrimaryCanvasTrace } from "./primaryCanvasTrace";

describe("primary canvas trace", () => {
  it("direct mode highlights only the current object and its immediate primary neighbors", () => {
    const workspace = createInitialWorkspace();
    const trace = collectPrimaryCanvasTrace(workspace, "direction-soft-rail", "direct");
    expect(trace).not.toBeNull();
    expect(trace!.highlightedObjectIds).toEqual(
      expect.arrayContaining(["direction-soft-rail", "definition-current", "image-soft-rail-preview"])
    );
    expect(trace!.highlightedEdgeKeys).toEqual(
      expect.arrayContaining([
        canvasEdgeKey("definition-current", "direction-soft-rail"),
        canvasEdgeKey("direction-soft-rail", "image-soft-rail-preview")
      ])
    );
  });

  it("chain mode walks the full primary derivation path to the source", () => {
    const workspace = createInitialWorkspace();
    const trace = collectPrimaryCanvasTrace(workspace, "image-soft-rail-v2", "chain");
    expect(trace).not.toBeNull();
    expect(trace!.highlightedObjectIds).toEqual(
      expect.arrayContaining([
        "image-soft-rail-v2",
        "image-soft-rail-preview",
        "direction-soft-rail",
        "definition-current"
      ])
    );
    expect(trace!.highlightedEdgeKeys).toEqual(
      expect.arrayContaining([
        canvasEdgeKey("image-soft-rail-preview", "image-soft-rail-v2"),
        canvasEdgeKey("direction-soft-rail", "image-soft-rail-preview"),
        canvasEdgeKey("definition-current", "direction-soft-rail")
      ])
    );
    // Must not expand primary children of intermediate/start nodes as chain branches.
    expect(trace!.highlightedObjectIds).not.toContain("image-rail-detail");
  });

  it("marks multi-reference non-primary parents as secondary without expanding branches", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (image?.type !== "image") {
      throw new Error("Expected versioned image.");
    }

    const baseGeneration = image.generation ?? {
      modelId: "test",
      modelLabel: "test",
      aspectRatio: "1:1",
      prompt: "x",
      referenceObjectIds: [] as string[],
      createdAt: image.createdAt ?? new Date().toISOString()
    };
    const next = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [image.id]: {
          ...image,
          generation: {
            ...baseGeneration,
            referenceObjectIds: ["image-soft-rail-preview", "image-support-island-preview"]
          }
        }
      }
    };

    const trace = collectPrimaryCanvasTrace(next, image.id, "chain");
    expect(trace!.highlightedObjectIds).toContain("image-soft-rail-preview");
    expect(trace!.secondaryObjectIds).toContain("image-support-island-preview");
    expect(trace!.highlightedObjectIds).not.toContain("image-support-island-preview");
  });

  it("is cycle-safe when primary edges form a loop", () => {
    const workspace = createInitialWorkspace();
    const edgesPoisoned = {
      ...workspace,
      relations: [
        ...workspace.relations,
        {
          id: "loop-a",
          kind: "version" as const,
          fromObjectId: "image-soft-rail-v2",
          toObjectId: "image-soft-rail-preview",
          note: "loop"
        }
      ]
    };
    const trace = collectPrimaryCanvasTrace(edgesPoisoned, "image-soft-rail-v2", "chain");
    expect(trace).not.toBeNull();
    expect(trace!.highlightedObjectIds.length).toBeGreaterThan(0);
    expect(new Set(trace!.highlightedObjectIds).size).toBe(trace!.highlightedObjectIds.length);
  });
});
