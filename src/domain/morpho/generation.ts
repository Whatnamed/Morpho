import { createObjectIncarnationId } from "./objectIdentity";
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
  const lineage = input.generation.lineage;
  const sentReferences = input.generation.providerInputs?.references.filter((entry) => entry.status === "sent");
  if (sentReferences && (sentReferences.length !== input.generation.referenceObjectIds.length || sentReferences.some((entry, index) =>
    entry.source.objectId !== input.generation.referenceObjectIds[index]) || input.generation.providerInputs?.references.some((entry) => entry.required && entry.status !== "sent"))) {
    throw new Error("生成记录与实际 Provider 输入不一致。");
  }
  if (lineage?.identityParent && !sentReferences?.some((entry) => entry.role === "identity" && entry.source.objectId === lineage.identityParent?.objectId)) {
    throw new Error("身份父图没有对应的实际像素输入。");
  }
  const primarySourceId = lineage?.identityParent?.objectId ?? input.sourceObjectIds[0];
  const sourceImages = [...new Set(sentReferences?.map((entry) => entry.source.objectId) ?? input.sourceObjectIds)]
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is ImageObject => Boolean(object) && object.type === "image" &&
      (!sentReferences || sentReferences.some((entry) => entry.source.objectId === object.id &&
        (!entry.source.incarnationId || entry.source.incarnationId === object.incarnationId))));
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
  const directionObjectId = lineage ? lineage.direction?.objectId : input.directionObjectId;
  const explicitDirection = directionObjectId ? workspace.objects[directionObjectId] : undefined;
  const directionId =
    explicitDirection?.type === "conceptDirection" && (!lineage?.direction?.incarnationId || explicitDirection.incarnationId === lineage.direction.incarnationId)
      ? explicitDirection.id
      : undefined;
  const explicitVisualBranchId = lineage ? lineage.branch?.id : input.visualBranchId ?? input.generation.visualBranchId;
  const explicitVisualBranch = explicitVisualBranchId ? workspace.visualBranches[explicitVisualBranchId] : undefined;
  const visualBranchId =
    directionId && explicitVisualBranch?.directionId === directionId && (!explicitVisualBranch.archivedAt || Boolean(lineage))
      ? explicitVisualBranch.id
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
    incarnationId: createObjectIncarnationId(),
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
      ...structuredClone(input.generation),
      directionId: lineage ? lineage.direction?.objectId : directionId,
      visualBranchId: lineage ? lineage.branch?.id : visualBranchId
    }
  };
  const relations: MorphoRelation[] = [];
  for (const sourceImage of sourceImages) {
    relations.push({
      id: nextAvailableId(
        Object.fromEntries([...workspace.relations, ...relations].map((relation) => [relation.id, relation])),
        `rel-${sourceImage.id}-${objectId}-source`
      ),
      kind: lineage ? "usesReference" : "source",
      fromObjectId: sourceImage.id,
      toObjectId: objectId,
      note: lineage ? `本次实际使用该参考（${sentReferences?.find((entry) => entry.source.objectId === sourceImage.id)?.role ?? "unspecified"}）；不以辅助参考决定版本或归属。` : "旧生成来源记录；参考角色与身份父图未知。"
    });
    if (lineage?.identityParent?.objectId === sourceImage.id) {
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
      note: "生成结果归属来自冻结的视觉任务；辅助参考不决定方向。"
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
