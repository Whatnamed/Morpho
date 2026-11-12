import type { MorphoWorkspace } from "../../domain/morpho/types";
import { createCurrentCaseStudyWorkspace, parseWorkspace, serializeWorkspace } from "../../domain/morpho/workspace";
import {
  CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
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
import { acquireProjectWriteLease, withProjectCatalogLock } from "./projectWriteLock";

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
      raw: string;
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

export type ProjectPersistenceWrite = ProjectPersistenceResult | {
  status: "catalogPending";
  savedAt: string;
  completion: Promise<ProjectPersistenceResult>;
};

export function getProjectWorkspaceStorageKey(projectId: string): string {
  return `morpho.project.${projectId}.workspace.v1`;
}

export function initializeLocalProjectCatalog(
  storage: Storage,
  options: LocalProjectStoreOptions = {}
): CatalogLoadResult {
  const plan = planCatalogInitialization(storage);
  return options.mode === "readOnly" ? catalogLoadResult(plan) : applyCatalogInitialization(storage, plan);
}

export async function initializeBrowserProjectCatalog(
  storage: Storage,
  options: { ownedProjectId?: string; isCancelled?: () => boolean } = {}
): Promise<CatalogLoadResult> {
  return withProjectCatalogLock(async () => {
    if (options.isCancelled?.()) return { status: "failed", reason: "已取消初始化项目列表。" };
    let plan = planCatalogInitialization(storage);
    const releases: Array<() => void | Promise<void>> = [];
    const protectedProjects = new Set([options.ownedProjectId]);
    try {
      while (plan.status === "ok" && !options.isCancelled?.()) {
        const projectId = plan.writeProjectIds.find((id) => !protectedProjects.has(id));
        if (!projectId) return applyCatalogInitialization(storage, plan);
        // Project leases here are non-blocking. Workspaces take their project lease first.
        const lease = await acquireProjectWriteLease(projectId);
        if (lease.status === "heldElsewhere") {
          const snapshot = loadCatalog(storage);
          return snapshot.status === "ok"
            ? { ...snapshot, didMigrate: false }
            : { status: "failed", reason: "项目列表正在其他标签页初始化，请稍后重试。" };
        }
        if (lease.status === "granted") releases.push(lease.release);
        protectedProjects.add(projectId);
        plan = planCatalogInitialization(storage);
      }
      return plan.status === "failed" ? plan : catalogLoadResult(plan);
    } finally {
      await Promise.all(releases.map((release) => release()));
    }
  });
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
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: "failed", reason: "浏览器无法读取本地项目。" };
  }
  if (raw === null) {
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
  if (parsed.workspace.project.id !== projectId) {
    return { status: "failed", reason: "本地记录与所选项目不匹配。" };
  }

  if (parsed.didMigrate && mode === "writer") {
    const written = writeProjectWorkspace(storage, parsed.workspace);
    if (written.status === "failed") return written;
  }

  return {
    status: "ok",
    workspace: parsed.workspace,
    didMigrate: parsed.didMigrate,
    raw
  };
}

export function saveProjectWorkspace(storage: Storage, workspace: MorphoWorkspace): void {
  void writeProjectWorkspace(storage, workspace);
}

export function persistProjectWorkspaceAndSummary(
  storage: Storage,
  workspace: MorphoWorkspace
): ProjectPersistenceWrite {
  const key = getProjectWorkspaceStorageKey(workspace.project.id);
  const raw = serializeWorkspace(workspace);
  const workspaceResult = persistStorageValue(storage, key, raw);
  if (workspaceResult.status === "failed") {
    return {
      status: "failed",
      stage: "workspace",
      kind: workspaceResult.kind,
      reason: workspaceResult.reason
    };
  }

  const catalogLockFailure: ProjectPersistenceResult = {
    status: "failed", stage: "catalog", kind: "unknown", reason: "项目内容已写入，无法更新项目列表。"
  };
  const savedAt = new Date().toISOString();
  try {
    const result = withProjectCatalogLock((): ProjectPersistenceResult => {
      // A queued summary can outlive this tab's project lease. A newer write or
      // deletion must not be overwritten by that summary.
      if (storage.getItem(key) === raw) {
        const summary = persistProjectSummary(storage, workspace);
        if (summary.status === "failed") return { ...summary, stage: "catalog" };
      }
      return { status: "ok", savedAt };
    });
    return result instanceof Promise
      ? { status: "catalogPending", savedAt, completion: result.catch(() => catalogLockFailure) }
      : result;
  } catch {
    return catalogLockFailure;
  }
}

/** Call inside the catalog lock, using the current project workspace. */
export function persistProjectSummary(
  storage: Storage,
  workspace: MorphoWorkspace,
  makeRecent = true
): Extract<StorageWriteResult, { status: "failed" }> | { status: "ok"; catalog: LocalProjectCatalog } {
  const loadedCatalog = loadLocalProjectCatalogSnapshot(storage);
  if (loadedCatalog.status === "failed") {
    return { ...loadedCatalog, kind: "unknown" };
  }

  const summary = summarizeProject(workspace);
  const previous = loadedCatalog.status === "ok" ? loadedCatalog.catalog : createCatalog([]);
  const projects = [summary, ...previous.projects.filter((project) => project.id !== summary.id)];
  const catalog = createCatalog(projects, makeRecent ? summary.id : previous.recentProjectId ?? summary.id);
  const written = writeCatalog(storage, catalog);
  return written.status === "ok" ? { status: "ok", catalog } : written;
}

/** Call inside the catalog lock. An already absent entry needs no write. */
export function removeProjectSummary(
  storage: Storage,
  projectId: string
): Extract<StorageWriteResult, { status: "failed" }> | { status: "ok"; catalog: LocalProjectCatalog } {
  const snapshot = loadCatalog(storage);
  if (snapshot.status === "failed") return { ...snapshot, kind: "unknown" };
  const previous = snapshot.status === "ok" ? snapshot.catalog : createCatalog([]);
  const projects = previous.projects.filter((project) => project.id !== projectId);
  if (projects.length === previous.projects.length) return { status: "ok", catalog: previous };
  const catalog = createCatalog(
    projects,
    previous.recentProjectId && previous.recentProjectId !== projectId ? previous.recentProjectId : projects[0]?.id
  );
  const written = writeCatalog(storage, catalog);
  return written.status === "ok" ? { status: "ok", catalog } : written;
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
  let raw: string | null;
  try {
    raw = storage.getItem(CATALOG_STORAGE_KEY);
  } catch {
    return { status: "failed", reason: "浏览器无法读取本地项目列表。" };
  }
  if (raw === null) {
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

export function writeProjectWorkspace(storage: Storage, workspace: MorphoWorkspace): StorageWriteResult {
  return persistStorageValue(storage, getProjectWorkspaceStorageKey(workspace.project.id), serializeWorkspace(workspace));
}

export function deleteProjectWorkspace(storage: Storage, projectId: string): StorageWriteResult {
  const key = getProjectWorkspaceStorageKey(projectId);
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null ? { status: "ok" } : storageWriteFailure("writeNotVerified");
  } catch (error) {
    return storageWriteFailure(classifyStorageWriteError(error));
  }
}

export function writeCatalog(storage: Storage, catalog: LocalProjectCatalog): StorageWriteResult {
  return persistStorageValue(storage, CATALOG_STORAGE_KEY, JSON.stringify(catalog));
}

function persistStorageValue(storage: Storage, key: string, value: string): StorageWriteResult {
  try {
    storage.setItem(key, value);
  } catch (error) {
    return storageWriteFailure(classifyStorageWriteError(error));
  }
  try {
    if (storage.getItem(key) === value) return { status: "ok" };
  } catch {
    // The write may have landed even if the read-back fails.
  }
  return storageWriteFailure("writeNotVerified");
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
      return "浏览器未能确认本地修改是否保存。";
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

type CatalogInitialization = Extract<CatalogLoadResult, { status: "failed" }> | {
  status: "ok";
  catalog: LocalProjectCatalog;
  didMigrate: boolean;
  migratedWorkspace?: MorphoWorkspace;
  workspaceToWrite?: MorphoWorkspace;
  caseStudy?: MorphoWorkspace;
  obsoleteWorkspaceKey?: string;
  writeProjectIds: string[];
};

function catalogLoadResult(plan: CatalogInitialization): CatalogLoadResult {
  if (plan.status === "failed") return plan;
  const { catalog, didMigrate, migratedWorkspace } = plan;
  return { status: "ok", catalog, didMigrate, ...(migratedWorkspace && { migratedWorkspace }) };
}

function planCatalogInitialization(storage: Storage): CatalogInitialization {
  try {
    const snapshot = loadCatalog(storage);
    if (snapshot.status === "failed") return snapshot;
    const catalog = snapshot.status === "ok" ? snapshot.catalog : createCatalog([]);
    const marker = readCaseStudyMarker(storage);
    const unchanged = { status: "ok" as const, catalog, didMigrate: false, writeProjectIds: [] };
    const legacySummary = catalog.projects.find((project) => project.id === LEGACY_NIGHTRAIL_PROJECT_ID);
    const hasCurrentCase = catalog.projects.some((project) => project.id === CURRENT_CASE_STUDY_ID);

    if (!catalog.projects.length) {
      const recovered = recoverCataloglessProjectWorkspaces(storage);
      const legacyRaw = snapshot.status === "missing" ? storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY) : null;
      if (legacyRaw !== null) {
        const legacy = parseWorkspace(legacyRaw);
        if (legacy.status === "failed") return legacy;
        if (isPristineLegacyNightrailWorkspace(legacy.workspace)) {
          return planCaseStudy(storage, recovered.map(summarizeProject), LEGACY_WORKSPACE_STORAGE_KEY);
        }
        const existing = recovered.find((workspace) => workspace.project.id === legacy.workspace.project.id);
        const migratedWorkspace = existing ?? legacy.workspace;
        return {
          status: "ok",
          catalog: createCatalog([summarizeProject(migratedWorkspace), ...recovered.filter((workspace) => workspace !== existing).map(summarizeProject)], migratedWorkspace.project.id),
          didMigrate: true,
          migratedWorkspace,
          workspaceToWrite: existing ? undefined : migratedWorkspace,
          writeProjectIds: [migratedWorkspace.project.id]
        };
      }
      if (!marker && recovered.length === 1 && isPristineLegacyNightrailWorkspace(recovered[0])) {
        return planCaseStudy(storage, [], getProjectWorkspaceStorageKey(LEGACY_NIGHTRAIL_PROJECT_ID));
      }
      if (recovered.length > 0) {
        const recent = recovered.find((workspace) => workspace.project.id === catalog.recentProjectId) ?? recovered[0];
        return {
          ...unchanged,
          catalog: createCatalog(recovered.map(summarizeProject), recent.project.id),
          didMigrate: true
        };
      }
      // An installation marker survives deleting the last project.
      if (marker || snapshot.status === "ok") return { ...unchanged, didMigrate: snapshot.status === "missing" };
      return planCaseStudy(storage, []);
    }

    if (!hasCurrentCase && legacySummary && !marker) {
      const legacy = loadProjectWorkspace(storage, LEGACY_NIGHTRAIL_PROJECT_ID, { mode: "readOnly" });
      if (legacy.status === "ok") {
        const pristine = isPristineLegacyNightrailWorkspace(legacy.workspace);
        if (!pristine || catalog.projects.length === 1) {
          return planCaseStudy(
            storage,
            pristine ? [] : catalog.projects,
            pristine ? getProjectWorkspaceStorageKey(LEGACY_NIGHTRAIL_PROJECT_ID) : undefined
          );
        }
      }
    }

    if (hasCurrentCase && marker && marker.installedVersion !== CURRENT_CASE_STUDY_VERSION) {
      const current = loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID, { mode: "readOnly" });
      if (current.status === "ok") {
        const next = createCurrentCaseStudyWorkspace();
        const fingerprint = fingerprintCaseStudyWorkspace(current.workspace);
        const alreadyUpgraded = fingerprint === fingerprintCaseStudyWorkspace(next);
        if (fingerprint === marker.workspaceFingerprint || alreadyUpgraded) {
          return caseStudyInitialization(next, catalog.projects, undefined, !alreadyUpgraded);
        }
      }
    }
    return unchanged;
  } catch {
    return { status: "failed", reason: "浏览器无法读取本地项目数据。" };
  }
}

function recoverCataloglessProjectWorkspaces(storage: Storage): MorphoWorkspace[] {
  const workspaces: MorphoWorkspace[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const projectId = key && parseProjectWorkspaceStorageKey(key);
    if (!projectId) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const parsed = parseWorkspace(raw);
    if (parsed.status === "ok" && parsed.workspace.project.id === projectId) workspaces.push(parsed.workspace);
  }
  return workspaces;
}

function planCaseStudy(
  storage: Storage,
  projects: LocalProjectSummary[],
  obsoleteWorkspaceKey?: string
): CatalogInitialization {
  const existing = loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID, { mode: "readOnly" });
  if (existing.status === "failed") return existing;
  return caseStudyInitialization(
    existing.status === "ok" ? existing.workspace : createCurrentCaseStudyWorkspace(),
    projects,
    obsoleteWorkspaceKey,
    existing.status === "missing"
  );
}

function caseStudyInitialization(
  workspace: MorphoWorkspace,
  projects: LocalProjectSummary[],
  obsoleteWorkspaceKey: string | undefined,
  writeWorkspace: boolean
): CatalogInitialization {
  const obsoleteProjectId = obsoleteWorkspaceKey && parseProjectWorkspaceStorageKey(obsoleteWorkspaceKey);
  return {
    status: "ok",
    catalog: createCatalog(
      [summarizeProject(workspace), ...projects.filter((project) => project.id !== CURRENT_CASE_STUDY_ID)],
      CURRENT_CASE_STUDY_ID
    ),
    didMigrate: true,
    migratedWorkspace: workspace,
    workspaceToWrite: writeWorkspace ? workspace : undefined,
    caseStudy: workspace,
    obsoleteWorkspaceKey,
    writeProjectIds: obsoleteProjectId ? [CURRENT_CASE_STUDY_ID, obsoleteProjectId] : [CURRENT_CASE_STUDY_ID]
  };
}

function applyCatalogInitialization(storage: Storage, plan: CatalogInitialization): CatalogLoadResult {
  if (plan.status === "ok" && plan.didMigrate) {
    if (plan.workspaceToWrite) {
      const written = writeProjectWorkspace(storage, plan.workspaceToWrite);
      if (written.status === "failed") return written;
    }
    const catalog = writeCatalog(storage, plan.catalog);
    if (catalog.status === "failed") return catalog;
    if (plan.caseStudy) {
      const marker = writeCaseStudyMarker(storage, plan.caseStudy, plan.obsoleteWorkspaceKey
        ? [...LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS]
        : undefined);
      if (marker.status === "failed") return marker;
    }
    if (plan.obsoleteWorkspaceKey) safeRemoveItem(storage, plan.obsoleteWorkspaceKey);
  }
  return catalogLoadResult(plan);
}

export function parseProjectWorkspaceStorageKey(storageKey: string): string | null {
  const match = /^morpho\.project\.(.+)\.workspace\.v1$/.exec(storageKey);
  return match?.[1] ?? null;
}

function readCaseStudyMarker(storage: Storage): {
  assetManifestVersion: string;
  installedVersion: string;
  obsoleteStorageKeys?: string[];
  projectId: string;
  workspaceFingerprint: string;
} | null {
  const raw = storage.getItem(CASE_STUDY_INSTALLATION_STORAGE_KEY);
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

function writeCaseStudyMarker(storage: Storage, workspace: MorphoWorkspace, obsoleteStorageKeys?: string[]): StorageWriteResult {
  return persistStorageValue(
    storage,
    CASE_STUDY_INSTALLATION_STORAGE_KEY,
    JSON.stringify({
      assetManifestVersion: CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
      installedVersion: CURRENT_CASE_STUDY_VERSION,
      projectId: CURRENT_CASE_STUDY_ID,
      workspaceFingerprint: fingerprintCaseStudyWorkspace(workspace),
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
