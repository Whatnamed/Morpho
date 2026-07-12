export type CanvasSelectableKind = "morpho" | "stage" | "other";

export type CanvasSelectionRequest = {
  objectIds: string[];
  nonce: number;
};

export function shouldApplyCanvasSelectionRequest(
  request: CanvasSelectionRequest,
  lastAppliedNonce: number | null
): boolean {
  return request.nonce !== lastAppliedNonce;
}

/**
 * Keeps the presentation-only stage landmarks out of object selections before
 * tldraw commits page state. The final stage is intentionally the newest one:
 * that is the stage the person just asked to inspect.
 */
export function normalizeCanvasSelectionIds(
  previousIds: readonly string[],
  nextIds: readonly string[],
  getKind: (shapeId: string) => CanvasSelectableKind
): string[] {
  const ordinaryIds = nextIds.filter((id) => getKind(id) === "morpho");
  if (ordinaryIds.length > 0) {
    return ordinaryIds;
  }

  const stageIds = nextIds.filter((id) => getKind(id) === "stage");
  if (stageIds.length === 0) {
    return [...nextIds];
  }

  const previous = new Set(previousIds);
  const newlyAddedStageIds = stageIds.filter((id) => !previous.has(id));
  return [newlyAddedStageIds.at(-1) ?? stageIds.at(-1)!];
}

export function areSelectionIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
