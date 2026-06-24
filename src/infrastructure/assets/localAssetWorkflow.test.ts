import { describe, expect, it } from "vitest";

import { saveBlobAsLocalAsset, type BlobStore } from "./localAssetWorkflow";

describe("local asset workflow", () => {
  it("stores binary image data outside workspace JSON and returns an asset record", async () => {
    const store = createMemoryBlobStore();
    const file = new File(["image-bytes"], "reference.png", { type: "image/png" });

    const result = await saveBlobAsLocalAsset(store, file, "originalImage");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected asset save to succeed.");
    }
    expect(result.asset.fileName).toBe("reference.png");
    expect(result.asset.mimeType).toBe("image/png");
    expect(result.asset.sourceType).toBe("originalImage");
    expect(await store.get(result.asset.storageKey)).toBeInstanceOf(Blob);
  });

  it("records intrinsic image dimensions when they can be read before saving", async () => {
    const store = createMemoryBlobStore();
    const file = new File(["image-bytes"], "wide.png", { type: "image/png" });

    const result = await saveBlobAsLocalAsset(store, file, "originalImage", {
      readImageDimensions: async () => ({ width: 1920, height: 1080, aspectRatio: 16 / 9 })
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected asset save to succeed.");
    }
    expect(result.asset.width).toBe(1920);
    expect(result.asset.height).toBe(1080);
    expect(result.asset.aspectRatio).toBe(16 / 9);
  });

  it("reports storage failure without pretending the import succeeded", async () => {
    const store: BlobStore = {
      async put() {
        throw new Error("quota exceeded");
      },
      async get() {
        return null;
      }
    };
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });

    const result = await saveBlobAsLocalAsset(store, file, "originalFile");

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain("quota exceeded");
    }
  });
});

function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, Blob>();

  return {
    async put(storageKey: string, blob: Blob) {
      blobs.set(storageKey, blob);
    },
    async get(storageKey: string) {
      return blobs.get(storageKey) ?? null;
    }
  };
}
