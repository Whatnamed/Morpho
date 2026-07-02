import { unzipSync, strFromU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";

import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import { CATALOG_STORAGE_KEY, getProjectWorkspaceStorageKey, loadProjectWorkspace } from "@/infrastructure/persistence/localProjectStore";
import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";

import {
  exportEditableProjectBackupBundle,
  exportHumanReadableArchiveBundle,
  inspectEditableProjectBackupBundle,
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

  test("inspects an editable backup and does not write blobs, workspace, or catalog", async () => {
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
      throw new Error("backup export should be ready for inspect assertions");
    }

    const inspected = await inspectEditableProjectBackupBundle(exported.file);

    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for assertions");
    }

    expect(inspected.preview.sourceProjectTitle).toBe("Night Study");
    expect(inspected.preview.createdAt).toBe(NOW);
    expect(inspected.preview.chat).toBe("full");
    expect(inspected.preview.projectContinuity).toBe("current");
    expect(inspected.preview.assets.total).toBe(3);
    expect(inspected.preview.assets.embedded).toBe(2);
    expect(inspected.preview.assets.referenceOnly).toBe(1);
    expect(inspected.preview.assets.missing).toBe(0);
    expect(inspected.preview.assets.sizeMismatch).toBe(0);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-restored"))).toBeNull();
    expect(await blobStore.get("blob:project-restored:asset-cover")).toBeNull();
  });

  test("restores an editable backup only after confirm-stage restore receives an inspected backup", async () => {
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

    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for restore assertions");
    }

    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();

    const restored = await restoreEditableProjectBackupBundle(inspected, {
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

  test("fails backup inspection safely for unreadable and non-backup zip inputs", async () => {
    const invalidBytes = new File([new Uint8Array([1, 2, 3, 4])], "broken.zip", { type: "application/zip" });
    await expect(inspectEditableProjectBackupBundle(invalidBytes)).resolves.toMatchObject({
      status: "failed",
      reason: "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。"
    });

    const missingBundle = new File([zipSync({ "backup-manifest.json": new TextEncoder().encode("{}") })], "missing-bundle.zip", {
      type: "application/zip"
    });
    await expect(inspectEditableProjectBackupBundle(missingBundle)).resolves.toMatchObject({
      status: "failed"
    });

    const missingManifest = new File(
      [
        zipSync({
          "bundle.json": new TextEncoder().encode(
            JSON.stringify({
              format: "morpho-project-bundle",
              bundleVersion: "1",
              packageKind: "editableBackup",
              createdAt: NOW,
              manifestPath: "backup-manifest.json",
              files: [{ path: "bundle.json", kind: "metadata", required: true }],
              diagnostics: []
            })
          )
        })
      ],
      "missing-manifest.zip",
      { type: "application/zip" }
    );
    await expect(inspectEditableProjectBackupBundle(missingManifest)).resolves.toMatchObject({
      status: "failed"
    });

    const malformedJson = new File(
      [
        zipSync({
          "bundle.json": new TextEncoder().encode("{not-json"),
          "backup-manifest.json": new TextEncoder().encode("{}")
        })
      ],
      "malformed.zip",
      { type: "application/zip" }
    );
    await expect(inspectEditableProjectBackupBundle(malformedJson)).resolves.toMatchObject({
      status: "failed"
    });

    const archive = await exportHumanReadableArchiveBundle(createBundleFixtureWorkspace(), {
      blobStore: new MemoryBlobStore({ "blob:asset-cover": "cover-bytes" }),
      createdAt: NOW
    });
    expect(archive.status).toBe("ok");
    if (archive.status !== "ok") {
      throw new Error("archive export should be ready for restore rejection assertions");
    }
    await expect(inspectEditableProjectBackupBundle(archive.file)).resolves.toMatchObject({
      status: "failed"
    });
  });

  test("restores the same inspected backup twice with distinct project ids and runtime storage keys", async () => {
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
      throw new Error("backup export should be ready for repeat restore assertions");
    }
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for repeat restore assertions");
    }

    const ids = ["project-restored-a", "project-restored-b"];
    const first = await restoreEditableProjectBackupBundle(inspected, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => ids.shift() ?? "project-restored-extra",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });
    const second = await restoreEditableProjectBackupBundle(inspected, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => ids.shift() ?? "project-restored-extra",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") {
      throw new Error("repeat restore should be ready for assertions");
    }
    expect(first.projectId).not.toBe(second.projectId);
    expect(first.workspace.assets["asset-cover"]?.storageKey).not.toBe(second.workspace.assets["asset-cover"]?.storageKey);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toContain(first.projectId);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toContain(second.projectId);
    expect(storage.getItem(getProjectWorkspaceStorageKey(workspace.project.id))).toBeNull();
  });

  test("retries project id collisions before any restore blob write and fails after the retry limit", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes",
      "blob:asset-brief": "brief-bytes"
    });
    const storage = createMemoryStorage();
    storage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        recentProjectId: "project-existing",
        projects: [
          {
            id: "project-existing",
            title: "Existing",
            subtitle: "",
            lastOpenedAt: NOW,
            updatedAt: NOW
          }
        ]
      })
    );
    storage.setItem(getProjectWorkspaceStorageKey("project-workspace-key-exists"), "{}");
    const exported = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW,
      chat: "full",
      projectContinuity: "current"
    });
    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") {
      throw new Error("backup export should be ready for collision assertions");
    }
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for collision assertions");
    }

    const collisionIds = [
      workspace.project.id,
      "project-existing",
      "project-workspace-key-exists",
      "project-safe"
    ];
    const restored = await restoreEditableProjectBackupBundle(inspected, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => collisionIds.shift() ?? "project-safe",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") {
      throw new Error("restore should retry collisions before assertions");
    }
    expect(restored.projectId).toBe("project-safe");
    expect(await blobStore.get("blob:project-night-study:asset-cover")).toBeNull();
    expect(await blobStore.get("blob:project-existing:asset-cover")).toBeNull();
    expect(await blobStore.get("blob:project-workspace-key-exists:asset-cover")).toBeNull();

    const alwaysCollidingBlobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes",
      "blob:asset-brief": "brief-bytes"
    });
    const failed = await restoreEditableProjectBackupBundle(inspected, {
      blobStore: alwaysCollidingBlobStore,
      storage,
      now: () => NOW,
      createProjectId: () => workspace.project.id,
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(failed.status).toBe("failed");
    if (failed.status === "failed") {
      expect(failed.diagnostics.some((diagnostic) => diagnostic.code === "restore_project_id_collision")).toBe(true);
    }
    expect(await alwaysCollidingBlobStore.get(`blob:${workspace.project.id}:asset-cover`)).toBeNull();
  });

  test("revalidates inspected backup chat scope before restore writes", async () => {
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
      throw new Error("backup export should be ready for revalidation assertions");
    }
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for revalidation assertions");
    }

    const tampered = structuredClone(inspected);
    tampered.backup.manifest.options.chat = "none";

    const restored = await restoreEditableProjectBackupBundle(tampered, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-tampered-scope",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("failed");
    if (restored.status === "failed") {
      expect(restored.reason).toBe("备份包在恢复前验证失败。");
      expect(restored.diagnostics.some((diagnostic) => diagnostic.code === "backup_chat_scope_mismatch")).toBe(true);
    }
    expect(await blobStore.get("blob:project-tampered-scope:asset-cover")).toBeNull();
    expect(await blobStore.get("blob:project-tampered-scope:asset-brief")).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-tampered-scope"))).toBeNull();
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
  });

  test("revalidates inspected backup bundle files before restore writes", async () => {
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
      throw new Error("backup export should be ready for bundle revalidation assertions");
    }
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for bundle revalidation assertions");
    }

    const tampered = structuredClone(inspected);
    tampered.backup.files["unexpected.txt"] = new TextEncoder().encode("not declared");

    const restored = await restoreEditableProjectBackupBundle(tampered, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-tampered-files",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("failed");
    if (restored.status === "failed") {
      expect(restored.reason).toBe("备份包在恢复前验证失败。");
      expect(restored.diagnostics.some((diagnostic) => diagnostic.code === "bundle_file_unexpected")).toBe(true);
    }
    expect(await blobStore.get("blob:project-tampered-files:asset-cover")).toBeNull();
    expect(await blobStore.get("blob:project-tampered-files:asset-brief")).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-tampered-files"))).toBeNull();
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
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

    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") {
      throw new Error("backup inspection should be ready for failure assertions");
    }

    const restored = await restoreEditableProjectBackupBundle(inspected, {
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
