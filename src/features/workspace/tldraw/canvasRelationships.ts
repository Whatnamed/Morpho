import type { MorphoObjectId, MorphoRelation, MorphoWorkspace } from "@/domain/morpho/types";

export type CanvasRelationshipKind =
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

export type DirectCanvasEdge = {
  fromObjectId: MorphoObjectId;
  toObjectId: MorphoObjectId;
  relationKind: CanvasRelationshipKind;
  primary: boolean;
};

const RELATION_PRIORITY: Record<CanvasRelationshipKind, number> = {
  version: 100,
  definitionBase: 96,
  directionOwnership: 92,
  visualBranchRoot: 88,
  generationReference: 84,
  directionRevisionSource: 80,
  definitionRevisionSource: 80,
  keyConclusionSource: 76,
  researchSource: 76,
  documentFragmentExtractedFromFile: 72,
  deliveryReference: 68,
  directionLineage: 64,
  belongsToDirection: 60,
  defaultReference: 56,
  usesReference: 52,
  supportsConclusion: 48,
  supports: 44,
  source: 40
};

export function collectDirectCanvasEdges(workspace: MorphoWorkspace): DirectCanvasEdge[] {
  const edgeByPair = new Map<string, DirectCanvasEdge>();
  const add = (
    fromObjectId: MorphoObjectId | undefined,
    toObjectId: MorphoObjectId | undefined,
    relationKind: CanvasRelationshipKind,
    primary = true
  ) => {
    if (!fromObjectId || !toObjectId || fromObjectId === toObjectId || !workspace.objects[fromObjectId] || !workspace.objects[toObjectId]) {
      return;
    }

    const key = `${fromObjectId}|${toObjectId}`;
    const current = edgeByPair.get(key);
    if (!current || RELATION_PRIORITY[relationKind] > RELATION_PRIORITY[current.relationKind]) {
      edgeByPair.set(key, { fromObjectId, toObjectId, relationKind, primary: primary || current?.primary === true });
      return;
    }

    if (primary && !current.primary) {
      edgeByPair.set(key, { ...current, primary: true });
    }
  };

  for (const relation of workspace.relations) {
    const target = workspace.objects[relation.toObjectId];
    if (target?.type === "image" && target.generation?.lineage && ["version", "source", "usesReference"].includes(relation.kind)) continue;
    if (target?.type === "image" && target.generation && ["source", "usesReference"].includes(relation.kind)) {
      add(relation.fromObjectId, relation.toObjectId, relation.kind, false);
      continue;
    }
    add(relation.fromObjectId, relation.toObjectId, relation.kind);
  }

  for (const object of Object.values(workspace.objects)) {
    if (object.type === "image") {
      const lineage = object.generation?.lineage;
      if (lineage) {
        const parent = lineage.identityParent;
        const currentParent = parent ? workspace.objects[parent.objectId] : undefined;
        if (parent && currentParent?.type === "image" && parent.assetId === currentParent.assetId &&
          (!parent.incarnationId || parent.incarnationId === currentParent.incarnationId)) add(parent.objectId, object.id, "version", true);
        for (const entry of object.generation?.providerInputs?.references ?? []) {
          const reference = workspace.objects[entry.source.objectId];
          if (entry.status === "sent" && reference?.type === "image" && reference.assetId === entry.source.assetId &&
            (!entry.source.incarnationId || reference.incarnationId === entry.source.incarnationId)) add(entry.source.objectId, object.id, "generationReference", false);
        }
      } else object.generation?.referenceObjectIds.forEach((referenceObjectId) => add(referenceObjectId, object.id, "generationReference", false));
      add(object.directionId, object.id, "directionOwnership");

      const branch = object.visualBranchId ? workspace.visualBranches[object.visualBranchId] : undefined;
      add(lineage ? lineage.branch?.rootObjectId : branch?.rootObjectId, object.id, "visualBranchRoot", false);
      continue;
    }

    if (object.type === "conceptDirection") {
      const revision = workspace.directionRevisions[object.currentRevisionId];
      revision?.sourceObjectIds.forEach((sourceObjectId) => add(sourceObjectId, object.id, "directionRevisionSource"));
      const definitionRevision = revision?.basedOnDefinitionRevisionId
        ? workspace.designDefinitionRevisions[revision.basedOnDefinitionRevisionId]
        : undefined;
      add(definitionRevision?.designDefinitionId, object.id, "definitionBase");
      continue;
    }

    if (object.type === "designDefinition") {
      const revision = workspace.designDefinitionRevisions[object.currentRevisionId];
      revision?.sourceObjectIds.forEach((sourceObjectId) => add(sourceObjectId, object.id, "definitionRevisionSource"));
      continue;
    }

    if (object.type === "keyConclusion") {
      object.sourceObjectIds.forEach((sourceObjectId) => add(sourceObjectId, object.id, "keyConclusionSource"));
      continue;
    }

    if (object.type === "research") {
      object.provenance?.sourceObjectIds.forEach((sourceObjectId) => add(sourceObjectId, object.id, "researchSource"));
    }
  }

  for (const lineage of workspace.directionLineage) {
    add(lineage.fromDirectionId, lineage.toDirectionId, "directionLineage");
  }

  return [...edgeByPair.values()];
}
