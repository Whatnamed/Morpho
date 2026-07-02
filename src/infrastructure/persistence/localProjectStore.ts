import type { MorphoWorkspace } from "../../domain/morpho/types";
import { createInitialWorkspace, parseWorkspace, serializeWorkspace } from "../../domain/morpho/workspace";

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
    }
  | {
      status: "failed";
      reason: string;
    };

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

export type StorageWriteResult =
  | {
      status: "ok";
    }
  | {
      status: "failed";
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
      reason: string;
      stage: "workspace" | "catalog";
    };

export function getProjectWorkspaceStorageKey(projectId: string): string {
  return `morpho.project.${projectId}.workspace.v1`;
}

export function initializeLocalProjectCatalog(storage: Storage): CatalogLoadResult {
  const existingCatalog = loadCatalog(storage);
  if (existingCatalog.status === "ok") {
    return {
      status: "ok",
      catalog: existingCatalog.catalog,
      didMigrate: false
    };
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

    saveProjectWorkspace(storage, migrated.workspace);
    const catalog = createCatalog([summarizeProject(migrated.workspace)], migrated.workspace.project.id);
    saveCatalog(storage, catalog);
    return {
      status: "ok",
      catalog,
      didMigrate: true
    };
  }

  const seed = createInitialWorkspace();
  saveProjectWorkspace(storage, seed);
  const catalog = createCatalog([summarizeProject(seed)], seed.project.id);
  saveCatalog(storage, catalog);
  return {
    status: "ok",
    catalog,
    didMigrate: true
  };
}

export function loadLocalProjectCatalogSnapshot(storage: Storage): CatalogSnapshotResult {
  return loadCatalog(storage);
}

export function loadProjectWorkspace(storage: Storage, projectId: string): ProjectWorkspaceLoadResult {
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

  if (parsed.didMigrate) {
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
      reason: workspaceResult.reason
    };
  }

  const loadedCatalog = loadLocalProjectCatalogSnapshot(storage);
  if (loadedCatalog.status === "failed") {
    return {
      status: "failed",
      stage: "catalog",
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
      return {
        status: "failed",
        reason: `Storage write for ${key} could not be verified.`
      };
    }
    return { status: "ok" };
  } catch {
    return {
      status: "failed",
      reason: `Storage write for ${key} failed.`
    };
  }
}

function safeRemoveItem(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
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
