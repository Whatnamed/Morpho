import { nightrailWorkspace } from "./seed";
import type {
  AiDraftResult,
  AiSuggestionInput,
  CanvasInstanceId,
  CanvasPoint,
  MorphoRelation,
  MorphoWorkspace
} from "./types";

export function createInitialWorkspace(): MorphoWorkspace {
  return structuredClone(nightrailWorkspace);
}

export function updateCanvasInstancePosition(
  workspace: MorphoWorkspace,
  instanceId: CanvasInstanceId,
  position: CanvasPoint
): MorphoWorkspace {
  let didFindInstance = false;
  const instances = workspace.canvas.instances.map((instance) => {
    if (instance.id !== instanceId) {
      return instance;
    }

    didFindInstance = true;
    return {
      ...instance,
      position
    };
  });

  if (!didFindInstance) {
    throw new Error(`Canvas instance not found: ${instanceId}`);
  }

  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      instances
    }
  };
}

export function createAiDraftFromSuggestion(
  workspace: MorphoWorkspace,
  input: AiSuggestionInput
): AiDraftResult {
  return {
    workspace,
    draft: input.suggestion,
    contextObjectIds: [...input.selectedObjectIds]
  };
}

export function serializeWorkspace(workspace: MorphoWorkspace): string {
  return JSON.stringify(workspace);
}

export function parseWorkspace(raw: string): MorphoWorkspace {
  const parsed = JSON.parse(raw) as MorphoWorkspace;

  if (parsed.schemaVersion !== 1) {
    throw new Error("Unsupported Morpho workspace schema version.");
  }

  return parsed;
}

export function addLocalModificationVariants(workspace: MorphoWorkspace, sourceObjectId: string): MorphoWorkspace {
  const sourceInstance = workspace.canvas.instances.find((instance) => instance.objectId === sourceObjectId);
  const sourceObject = workspace.objects[sourceObjectId];

  if (!sourceInstance || !sourceObject || sourceObject.type !== "image") {
    return workspace;
  }

  if (workspace.objects["image-soft-rail-v3-a"] && workspace.objects["image-soft-rail-v3-b"]) {
    return workspace;
  }

  const firstVariantId = "image-soft-rail-v3-a";
  const secondVariantId = "image-soft-rail-v3-b";

  const variantRelations: MorphoRelation[] = [
    {
      id: "rel-v3-a-version",
      kind: "version",
      fromObjectId: sourceObjectId,
      toObjectId: firstVariantId,
      note: "局部修改生成的新对象，原图不被覆盖。"
    },
    {
      id: "rel-v3-b-version",
      kind: "version",
      fromObjectId: sourceObjectId,
      toObjectId: secondVariantId,
      note: "局部修改生成的新对象，原图不被覆盖。"
    }
  ];

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [firstVariantId]: {
        id: firstVariantId,
        type: "image",
        title: "柔光轨道 v3 · 转角一体化",
        summary: "保留整体比例与柔光轨道语言，减少转角连接件的外露五金感。",
        createdBy: "ai",
        role: "detail",
        imageVariant: "detail",
        directionId: sourceObject.directionId
      },
      [secondVariantId]: {
        id: secondVariantId,
        type: "image",
        title: "柔光轨道 v3 · 隐蔽固定",
        summary: "在同一产品路线下尝试更安静的安装与固定表达。",
        createdBy: "ai",
        role: "detail",
        imageVariant: "rail",
        directionId: sourceObject.directionId
      }
    },
    relations: [...workspace.relations, ...variantRelations],
    canvas: {
      ...workspace.canvas,
      instances: [
        ...workspace.canvas.instances,
        {
          id: "canvas-image-v3-a",
          objectId: firstVariantId,
          position: {
            x: sourceInstance.position.x + sourceInstance.size.w + 92,
            y: sourceInstance.position.y + 36
          },
          size: { w: 240, h: 190 }
        },
        {
          id: "canvas-image-v3-b",
          objectId: secondVariantId,
          position: {
            x: sourceInstance.position.x + sourceInstance.size.w + 92,
            y: sourceInstance.position.y + 266
          },
          size: { w: 240, h: 190 }
        }
      ]
    },
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: "ai-msg-local-edit-result",
          role: "assistant",
          body: "已在原图右侧放置两张局部修改变体。原图、默认参考和交付引用都没有被替换。"
        }
      ]
    }
  };
}
