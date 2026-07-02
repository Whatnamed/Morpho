import type { AssetRecord } from "@/domain/morpho/types";

export type WorkspaceAssetUrlCache = {
  reconcile(assets: Record<string, AssetRecord>): Promise<Record<string, string>>;
  getUrls(): Record<string, string>;
  dispose(): void;
};

type CachedAssetUrl = {
  assetId: string;
  storageKey: string;
  url: string;
  generation: number;
};

type PendingAssetUrl = {
  storageKey: string;
  generation: number;
};

type WorkspaceAssetUrlCacheOptions = {
  loadUrl: (storageKey: string) => Promise<string | null>;
  revokeUrl: (url: string) => void;
  onChange?: (urls: Record<string, string>) => void;
};

export function createWorkspaceAssetUrlCache({
  loadUrl,
  revokeUrl,
  onChange
}: WorkspaceAssetUrlCacheOptions): WorkspaceAssetUrlCache {
  let generation = 0;
  let disposed = false;
  const cached = new Map<string, CachedAssetUrl>();
  const pending = new Map<string, PendingAssetUrl>();

  function publish(): Record<string, string> {
    const urls = Object.fromEntries([...cached.entries()].map(([assetId, entry]) => [assetId, entry.url]));
    onChange?.(urls);
    return urls;
  }

  async function loadAsset(asset: AssetRecord, requestGeneration: number): Promise<void> {
    try {
      const url = await loadUrl(asset.storageKey);
      const activePending = pending.get(asset.id);
      const current = cached.get(asset.id);
      const isCurrent =
        !disposed &&
        activePending?.generation === requestGeneration &&
        activePending.storageKey === asset.storageKey &&
        (!current || current.generation <= requestGeneration);

      if (!url) {
        if (isCurrent) {
          pending.delete(asset.id);
        }
        return;
      }

      if (!isCurrent) {
        revokeUrl(url);
        return;
      }

      if (current && current.url !== url) {
        revokeUrl(current.url);
      }
      cached.set(asset.id, {
        assetId: asset.id,
        storageKey: asset.storageKey,
        url,
        generation: requestGeneration
      });
      pending.delete(asset.id);
      publish();
    } catch {
      const activePending = pending.get(asset.id);
      if (activePending?.generation === requestGeneration && activePending.storageKey === asset.storageKey) {
        pending.delete(asset.id);
      }
    }
  }

  return {
    async reconcile(assets) {
      if (disposed) {
        return {};
      }

      generation += 1;
      const currentGeneration = generation;
      const imageAssets = Object.values(assets).filter(isImagePreviewAsset);
      const desiredKeys = new Map(imageAssets.map((asset) => [asset.id, asset.storageKey]));

      for (const [assetId, entry] of cached) {
        const desiredStorageKey = desiredKeys.get(assetId);
        if (!desiredStorageKey || desiredStorageKey !== entry.storageKey) {
          revokeUrl(entry.url);
          cached.delete(assetId);
        }
      }

      const reads: Promise<void>[] = [];
      for (const asset of imageAssets) {
        const current = cached.get(asset.id);
        const currentPending = pending.get(asset.id);
        if (current?.storageKey === asset.storageKey || currentPending?.storageKey === asset.storageKey) {
          continue;
        }

        pending.set(asset.id, {
          storageKey: asset.storageKey,
          generation: currentGeneration
        });
        reads.push(loadAsset(asset, currentGeneration));
      }

      publish();
      await Promise.all(reads);
      return publish();
    },
    getUrls() {
      return publish();
    },
    dispose() {
      disposed = true;
      pending.clear();
      for (const entry of cached.values()) {
        revokeUrl(entry.url);
      }
      cached.clear();
      publish();
    }
  };
}

function isImagePreviewAsset(asset: AssetRecord): boolean {
  return asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage";
}
