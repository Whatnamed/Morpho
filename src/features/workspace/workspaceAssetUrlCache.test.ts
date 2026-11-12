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

  it("does not let a pending read restore an asset that was removed before the read completed", async () => {
    const revoked: string[] = [];
    const pending = new Map<string, (url: string | null) => void>();
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: (storageKey) =>
        new Promise((resolve) => {
          pending.set(storageKey, resolve);
        }),
      revokeUrl: (url) => revoked.push(url)
    });

    const first = cache.reconcile({ a: imageAsset("a", "removed-key") });
    await cache.reconcile({});
    pending.get("removed-key")?.("blob:removed");
    await first;

    expect(cache.getUrls()).toEqual({});
    expect(revoked).toEqual(["blob:removed"]);
  });

  it("does not let a pending image read restore an asset that became a non-image asset", async () => {
    const revoked: string[] = [];
    const pending = new Map<string, (url: string | null) => void>();
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: (storageKey) =>
        new Promise((resolve) => {
          pending.set(storageKey, resolve);
        }),
      revokeUrl: (url) => revoked.push(url)
    });

    const first = cache.reconcile({ a: imageAsset("a", "image-key") });
    await cache.reconcile({ a: fileAsset("a", "file-key") });
    pending.get("image-key")?.("blob:image");
    await first;

    expect(cache.getUrls()).toEqual({});
    expect(revoked).toEqual(["blob:image"]);
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

  it("reloads cached and previously missing storageKeys on invalidation without disturbing unrelated URLs", async () => {
    const blobs = new Map<string, string | null>([
      ["k-corrupt", "blob:corrupt-v1"],
      ["k-missing", null],
      ["k-keep", "blob:keep-v1"]
    ]);
    const revoked: string[] = [];
    const notifications: Array<Record<string, string>> = [];
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: async (storageKey) => blobs.get(storageKey) ?? null,
      revokeUrl: (url) => revoked.push(url),
      onChange: (urls) => notifications.push(urls)
    });

    await cache.reconcile({
      a: imageAsset("a", "k-corrupt"),
      b: imageAsset("b", "k-missing"),
      c: imageAsset("c", "k-keep")
    });
    expect(cache.getUrls()).toEqual({ a: "blob:corrupt-v1", c: "blob:keep-v1" });

    // Unreferenced key invalidation should not publish or touch existing URLs.
    const beforeNoopNotifications = notifications.length;
    await cache.invalidateStorageKeys(["k-offscreen"]);
    expect(notifications.length).toBe(beforeNoopNotifications);
    expect(revoked).toEqual([]);

    // Repair k-corrupt and install k-missing under the same storageKeys.
    blobs.set("k-corrupt", "blob:repaired-v2");
    blobs.set("k-missing", "blob:installed-v2");
    await cache.invalidateStorageKeys(["k-corrupt", "k-missing"]);

    expect(revoked).toEqual(["blob:corrupt-v1"]);
    expect(cache.getUrls()).toEqual({
      a: "blob:repaired-v2",
      b: "blob:installed-v2",
      c: "blob:keep-v1"
    });
  });

  it("prevents a late pre-invalidation read from overwriting a freshly invalidated storageKey reload", async () => {
    const resolvers: Record<string, Array<(url: string | null) => void>> = {};
    const revoked: string[] = [];
    const cache = createWorkspaceAssetUrlCache({
      loadUrl: (storageKey) =>
        new Promise((resolve) => {
          (resolvers[storageKey] ??= []).push(resolve);
        }),
      revokeUrl: (url) => revoked.push(url)
    });

    const firstReconcile = cache.reconcile({ a: imageAsset("a", "k-race") });
    const reloadPromise = cache.invalidateStorageKeys(["k-race"]);

    resolvers["k-race"]?.[1]?.("blob:fresh-v2");
    await reloadPromise;
    expect(cache.getUrls()).toEqual({ a: "blob:fresh-v2" });

    resolvers["k-race"]?.[0]?.("blob:stale-v1");
    await firstReconcile;
    expect(cache.getUrls()).toEqual({ a: "blob:fresh-v2" });
    expect(revoked).toEqual(["blob:stale-v1"]);
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
