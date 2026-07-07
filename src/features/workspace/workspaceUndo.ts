import type { MorphoWorkspace } from "@/domain/morpho/types";

export function shouldBlockSnapshotUndo(snapshot: MorphoWorkspace, current: MorphoWorkspace): boolean {
  return (
    hasNewRecord(Object.keys(snapshot.objects), Object.keys(current.objects)) ||
    hasNewRecord(snapshot.canvas.instances.map((instance) => instance.id), current.canvas.instances.map((instance) => instance.id)) ||
    hasNewRecord(Object.keys(snapshot.assets), Object.keys(current.assets)) ||
    hasNewRecord(Object.keys(snapshot.operations), Object.keys(current.operations)) ||
    hasNewRecord(Object.keys(snapshot.artifactProposals), Object.keys(current.artifactProposals)) ||
    hasNewRecord(Object.keys(snapshot.citationSnapshots), Object.keys(current.citationSnapshots)) ||
    hasNewRecord(snapshot.ai.messages.map((message) => message.id), current.ai.messages.map((message) => message.id))
  );
}

function hasNewRecord(snapshotIds: string[], currentIds: string[]): boolean {
  const snapshotIdSet = new Set(snapshotIds);
  return currentIds.some((id) => !snapshotIdSet.has(id));
}
