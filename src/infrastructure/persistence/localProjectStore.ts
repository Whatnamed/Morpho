import type { MorphoWorkspace } from "../../domain/morpho/types";
import { parseWorkspace, serializeWorkspace } from "@/domain/morpho/workspaceCodec";
import { withProjectCatalogLock } from "./projectWriteLock";

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

export function parseProjectWorkspaceStorageKey(storageKey: string): string | null {
  const match = /^morpho\.project\.(.+)\.workspace\.v1$/.exec(storageKey);
  return match?.[1] ?? null;
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
