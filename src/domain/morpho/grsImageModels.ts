export type GrsImageModelStatus = "available" | "maintenance";
export type GrsImageModelFamily = "nanoBanana" | "gptImage2";
export type GrsImageCapability = "textToImage" | "imageToImage";
export type GrsImageSizeOption = "1K" | "2K" | "4K";
export type GrsImageAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export type GrsImageModelCatalogItem = {
  id: string;
  label: string;
  status: GrsImageModelStatus;
  family: GrsImageModelFamily;
  points: number;
  capabilities: GrsImageCapability[];
  sizeOptions?: readonly GrsImageSizeOption[];
  defaultSizeOption?: GrsImageSizeOption;
  note?: string;
};

export type ResolvedGrsImageModelSettings = {
  model: GrsImageModelCatalogItem;
  sizeOption?: GrsImageSizeOption;
};

export const GRS_IMAGE_ASPECT_RATIOS: readonly GrsImageAspectRatio[] = ["1:1", "4:3", "3:4", "16:9", "9:16"];

export const GRS_IMAGE_MODEL_CATALOG: readonly GrsImageModelCatalogItem[] = [
  {
    id: "gpt-image-2-vip",
    label: "gpt-image-2-vip",
    status: "maintenance",
    family: "gptImage2",
    points: 1300,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K", "2K", "4K"],
    defaultSizeOption: "1K",
    note: "维护中"
  },
  {
    id: "gpt-image-2",
    label: "gpt-image-2",
    status: "available",
    family: "gptImage2",
    points: 600,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-pro",
    label: "nano-banana-pro",
    status: "available",
    family: "nanoBanana",
    points: 1800,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K", "2K", "4K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-pro-vt",
    label: "nano-banana-pro-vt",
    status: "available",
    family: "nanoBanana",
    points: 1800,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K", "2K", "4K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-2",
    label: "nano-banana-2",
    status: "available",
    family: "nanoBanana",
    points: 1200,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K", "2K", "4K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-fast",
    label: "nano-banana-fast",
    status: "available",
    family: "nanoBanana",
    points: 440,
    capabilities: ["textToImage", "imageToImage"]
  },
  {
    id: "nano-banana-pro-cl",
    label: "nano-banana-pro-cl",
    status: "available",
    family: "nanoBanana",
    points: 6000,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-2-cl",
    label: "nano-banana-2-cl",
    status: "available",
    family: "nanoBanana",
    points: 1600,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-2-2k-cl",
    label: "nano-banana-2-2k-cl",
    status: "available",
    family: "nanoBanana",
    points: 4000,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["2K"],
    defaultSizeOption: "2K"
  },
  {
    id: "nano-banana-pro-4k-vip",
    label: "nano-banana-pro-4k-vip",
    status: "available",
    family: "nanoBanana",
    points: 16000,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["4K"],
    defaultSizeOption: "4K"
  },
  {
    id: "nano-banana-pro-vip",
    label: "nano-banana-pro-vip",
    status: "available",
    family: "nanoBanana",
    points: 10000,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["1K", "2K"],
    defaultSizeOption: "1K"
  },
  {
    id: "nano-banana-2-4k-cl",
    label: "nano-banana-2-4k-cl",
    status: "available",
    family: "nanoBanana",
    points: 6000,
    capabilities: ["textToImage", "imageToImage"],
    sizeOptions: ["4K"],
    defaultSizeOption: "4K"
  },
  {
    id: "nano-banana",
    label: "nano-banana",
    status: "available",
    family: "nanoBanana",
    points: 1400,
    capabilities: ["textToImage", "imageToImage"]
  }
];

export function getSelectableGrsImageModels(): GrsImageModelCatalogItem[] {
  return GRS_IMAGE_MODEL_CATALOG.filter((model) => model.status === "available");
}

export function getDefaultGrsImageModel(): GrsImageModelCatalogItem {
  const selectable = getSelectableGrsImageModels();
  return selectable.reduce((best, model) => (model.points < best.points ? model : best), selectable[0]);
}

export function findSelectableGrsImageModel(modelId: string): GrsImageModelCatalogItem | undefined {
  return getSelectableGrsImageModels().find((model) => model.id === modelId);
}

export function resolveGrsImageModelSettings(
  modelId: string | undefined,
  requestedSizeOption: string | undefined
): ResolvedGrsImageModelSettings {
  const model = modelId ? findSelectableGrsImageModel(modelId) ?? getDefaultGrsImageModel() : getDefaultGrsImageModel();
  const sizeOption = resolveSizeOption(model, requestedSizeOption);

  return {
    model,
    sizeOption
  };
}

function resolveSizeOption(
  model: GrsImageModelCatalogItem,
  requestedSizeOption: string | undefined
): GrsImageSizeOption | undefined {
  if (!model.sizeOptions || model.sizeOptions.length === 0) {
    return undefined;
  }

  if (isGrsImageSizeOption(requestedSizeOption) && model.sizeOptions.includes(requestedSizeOption)) {
    return requestedSizeOption;
  }

  return model.defaultSizeOption ?? model.sizeOptions[0];
}

export function isGrsImageAspectRatio(value: string | undefined): value is GrsImageAspectRatio {
  return Boolean(value && (GRS_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value));
}

function isGrsImageSizeOption(value: string | undefined): value is GrsImageSizeOption {
  return value === "1K" || value === "2K" || value === "4K";
}
