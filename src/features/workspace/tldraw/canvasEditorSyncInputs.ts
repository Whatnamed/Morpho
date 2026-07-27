import type { MorphoWorkspace } from "@/domain/morpho/types";

export type CanvasEditorSyncInputs = {
  workspace: MorphoWorkspace;
  annotatedObjectId: string | null;
  highlightedObjectId: string | null;
  assetUrls: Record<string, string>;
  traceObjectIds: readonly string[];
};

export function hasCanvasEditorSyncInputChange(
  previous: CanvasEditorSyncInputs | null,
  next: CanvasEditorSyncInputs
): boolean {
  if (!previous) {
    return true;
  }

  const previousWorkspace = previous.workspace;
  const nextWorkspace = next.workspace;
  return (
    previousWorkspace.objects !== nextWorkspace.objects ||
    previousWorkspace.canvas.instances !== nextWorkspace.canvas.instances ||
    previousWorkspace.canvas.stageRegions !== nextWorkspace.canvas.stageRegions ||
    previousWorkspace.assets !== nextWorkspace.assets ||
    previousWorkspace.artifactProposals !== nextWorkspace.artifactProposals ||
    previousWorkspace.deliveryReferences !== nextWorkspace.deliveryReferences ||
    previous.annotatedObjectId !== next.annotatedObjectId ||
    previous.highlightedObjectId !== next.highlightedObjectId ||
    previous.assetUrls !== next.assetUrls ||
    !haveSameIds(previous.traceObjectIds, next.traceObjectIds)
  );
}

function haveSameIds(previous: readonly string[], next: readonly string[]): boolean {
  return previous === next ||
    (previous.length === next.length && previous.every((id, index) => id === next[index]));
}
