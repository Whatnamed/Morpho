import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";

export type VisualGenerationTargetResult =
  | {
      status: "ready";
      directionId?: string;
      visualBranchId?: string;
    }
  | {
      status: "blocked";
      reason: string;
    };

export function resolveVisualGenerationTarget(
  workspace: MorphoWorkspace,
  selectedObjects: MorphoObject[],
  sourceObjectIds: string[],
  explicitVisualBranchId?: string
): VisualGenerationTargetResult {
  const selectedDirection = selectedObjects.find((object) => object.type === "conceptDirection");
  const sourceImages = sourceObjectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is Extract<MorphoObject, { type: "image" }> => object?.type === "image");
  const sourceDirectionIds = [...new Set(sourceImages.map((image) => image.directionId).filter(Boolean))];

  if (!selectedDirection && sourceDirectionIds.length > 1) {
    return {
      status: "blocked",
      reason: "已选图片来自不同方向。请先明确选择目标方向，或切换为无方向视觉探索。"
    };
  }

  const directionId = sourceDirectionIds[0] ?? selectedDirection?.id;
  const explicitBranch = explicitVisualBranchId ? workspace.visualBranches[explicitVisualBranchId] : undefined;
  if (directionId && explicitBranch?.directionId === directionId && !explicitBranch.archivedAt) {
    return {
      status: "ready",
      directionId,
      visualBranchId: explicitBranch.id
    };
  }

  const sourceBranchIds = [
    ...new Set(
      sourceImages
        .map((image) => image.visualBranchId)
        .filter((branchId): branchId is string => Boolean(branchId))
        .filter((branchId) => workspace.visualBranches[branchId]?.directionId === directionId)
        .filter((branchId) => !workspace.visualBranches[branchId]?.archivedAt)
    )
  ];

  return {
    status: "ready",
    directionId,
    visualBranchId: sourceBranchIds.length === 1 ? sourceBranchIds[0] : undefined
  };
}
