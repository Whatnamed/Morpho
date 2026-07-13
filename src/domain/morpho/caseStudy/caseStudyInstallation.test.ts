import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import { currentCaseStudyAssetManifest } from "./currentCaseStudy";
import { installCurrentCaseStudyAssets } from "./caseStudyInstallation";

describe("current case-study asset installation", () => {
  it("installs assets, then skips verified blobs on a later run", async () => {
    const store = createMemoryBlobStore();

    const first = await installCurrentCaseStudyAssets(store, { fetchAsset: fetchPublicCaseAsset });
    const second = await installCurrentCaseStudyAssets(store, { fetchAsset: fetchPublicCaseAsset });

    expect(first).toMatchObject({ diagnostics: [], installedCount: currentCaseStudyAssetManifest.assets.length });
    expect(second).toMatchObject({ diagnostics: [], skippedCount: currentCaseStudyAssetManifest.assets.length });
  });

  it("repairs a corrupt blob with the generated static asset", async () => {
    const store = createMemoryBlobStore();
    await installCurrentCaseStudyAssets(store, { fetchAsset: fetchPublicCaseAsset });
    const target = currentCaseStudyAssetManifest.assets[0];
    if (!target) throw new Error("Expected one case-study asset.");

    await store.put(target.runtimeStorageKey, new Blob(["corrupt"], { type: target.mimeType }));
    const repaired = await installCurrentCaseStudyAssets(store, { fetchAsset: fetchPublicCaseAsset });

    expect(repaired).toMatchObject({ diagnostics: [], repairedCount: 1 });
  });

  it("reports a single fetch failure without writing a fake blob", async () => {
    const store = createMemoryBlobStore();
    const unavailable = currentCaseStudyAssetManifest.assets[0];
    if (!unavailable) throw new Error("Expected one case-study asset.");

    const result = await installCurrentCaseStudyAssets(store, {
      fetchAsset: async (path) => (path === unavailable.publicPath ? new Response(null, { status: 404 }) : fetchPublicCaseAsset(path))
    });

    expect(result.diagnostics).toContainEqual({ assetId: unavailable.assetId, code: "fetch_failed" });
    expect(await store.get(unavailable.runtimeStorageKey)).toBeNull();
  });
});

function createMemoryBlobStore(): BlobStore {
  const values = new Map<string, Blob>();
  return {
    async delete(storageKey) {
      values.delete(storageKey);
    },
    async get(storageKey) {
      return values.get(storageKey) ?? null;
    },
    async put(storageKey, blob) {
      values.set(storageKey, blob);
    }
  };
}

async function fetchPublicCaseAsset(path: string): Promise<Response> {
  const bytes = await readFile(resolve(process.cwd(), "public", path.slice(1)));
  return new Response(bytes, { status: 200 });
}
