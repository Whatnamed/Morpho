import type { GrsImageAspectRatio, GrsImageSizeOption } from "../../domain/morpho/grsImageModels";
import { resolveGrsImageModelSettings } from "../../domain/morpho/grsImageModels";

export type GrsRequestProfile = {
  family: "nanoBanana" | "gptImage2";
  modelId: string;
  imageSize?: GrsImageSizeOption;
  replyType: "json";
  aspectRatio: string;
};

const GPT_IMAGE_2_ASPECT_RATIO_MAP: Record<GrsImageAspectRatio, string> = {
  "1:1": "1024x1024",
  "4:3": "1024x768",
  "3:4": "768x1024",
  "16:9": "1024x576",
  "9:16": "576x1024"
};

export function getGrsRequestProfile(input: {
  modelId?: string;
  aspectRatio: GrsImageAspectRatio;
  sizeOption?: string;
}): GrsRequestProfile {
  const resolved = resolveGrsImageModelSettings(input.modelId, input.sizeOption);

  if (resolved.model.family === "gptImage2") {
    return {
      family: "gptImage2",
      modelId: resolved.model.id,
      replyType: "json",
      aspectRatio: GPT_IMAGE_2_ASPECT_RATIO_MAP[input.aspectRatio]
    };
  }

  return {
    family: "nanoBanana",
    modelId: resolved.model.id,
    imageSize: resolved.sizeOption,
    replyType: "json",
    aspectRatio: input.aspectRatio
  };
}
