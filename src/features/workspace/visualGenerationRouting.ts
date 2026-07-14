import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";

export type VisualGenerationIntent = "directionPreview" | "visualDevelopment";

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

const DIRECTION_PREVIEW_PATTERN = /方向.*(?:预览|出图|图片|图像|效果图)|(?:每个|每条|各).{0,8}方向.*(?:图|预览)|生成.*(?:方向|概念).*(?:图|预览)/i;
const VISUAL_DEVELOPMENT_PATTERN = /继续|迭代|保留|借鉴|参考|场景|cmf|材质|颜色|细节|局部|出图|生成.*(?:场景图|细节图|cmf图|角度图)/i;

export function classifyVisualGenerationIntent(
  draft: string,
  selectedObjects: readonly MorphoObject[]
): VisualGenerationIntent | null {
  const text = draft.trim();
  const selectedDirections = selectedObjects.filter((object) => object.type === "conceptDirection");
  const selectedImages = selectedObjects.filter((object) => object.type === "image");

  if (selectedDirections.length > 0 && DIRECTION_PREVIEW_PATTERN.test(text)) {
    return "directionPreview";
  }

  if (selectedImages.length > 0 && VISUAL_DEVELOPMENT_PATTERN.test(text)) {
    return "visualDevelopment";
  }

  return null;
}

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
