import { unzipSync, strFromU8, zipSync } from "fflate";
import { describe, expect, test, vi } from "vitest";

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

  test("bundles above the sync-zip threshold export through the async path and stay inspectable", async () => {
    const workspace = createBundleFixtureWorkspace();
    // Push the bundle input past SYNC_ZIP_MAX_INPUT_BYTES (2 MiB) so the export
    // takes the async Worker zip path; the asset record's size must match the
    // actual blob for "embedded" availability. Pseudo-random bytes keep the
    // compression ratio near 1:1 — all-zero padding would trip the restore-side
    // zip-bomb compression-ratio budget.
    const bigBytes = new Uint8Array(2 * 1024 * 1024 + 512 * 1024);
    let state = 0x5eed0000;
    for (let index = 0; index < bigBytes.length; index += 1) {
      // mulberry32-style mixing: taking low bits of a raw LCG cycles with a short
      // period and compresses like mad, which the zip-bomb budget rejects.
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      bigBytes[index] = (mixed ^ (mixed >>> 14)) & 0xff;
    }
    const blobStore = new MemoryBlobStore({ "blob:asset-brief": "brief-bytes" });
    await blobStore.put("blob:asset-cover", new Blob([bigBytes]));
    workspace.assets["asset-cover"]!.size = bigBytes.byteLength;

    const exported = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW,
      chat: "full",
      projectContinuity: "current"
    });

    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") {
      throw new Error("large-bundle export should be ready for inspection");
    }

    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    if (inspected.status !== "ok") {
      throw new Error(`large-bundle inspection failed: ${inspected.reason}`);
    }
    expect(inspected.status).toBe("ok");
    if (inspected.status === "ok") {
      expect(inspected.preview.assets.embedded).toBe(2);
      expect(inspected.preview.assets.missing).toBe(0);
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

  test("rejects a structurally declared but deeply malformed current backup during inspection", async () => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new MemoryBlobStore({
      "blob:asset-cover": "cover-bytes",
      "blob:asset-brief": "brief-bytes"
    });
    const exported = await exportEditableProjectBackupBundle(workspace, {
      blobStore,
      createdAt: NOW,
      chat: "full",
      projectContinuity: "current"
    });
    expect(exported.status).toBe("ok");
    if (exported.status !== "ok") throw new Error("Expected a valid backup fixture.");

    const files = unzipSync(new Uint8Array(await exported.file.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["backup-manifest.json"])) as Record<string, unknown>;
    const snapshot = manifest.workspaceSnapshot as { canvas: { view: { x: unknown } } };
    snapshot.canvas.view.x = "not-a-finite-number";
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    files["backup-manifest.json"] = manifestBytes;
    const envelope = JSON.parse(strFromU8(files["bundle.json"])) as {
      files: Array<{ path: string; byteLength?: number }>;
    };
    const descriptor = envelope.files.find((entry) => entry.path === "backup-manifest.json");
    if (!descriptor) throw new Error("Expected the backup manifest descriptor.");
    descriptor.byteLength = manifestBytes.byteLength;
    files["bundle.json"] = new TextEncoder().encode(JSON.stringify(envelope));
    const tamperedZip = new File([zipSync(files)], "tampered-current-backup.zip", {
      type: "application/zip"
    });

    const inspected = await inspectEditableProjectBackupBundle(tamperedZip);

    expect(inspected.status).toBe("failed");
    if (inspected.status === "failed") {
      expect(inspected.reason).toBe("无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。");
      expect(inspected.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_workspace_snapshot",
          path: "workspaceSnapshot.canvas.view.x"
        })
      ]));
    }
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

  test("rejects backup ZIP bombs and excessive entry counts before restore", async () => {
    const highRatio = new File([zipSync({
      "bundle.json": new TextEncoder().encode("0".repeat(3 * 1024 * 1024))
    })], "high-ratio.zip", { type: "application/zip" });
    await expect(inspectEditableProjectBackupBundle(highRatio)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("安全解压预算")
    });

    const tooManyEntries = Object.fromEntries(
      Array.from({ length: 4_097 }, (_value, index) => [
        index === 0 ? "bundle.json" : `extra-${index}.txt`,
        new Uint8Array()
      ])
    );
    await expect(inspectEditableProjectBackupBundle(new File(
      [zipSync(tooManyEntries)],
      "too-many.zip",
      { type: "application/zip" }
    ))).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("安全解压预算")
    });
  });

  test("rejects an oversized compressed backup before reading it into memory", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const oversized = {
      size: 128 * 1024 * 1024 + 1,
      arrayBuffer
    } as unknown as Blob;

    await expect(inspectEditableProjectBackupBundle(oversized)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("128 MiB")
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
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

  test.each([
    ["variant", "derivedFromDirection"],
    ["split", "splitFromDirection"],
    ["merge", "mergedFromDirection"],
    ["revision", "supersedesDirection"]
  ] as const)("restores legacy lineage alias %s and persists %s", async (alias, canonical) => {
    const workspace = createBundleFixtureWorkspace();
    addLineageProposal(workspace, "derivedFromDirection");
    const blobStore = new TrackingMemoryBlobStore({
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
    if (exported.status !== "ok") throw new Error("Expected a valid backup fixture.");

    const legacyFile = rewriteBackupManifest(exported.file, (snapshot) => {
      setLineageKind(snapshot, alias);
    });
    const inspected = await inspectEditableProjectBackupBundle(await legacyFile);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") throw new Error("Expected the legacy backup to pass inspection.");

    blobStore.putCalls.length = 0;
    const restored = await restoreEditableProjectBackupBundle(inspected, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => `project-legacy-${alias}`,
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") throw new Error("Expected the legacy backup to restore.");
    expect(lineageKindFromWorkspace(restored.workspace)).toBe(canonical);
    const persisted = loadProjectWorkspace(storage, `project-legacy-${alias}`);
    expect(persisted.status).toBe("ok");
    if (persisted.status === "ok") {
      expect(lineageKindFromWorkspace(persisted.workspace)).toBe(canonical);
    }
  });

  test("rejects a legacy lineage alias combined with another malformed required field before any restore write", async () => {
    const workspace = createBundleFixtureWorkspace();
    addLineageProposal(workspace, "derivedFromDirection");
    workspace.objects.delivery = {
      id: "delivery",
      type: "delivery",
      title: "Delivery",
      summary: "Restore validation fixture",
      createdBy: "user",
      visibility: "active",
      format: "board",
      sections: [{
        id: "hero",
        title: "Hero",
        order: 0,
        referenceIds: [],
        createdAt: NOW,
        updatedAt: NOW
      }],
      gaps: [],
      references: []
    };
    const blobStore = new TrackingMemoryBlobStore({
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
    if (exported.status !== "ok") throw new Error("Expected a valid backup fixture.");
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") throw new Error("Expected an inspected backup fixture.");

    const snapshot = inspected.backup.manifest.workspaceSnapshot as unknown as Record<string, unknown>;
    setLineageKind(snapshot, "split");
    const objects = snapshot.objects as Record<string, Record<string, unknown>>;
    const sections = objects.delivery.sections as Array<Record<string, unknown>>;
    delete sections[0]?.createdAt;
    blobStore.putCalls.length = 0;

    const restored = await restoreEditableProjectBackupBundle(inspected, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-invalid-legacy",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("failed");
    if (restored.status === "failed") {
      expect(restored.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_workspace_snapshot",
          path: "workspaceSnapshot.objects.delivery.sections.0.createdAt"
        })
      ]));
    }
    expect(blobStore.putCalls).toEqual([]);
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-invalid-legacy"))).toBeNull();
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
  });

  test.each([
    {
      label: "nested object container",
      tamper: (snapshot: Record<string, unknown>) => {
        snapshot.objects = [];
      },
      expectedPath: "workspaceSnapshot"
    },
    {
      label: "critical canvas reference",
      tamper: (snapshot: Record<string, unknown>) => {
        const canvas = snapshot.canvas as { instances: unknown[] };
        canvas.instances.push({
          id: "canvas-missing",
          objectId: "missing-object",
          position: { x: 0, y: 0 },
          size: { w: 100, h: 100 }
        });
      },
      expectedPath: expect.stringMatching(/workspaceSnapshot\.canvas\.instances\.\d+\.objectId/)
    },
    {
      label: "non-finite canvas geometry",
      tamper: (snapshot: Record<string, unknown>) => {
        const canvas = snapshot.canvas as { view: { x: number } };
        canvas.view.x = Number.POSITIVE_INFINITY;
      },
      expectedPath: "workspaceSnapshot.canvas.view.x"
    },
    {
      label: "incomplete required object variant",
      tamper: (snapshot: Record<string, unknown>) => {
        const objects = snapshot.objects as Record<string, unknown>;
        objects.delivery = {
          id: "delivery",
          type: "delivery",
          title: "Delivery",
          summary: "Malformed required section metadata",
          createdBy: "user",
          visibility: "active",
          format: "board",
          sections: [{
            id: "hero",
            title: "Hero",
            order: 0,
            referenceIds: [],
            updatedAt: NOW
          }],
          gaps: [],
          references: []
        };
      },
      expectedPath: "workspaceSnapshot.objects.delivery.sections.0.createdAt"
    }
  ])("revalidates a tampered current backup $label before any restore write", async ({ tamper, expectedPath }) => {
    const workspace = createBundleFixtureWorkspace();
    const blobStore = new TrackingMemoryBlobStore({
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
    if (exported.status !== "ok") throw new Error("Expected a valid backup fixture.");
    const inspected = await inspectEditableProjectBackupBundle(exported.file);
    expect(inspected.status).toBe("ok");
    if (inspected.status !== "ok") throw new Error("Expected an inspected backup fixture.");

    const tampered = structuredClone(inspected);
    tamper(tampered.backup.manifest.workspaceSnapshot as unknown as Record<string, unknown>);
    blobStore.putCalls.length = 0;
    const catalogBefore = storage.getItem(CATALOG_STORAGE_KEY);

    const restored = await restoreEditableProjectBackupBundle(tampered, {
      blobStore,
      storage,
      now: () => NOW,
      createProjectId: () => "project-invalid-deep",
      createRuntimeStorageKey: (assetId, projectId) => `blob:${projectId}:${assetId}`
    });

    expect(restored.status).toBe("failed");
    if (restored.status === "failed") {
      expect(restored.reason).toBe("备份包在恢复前验证失败。");
      expect(restored.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "invalid_workspace_snapshot", path: expectedPath })
      ]));
    }
    expect(blobStore.putCalls).toEqual([]);
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-invalid-deep"))).toBeNull();
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBe(catalogBefore);
    expect(storage.getItem(getProjectWorkspaceStorageKey(workspace.project.id))).toBeNull();
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
      ...workspace.ai,
      messages: [
        { id: "msg-1", role: "user", body: "Keep the warmer direction.", createdAt: NOW },
        { id: "msg-2", role: "assistant", body: "Recorded for the project.", createdAt: NOW }
      ],
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

function addLineageProposal(
  workspace: MorphoWorkspace,
  lineageKind: "derivedFromDirection" | "splitFromDirection" | "mergedFromDirection" | "supersedesDirection"
): void {
  workspace.artifactProposals["legacy-lineage"] = {
    id: "legacy-lineage",
    type: "conceptDirection",
    status: "pending",
    sourceSnapshots: [],
    sourceObjectIds: [],
    citationIds: [],
    createdAt: NOW,
    title: "Legacy direction proposal",
    summary: "Compatibility fixture",
    applicationMode: "create",
    parentDirectionIds: [],
    directions: [{
      title: "Legacy direction",
      summary: "Compatibility fixture",
      conceptStatement: "Preserve a retired lineage value.",
      keywords: [],
      strategy: "Restore without widening validation.",
      differentiators: [],
      visualSignals: [],
      risks: [],
      openQuestions: [],
      lineageKind
    }]
  };
}

async function rewriteBackupManifest(
  file: File,
  rewrite: (snapshot: Record<string, unknown>) => void
): Promise<File> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files["backup-manifest.json"])) as Record<string, unknown>;
  rewrite(manifest.workspaceSnapshot as Record<string, unknown>);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  files["backup-manifest.json"] = manifestBytes;
  const envelope = JSON.parse(strFromU8(files["bundle.json"])) as {
    files: Array<{ path: string; byteLength?: number }>;
  };
  const descriptor = envelope.files.find((entry) => entry.path === "backup-manifest.json");
  if (!descriptor) throw new Error("Expected the backup manifest descriptor.");
  descriptor.byteLength = manifestBytes.byteLength;
  files["bundle.json"] = new TextEncoder().encode(JSON.stringify(envelope));
  return new File([zipSync(files)], "legacy-lineage-backup.zip", { type: "application/zip" });
}

function setLineageKind(snapshot: Record<string, unknown>, lineageKind: string): void {
  const proposals = snapshot.artifactProposals as Record<string, Record<string, unknown>>;
  const directions = proposals["legacy-lineage"].directions as Array<Record<string, unknown>>;
  if (!directions[0]) throw new Error("Expected a lineage proposal direction.");
  directions[0].lineageKind = lineageKind;
}

function lineageKindFromWorkspace(workspace: MorphoWorkspace): unknown {
  const proposal = workspace.artifactProposals["legacy-lineage"];
  return proposal?.type === "conceptDirection" ? proposal.directions[0]?.lineageKind : undefined;
}

class TrackingMemoryBlobStore extends MemoryBlobStore {
  readonly putCalls: string[] = [];

  override async put(storageKey: string, blob: Blob) {
    this.putCalls.push(storageKey);
    await super.put(storageKey, blob);
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
