import { strFromU8, unzipSync, zip } from "fflate";

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
  type ProjectBundleDiagnostic,
  type ProjectBundleEnvelope,
  type ProjectBundleResolvedAsset
} from "@/domain/morpho/projectBundles";
import type { EditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import type { AssetId, AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import { BoundedZipError, unzipWithBudget } from "@/shared/boundedZip";
import {
  createCatalog,
  deleteProjectWorkspace,
  getProjectWorkspaceStorageKey,
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

export type EditableProjectBackupInspectionPreview = {
  sourceProjectId: string;
  sourceProjectTitle: string;
  sourceProjectSubtitle: string;
  createdAt: string;
  chat: EditableBackupOptions["chat"];
  projectContinuity: EditableBackupOptions["projectContinuity"];
  assets: {
    total: number;
    embedded: number;
    referenceOnly: number;
    missing: number;
    sizeMismatch: number;
  };
  warningCount: number;
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

export type InspectedEditableProjectBackupBundle = {
  preview: EditableProjectBackupInspectionPreview;
  bundle: ProjectBundleEnvelope;
  manifest: EditableProjectBackupManifest;
  files: Record<string, Uint8Array>;
  diagnostics: ProjectBundleDiagnostic[];
};

type InspectBackupResult =
  | {
      status: "ok";
      preview: EditableProjectBackupInspectionPreview;
      backup: InspectedEditableProjectBackupBundle;
      diagnostics: ProjectBundleDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

const UNREADABLE_BACKUP_BUNDLE_REASON = "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。";
const RESTORE_PROJECT_ID_ATTEMPT_LIMIT = 10;
const MAX_BACKUP_COMPRESSED_BYTES = 128 * 1024 * 1024;

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
    file: await bundleToZipFile(bundle),
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
    file: await bundleToZipFile(bundle.bundle),
    diagnostics: bundle.diagnostics
  };
}

export async function inspectEditableProjectBackupBundle(file: File | Blob): Promise<InspectBackupResult> {
  if (file.size > MAX_BACKUP_COMPRESSED_BYTES) {
    return unreadableBackupBundleFailure("备份包超过 128 MiB 安全上限。");
  }

  let zipped: Record<string, Uint8Array>;
  try {
    const compressed = new Uint8Array(await file.arrayBuffer());
    const bootstrapFiles = await unzipWithBudget(compressed, {
      ...backupZipBudget(),
      maxIncludedEntries: 1,
      maxEntryUncompressedBytes: 2 * 1024 * 1024,
      maxTotalUncompressedBytes: 2 * 1024 * 1024,
      include: (entry) => entry.name === "bundle.json"
    });
    const bundleValue = parseJsonFile(bootstrapFiles["bundle.json"]);
    const declaredPaths = resolveDeclaredBundlePaths(bundleValue);
    if (!declaredPaths) return unreadableBackupBundleFailure();
    zipped = await unzipWithBudget(compressed, {
      ...backupZipBudget(),
      include: (entry) => declaredPaths.has(entry.name)
    });
  } catch (error) {
    return unreadableBackupBundleFailure(
      error instanceof BoundedZipError && error.code !== "invalid_zip"
        ? `备份包超过安全解压预算：${error.message}`
        : undefined
    );
  }

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
      reason: UNREADABLE_BACKUP_BUNDLE_REASON,
      diagnostics: ensureUnreadableDiagnostic(validation.diagnostics)
    };
  }

  const preview = buildEditableBackupInspectionPreview(validation.manifest, validation.files, validation.diagnostics);
  const backup: InspectedEditableProjectBackupBundle = {
    preview,
    bundle: validation.bundle,
    manifest: validation.manifest,
    files: validation.files,
    diagnostics: validation.diagnostics
  };

  return {
    status: "ok",
    preview,
    backup,
    diagnostics: validation.diagnostics
  };
}

export async function restoreEditableProjectBackupBundle(
  inspectedBackup: InspectedEditableProjectBackupBundle | Extract<InspectBackupResult, { status: "ok" }>,
  options: RestoreBackupOptions
): Promise<RestoreResult> {
  const backup = "backup" in inspectedBackup ? inspectedBackup.backup : inspectedBackup;
  const revalidation = validateEditableProjectBackupBundle({
    bundle: backup.bundle,
    manifest: backup.manifest,
    files: backup.files
  });
  if (revalidation.status !== "ok") {
    return {
      status: "failed",
      reason: "备份包在恢复前验证失败。",
      diagnostics: revalidation.diagnostics
    };
  }

  const catalogSnapshot = loadLocalProjectCatalogSnapshot(options.storage);
  if (catalogSnapshot.status === "failed") {
    return {
      status: "failed",
      reason: catalogSnapshot.reason,
      diagnostics: revalidation.diagnostics
    };
  }

  const restoredAt = options.now?.() ?? new Date().toISOString();
  const baseCatalog =
    catalogSnapshot.status === "ok"
      ? catalogSnapshot.catalog
      : {
          schemaVersion: 1 as const,
          recentProjectId: undefined,
          projects: []
        };
  const projectIdResolution = resolveRestoredProjectId({
    sourceProjectId: revalidation.manifest.sourceProject.id,
    catalog: baseCatalog,
    storage: options.storage,
    createProjectId: options.createProjectId ?? createProjectId
  });
  if (projectIdResolution.status !== "ok") {
    return {
      status: "failed",
      reason: projectIdResolution.reason,
      diagnostics: [...revalidation.diagnostics, projectIdResolution.diagnostic]
    };
  }

  const projectId = projectIdResolution.projectId;
  const projectTitle = nextRestoredProjectTitle(revalidation.manifest.sourceProject.title, baseCatalog);
  const createRuntimeStorageKey =
    options.createRuntimeStorageKey ?? ((assetId: AssetId, restoredProjectId: string) => `blob:${restoredProjectId}:${assetId}`);

  const plan = planEditableProjectBackupRestore(revalidation.manifest, revalidation.files, {
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
      diagnostics: revalidation.diagnostics
    };
  }

  const workspaceWrite = writeProjectWorkspace(options.storage, plan.workspace);
  if (workspaceWrite.status !== "ok") {
    await cleanupWrittenBlobs(options.blobStore, writtenBlobKeys);
    deleteProjectWorkspace(options.storage, projectId);
    return {
      status: "failed",
      reason: workspaceWrite.reason,
      diagnostics: revalidation.diagnostics
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
      diagnostics: revalidation.diagnostics
    };
  }

  return {
    status: "ok",
    projectId,
    workspace: plan.workspace,
    diagnostics: revalidation.diagnostics
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

/**
 * Zip compression runs off the main thread when the platform provides Workers.
 *
 * Measured on the built-in case study (Phase 5 atlas): `zipSync` froze the page for
 * ~890 ms during the human-readable archive export because that bundle embeds every
 * readable local binary. `zip` produces the same bytes at the same level; it only
 * changes where the compression runs.
 */
async function bundleToZipFile(bundle: BuiltProjectBundle): Promise<File> {
  const entries = Object.fromEntries(bundle.files.map((entry) => [entry.path, entry.bytes]));
  // fflate hands back a freshly allocated, exactly sized buffer; the cast only
  // re-narrows the library's ArrayBufferLike-wide element type for the File part.
  const zipped = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data as Uint8Array<ArrayBuffer>);
    });
  });
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

function buildEditableBackupInspectionPreview(
  manifest: EditableProjectBackupManifest,
  files: Record<string, Uint8Array>,
  diagnostics: ProjectBundleDiagnostic[]
): EditableProjectBackupInspectionPreview {
  const assets = {
    total: manifest.assetInventory.entries.length,
    embedded: 0,
    referenceOnly: 0,
    missing: 0,
    sizeMismatch: 0
  };

  for (const entry of manifest.assetInventory.entries) {
    if (entry.sourceType === "originalLink") {
      assets.referenceOnly += 1;
      continue;
    }
    const bytes = files[entry.portableBundleKey];
    if (!bytes) {
      assets.missing += 1;
      continue;
    }
    if (bytes.byteLength !== entry.size) {
      assets.sizeMismatch += 1;
      continue;
    }
    assets.embedded += 1;
  }

  return {
    sourceProjectId: manifest.sourceProject.id,
    sourceProjectTitle: manifest.sourceProject.title,
    sourceProjectSubtitle: manifest.sourceProject.subtitle,
    createdAt: manifest.createdAt,
    chat: manifest.options.chat,
    projectContinuity: manifest.options.projectContinuity,
    assets,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length
  };
}

function unreadableBackupBundleFailure(detail?: string): Extract<InspectBackupResult, { status: "failed" }> {
  return {
    status: "failed",
    reason: detail ? `${UNREADABLE_BACKUP_BUNDLE_REASON} ${detail}` : UNREADABLE_BACKUP_BUNDLE_REASON,
    diagnostics: [
      {
        code: "unreadable_backup_bundle",
        severity: "error",
        message: detail ? `${UNREADABLE_BACKUP_BUNDLE_REASON} ${detail}` : UNREADABLE_BACKUP_BUNDLE_REASON
      }
    ]
  };
}

function backupZipBudget() {
  return {
    maxCompressedBytes: MAX_BACKUP_COMPRESSED_BYTES,
    maxEntries: 4_096,
    maxIncludedEntries: 2_048,
    maxEntryUncompressedBytes: 64 * 1024 * 1024,
    maxTotalUncompressedBytes: 256 * 1024 * 1024,
    maxCompressionRatio: 200,
    timeoutMs: 15_000
  } as const;
}

function resolveDeclaredBundlePaths(bundleValue: unknown): Set<string> | undefined {
  if (!isRecord(bundleValue) || !Array.isArray(bundleValue.files) || bundleValue.files.length > 2_048) {
    return undefined;
  }
  const paths = new Set<string>(["bundle.json"]);
  for (const entry of bundleValue.files) {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.path.length > 512) {
      return undefined;
    }
    paths.add(entry.path);
  }
  if (typeof bundleValue.manifestPath !== "string" || !paths.has(bundleValue.manifestPath)) {
    return undefined;
  }
  return paths;
}

function ensureUnreadableDiagnostic(diagnostics: ProjectBundleDiagnostic[]): ProjectBundleDiagnostic[] {
  if (diagnostics.some((diagnostic) => diagnostic.code === "unreadable_backup_bundle")) {
    return diagnostics;
  }
  return [
    ...diagnostics,
    {
      code: "unreadable_backup_bundle",
      severity: "error",
      message: UNREADABLE_BACKUP_BUNDLE_REASON
    }
  ];
}

function resolveRestoredProjectId(input: {
  sourceProjectId: string;
  catalog: LocalProjectCatalog;
  storage: Storage;
  createProjectId: () => string;
}):
  | {
      status: "ok";
      projectId: string;
    }
  | {
      status: "failed";
      reason: string;
      diagnostic: ProjectBundleDiagnostic;
    } {
  for (let attempt = 0; attempt < RESTORE_PROJECT_ID_ATTEMPT_LIMIT; attempt += 1) {
    const projectId = input.createProjectId();
    if (isRestoredProjectIdAvailable(projectId, input.sourceProjectId, input.catalog, input.storage)) {
      return { status: "ok", projectId };
    }
  }

  return {
    status: "failed",
    reason: "无法为恢复副本生成安全的新项目 ID。",
    diagnostic: {
      code: "restore_project_id_collision",
      severity: "error",
      message: `Could not generate a non-colliding restored project id after ${RESTORE_PROJECT_ID_ATTEMPT_LIMIT} attempts.`,
      path: "project.id"
    }
  };
}

function isRestoredProjectIdAvailable(
  projectId: string,
  sourceProjectId: string,
  catalog: LocalProjectCatalog,
  storage: Storage
): boolean {
  if (!projectId || projectId === sourceProjectId) {
    return false;
  }
  if (catalog.projects.some((project) => project.id === projectId)) {
    return false;
  }
  try {
    return storage.getItem(getProjectWorkspaceStorageKey(projectId)) === null;
  } catch {
    return false;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
