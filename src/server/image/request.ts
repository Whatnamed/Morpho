import type { GrsImageAspectRatio } from "../../domain/morpho/grsImageModels";
import {
  findSelectableGrsImageModel,
  getDefaultGrsImageModel,
  isGrsImageAspectRatio,
  resolveGrsImageModelSettings
} from "../../domain/morpho/grsImageModels";
import { GRS_REFERENCE_IMAGE_LIMIT } from "../../domain/morpho/imageLimits";

import type { GrsGenerateInput } from "./grsProvider";
import { validateImageInputCollection } from "./imageInputBounds";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_IMAGE_PROMPT_CHARS = 16_000;

export type GrsImageRouteValidationResult =
  | {
      status: "ok";
      value: GrsGenerateInput;
    }
  | {
      status: "failed";
      reason: string;
    };

export function validateGrsImageRouteRequest(value: unknown): GrsImageRouteValidationResult {
  if (!isRecord(value)) {
    return { status: "failed", reason: "请求格式无效。" };
  }

  if (
    typeof value.prompt !== "string" ||
    !value.prompt.trim() ||
    value.prompt.length > MAX_IMAGE_PROMPT_CHARS
  ) {
    return { status: "failed", reason: "图像任务描述为空或超过 16000 字符。" };
  }

  const requestedModelId = typeof value.modelId === "string" && value.modelId ? value.modelId : undefined;
  if (requestedModelId && !findSelectableGrsImageModel(requestedModelId)) {
    return { status: "failed", reason: "所选 GrsAI 图像模型不可用或正在维护。" };
  }

  const resolvedSettings = resolveGrsImageModelSettings(requestedModelId, stringValue(value.sizeOption));
  const imageInputs = validateImageInputCollection(value.images ?? [], {
    maxCount: GRS_REFERENCE_IMAGE_LIMIT
  });
  if (imageInputs.status === "failed") {
    return {
      status: "failed",
      reason: `GrsAI ${imageInputs.reason}`
    };
  }
  const referenceObjectIds = boundedIdentifierArray(value.referenceObjectIds);
  if (referenceObjectIds === undefined) {
    return { status: "failed", reason: "referenceObjectIds 格式无效或数量过多。" };
  }
  const directionObjectId = optionalBoundedIdentifier(value.directionObjectId);
  const operationId = optionalBoundedIdentifier(value.operationId);
  const clientRequestId = optionalBoundedIdentifier(value.clientRequestId);
  if (directionObjectId === null || operationId === null || clientRequestId === null) {
    return { status: "failed", reason: "图像任务对象标识格式无效。" };
  }
  const requestedAspectRatio = stringValue(value.aspectRatio);
  const aspectRatio: GrsImageAspectRatio = isGrsImageAspectRatio(requestedAspectRatio) ? requestedAspectRatio : "1:1";

  return {
    status: "ok",
    value: {
      modelId: requestedModelId ?? getDefaultGrsImageModel().id,
      prompt: value.prompt.trim(),
      images: imageInputs.images,
      aspectRatio,
      sizeOption: resolvedSettings.sizeOption,
      referenceObjectIds,
      directionObjectId: directionObjectId ?? undefined,
      operationId: operationId ?? undefined,
      clientRequestId: clientRequestId ?? undefined
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function boundedIdentifierArray(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > GRS_REFERENCE_IMAGE_LIMIT) return undefined;
  return value.every(isBoundedIdentifier) ? [...value] : undefined;
}

function optionalBoundedIdentifier(value: unknown): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  return isBoundedIdentifier(value) ? value : null;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    IDENTIFIER_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
