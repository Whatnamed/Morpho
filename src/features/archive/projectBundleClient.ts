import { strFromU8, unzipSync, zipSync } from "fflate";

import {
  createEditableProjectBackupManifest,
  createHumanReadableArchiveManifest,
  type EditableBackupOptions,
  type ProjectArchiveDiagnostic
} from "@/domain/morpho/projectArchive";
import {
  createEditableProjectBackupBundle,
  createHumanReadableArchiveBundle,
  planEditableProjectBackupRestore,
  validateEditableProjectBackupBundle,
  type BuiltProjectBundle,
  type BundleCreationResult,
  type ProjectBundleDiagnostic,
  type ProjectBundleResolvedAsset
} from "@/domain/morpho/projectBundles";
import type { AssetId, AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import {
  createCatalog,
  deleteProjectWorkspace,
  loadLocalProjectCatalogSnapshot,
  summarizeProject,
  writeCatalog,
  writeProjectWorkspace,
  type LocalProjectCatalog
} from "@/infrastructure/persistence/localProjectStore";

type ExportArchiveOptions = {
  blobStore: BlobStore;
  createdAt?: string;
  chat?: "none" | "decisionSummary" | "full";
  projectContinuity?: "none" | "current";
};

type ExportBackupOptions = {
  blobStore: BlobStore;
  createdAt?: string;
  chat?: EditableBackupOptions["chat"];
  projectContinuity?: EditableBackupOptions["projectContinuity"];
};

type RestoreBackupOptions = {
  blobStore: BlobStore;
  storage: Storage;
  now?: () => string;
  createProjectId?: () => string;
  createRuntimeStorageKey?: (assetId: AssetId, projectId: string) => string;
};

type ExportResult =
  | {
      status: "ok";
      file: File;
      diagnostics: ProjectBundleDiagnostic[];
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: Array<ProjectArchiveDiagnostic | ProjectBundleDiagnostic>;
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

type RestoreResult =
  | {
      status: "ok";
      projectId: string;
      workspace: MorphoWorkspace;
      diagnostics: ProjectBundleDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

export async function exportHumanReadableArchiveBundle(
  workspace: MorphoWorkspace,
  options: ExportArchiveOptions
): Promise<ExportResult> {
  const archive = createHumanReadableArchiveManifest(workspace, {
    createdAt: options.createdAt,
    chat: options.chat,
    projectContinuity: options.projectContinuity
  });

  if (archive.status !== "ok") {
    return {
      status: "failed",
      reason: "Human-readable archive manifest creation failed.",
      diagnostics: archive.diagnostics
    };
  }

  const resolvedAssets = await resolveBundleAssets(workspace, archive.manifest.assetInventory.entries, options.blobStore);
  const bundle = createHumanReadableArchiveBundle(archive.manifest, resolvedAssets);
  return {
    status: "ok",
    file: bundleToZipFile(bundle),
    diagnostics: bundle.diagnostics
  };
}

export async function exportEditableProjectBackupBundle(
  workspace: MorphoWorkspace,
  options: ExportBackupOptions
): Promise<ExportResult> {
  const backup = createEditableProjectBackupManifest(workspace, {
    createdAt: options.createdAt,
    chat: options.chat,
    projectContinuity: options.projectContinuity
  });

  if (backup.status === "blocked") {
    return {
      status: "blocked",
      reason: backup.reason,
      diagnostics: backup.diagnostics
    };
  }

  const resolvedAssets = await resolveBundleAssets(workspace, backup.manifest.assetInventory.entries, options.blobStore);
  const bundle = createEditableProjectBackupBundle(backup.manifest, resolvedAssets);
  if (bundle.status === "blocked") {
    return {
      status: "blocked",
      reason: bundle.reason,
      diagnostics: bundle.diagnostics
    };
  }

  return {
    status: "ok",
    file: bundleToZipFile(bundle.bundle),
    diagnostics: bundle.diagnostics
  };
}

export async function restoreEditableProjectBackupBundle(file: File | Blob, options: RestoreBackupOptions): Promise<RestoreResult> {
  const zipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const bundleValue = parseJsonFile(zipped["bundle.json"]);
  const manifestPath = resolveManifestPath(bundleValue);
  const manifestValue = manifestPath ? parseJsonFile(zipped[manifestPath]) : undefined;
  const validation = validateEditableProjectBackupBundle({
    bundle: bundleValue,
    manifest: manifestValue,
    files: zipped
  });

  if (validation.status !== "ok") {
    return {
      status: "failed",
      reason: validation.reason,
      diagnostics: validation.diagnostics
    };
  }

  const catalogSnapshot = loadLocalProjectCatalogSnapshot(options.storage);
  if (catalogSnapshot.status === "failed") {
    return {
      status: "failed",
      reason: catalogSnapshot.reason,
      diagnostics: validation.diagnostics
    };
  }

  const restoredAt = options.now?.() ?? new Date().toISOString();
  const projectId = options.createProjectId?.() ?? createProjectId();
  const baseCatalog =
    catalogSnapshot.status === "ok"
      ? catalogSnapshot.catalog
      : {
          schemaVersion: 1 as const,
          recentProjectId: undefined,
          projects: []
        };
  const projectTitle = nextRestoredProjectTitle(validation.manifest.sourceProject.title, baseCatalog);
  const createRuntimeStorageKey =
    options.createRuntimeStorageKey ?? ((assetId: AssetId, restoredProjectId: string) => `blob:${restoredProjectId}:${assetId}`);

  const plan = planEditableProjectBackupRestore(validation.manifest, validation.files, {
    restoredAt,
    projectId,
    projectTitle,
    createRuntimeStorageKey: (assetId) => createRuntimeStorageKey(assetId, projectId)
  });

  if (plan.status !== "ok") {
    return {
      status: "failed",
      reason: plan.reason,
      diagnostics: plan.diagnostics
    };
  }

  const writtenBlobKeys: string[] = [];
  try {
    for (const assetWrite of plan.assetWrites) {
      await options.blobStore.put(assetWrite.storageKey, new Blob([new Uint8Array(assetWrite.bytes)], { type: assetWrite.mimeType }));
      writtenBlobKeys.push(assetWrite.storageKey);
    }
  } catch (error) {
    await cleanupWrittenBlobs(options.blobStore, writtenBlobKeys);
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Backup restore failed while writing asset blobs.",
      diagnostics: validation.diagnostics
    };
  }

  const workspaceWrite = writeProjectWorkspace(options.storage, plan.workspace);
  if (workspaceWrite.status !== "ok") {
    await cleanupWrittenBlobs(options.blobStore, writtenBlobKeys);
    deleteProjectWorkspace(options.storage, projectId);
    return {
      status: "failed",
      reason: workspaceWrite.reason,
      diagnostics: validation.diagnostics
    };
  }

  const nextCatalog = upsertCatalogProject(baseCatalog, plan.workspace);
  const catalogWrite = writeCatalog(options.storage, nextCatalog);
  if (catalogWrite.status !== "ok") {
    deleteProjectWorkspace(options.storage, projectId);
    await cleanupWrittenBlobs(options.blobStore, writtenBlobKeys);
    return {
      status: "failed",
      reason: catalogWrite.reason,
      diagnostics: validation.diagnostics
    };
  }

  return {
    status: "ok",
    projectId,
    workspace: plan.workspace,
    diagnostics: validation.diagnostics
  };
}

export function downloadProjectBundleFile(file: File | Blob, fileName?: string): void {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName ?? (file instanceof File ? file.name : "morpho-project-bundle.zip");
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function resolveBundleAssets(
  workspace: MorphoWorkspace,
  entries: Array<{
    sourceAssetId: AssetId;
    portableBundleKey: string;
    fileName: string;
    mimeType: string;
    size: number;
    sourceType: AssetRecord["sourceType"];
  }>,
  blobStore: BlobStore
): Promise<ProjectBundleResolvedAsset[]> {
  const resolved: ProjectBundleResolvedAsset[] = [];
  for (const entry of entries) {
    const runtimeAsset = workspace.assets[entry.sourceAssetId];
    if (entry.sourceType === "originalLink") {
      resolved.push({
        sourceAssetId: entry.sourceAssetId,
        portableBundleKey: entry.portableBundleKey,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sourceType: entry.sourceType,
        expectedByteLength: entry.size,
        availability: "referenceOnly",
        required: false
      });
      continue;
    }

    if (!runtimeAsset?.storageKey) {
      resolved.push(missingResolvedAsset(entry));
      continue;
    }

    try {
      const blob = await blobStore.get(runtimeAsset.storageKey);
      if (!blob) {
        resolved.push(missingResolvedAsset(entry));
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      resolved.push({
        sourceAssetId: entry.sourceAssetId,
        portableBundleKey: entry.portableBundleKey,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sourceType: entry.sourceType,
        expectedByteLength: entry.size,
        actualByteLength: bytes.byteLength,
        availability: bytes.byteLength === entry.size ? "embedded" : "sizeMismatch",
        required: true,
        bytes
      });
    } catch {
      resolved.push(missingResolvedAsset(entry));
    }
  }
  return resolved;
}

function missingResolvedAsset(entry: {
  sourceAssetId: AssetId;
  portableBundleKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: AssetRecord["sourceType"];
}): ProjectBundleResolvedAsset {
  return {
    sourceAssetId: entry.sourceAssetId,
    portableBundleKey: entry.portableBundleKey,
    fileName: entry.fileName,
    mimeType: entry.mimeType,
    sourceType: entry.sourceType,
    expectedByteLength: entry.size,
    availability: "missingRequiredBinary",
    required: true
  };
}

function bundleToZipFile(bundle: BuiltProjectBundle): File {
  const zipped = zipSync(Object.fromEntries(bundle.files.map((entry) => [entry.path, entry.bytes])));
  return new File([zipped], bundle.fileName, { type: "application/zip" });
}

function parseJsonFile(bytes: Uint8Array | undefined): unknown {
  if (!bytes) {
    return undefined;
  }
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

function resolveManifestPath(bundleValue: unknown): string | undefined {
  if (!bundleValue || typeof bundleValue !== "object" || Array.isArray(bundleValue)) {
    return undefined;
  }
  const manifestPath = (bundleValue as { manifestPath?: unknown }).manifestPath;
  return typeof manifestPath === "string" ? manifestPath : undefined;
}

function nextRestoredProjectTitle(sourceTitle: string, catalog: LocalProjectCatalog): string {
  const base = `${sourceTitle}（恢复副本）`;
  const titles = new Set(catalog.projects.map((project) => project.title));
  if (!titles.has(base)) {
    return base;
  }
  let index = 2;
  while (titles.has(`${sourceTitle}（恢复副本 ${index}）`)) {
    index += 1;
  }
  return `${sourceTitle}（恢复副本 ${index}）`;
}

function upsertCatalogProject(catalog: LocalProjectCatalog, workspace: MorphoWorkspace): LocalProjectCatalog {
  const summary = summarizeProject(workspace);
  return createCatalog([summary, ...catalog.projects.filter((project) => project.id !== summary.id)], summary.id);
}

async function cleanupWrittenBlobs(blobStore: BlobStore, storageKeys: string[]): Promise<void> {
  for (const storageKey of storageKeys) {
    try {
      await blobStore.delete(storageKey);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function createProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `project-${crypto.randomUUID()}`;
  }
  return `project-${Date.now().toString(36)}`;
}
