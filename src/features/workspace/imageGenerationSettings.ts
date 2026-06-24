import type {
  GrsImageAspectRatio,
  GrsImageCapability,
  GrsImageSizeOption
} from "../../domain/morpho/grsImageModels";
import {
  GRS_IMAGE_ASPECT_RATIOS,
  getDefaultGrsImageModel,
  getSelectableGrsImageModels,
  resolveGrsImageModelSettings
} from "../../domain/morpho/grsImageModels";
import type { MorphoWorkspace } from "../../domain/morpho/types";

export type ImageGenerationSettings = {
  modelId: string;
  modelLabel: string;
  points: number;
  capabilities: GrsImageCapability[];
  aspectRatio: GrsImageAspectRatio;
  sizeOption?: GrsImageSizeOption;
  sizeOptions: GrsImageSizeOption[];
};

export type ImageGenerationModelOption = {
  id: string;
  label: string;
  points: number;
  capabilities: readonly GrsImageCapability[];
  sizeOptions: readonly GrsImageSizeOption[];
  defaultSizeOption?: GrsImageSizeOption;
};

export function inferGenerationAspectRatio(
  workspace: MorphoWorkspace,
  selectedObjectIds: readonly string[]
): GrsImageAspectRatio {
  const selectedRatio = selectedObjectIds.map((objectId) => ratioForImageObject(workspace, objectId)).find(Boolean);
  if (selectedRatio) {
    return closestAspectRatio(selectedRatio);
  }

  const defaultReference = Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.isDefaultReference && object.visibility === "active"
  );
  const defaultRatio = defaultReference ? ratioForImageObject(workspace, defaultReference.id) : undefined;

  return defaultRatio ? closestAspectRatio(defaultRatio) : "1:1";
}

export function resolveGenerationSettings(input: {
  modelId?: string;
  sizeOption?: string;
  aspectRatio?: GrsImageAspectRatio;
}): ImageGenerationSettings {
  const resolved = resolveGrsImageModelSettings(input.modelId, input.sizeOption);

  return {
    modelId: resolved.model.id,
    modelLabel: resolved.model.label,
    points: resolved.model.points,
    capabilities: [...resolved.model.capabilities],
    aspectRatio: input.aspectRatio ?? "1:1",
    sizeOption: resolved.sizeOption,
    sizeOptions: [...(resolved.model.sizeOptions ?? [])]
  };
}

export function getImageGenerationModelOptions(): ImageGenerationModelOption[] {
  return getSelectableGrsImageModels().map((model) => ({
    id: model.id,
    label: model.label,
    points: model.points,
    capabilities: model.capabilities,
    sizeOptions: model.sizeOptions ?? [],
    defaultSizeOption: model.defaultSizeOption
  }));
}

export function getDefaultImageGenerationSettings(): ImageGenerationSettings {
  const model = getDefaultGrsImageModel();
  return resolveGenerationSettings({
    modelId: model.id,
    sizeOption: model.defaultSizeOption,
    aspectRatio: "1:1"
  });
}

export { GRS_IMAGE_ASPECT_RATIOS };

function ratioForImageObject(workspace: MorphoWorkspace, objectId: string): number | undefined {
  const object = workspace.objects[objectId];
  if (!object || object.type !== "image" || object.visibility !== "active" || !object.assetId) {
    return undefined;
  }

  const asset = workspace.assets[object.assetId];
  if (!asset) {
    return undefined;
  }

  if (isPositiveFinite(asset.aspectRatio)) {
    return asset.aspectRatio;
  }

  if (isPositiveFinite(asset.width) && isPositiveFinite(asset.height)) {
    return asset.width / asset.height;
  }

  return undefined;
}

function closestAspectRatio(ratio: number): GrsImageAspectRatio {
  const options: Array<{ option: GrsImageAspectRatio; ratio: number }> = [
    { option: "1:1", ratio: 1 },
    { option: "4:3", ratio: 4 / 3 },
    { option: "3:4", ratio: 3 / 4 },
    { option: "16:9", ratio: 16 / 9 },
    { option: "9:16", ratio: 9 / 16 }
  ];

  return options.reduce((best, option) =>
    Math.abs(option.ratio - ratio) < Math.abs(best.ratio - ratio) ? option : best
  ).option;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
