import type { MorphoWorkspace, DesignDefinitionObject, DesignDefinitionRevision } from "./types";

/** Project-current object authority is distinct from each object's revision.isCurrent. */
export function resolveCurrentDesignDefinition(workspace: MorphoWorkspace):
  | { object: DesignDefinitionObject; revision: DesignDefinitionRevision; availability: "available" | "hidden" }
  | undefined {
  const object = projectCurrentDesignDefinitionObject(workspace);
  if (!object) return undefined;
  const revision = workspace.designDefinitionRevisions[object.currentRevisionId];
  if (!revision || revision.designDefinitionId !== object.id) return undefined;
  return { object, revision, availability: object.visibility === "hidden" ? "hidden" : "available" };
}

export function projectCurrentDesignDefinitionObject(workspace: MorphoWorkspace): DesignDefinitionObject | undefined {
  return Object.values(workspace.objects).find(
    (candidate): candidate is DesignDefinitionObject => candidate.type === "designDefinition" && candidate.isCurrentEffective
  );
}
