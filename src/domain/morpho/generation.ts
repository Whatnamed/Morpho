import type { AssetRecord, ImageObject, MorphoRelation, MorphoWorkspace } from "./types";

export type CreateGeneratedImageInput = {
  asset: AssetRecord;
  prompt: string;
  sourceObjectIds: string[];
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
  const sourceInstance = primarySourceId
    ? workspace.canvas.instances.find((instance) => instance.objectId === primarySourceId)
    : undefined;
  const objectId = nextAvailableId(workspace.objects, `image-generated-${input.asset.id}`);
  const canvasInstanceId = nextAvailableId(
    Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
    `canvas-${objectId}`
  );
  const directionId = primarySource?.type === "image" ? primarySource.directionId : undefined;
  const generatedImage: ImageObject = {
    id: objectId,
    type: "image",
    title: "GrsAI 生成结果",
    summary: input.prompt,
    createdBy: "ai",
    visibility: "active",
    role: "preview",
    imageVariant: "rail",
    assetId: input.asset.id,
    directionId
  };
  const relations: MorphoRelation[] = primarySourceId
    ? [
        {
          id: nextAvailableId(
            Object.fromEntries(workspace.relations.map((relation) => [relation.id, relation])),
            `rel-${primarySourceId}-${objectId}-source`
          ),
          kind: "source",
          fromObjectId: primarySourceId,
          toObjectId: objectId,
          note: "GrsAI 视觉发展使用该图作为本次明确来源。"
        },
        {
          id: nextAvailableId(
            Object.fromEntries(workspace.relations.map((relation) => [relation.id, relation])),
            `rel-${primarySourceId}-${objectId}-version`
          ),
          kind: "version",
          fromObjectId: primarySourceId,
          toObjectId: objectId,
          note: "GrsAI 视觉发展创建的新对象，来源图不被覆盖。"
        }
      ]
    : [];

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
    workspace: {
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
            position: sourceInstance
              ? {
                  x: sourceInstance.position.x + sourceInstance.size.w + 92,
                  y: sourceInstance.position.y
                }
              : {
                  x: workspace.canvas.view.x + 180,
                  y: workspace.canvas.view.y + 180
                },
            size: { w: 270, h: 210 }
          }
        ]
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: [objectId]
      }
    }
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
