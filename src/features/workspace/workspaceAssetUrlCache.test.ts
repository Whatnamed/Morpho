import { describe, expect, it } from "vitest";

import type { AssetRecord } from "@/domain/morpho/types";
import { createWorkspaceAssetUrlCache } from "./workspaceAssetUrlCache";

describe("workspace asset URL cache", () => {
  it("loads only new image assets and keeps existing URLs stable", async () => {
    const reads: string[] = [];
    const revoked: string[] = [];
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: async (storageKey) => {
        reads.push(storageKey);
        return `blob:${storageKey}`;
      },
      revokeUrl: (url) => revoked.push(url)
    });

    await cache.reconcile({ a: imageAsset("a", "key-a"), b: imageAsset("b", "key-b") });
    const first = cache.getUrls();
    await cache.reconcile({
      a: imageAsset("a", "key-a"),
      b: imageAsset("b", "key-b"),
      c: imageAsset("c", "key-c")
    });

    expect(reads).toEqual(["key-a", "key-b", "key-c"]);
    expect(cache.getUrls()).toEqual({ a: first.a, b: first.b, c: "blob:key-c" });
    expect(revoked).toEqual([]);
  });

  it("revokes removed, changed, and disposed URLs without reloading unchanged assets", async () => {
    const reads: string[] = [];
    const revoked: string[] = [];
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: async (storageKey) => {
        reads.push(storageKey);
        return `blob:${storageKey}`;
      },
      revokeUrl: (url) => revoked.push(url)
    });

    await cache.reconcile({ a: imageAsset("a", "key-a"), b: imageAsset("b", "key-b") });
    await cache.reconcile({ a: imageAsset("a", "key-a2"), c: fileAsset("c", "key-c") });
    cache.dispose();

    expect(reads).toEqual(["key-a", "key-b", "key-a2"]);
    expect(revoked).toEqual(["blob:key-a", "blob:key-b", "blob:key-a2"]);
    expect(cache.getUrls()).toEqual({});
  });

  it("does not let a stale async read overwrite a newer URL and revokes the stale URL", async () => {
    const revoked: string[] = [];
    const pending = new Map<string, (url: string | null) => void>();
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: (storageKey) =>
        new Promise((resolve) => {
          pending.set(storageKey, resolve);
        }),
      revokeUrl: (url) => revoked.push(url)
    });

    const first = cache.reconcile({ a: imageAsset("a", "old-key") });
    const second = cache.reconcile({ a: imageAsset("a", "new-key") });
    pending.get("new-key")?.("blob:new");
    await second;
    expect(cache.getUrls()).toEqual({ a: "blob:new" });

    pending.get("old-key")?.("blob:old");
    await first;

    expect(cache.getUrls()).toEqual({ a: "blob:new" });
    expect(revoked).toEqual(["blob:old"]);
  });

  it("keeps other image URLs when one IndexedDB read fails", async () => {
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: async (storageKey) => {
        if (storageKey === "bad-key") {
          throw new Error("read failed");
        }
        return `blob:${storageKey}`;
      },
      revokeUrl: () => undefined
    });

    await cache.reconcile({ a: imageAsset("a", "good-key"), b: imageAsset("b", "bad-key") });

    expect(cache.getUrls()).toEqual({ a: "blob:good-key" });
  });
});

function imageAsset(id: string, storageKey: string): AssetRecord {
  return {
    id,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 1,
    createdAt: "2026-07-03T00:00:00.000Z",
    storageKey,
    sourceType: "originalImage"
  };
}

function fileAsset(id: string, storageKey: string): AssetRecord {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 1,
    createdAt: "2026-07-03T00:00:00.000Z",
    storageKey,
    sourceType: "originalFile"
  };
}
