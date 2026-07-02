import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, test } from "vitest";

import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import { CATALOG_STORAGE_KEY, getProjectWorkspaceStorageKey, loadProjectWorkspace } from "@/infrastructure/persistence/localProjectStore";
import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";

import {
  exportEditableProjectBackupBundle,
  exportHumanReadableArchiveBundle,
  restoreEditableProjectBackupBundle
} from "./projectBundleClient";

const NOW = "2026-07-02T13:00:00.000Z";

describe("project bundle client", () => {
  test("exports a human-readable archive zip with markdown, manifest, and available assets", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes"
    });

    const result = await exportHumanReadableArchiveBundle(workspace, {
      blobStore,
      createdAt: NOW
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("archive export should be ready for assertions");
    }

    expect(result.file.name).toBe("morpho-archive-night-study-2026-07-02.zip");
    const files = unzipSync(new Uint8Array(await result.file.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "README.md",
      "archive-manifest.json",
      "asset-index.md",
      "assets/asset-cover",
      "bundle.json",
      "decisions-and-process.md",
      "delivery-preparation.md",
      "directions-and-visuals.md",
      "project-overview.md",
      "research-and-sources.md"
    ]);
    expect(strFromU8(files["README.md"])).toContain("Night Study");
    expect(strFromU8(files["README.md"])).toContain("不能用于恢复");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "asset_binary_missing")).toBe(true);
  });

  test("blocks editable backup export when a required local binary is missing", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes"
    });

    const result = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "asset_binary_missing")).toBe(true);
    }
  });

  test("restores an editable backup into a new project copy with fresh runtime storage keys", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes",
      "blob:asset-brief": "brief-bytes"
    });
    const storage = createMemoryStorage();

    const exported = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW,
      chat: "full",
      projectContinuity: "current"
    });

    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") {
      throw new Error("backup export should be ready for restore assertions");
    }

    const restored = await restoreEditableProjectBackupBundle(exported.file, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-restored",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") {
      throw new Error("restore should be ready for assertions");
    }

    expect(restored.projectId).toBe("project-restored");
    expect(restored.workspace.project.title).toBe("Night Study（恢复副本）");
    expect(restored.workspace.assets["asset-cover"]?.storageKey).toBe("blob:project-restored:asset-cover");
    expect(restored.workspace.assets["asset-brief"]?.storageKey).toBe("blob:project-restored:asset-brief");
    expect(restored.workspace.assets["asset-link"]?.storageKey).toBe("blob:project-restored:asset-link");
    expect(await blobStore.get("blob:project-restored:asset-cover")).toBeInstanceOf(Blob);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toContain("project-restored");
    expect(loadProjectWorkspace(storage, "project-restored")).toMatchObject({ status: "ok" });
    expect(storage.getItem(getProjectWorkspaceStorageKey(workspace.project.id))).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-nightrail"))).toBeNull();
  });

  test("cleans up newly written blobs and does not persist a project when restore persistence fails", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes",
      "blob:asset-brief": "brief-bytes"
    });
    const storage = createMemoryStorage(CATALOG_STORAGE_KEY);

    const exported = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW,
      chat: "full",
      projectContinuity: "current"
    });

    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") {
      throw new Error("backup export should be ready for failure assertions");
    }

    const restored = await restoreEditableProjectBackupBundle(exported.file, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-failed",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("failed");
    expect(await blobStore.get("blob:project-failed:asset-cover")).toBeNull();
    expect(await blobStore.get("blob:project-failed:asset-brief")).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-failed"))).toBeNull();
  });
});

function createBundleFixtureWorkspace(): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-night-study");
  const coverAsset = asset("asset-cover", "cover.png", "image/png", "originalImage", "blob:asset-cover", 11);
  const briefAsset = asset("asset-brief", "brief.pdf", "application/pdf", "originalFile", "blob:asset-brief", 11);
  const linkAsset: AssetRecord = {
    ...asset("asset-link", "source.url", "text/uri-list", "originalLink", "blob:asset-link", 0),
    url: "https://example.com/night-study",
    domain: "example.com"
  };

  return {
    ...workspace,
    project: {
      ...workspace.project,
      title: "Night Study",
      subtitle: "Bundle export fixture",
      coverAssetId: coverAsset.id
    },
    assets: {
      [coverAsset.id]: coverAsset,
      [briefAsset.id]: briefAsset,
      [linkAsset.id]: linkAsset
    },
    ai: {
      messages: [
        { id: "msg-1", role: "user", body: "Keep the warmer direction.", createdAt: NOW },
        { id: "msg-2", role: "assistant", body: "Recorded for the project.", createdAt: NOW }
      ],
      conversationCheckpoints: [],
      comparisonAnalyses: {}
    },
    projectContinuity: {
      ...workspace.projectContinuity,
      recordEntries: [
        {
          id: "continuity-1",
          dedupeKey: "direction-choice",
          origin: "deterministicEvent",
          manualState: "active",
          stage: "directionAndVisual",
          category: "decision",
          summary: "Keep the warmer route",
          sourceRefs: [],
          createdAt: NOW,
          updatedAt: NOW,
          validity: "current"
        }
      ],
      updatedAt: NOW
    }
  };
}

class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Blob>();

  constructor(initial: Record<string, string>) {
    for (const [storageKey, value] of Object.entries(initial)) {
      this.blobs.set(storageKey, new Blob([value]));
    }
  }

  async put(storageKey: string, blob: Blob) {
    this.blobs.set(storageKey, blob);
  }

  async get(storageKey: string) {
    return this.blobs.get(storageKey) ?? null;
  }

  async delete(storageKey: string) {
    this.blobs.delete(storageKey);
  }
}

function createMemoryStorage(failingKey?: string): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      if (key === failingKey) {
        throw new Error(`blocked write for ${key}`);
      }
      values.set(key, value);
    }
  };
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
    size,
    createdAt: NOW,
    storageKey,
    sourceType
  };
}
