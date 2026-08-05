import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import { exportDeliveryOutputPackage } from "./deliveryOutputClient";

const NOW = "2026-07-02T10:00:00.000Z";

describe("delivery output client", () => {
  it("exports a zip with markdown, manifest, source map, and only selected delivery assets", async () => {
    const workspace = createClientFixtureWorkspace();
    const blobStore = new TrackingBlobStore({
      "storage:asset-hero": "hero-bytes",
      "storage:asset-unused": "unused-bytes"
    });

    const result = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.file.name).toBe("morpho-delivery-a1-output-2026-07-02.zip");
    expect(blobStore.getCalls).toEqual(["storage:asset-hero"]);
    expect(blobStore.putCalls).toEqual([]);
    expect(blobStore.deleteCalls).toEqual([]);

    const files = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "README.md",
      "asset-index.md",
      "assets/asset-hero--night-beacon.png",
      "captions-and-copy.md",
      "delivery-outline.md",
      "gaps-and-next-steps.md",
      "output-manifest.json",
      "source-map.json"
    ]);
    expect(strFromU8(files["assets/asset-hero--night-beacon.png"])).toBe("hero-bytes");
    expect(strFromU8(files["output-manifest.json"])).toContain("\"format\": \"morpho-delivery-output\"");
    expect(strFromU8(files["source-map.json"])).toContain("assets/asset-hero--night-beacon.png");
    expect(strFromU8(files["asset-index.md"])).toContain("已打包");
    expect(strFromU8(files["README.md"])).toContain("此包不是项目归档");
    expect(files["assets/asset-unused--unused.png"]).toBeUndefined();
  });

  it("exports with missing binaries honestly and does not create empty asset files", async () => {
    const workspace = createClientFixtureWorkspace();
    const blobStore = new TrackingBlobStore({});

    const result = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.summary.missingOrMismatchedAssets).toBe(1);
    const files = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(files["assets/asset-hero--night-beacon.png"]).toBeUndefined();
    expect(strFromU8(files["asset-index.md"])).toContain("缺失本地文件");
    expect(strFromU8(files["README.md"])).toContain("缺失素材没有伪造为空文件");
  });

  it("marks size mismatches while embedding the real readable blob", async () => {
    const workspace = createClientFixtureWorkspace();
    const blobStore = new TrackingBlobStore({
      "storage:asset-hero": "changed-size"
    });

    const result = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    const files = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(strFromU8(files["assets/asset-hero--night-beacon.png"])).toBe("changed-size");
    expect(strFromU8(files["asset-index.md"])).toContain("文件大小异常");
    expect(strFromU8(files["source-map.json"])).toContain("sizeMismatch");
  });

  it("does not request blobs for link-only and text-only output", async () => {
    const workspace = createClientFixtureWorkspace({ textOnly: true });
    const blobStore = new TrackingBlobStore({});

    const result = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore
    });

    expect(result.status).toBe("ok");
    expect(blobStore.getCalls).toEqual([]);
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    const files = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(Object.keys(files).some((path) => path.startsWith("assets/"))).toBe(false);
  });

  it("blocks structurally invalid delivery packages and returns zip failures as readable results", async () => {
    const workspace = createClientFixtureWorkspace({ noSections: true });
    const blocked = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore: new TrackingBlobStore({})
    });

    expect(blocked.status).toBe("blocked");

    const zipFailure = await exportDeliveryOutputPackage(createClientFixtureWorkspace(), {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore: new TrackingBlobStore({ "storage:asset-hero": "hero-bytes" }),
      zipSyncImpl: () => {
        throw new Error("zip failed");
      }
    });

    expect(zipFailure).toMatchObject({
      status: "failed",
      reason: "zip failed"
    });
  });

  it("downloads and revokes the generated object url", async () => {
    const workspace = createClientFixtureWorkspace();
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const appended: unknown[] = [];
    const clicked: unknown[] = [];
    const removed: unknown[] = [];
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: () => clicked.push(anchor),
      remove: () => removed.push(anchor)
    };
    vi.stubGlobal("document", {
      body: {
        append: (node: unknown) => appended.push(node)
      },
      createElement: () => anchor
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        const url = `blob:test-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url);
      }
    });

    const result = await exportDeliveryOutputPackage(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW,
      blobStore: new TrackingBlobStore({ "storage:asset-hero": "hero-bytes" }),
      download: true
    });

    expect(result.status).toBe("ok");
    expect(appended).toEqual([anchor]);
    expect(clicked).toEqual([anchor]);
    expect(removed).toEqual([anchor]);
    expect(createdUrls).toEqual(["blob:test-1"]);
    expect(revokedUrls).toEqual(["blob:test-1"]);

    vi.unstubAllGlobals();
  });
});

function createClientFixtureWorkspace(options: { textOnly?: boolean; noSections?: boolean } = {}): MorphoWorkspace {
  const base = createBlankWorkspace("project-delivery-client");
  const heroAsset = asset("asset-hero", "night beacon.png", "image/png", "originalImage", "storage:asset-hero", 10);
  const unusedAsset = asset("asset-unused", "unused.png", "image/png", "originalImage", "storage:asset-unused", 12);
  const section = {
    id: "section-a-1",
    title: "Main section",
    purpose: "Prepare the main board.",
    order: 0,
    referenceIds: options.textOnly ? ["ref-text"] : ["ref-hero", "ref-text"],
    narrative: "Confirmed copy",
    createdAt: NOW,
    updatedAt: NOW
  };

  return {
    ...base,
    project: {
      ...base.project,
      title: "Client Fixture",
      subtitle: "Delivery output client"
    },
    assets: {
      [heroAsset.id]: heroAsset,
      [unusedAsset.id]: unusedAsset
    },
    objects: {
      ...base.objects,
      "image-hero": {
        id: "image-hero",
        type: "image",
        title: "Hero",
        summary: "Hero image",
        createdBy: "ai",
        visibility: "active",
        role: "primaryVisual",
        assetId: "asset-hero",
        createdAt: NOW,
        updatedAt: NOW
      },
      "text-note": {
        id: "text-note",
        type: "text",
        title: "Copy note",
        summary: "Copy only",
        createdBy: "user",
        visibility: "active",
        body: "No binary needed",
        createdAt: NOW,
        updatedAt: NOW
      },
      "delivery-a": {
        id: "delivery-a",
        type: "delivery",
        title: "A1 Output",
        summary: "Client output package",
        createdBy: "user",
        visibility: "active",
        format: "board",
        sections: options.noSections ? [] : [section],
        references: options.textOnly ? ["ref-text"] : ["ref-hero", "ref-text"],
        gaps: [
          {
            id: "gap-a",
            label: "Need one more diagram",
            sectionId: "section-a-1",
            status: "open",
            origin: "manual",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        createdAt: NOW,
        updatedAt: NOW
      }
    },
    deliveryReferences: {
      "ref-hero": {
        id: "ref-hero",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-1",
        order: 0,
        sourceObjectId: "image-hero",
        sourceAssetId: "asset-hero",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "image",
          title: "Hero stable snapshot",
          summary: "Frozen hero",
          previewAsset: { assetId: "asset-hero", alt: "Hero" }
        },
        editorial: {
          caption: "Hero caption"
        }
      },
      "ref-text": {
        id: "ref-text",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-1",
        order: 1,
        sourceObjectId: "text-note",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "text",
          title: "Text stable snapshot",
          body: "No binary needed",
          bodyKind: "complete"
        }
      }
    }
  };
}

class TrackingBlobStore implements BlobStore {
  readonly getCalls: string[] = [];
  readonly putCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  private readonly blobs = new Map<string, Blob>();

  constructor(initial: Record<string, string>) {
    for (const [storageKey, content] of Object.entries(initial)) {
      this.blobs.set(storageKey, new Blob([content]));
    }
  }

  async get(storageKey: string) {
    this.getCalls.push(storageKey);
    return this.blobs.get(storageKey) ?? null;
  }

  async put(storageKey: string, blob: Blob) {
    this.putCalls.push(storageKey);
    this.blobs.set(storageKey, blob);
  }

  async delete(storageKey: string) {
    this.deleteCalls.push(storageKey);
    this.blobs.delete(storageKey);
  }
}

function asset(
  id: string,
  fileName: string,
  mimeType: string,
  sourceType: AssetRecord["sourceType"],
  storageKey: string,
  size: number
): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    sourceType,
    storageKey,
    size,
    createdAt: NOW
  };
}
