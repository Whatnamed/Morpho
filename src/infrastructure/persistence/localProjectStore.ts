import type { MorphoWorkspace } from "../../domain/morpho/types";
import { createCurrentCaseStudyWorkspace, parseWorkspace, serializeWorkspace } from "../../domain/morpho/workspace";
import {
  CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
  CURRENT_CASE_STUDY_FINGERPRINT,
  CURRENT_CASE_STUDY_ID,
  CURRENT_CASE_STUDY_VERSION
} from "../../domain/morpho/caseStudy/currentCaseStudy";
import { CASE_STUDY_INSTALLATION_STORAGE_KEY } from "../../domain/morpho/caseStudy/caseStudyInstallation";
import { fingerprintCaseStudyWorkspace } from "../../domain/morpho/caseStudy/caseStudyFingerprint";
import {
  isPristineLegacyNightrailWorkspace,
  LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS,
  LEGACY_NIGHTRAIL_PROJECT_ID
} from "../../domain/morpho/caseStudy/legacyNightrailMigration";

export const CATALOG_STORAGE_KEY = "morpho.projects.catalog.v1";
export const LEGACY_WORKSPACE_STORAGE_KEY = "morpho.workspace.nightrail.v1";

export type LocalProjectSummary = {
  id: string;
  title: string;
  subtitle: string;
  currentFocus?: MorphoWorkspace["projectContinuity"]["currentFocus"];
  continuityUpdatedAt?: string;
  continuityNote?: string;
  lastOpenedAt: string;
  updatedAt: string;
  coverAssetId?: string;
};

export type LocalProjectCatalog = {
  schemaVersion: 1;
  recentProjectId?: string;
  projects: LocalProjectSummary[];
};

export type CatalogLoadResult =
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
      didMigrate: boolean;
      /** Workspace materialized only in memory when a read-only migration cannot persist it. */
      migratedWorkspace?: MorphoWorkspace;
    }
  | {
      status: "failed";
      reason: string;
    };

export type LocalProjectStoreMode = "writer" | "readOnly";

export type LocalProjectStoreOptions = Readonly<{
  mode?: LocalProjectStoreMode;
}>;

export type CatalogSnapshotResult =
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
    }
  | {
      status: "missing";
    }
  | {
      status: "failed";
      reason: string;
    };

/**
 * Why a local write failed. These need different words to the user because they
 * need different actions: a full origin is fixed by exporting and deleting, a
 * blocked one by leaving private mode, and an unverified write by not trusting
 * this browser session with more work.
 */
export type StorageWriteFailureKind =
  /** The origin's storage budget is spent. */
  | "quotaExceeded"
  /** The browser refused storage access outright. */
  | "storageUnavailable"
  /** The write was accepted and then read back as something else, or as nothing. */
  | "writeNotVerified"
  | "unknown";

export type StorageWriteResult =
  | {
      status: "ok";
    }
  | {
      status: "failed";
      kind: StorageWriteFailureKind;
      reason: string;
    };

export type ProjectWorkspaceLoadResult =
  | {
      status: "ok";
      workspace: MorphoWorkspace;
      didMigrate: boolean;
    }
  | {
      status: "missing";
      reason: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ProjectPersistenceResult =
  | {
      status: "ok";
      savedAt: string;
    }
  | {
      status: "failed";
      kind: StorageWriteFailureKind;
      reason: string;
      stage: "workspace" | "catalog";
    };

export function getProjectWorkspaceStorageKey(projectId: string): string {
  return `morpho.project.${projectId}.workspace.v1`;
}

export function initializeLocalProjectCatalog(
  storage: Storage,
  options: LocalProjectStoreOptions = {}
): CatalogLoadResult {
  const mode = options.mode ?? "writer";
  const existingCatalog = loadCatalog(storage);
  if (existingCatalog.status === "ok") {
    return migrateExistingCatalog(storage, existingCatalog.catalog, mode);
  }

  if (existingCatalog.status === "failed") {
    return existingCatalog;
  }

  const legacyRaw = safeGetItem(storage, LEGACY_WORKSPACE_STORAGE_KEY);
  if (legacyRaw) {
    const migrated = parseWorkspace(legacyRaw);
    if (migrated.status === "failed") {
      return {
        status: "failed",
        reason: migrated.reason
      };
    }

    if (isPristineLegacyNightrailWorkspace(migrated.workspace)) {
      if (mode === "writer") {
        safeRemoveItem(storage, LEGACY_WORKSPACE_STORAGE_KEY);
      }
      return installCurrentCaseStudy(storage, {
        obsoleteStorageKeys: [...LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS]
      }, mode);
    }

    if (mode === "writer") {
      saveProjectWorkspace(storage, migrated.workspace);
    }
    const catalog = createCatalog([summarizeProject(migrated.workspace)], migrated.workspace.project.id);
    if (mode === "writer") {
      saveCatalog(storage, catalog);
    }
    return {
      status: "ok",
      catalog,
      didMigrate: true,
      migratedWorkspace: migrated.workspace
    };
  }

  return installCurrentCaseStudy(storage, {}, mode);
}

export function loadLocalProjectCatalogSnapshot(storage: Storage): CatalogSnapshotResult {
  return loadCatalog(storage);
}

export function loadProjectWorkspace(
  storage: Storage,
  projectId: string,
  options: LocalProjectStoreOptions = {}
): ProjectWorkspaceLoadResult {
  const mode = options.mode ?? "writer";
  const key = getProjectWorkspaceStorageKey(projectId);
  const raw = safeGetItem(storage, key);
  if (!raw) {
    return {
      status: "missing",
      reason: "本地项目不存在或尚未迁移。"
    };
  }

  const parsed = parseWorkspace(raw);
  if (parsed.status === "failed") {
    return {
      status: "failed",
      reason: parsed.reason
    };
  }

  if (parsed.didMigrate && mode === "writer") {
    safeSetItem(storage, key, serializeWorkspace(parsed.workspace));
  }

  return {
    status: "ok",
    workspace: parsed.workspace,
    didMigrate: parsed.didMigrate
  };
}

export function saveProjectWorkspace(storage: Storage, workspace: MorphoWorkspace): void {
  void writeProjectWorkspace(storage, workspace);
}

export function persistProjectWorkspaceAndSummary(storage: Storage, workspace: MorphoWorkspace): ProjectPersistenceResult {
  const workspaceResult = writeProjectWorkspace(storage, workspace);
  if (workspaceResult.status === "failed") {
    return {
      status: "failed",
      stage: "workspace",
      kind: workspaceResult.kind,
      reason: workspaceResult.reason
    };
  }

  const loadedCatalog = loadLocalProjectCatalogSnapshot(storage);
  if (loadedCatalog.status === "failed") {
    // The workspace itself is safely written; only the project list is stale.
    return {
      status: "failed",
      stage: "catalog",
      kind: "unknown",
      reason: loadedCatalog.reason
    };
  }

  const summary = summarizeProject(workspace);
  const baseProjects = loadedCatalog.status === "ok" ? loadedCatalog.catalog.projects : [];
  const projects = [summary, ...baseProjects.filter((project) => project.id !== summary.id)];
  const catalogResult = writeCatalog(storage, createCatalog(projects, summary.id));
  if (catalogResult.status === "failed") {
    return {
      status: "failed",
      stage: "catalog",
      kind: catalogResult.kind,
      reason: catalogResult.reason
    };
  }

  return {
    status: "ok",
    savedAt: new Date().toISOString()
  };
}

export function upsertProjectSummary(storage: Storage, workspace: MorphoWorkspace): LocalProjectCatalog {
  const loaded = initializeLocalProjectCatalog(storage);
  const baseCatalog = loaded.status === "ok" ? loaded.catalog : createCatalog([], workspace.project.id);
  const summary = summarizeProject(workspace);
  const projects = [summary, ...baseCatalog.projects.filter((project) => project.id !== summary.id)];
  const catalog = createCatalog(projects, summary.id);
  saveCatalog(storage, catalog);
  return catalog;
}

export function createCatalog(projects: LocalProjectSummary[], recentProjectId?: string): LocalProjectCatalog {
  return {
    schemaVersion: 1,
    recentProjectId,
    projects: [...projects].sort((a: LocalProjectSummary, b: LocalProjectSummary) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt)
    )
  };
}

export function summarizeProject(workspace: MorphoWorkspace): LocalProjectSummary {
  return {
    id: workspace.project.id,
    title: workspace.project.title,
    subtitle: workspace.project.subtitle,
    currentFocus: workspace.projectContinuity.currentFocus,
    continuityUpdatedAt: workspace.projectContinuity.updatedAt,
    continuityNote: workspace.projectContinuity.currentFocus.note,
    lastOpenedAt: workspace.project.lastOpenedAt ?? workspace.project.updatedAt ?? "2026-06-23T00:00:00.000Z",
    updatedAt: workspace.project.updatedAt ?? "2026-06-23T00:00:00.000Z",
    coverAssetId: workspace.project.coverAssetId
  };
}

function loadCatalog(storage: Storage):
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
    }
  | {
      status: "missing";
    }
  | {
      status: "failed";
      reason: string;
    } {
  const raw = safeGetItem(storage, CATALOG_STORAGE_KEY);
  if (!raw) {
    return { status: "missing" };
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isCatalog(value)) {
      return {
        status: "failed",
        reason: "本地项目目录格式无效。"
      };
    }

    return {
      status: "ok",
      catalog: value
    };
  } catch {
    return {
      status: "failed",
      reason: "本地项目目录不是有效 JSON。"
    };
  }
}

function saveCatalog(storage: Storage, catalog: LocalProjectCatalog): void {
  void writeCatalog(storage, catalog);
}

function safeGetItem(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageKey(storage: Storage, index: number): string | null {
  try {
    return storage.key(index);
  } catch {
    return null;
  }
}

function safeSetItem(storage: Storage, key: string, value: string): void {
  void persistStorageValue(storage, key, value);
}

export function writeProjectWorkspace(storage: Storage, workspace: MorphoWorkspace): StorageWriteResult {
  return persistStorageValue(storage, getProjectWorkspaceStorageKey(workspace.project.id), serializeWorkspace(workspace));
}

export function deleteProjectWorkspace(storage: Storage, projectId: string): void {
  safeRemoveItem(storage, getProjectWorkspaceStorageKey(projectId));
}

export function writeCatalog(storage: Storage, catalog: LocalProjectCatalog): StorageWriteResult {
  return persistStorageValue(storage, CATALOG_STORAGE_KEY, JSON.stringify(catalog));
}

function persistStorageValue(storage: Storage, key: string, value: string): StorageWriteResult {
  try {
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) {
      // Safari private mode and some embedded webviews accept the write and
      // store nothing. Nothing threw, so only the read-back catches it.
      return storageWriteFailure("writeNotVerified");
    }
    return { status: "ok" };
  } catch (error) {
    return storageWriteFailure(classifyStorageWriteError(error));
  }
}

function classifyStorageWriteError(error: unknown): StorageWriteFailureKind {
  if (typeof error !== "object" || error === null) {
    return "unknown";
  }

  const { name, code } = error as { name?: unknown; code?: unknown };
  // Chrome/Safari raise QuotaExceededError (code 22); Firefox raises
  // NS_ERROR_DOM_QUOTA_REACHED (code 1014). Both mean the same thing here.
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014) {
    return "quotaExceeded";
  }
  if (name === "SecurityError" || name === "InvalidAccessError" || name === "InvalidStateError") {
    return "storageUnavailable";
  }

  return "unknown";
}

/**
 * User-facing wording. Storage keys stay out of it: which key failed is an
 * internal storage mechanic, while "your change is not saved" is the fact the
 * user has to act on.
 */
function storageWriteFailure(kind: StorageWriteFailureKind): StorageWriteResult {
  return { status: "failed", kind, reason: describeStorageWriteFailure(kind) };
}

export function describeStorageWriteFailure(kind: StorageWriteFailureKind): string {
  switch (kind) {
    case "quotaExceeded":
      return "浏览器本地存储空间已满，这次修改没有保存。";
    case "storageUnavailable":
      return "浏览器不允许保存本地数据，这次修改没有保存。";
    case "writeNotVerified":
      return "写入浏览器本地存储后无法读回，这次修改没有保存。";
    case "unknown":
      return "本地保存失败，这次修改没有保存。";
  }
}

function safeRemoveItem(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

function migrateExistingCatalog(
  storage: Storage,
  catalog: LocalProjectCatalog,
  mode: LocalProjectStoreMode
): CatalogLoadResult {
  if (catalog.projects.length === 0) {
    const recoveredWorkspaces = recoverCataloglessProjectWorkspaces(storage, mode);
    if (recoveredWorkspaces.length > 0) {
      if (
        recoveredWorkspaces.length === 1 &&
        recoveredWorkspaces[0]?.project.id === LEGACY_NIGHTRAIL_PROJECT_ID &&
        isPristineLegacyNightrailWorkspace(recoveredWorkspaces[0])
      ) {
        if (mode === "writer") {
          deleteProjectWorkspace(storage, LEGACY_NIGHTRAIL_PROJECT_ID);
        }
        return installCurrentCaseStudy(storage, {
          obsoleteStorageKeys: [...LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS]
        }, mode);
      }

      const recoveredCatalog = createCatalog(
        recoveredWorkspaces.map(summarizeProject),
        catalog.recentProjectId && recoveredWorkspaces.some((workspace) => workspace.project.id === catalog.recentProjectId)
          ? catalog.recentProjectId
          : recoveredWorkspaces[0]?.project.id
      );
      if (mode === "writer") {
        saveCatalog(storage, recoveredCatalog);
      }
      return {
        status: "ok",
        catalog: recoveredCatalog,
        didMigrate: true
      };
    }

    // An empty catalog on a browser that has already installed the built-in case
    // study is a user who deleted their projects, not a first run. Reinstalling
    // here would resurrect a project they explicitly removed.
    if (readCaseStudyMarker(storage)) {
      return {
        status: "ok",
        catalog,
        didMigrate: false
      };
    }

    return installCurrentCaseStudy(storage, {}, mode);
  }

  if (catalog.projects.length === 1 && catalog.projects[0]?.id === LEGACY_NIGHTRAIL_PROJECT_ID) {
    const legacyWorkspace = loadProjectWorkspace(storage, LEGACY_NIGHTRAIL_PROJECT_ID, { mode });
    if (legacyWorkspace.status === "ok" && isPristineLegacyNightrailWorkspace(legacyWorkspace.workspace)) {
      if (mode === "writer") {
        deleteProjectWorkspace(storage, LEGACY_NIGHTRAIL_PROJECT_ID);
      }
      return installCurrentCaseStudy(storage, {
        obsoleteStorageKeys: [...LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS]
      }, mode);
    }
  }

  const marker = readCaseStudyMarker(storage);
  const currentCaseSummary = catalog.projects.find((project) => project.id === CURRENT_CASE_STUDY_ID);
  const legacySummary = catalog.projects.find((project) => project.id === LEGACY_NIGHTRAIL_PROJECT_ID);
  if (!currentCaseSummary && legacySummary) {
    const legacyWorkspace = loadProjectWorkspace(storage, LEGACY_NIGHTRAIL_PROJECT_ID, { mode });
    if (legacyWorkspace.status === "ok" && !isPristineLegacyNightrailWorkspace(legacyWorkspace.workspace)) {
      const next = createCurrentCaseStudyWorkspace();
      if (mode === "writer") {
        saveProjectWorkspace(storage, next);
      }
      const nextCatalog = createCatalog([summarizeProject(next), ...catalog.projects], CURRENT_CASE_STUDY_ID);
      if (mode === "writer") {
        saveCatalog(storage, nextCatalog);
        writeCaseStudyMarker(storage);
      }
      return {
        status: "ok",
        catalog: nextCatalog,
        didMigrate: true,
        migratedWorkspace: next
      };
    }
  }

  if (
    marker &&
    currentCaseSummary &&
    marker.projectId === CURRENT_CASE_STUDY_ID &&
    marker.installedVersion !== CURRENT_CASE_STUDY_VERSION
  ) {
    const currentCase = loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID, { mode });
    if (currentCase.status === "ok" && fingerprintCaseStudyWorkspace(currentCase.workspace) === marker.workspaceFingerprint) {
      const next = createCurrentCaseStudyWorkspace();
      if (mode === "writer") {
        saveProjectWorkspace(storage, next);
      }
      const nextCatalog = createCatalog(
        [summarizeProject(next), ...catalog.projects.filter((project) => project.id !== CURRENT_CASE_STUDY_ID)],
        CURRENT_CASE_STUDY_ID
      );
      if (mode === "writer") {
        saveCatalog(storage, nextCatalog);
        writeCaseStudyMarker(storage);
      }
      return {
        status: "ok",
        catalog: nextCatalog,
        didMigrate: true,
        migratedWorkspace: next
      };
    }
  }

  return {
    status: "ok",
    catalog,
    didMigrate: false
  };
}

function recoverCataloglessProjectWorkspaces(storage: Storage, mode: LocalProjectStoreMode): MorphoWorkspace[] {
  const workspaces: MorphoWorkspace[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = safeStorageKey(storage, index);
    const projectId = storageKey ? parseProjectWorkspaceStorageKey(storageKey) : null;
    if (!storageKey || !projectId) {
      continue;
    }

    const raw = safeGetItem(storage, storageKey);
    if (!raw) {
      continue;
    }

    const parsed = parseWorkspace(raw);
    if (parsed.status === "failed" || parsed.workspace.project.id !== projectId) {
      continue;
    }

    if (parsed.didMigrate && mode === "writer") {
      safeSetItem(storage, storageKey, serializeWorkspace(parsed.workspace));
    }
    workspaces.push(parsed.workspace);
  }

  return workspaces;
}

function parseProjectWorkspaceStorageKey(storageKey: string): string | null {
  const match = /^morpho\.project\.(.+)\.workspace\.v1$/.exec(storageKey);
  return match?.[1] ?? null;
}

function installCurrentCaseStudy(
  storage: Storage,
  options: {
    obsoleteStorageKeys?: string[];
  } = {},
  mode: LocalProjectStoreMode = "writer"
): CatalogLoadResult {
  const workspace = createCurrentCaseStudyWorkspace();
  if (mode === "writer") {
    saveProjectWorkspace(storage, workspace);
  }
  const catalog = createCatalog([summarizeProject(workspace)], CURRENT_CASE_STUDY_ID);
  if (mode === "writer") {
    saveCatalog(storage, catalog);
    writeCaseStudyMarker(storage, options.obsoleteStorageKeys);
  }
  return {
    status: "ok",
    catalog,
    didMigrate: true,
    migratedWorkspace: workspace
  };
}

function readCaseStudyMarker(storage: Storage): {
  assetManifestVersion: string;
  installedVersion: string;
  obsoleteStorageKeys?: string[];
  projectId: string;
  workspaceFingerprint: string;
} | null {
  const raw = safeGetItem(storage, CASE_STUDY_INSTALLATION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      typeof value.assetManifestVersion !== "string" ||
      typeof value.installedVersion !== "string" ||
      typeof value.projectId !== "string" ||
      typeof value.workspaceFingerprint !== "string"
    ) {
      return null;
    }
    return {
      assetManifestVersion: value.assetManifestVersion,
      installedVersion: value.installedVersion,
      obsoleteStorageKeys: Array.isArray(value.obsoleteStorageKeys)
        ? value.obsoleteStorageKeys.filter((key): key is string => typeof key === "string")
        : undefined,
      projectId: value.projectId,
      workspaceFingerprint: value.workspaceFingerprint
    };
  } catch {
    return null;
  }
}

function writeCaseStudyMarker(storage: Storage, obsoleteStorageKeys?: string[]): void {
  safeSetItem(
    storage,
    CASE_STUDY_INSTALLATION_STORAGE_KEY,
    JSON.stringify({
      assetManifestVersion: CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
      installedVersion: CURRENT_CASE_STUDY_VERSION,
      projectId: CURRENT_CASE_STUDY_ID,
      workspaceFingerprint: CURRENT_CASE_STUDY_FINGERPRINT,
      obsoleteStorageKeys
    })
  );
}

function isCatalog(value: unknown): value is LocalProjectCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.projects)) {
    return false;
  }

  return value.projects.every(
    (project) =>
      isRecord(project) &&
      typeof project.id === "string" &&
      typeof project.title === "string" &&
      typeof project.subtitle === "string" &&
      typeof project.lastOpenedAt === "string" &&
      typeof project.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
