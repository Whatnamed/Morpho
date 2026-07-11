import type { MorphoObjectId, MorphoWorkspace } from "@/domain/morpho/types";
import { canvasEdgeKey, collectPrimaryCanvasEdges, type PrimaryCanvasEdge } from "./primaryCanvasEdges";

export type PrimaryCanvasTraceMode = "direct" | "chain";

export type PrimaryCanvasTrace = {
  mode: PrimaryCanvasTraceMode;
  startObjectId: MorphoObjectId;
  highlightedObjectIds: MorphoObjectId[];
  highlightedEdgeKeys: string[];
  secondaryObjectIds: MorphoObjectId[];
  secondaryEdgeKeys: string[];
};

/**
 * Canvas-only primary trace. Unlike traceDesignChain, does not expand side branches
 * of supports/source/revision bags — only permanent primary edges.
 */
export function collectPrimaryCanvasTrace(
  workspace: MorphoWorkspace,
  startObjectId: MorphoObjectId,
  mode: PrimaryCanvasTraceMode = "direct"
): PrimaryCanvasTrace | null {
  if (!workspace.objects[startObjectId]) {
    return null;
  }

  const primaryEdges = collectPrimaryCanvasEdges(workspace);
  if (mode === "direct") {
    return buildDirectTrace(workspace, startObjectId, primaryEdges);
  }
  return buildChainTrace(workspace, startObjectId, primaryEdges);
}

function buildDirectTrace(
  workspace: MorphoWorkspace,
  startObjectId: MorphoObjectId,
  primaryEdges: PrimaryCanvasEdge[]
): PrimaryCanvasTrace {
  const highlightedObjectIds = new Set<MorphoObjectId>([startObjectId]);
  const highlightedEdgeKeys: string[] = [];
  const secondaryObjectIds = new Set<MorphoObjectId>();
  const secondaryEdgeKeys: string[] = [];

  for (const edge of primaryEdges) {
    if (edge.fromObjectId === startObjectId || edge.toObjectId === startObjectId) {
      highlightedObjectIds.add(edge.fromObjectId);
      highlightedObjectIds.add(edge.toObjectId);
      highlightedEdgeKeys.push(canvasEdgeKey(edge.fromObjectId, edge.toObjectId));
    }
  }

  // Non-primary generation references stay secondary only.
  const start = workspace.objects[startObjectId];
  if (start?.type === "image") {
    const refs = start.generation?.referenceObjectIds ?? [];
    refs.forEach((refId, index) => {
      if (!workspace.objects[refId]) {
        return;
      }
      if (index === 0) {
        return;
      }
      secondaryObjectIds.add(refId);
      secondaryEdgeKeys.push(canvasEdgeKey(refId, startObjectId));
    });
  }

  return {
    mode: "direct",
    startObjectId,
    highlightedObjectIds: [...highlightedObjectIds],
    highlightedEdgeKeys,
    secondaryObjectIds: [...secondaryObjectIds],
    secondaryEdgeKeys
  };
}

function buildChainTrace(
  workspace: MorphoWorkspace,
  startObjectId: MorphoObjectId,
  primaryEdges: PrimaryCanvasEdge[]
): PrimaryCanvasTrace {
  const inbound = new Map<MorphoObjectId, PrimaryCanvasEdge[]>();
  for (const edge of primaryEdges) {
    const list = inbound.get(edge.toObjectId) ?? [];
    list.push(edge);
    inbound.set(edge.toObjectId, list);
  }

  const pathNodes: MorphoObjectId[] = [startObjectId];
  const pathEdges: string[] = [];
  const secondaryObjectIds = new Set<MorphoObjectId>();
  const secondaryEdgeKeys: string[] = [];
  const visited = new Set<MorphoObjectId>([startObjectId]);
  let cursor = startObjectId;

  // Walk upstream along one primary path to a source root.
  for (let guard = 0; guard < 64; guard += 1) {
    const parents = inbound.get(cursor) ?? [];
    if (parents.length === 0) {
      break;
    }

    const chosen = pickPrimaryParentEdge(workspace, cursor, parents);
    for (const edge of parents) {
      if (edge === chosen) {
        continue;
      }
      // Other parents are secondary weak highlights only — do not expand.
      secondaryObjectIds.add(edge.fromObjectId);
      secondaryEdgeKeys.push(canvasEdgeKey(edge.fromObjectId, edge.toObjectId));
    }

    if (visited.has(chosen.fromObjectId)) {
      break;
    }

    pathEdges.push(canvasEdgeKey(chosen.fromObjectId, chosen.toObjectId));
    pathNodes.push(chosen.fromObjectId);
    visited.add(chosen.fromObjectId);
    cursor = chosen.fromObjectId;
  }

  // Chain mode is source → current only. Do not attach primary children of the
  // start node (that would highlight intermediate side branches). Direct mode
  // still strengthens immediate parents/children separately.

  // Multi-reference secondary: non-first generation refs on chain images.
  for (const objectId of pathNodes) {
    const object = workspace.objects[objectId];
    if (object?.type !== "image") {
      continue;
    }
    const refs = object.generation?.referenceObjectIds ?? [];
    refs.forEach((refId, index) => {
      if (index === 0 || !workspace.objects[refId] || visited.has(refId)) {
        return;
      }
      secondaryObjectIds.add(refId);
      secondaryEdgeKeys.push(canvasEdgeKey(refId, objectId));
    });
  }

  return {
    mode: "chain",
    startObjectId,
    highlightedObjectIds: pathNodes,
    highlightedEdgeKeys: pathEdges,
    secondaryObjectIds: [...secondaryObjectIds],
    secondaryEdgeKeys
  };
}

function pickPrimaryParentEdge(
  workspace: MorphoWorkspace,
  _childId: MorphoObjectId,
  parents: PrimaryCanvasEdge[]
): PrimaryCanvasEdge {
  const rank = (edge: PrimaryCanvasEdge): number => {
    switch (edge.relationKind) {
      case "version":
        return 100;
      case "generationReference":
        return 90;
      case "directionOwnership":
        return 80;
      case "definitionBase":
        return 70;
      case "definitionRevisionSource":
        return 60;
      default:
        return 10;
    }
  };

  return [...parents].sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) {
      return diff;
    }
    return a.fromObjectId.localeCompare(b.fromObjectId);
  })[0];
}
