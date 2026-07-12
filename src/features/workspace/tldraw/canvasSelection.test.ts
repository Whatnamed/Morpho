import { describe, expect, it } from "vitest";

import { normalizeCanvasSelectionIds, shouldApplyCanvasSelectionRequest } from "./canvasSelection";

const kinds: Record<string, "morpho" | "stage"> = {
  "shape:stage-a": "stage",
  "shape:stage-b": "stage",
  "shape:object-a": "morpho",
  "shape:object-b": "morpho"
};

describe("normalizeCanvasSelectionIds", () => {
  const getKind = (id: string) => kinds[id] ?? "other";

  it("keeps ordinary Morpho objects and removes every stage", () => {
    expect(normalizeCanvasSelectionIds(["shape:stage-a"], ["shape:stage-a", "shape:object-a", "shape:object-b"], getKind)).toEqual([
      "shape:object-a",
      "shape:object-b"
    ]);
  });

  it("keeps the last newly added stage, then falls back to the final selected stage", () => {
    expect(normalizeCanvasSelectionIds(["shape:stage-a"], ["shape:stage-a", "shape:stage-b"], getKind)).toEqual(["shape:stage-b"]);
    expect(normalizeCanvasSelectionIds([], ["shape:stage-b", "shape:stage-a"], getKind)).toEqual(["shape:stage-a"]);
  });

  it("drops pending-image and other ephemeral shapes from selection", () => {
    expect(normalizeCanvasSelectionIds([], ["shape:pending-op1:item-a"], getKind)).toEqual([]);
    expect(
      normalizeCanvasSelectionIds([], ["shape:pending-op1:item-a", "shape:object-a"], getKind)
    ).toEqual(["shape:object-a"]);
  });

  it("applies each programmatic selection request nonce only once, including empty selection", () => {
    expect(shouldApplyCanvasSelectionRequest({ objectIds: ["object-a"], nonce: 1 }, null)).toBe(true);
    expect(shouldApplyCanvasSelectionRequest({ objectIds: ["object-a"], nonce: 1 }, 1)).toBe(false);
    expect(shouldApplyCanvasSelectionRequest({ objectIds: [], nonce: 2 }, 1)).toBe(true);
  });
});
