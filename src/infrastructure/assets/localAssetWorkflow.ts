import type { AssetRecord, AssetSourceType } from "../../domain/morpho/types";

export type BlobStore = {
  put: (storageKey: string, blob: Blob) => Promise<void>;
  get: (storageKey: string) => Promise<Blob | null>;
};

export type SaveLocalAssetResult =
  | {
      status: "ok";
      asset: AssetRecord;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ImageAssetDimensions = {
  width: number;
  height: number;
  aspectRatio: number;
};

export type SaveLocalAssetOptions = {
  readImageDimensions?: (blob: Blob) => Promise<ImageAssetDimensions>;
};

export async function saveBlobAsLocalAsset(
  store: BlobStore,
  file: File,
  sourceType: AssetSourceType,
  options: SaveLocalAssetOptions = {}
): Promise<SaveLocalAssetResult> {
  const assetId = createAssetId(file.name);
  const storageKey = `blob:${assetId}`;
  const dimensionsResult = await readDimensionsIfNeeded(file, sourceType, options);
  if (dimensionsResult.status === "failed") {
    return dimensionsResult;
  }

  const asset: AssetRecord = {
    id: assetId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    createdAt: new Date().toISOString(),
    storageKey,
    sourceType,
    ...dimensionsResult.dimensions
  };

  try {
    await store.put(storageKey, file);
    return {
      status: "ok",
      asset
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "本地二进制资产保存失败。"
    };
  }
}

export function readImageBlobDimensions(blob: Blob): Promise<ImageAssetDimensions> {
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    return Promise.reject(new Error("当前环境无法读取图片尺寸。"));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("图片尺寸读取失败。"));
        return;
      }

      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspectRatio: image.naturalWidth / image.naturalHeight
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片尺寸读取失败。"));
    };
    image.src = url;
  });
}

async function readDimensionsIfNeeded(
  file: File,
  sourceType: AssetSourceType,
  options: SaveLocalAssetOptions
): Promise<{ status: "ok"; dimensions?: ImageAssetDimensions } | { status: "failed"; reason: string }> {
  const shouldReadDimensions =
    Boolean(options.readImageDimensions) &&
    (sourceType === "originalImage" || sourceType === "aiGeneratedImage" || file.type.startsWith("image/"));

  if (!shouldReadDimensions || !options.readImageDimensions) {
    return { status: "ok" };
  }

  try {
    return {
      status: "ok",
      dimensions: await options.readImageDimensions(file)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "图片尺寸读取失败。"
    };
  }
}

export function createAssetId(fileName: string): string {
  const safeName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36);

  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36);

  return `asset-${safeName || "file"}-${randomPart}`;
}
