"use client";

import { useEffect, useRef, useState } from "react";

import type { AssetRecord } from "@/domain/morpho/types";
import { getAssetObjectUrl } from "@/infrastructure/assets/indexedDbAssetStore";
import { createWorkspaceAssetUrlCache, type WorkspaceAssetUrlCache } from "./workspaceAssetUrlCache";

export function useWorkspaceAssetUrls(assets: Record<string, AssetRecord>): Record<string, string> {
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const cacheRef = useRef<WorkspaceAssetUrlCache | null>(null);

  useEffect(() => {
    if (!cacheRef.current) {
      cacheRef.current = createWorkspaceAssetUrlCache({
        loadUrl: getAssetObjectUrl,
        revokeUrl: (url) => URL.revokeObjectURL(url),
        onChange: setAssetUrls
      });
    }

    const cache = cacheRef.current;
    void cache.reconcile(assets);
  }, [assets]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      cache?.dispose();
      cacheRef.current = null;
    };
  }, []);

  return assetUrls;
}
