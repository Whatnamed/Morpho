import type { DecisionRecord, MorphoObjectId, MorphoRelation, MorphoWorkspace, VisualBranchId } from "./types";

export type DesignTraceEdgeKind =
  | MorphoRelation["kind"]
  | "generationReference"
  | "directionOwnership"
  | "visualBranchRoot"
  | "directionRevisionSource"
  | "definitionRevisionSource"
  | "definitionBase"
  | "keyConclusionSource"
  | "researchSource"
  | "directionLineage";

export type DesignTraceEdge = {
  fromObjectId: MorphoObjectId;
  toObjectId: MorphoObjectId;
  kind: DesignTraceEdgeKind;
  note: string;
};

export type DesignTraceResult = {
  startObjectId: MorphoObjectId;
  objectIds: MorphoObjectId[];
  edges: DesignTraceEdge[];
  decisions: DecisionRecord[];
  visualBranchIds: VisualBranchId[];
  orderedSummary: string[];
  truncated: boolean;
};

export type TraceDesignChainOptions = {
  maxDepth?: number;
  maxNodes?: number;
};

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 48;

export function traceDesignChain(
  workspace: MorphoWorkspace,
  startObjectId: MorphoObjectId,
  options: TraceDesignChainOptions = {}
): DesignTraceResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const visited = new Set<MorphoObjectId>();
  const objectIds: MorphoObjectId[] = [];
  const edges: DesignTraceEdge[] = [];
  const decisions = new Map<string, DecisionRecord>();
  const visualBranchIds = new Set<VisualBranchId>();
  const queue: Array<{ objectId: MorphoObjectId; depth: number }> = [{ objectId: startObjectId, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (visited.has(current.objectId)) {
      continue;
    }

    if (objectIds.length >= maxNodes || current.depth > maxDepth) {
      truncated = true;
      continue;
    }

    const object = workspace.objects[current.objectId];
    if (!object) {
      continue;
    }

    visited.add(current.objectId);
    objectIds.push(current.objectId);
    collectDecisions(workspace, current.objectId, decisions);

    const upstream = collectUpstreamEdges(workspace, current.objectId, visualBranchIds);
    for (const edge of upstream) {
      addEdge(edges, edge);
      if (!visited.has(edge.fromObjectId)) {
        queue.push({ objectId: edge.fromObjectId, depth: current.depth + 1 });
      }
    }
  }

  return {
    startObjectId,
    objectIds,
    edges,
    decisions: [...decisions.values()],
    visualBranchIds: [...visualBranchIds],
    orderedSummary: buildOrderedSummary(workspace, objectIds, edges, [...decisions.values()], [...visualBranchIds]),
    truncated
  };
}

function collectUpstreamEdges(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  visualBranchIds: Set<VisualBranchId>
): DesignTraceEdge[] {
  const object = workspace.objects[objectId];
  if (!object) {
    return [];
  }

  const edges: DesignTraceEdge[] = workspace.relations
    .filter((relation) => relation.toObjectId === objectId)
    .map((relation) => ({
      fromObjectId: relation.fromObjectId,
      toObjectId: relation.toObjectId,
      kind: relation.kind,
      note: relation.note
    }));

  if (object.type === "image") {
    for (const referenceObjectId of object.generation?.referenceObjectIds ?? []) {
      if (workspace.objects[referenceObjectId]) {
        edges.push({
          fromObjectId: referenceObjectId,
          toObjectId: object.id,
          kind: "generationReference",
          note: "图像生成计划明确引用了该对象。"
        });
      }
    }

    if (object.directionId && workspace.objects[object.directionId]) {
      edges.push({
        fromObjectId: object.directionId,
        toObjectId: object.id,
        kind: "directionOwnership",
        note: "图像属于该概念方向。"
      });
    }

    if (object.visualBranchId) {
      const branch = workspace.visualBranches[object.visualBranchId];
      if (branch) {
        visualBranchIds.add(branch.id);
        if (branch.rootObjectId && workspace.objects[branch.rootObjectId]) {
          edges.push({
            fromObjectId: branch.rootObjectId,
            toObjectId: object.id,
            kind: "visualBranchRoot",
            note: `图像沿用视觉分支「${branch.label}」。`
          });
        }
      }
    }
  }

  if (object.type === "conceptDirection") {
    const currentRevision = workspace.directionRevisions[object.currentRevisionId];
    if (currentRevision) {
      for (const sourceObjectId of currentRevision.sourceObjectIds) {
        if (workspace.objects[sourceObjectId]) {
          edges.push({
            fromObjectId: sourceObjectId,
            toObjectId: object.id,
            kind: "directionRevisionSource",
            note: "当前方向修订引用了该来源对象。"
          });
        }
      }

      if (currentRevision.basedOnDefinitionRevisionId) {
        const definitionRevision = workspace.designDefinitionRevisions[currentRevision.basedOnDefinitionRevisionId];
        if (definitionRevision && workspace.objects[definitionRevision.designDefinitionId]) {
          edges.push({
            fromObjectId: definitionRevision.designDefinitionId,
            toObjectId: object.id,
            kind: "definitionBase",
            note: "当前方向基于该设计定义修订。"
          });
        }
      }
    }

    for (const lineage of workspace.directionLineage.filter((record) => record.toDirectionId === object.id)) {
      if (workspace.objects[lineage.fromDirectionId]) {
        edges.push({
          fromObjectId: lineage.fromDirectionId,
          toObjectId: object.id,
          kind: "directionLineage",
          note: lineage.note
        });
      }
    }
  }

  if (object.type === "designDefinition") {
    const currentRevision = workspace.designDefinitionRevisions[object.currentRevisionId];
    for (const sourceObjectId of currentRevision?.sourceObjectIds ?? []) {
      if (workspace.objects[sourceObjectId]) {
        edges.push({
          fromObjectId: sourceObjectId,
          toObjectId: object.id,
          kind: "definitionRevisionSource",
          note: "当前设计定义修订引用了该来源对象。"
        });
      }
    }
  }

  if (object.type === "keyConclusion") {
    for (const sourceObjectId of object.sourceObjectIds) {
      if (workspace.objects[sourceObjectId]) {
        edges.push({
          fromObjectId: sourceObjectId,
          toObjectId: object.id,
          kind: "keyConclusionSource",
          note: "关键结论由该来源保留。"
        });
      }
    }
  }

  if (object.type === "research") {
    for (const sourceObjectId of object.provenance?.sourceObjectIds ?? []) {
      if (workspace.objects[sourceObjectId]) {
        edges.push({
          fromObjectId: sourceObjectId,
          toObjectId: object.id,
          kind: "researchSource",
          note: "研究卡由该原始资料或对象形成。"
        });
      }
    }
  }

  return edges;
}

function collectDecisions(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  target: Map<string, DecisionRecord>
): void {
  for (const decision of workspace.decisionRecords) {
    if (decision.objectSnapshot?.id === objectId || decision.relatedObjectIds.includes(objectId)) {
      target.set(decision.id, decision);
    }
  }
}

function addEdge(edges: DesignTraceEdge[], edge: DesignTraceEdge): void {
  if (
    edges.some(
      (existing) =>
        existing.fromObjectId === edge.fromObjectId &&
        existing.toObjectId === edge.toObjectId &&
        existing.kind === edge.kind
    )
  ) {
    return;
  }

  edges.push(edge);
}

function buildOrderedSummary(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  edges: DesignTraceEdge[],
  decisions: DecisionRecord[],
  visualBranchIds: VisualBranchId[]
): string[] {
  const lines = objectIds.map((objectId) => {
    const object = workspace.objects[objectId];
    return object ? `${object.title}（${object.type}${object.visibility === "hidden" ? "，已隐藏" : ""}）` : objectId;
  });

  if (visualBranchIds.length > 0) {
    lines.push(
      `视觉分支：${visualBranchIds
        .map((branchId) => workspace.visualBranches[branchId]?.label ?? branchId)
        .join("、")}`
    );
  }

  if (edges.length > 0) {
    lines.push(`直接/间接关系：${edges.length} 条。`);
  }

  if (decisions.length > 0) {
    lines.push(`相关决策：${decisions.map((decision) => decision.summary).join("；")}`);
  }

  return lines;
}
