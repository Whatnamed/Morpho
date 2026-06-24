import type { GrsGenerateInput } from "./grsProvider";
import { getGrsRequestProfile } from "./profile";

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

export function validateGrsImageRouteRequest(
  value: unknown,
  options: { model?: string } = {}
): GrsImageRouteValidationResult {
  if (!isRecord(value)) {
    return { status: "failed", reason: "请求格式无效。" };
  }

  if (typeof value.prompt !== "string" || !value.prompt.trim()) {
    return { status: "failed", reason: "图像任务描述为空。" };
  }

  const images = Array.isArray(value.images)
    ? value.images.filter((image): image is string => typeof image === "string" && image.length > 0).slice(0, MAX_REFERENCE_IMAGES)
    : [];

  const profile = getGrsRequestProfile(options.model ?? "");

  return {
    status: "ok",
    value: {
      prompt: value.prompt.trim(),
      images,
      aspectRatio: typeof value.aspectRatio === "string" && value.aspectRatio ? value.aspectRatio : "4:3",
      imageSize: profile.imageSize,
      replyType: profile.replyType
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
