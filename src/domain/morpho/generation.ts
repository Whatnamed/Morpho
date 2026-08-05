import { reconcileWorkspaceDerivedState } from "./derivedState";
import { getImageCanvasSize } from "./imageSizing";
import { findAvailableCanvasPosition } from "./canvasPlacement";
import type {
  AssetRecord,
  CanvasPoint,
  ImageGenerationMetadata,
  ImageObject,
  ImageRole,
  MorphoRelation,
  MorphoWorkspace
} from "./types";

export type CreateGeneratedImageInput = {
  asset: AssetRecord;
  generation: ImageGenerationMetadata;
  sourceObjectIds: string[];
  directionObjectId?: string;
  visualBranchId?: string;
  title?: string;
  summary?: string;
  role?: ImageRole;
  position?: CanvasPoint;
  canvasSize?: { w: number; h: number };
};

export type CreateGeneratedImageResult = {
  workspace: MorphoWorkspace;
  createdObjectId: string;
};

export function createGeneratedImageFromAsset(
  workspace: MorphoWorkspace,
  input: CreateGeneratedImageInput
): CreateGeneratedImageResult {
  const primarySourceId = input.sourceObjectIds[0];
  const primarySource = primarySourceId ? workspace.objects[primarySourceId] : undefined;
  const sourceImages = [...new Set(input.sourceObjectIds)]
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is ImageObject => Boolean(object) && object.type === "image");
  const sourceInstance = primarySourceId
    ? workspace.canvas.instances.find((instance) => instance.objectId === primarySourceId)
    : undefined;
  const directionInstance = input.directionObjectId
    ? workspace.canvas.instances.find((instance) => instance.objectId === input.directionObjectId)
    : undefined;
  const objectId = nextAvailableId(workspace.objects, `image-generated-${input.asset.id}`);
  const canvasInstanceId = nextAvailableId(
    Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
    `canvas-${objectId}`
  );
  const canvasSize =
    input.canvasSize ??
    getImageCanvasSize({
      width: input.asset.width,
      height: input.asset.height,
      aspectRatio: input.asset.aspectRatio
    });
  const explicitDirection = input.directionObjectId ? workspace.objects[input.directionObjectId] : undefined;
  const directionId =
    explicitDirection?.type === "conceptDirection"
      ? explicitDirection.id
      : primarySource?.type === "image"
        ? primarySource.directionId
        : undefined;
  const explicitVisualBranchId = input.visualBranchId ?? input.generation.visualBranchId;
  const explicitVisualBranch = explicitVisualBranchId ? workspace.visualBranches[explicitVisualBranchId] : undefined;
  const sourceVisualBranch =
    primarySource?.type === "image" && primarySource.visualBranchId
      ? workspace.visualBranches[primarySource.visualBranchId]
      : undefined;
  const visualBranchId =
    directionId && explicitVisualBranch?.directionId === directionId && !explicitVisualBranch.archivedAt
      ? explicitVisualBranch.id
      : directionId && sourceVisualBranch?.directionId === directionId && !sourceVisualBranch.archivedAt
        ? sourceVisualBranch.id
        : undefined;
  const preferredPosition = input.position
    ? input.position
    : sourceInstance
      ? {
          x: sourceInstance.position.x + sourceInstance.size.w + 92,
          y: sourceInstance.position.y
        }
      : directionInstance
        ? {
            x: directionInstance.position.x + directionInstance.size.w + 92,
            y: directionInstance.position.y
          }
        : {
            x: workspace.canvas.view.x + 180,
            y: workspace.canvas.view.y + 180
          };
  const position = findAvailableCanvasPosition(workspace, {
    preferred: preferredPosition,
    size: canvasSize
  });
  const generatedImage: ImageObject = {
    id: objectId,
    type: "image",
    title: input.title ?? input.generation.title ?? "GrsAI 生成结果",
    summary: input.summary ?? input.generation.purpose ?? input.generation.prompt,
    createdBy: "ai",
    visibility: "active",
    role: input.role ?? input.generation.role ?? "preview",
    assetId: input.asset.id,
    directionId,
    visualBranchId,
    generation: {
      ...input.generation,
      directionId,
      visualBranchId
    }
  };
  const relations: MorphoRelation[] = [];
  for (const sourceImage of sourceImages) {
    relations.push({
      id: nextAvailableId(
        Object.fromEntries([...workspace.relations, ...relations].map((relation) => [relation.id, relation])),
        `rel-${sourceImage.id}-${objectId}-source`
      ),
      kind: "source",
      fromObjectId: sourceImage.id,
      toObjectId: objectId,
      note: "GrsAI 视觉发展使用该图作为本次明确来源。"
    });
    if (sourceImages.length === 1) {
      relations.push({
        id: nextAvailableId(
          Object.fromEntries([...workspace.relations, ...relations].map((relation) => [relation.id, relation])),
          `rel-${sourceImage.id}-${objectId}-version`
        ),
        kind: "version",
        fromObjectId: sourceImage.id,
        toObjectId: objectId,
        note: "GrsAI 视觉发展创建的新对象，来源图不被覆盖。"
      });
    }
  }

  if (directionId) {
    relations.push({
      id: nextAvailableId(
        Object.fromEntries([...workspace.relations, ...relations].map((relation) => [relation.id, relation])),
        `rel-${objectId}-${directionId}-direction`
      ),
      kind: "belongsToDirection",
      fromObjectId: objectId,
      toObjectId: directionId,
      note: "生成结果沿用来源图所属方向，仅作为本次视觉发展关系。"
    });
  }

  return {
    createdObjectId: objectId,
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      assets: {
        ...workspace.assets,
        [input.asset.id]: input.asset
      },
      objects: {
        ...workspace.objects,
        [objectId]: generatedImage
      },
      relations: [...workspace.relations, ...relations],
      canvas: {
        ...workspace.canvas,
        instances: [
          ...workspace.canvas.instances,
          {
            id: canvasInstanceId,
            objectId,
            position,
            size: canvasSize
          }
        ]
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: [objectId]
      }
    })
  };
}

function nextAvailableId(record: Record<string, unknown>, preferredId: string): string {
  if (!record[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (record[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredId}-${suffix}`;
}
