import type { GrsImageAspectRatio } from "../../domain/morpho/grsImageModels";
import {
  findSelectableGrsImageModel,
  getDefaultGrsImageModel,
  isGrsImageAspectRatio,
  resolveGrsImageModelSettings
} from "../../domain/morpho/grsImageModels";

import type { GrsGenerateInput } from "./grsProvider";

export type GrsImageRouteValidationResult =
  | {
      status: "ok";
      value: GrsGenerateInput;
    }
  | {
      status: "failed";
      reason: string;
    };

const MAX_REFERENCE_IMAGES = 4;

export function validateGrsImageRouteRequest(value: unknown): GrsImageRouteValidationResult {
  if (!isRecord(value)) {
    return { status: "failed", reason: "请求格式无效。" };
  }

  if (typeof value.prompt !== "string" || !value.prompt.trim()) {
    return { status: "failed", reason: "图像任务描述为空。" };
  }

  const requestedModelId = typeof value.modelId === "string" && value.modelId ? value.modelId : undefined;
  if (requestedModelId && !findSelectableGrsImageModel(requestedModelId)) {
    return { status: "failed", reason: "所选 GrsAI 图像模型不可用或正在维护。" };
  }

  const resolvedSettings = resolveGrsImageModelSettings(requestedModelId, stringValue(value.sizeOption));
  const images = Array.isArray(value.images)
    ? value.images.filter((image): image is string => typeof image === "string" && image.length > 0).slice(0, MAX_REFERENCE_IMAGES)
    : [];
  const requestedAspectRatio = stringValue(value.aspectRatio);
  const aspectRatio: GrsImageAspectRatio = isGrsImageAspectRatio(requestedAspectRatio) ? requestedAspectRatio : "1:1";

  return {
    status: "ok",
    value: {
      modelId: requestedModelId ?? getDefaultGrsImageModel().id,
      prompt: value.prompt.trim(),
      images,
      aspectRatio,
      sizeOption: resolvedSettings.sizeOption,
      referenceObjectIds: stringArray(value.referenceObjectIds),
      directionObjectId: stringValue(value.directionObjectId),
      operationId: stringValue(value.operationId),
      clientRequestId: stringValue(value.clientRequestId)
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
