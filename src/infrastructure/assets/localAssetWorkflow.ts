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

export async function saveBlobAsLocalAsset(
  store: BlobStore,
  file: File,
  sourceType: AssetSourceType
): Promise<SaveLocalAssetResult> {
  const assetId = createAssetId(file.name);
  const storageKey = `blob:${assetId}`;
  const asset: AssetRecord = {
    id: assetId,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    createdAt: new Date().toISOString(),
    storageKey,
    sourceType
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
