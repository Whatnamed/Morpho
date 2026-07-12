import { describe, expect, it } from "vitest";

import { normalizeCanvasSelectionIds } from "./canvasSelection";

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
});
