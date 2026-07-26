import type { MorphoWorkspace } from "../../domain/morpho/types";
import { parseWorkspace } from "../../domain/morpho/workspace";
import {
  createCatalog,
  deleteProjectWorkspace,
  loadLocalProjectCatalogSnapshot,
  loadProjectWorkspace,
  summarizeProject,
  writeCatalog,
  writeProjectWorkspace,
  type LocalProjectCatalog
} from "./localProjectStore";

/**
 * Removing and renaming local projects.
 *
 * Deletion is the only way a user can reclaim local space, so it has to reclaim
 * the part that actually costs space: the IndexedDB image blobs. It also has to
 * be provably safe, because a blob deleted out from under another project shows
 * up as a permanently broken image with no way back.
 *
 * The safety rule here is ownership, computed before anything is removed: a blob
 * is deleted only when no other stored workspace still references its storage
 * key. The scan reads every `morpho.project.*.workspace.v1` entry rather than
 * only catalogued ones, because a workspace missing from the catalog is still
 * recoverable data and its references still count.
 */

export type ProjectDeletionPlan = {
  projectId: string;
  title: string;
  /** Blob storage keys no other stored workspace references. Safe to delete. */
  exclusiveStorageKeys: string[];
  /** Blob storage keys that must be kept: shared, or not provably unshared. */
  sharedStorageKeys: string[];
  /**
   * Stored workspaces that could not be parsed. While any exist, ownership
   * cannot be proven for any key and nothing is reclaimed.
   */
  unreadableProjectCount: number;
};

export type ProjectDeletionPlanResult =
  | {
      status: "ok";
      plan: ProjectDeletionPlan;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ProjectRecordDeletionResult =
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ProjectRenameResult =
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
      workspace: MorphoWorkspace;
    }
  | {
      status: "failed";
      reason: string;
    };

const PROJECT_WORKSPACE_KEY_PATTERN = /^morpho\.project\.(.+)\.workspace\.v1$/;
export const MAX_PROJECT_TITLE_LENGTH = 80;

/**
 * Works out what deleting one project would remove, without removing anything.
 * The caller shows this to the user and only then commits.
 */
export function planLocalProjectDeletion(storage: Storage, projectId: string): ProjectDeletionPlanResult {
  const target = loadProjectWorkspace(storage, projectId);
  if (target.status !== "ok") {
    return {
      status: "failed",
      reason: target.reason
    };
  }

  const ownKeys = collectAssetStorageKeys(target.workspace);
  const neighbours = collectStorageKeysReferencedByOtherProjects(storage, projectId);

  // An unreadable neighbour is not evidence that its blobs are unused — it is
  // the absence of evidence. Reclaiming space is worth less than an image no
  // other project can ever get back, so nothing is reclaimed until every stored
  // workspace has been read.
  const canProveOwnership = neighbours.unreadableProjectCount === 0;

  const exclusiveStorageKeys: string[] = [];
  const sharedStorageKeys: string[] = [];
  for (const storageKey of ownKeys) {
    if (!canProveOwnership || neighbours.storageKeys.has(storageKey)) {
      sharedStorageKeys.push(storageKey);
    } else {
      exclusiveStorageKeys.push(storageKey);
    }
  }

  return {
    status: "ok",
    plan: {
      projectId,
      title: target.workspace.project.title,
      exclusiveStorageKeys,
      sharedStorageKeys,
      unreadableProjectCount: neighbours.unreadableProjectCount
    }
  };
}

/**
 * Removes the project from local storage and from the catalog.
 *
 * Blobs are deliberately not touched here. The record removal is what the user
 * asked for and must not be held hostage by an IndexedDB failure; blobs are
 * cleaned up afterwards, where failing only leaves reclaimable space behind
 * instead of a project that is half gone.
 */
export function deleteLocalProjectRecords(storage: Storage, projectId: string): ProjectRecordDeletionResult {
  const loadedCatalog = loadLocalProjectCatalogSnapshot(storage);
  if (loadedCatalog.status === "failed") {
    return {
      status: "failed",
      reason: loadedCatalog.reason
    };
  }

  deleteProjectWorkspace(storage, projectId);

  const previous = loadedCatalog.status === "ok" ? loadedCatalog.catalog : createCatalog([]);
  const projects = previous.projects.filter((project) => project.id !== projectId);
  const recentProjectId =
    previous.recentProjectId && previous.recentProjectId !== projectId
      ? previous.recentProjectId
      : projects[0]?.id;
  const catalog = createCatalog(projects, recentProjectId);

  const written = writeCatalog(storage, catalog);
  if (written.status === "failed") {
    return {
      status: "failed",
      reason: "项目内容已删除，但项目目录未能更新。重新打开页面后目录会自行修复。"
    };
  }

  return { status: "ok", catalog };
}

export function renameLocalProject(storage: Storage, projectId: string, title: string): ProjectRenameResult {
  const nextTitle = title.trim();
  if (nextTitle.length === 0) {
    return { status: "failed", reason: "项目名称不能为空。" };
  }
  if (nextTitle.length > MAX_PROJECT_TITLE_LENGTH) {
    return { status: "failed", reason: `项目名称请控制在 ${MAX_PROJECT_TITLE_LENGTH} 个字符以内。` };
  }

  const loaded = loadProjectWorkspace(storage, projectId);
  if (loaded.status !== "ok") {
    return { status: "failed", reason: loaded.reason };
  }

  // A rename is metadata. It must not move the project in "recently updated",
  // which reports when the design work last changed.
  const workspace: MorphoWorkspace = {
    ...loaded.workspace,
    project: {
      ...loaded.workspace.project,
      title: nextTitle
    }
  };

  const written = writeProjectWorkspace(storage, workspace);
  if (written.status === "failed") {
    return { status: "failed", reason: "项目名称未能保存，原名称保持不变。" };
  }

  const loadedCatalog = loadLocalProjectCatalogSnapshot(storage);
  const previous = loadedCatalog.status === "ok" ? loadedCatalog.catalog : createCatalog([]);
  const summary = summarizeProject(workspace);
  const catalog = createCatalog(
    [summary, ...previous.projects.filter((project) => project.id !== projectId)],
    previous.recentProjectId ?? projectId
  );
  writeCatalog(storage, catalog);

  return { status: "ok", catalog, workspace };
}

function collectAssetStorageKeys(workspace: MorphoWorkspace): string[] {
  const keys = new Set<string>();
  for (const asset of Object.values(workspace.assets)) {
    if (asset.storageKey) {
      keys.add(asset.storageKey);
    }
  }

  return [...keys].sort();
}

function collectStorageKeysReferencedByOtherProjects(
  storage: Storage,
  excludedProjectId: string
): { storageKeys: Set<string>; unreadableProjectCount: number } {
  const storageKeys = new Set<string>();
  let unreadableProjectCount = 0;

  for (const storageKey of listProjectWorkspaceStorageKeys(storage)) {
    const projectId = PROJECT_WORKSPACE_KEY_PATTERN.exec(storageKey)?.[1];
    if (!projectId || projectId === excludedProjectId) {
      continue;
    }

    let raw: string | null = null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      unreadableProjectCount += 1;
      continue;
    }
    if (!raw) {
      continue;
    }

    const parsed = parseWorkspace(raw);
    if (parsed.status === "failed") {
      unreadableProjectCount += 1;
      continue;
    }

    for (const assetStorageKey of collectAssetStorageKeys(parsed.workspace)) {
      storageKeys.add(assetStorageKey);
    }
  }

  return { storageKeys, unreadableProjectCount };
}

function listProjectWorkspaceStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    let key: string | null = null;
    try {
      key = storage.key(index);
    } catch {
      continue;
    }
    if (key && PROJECT_WORKSPACE_KEY_PATTERN.test(key)) {
      keys.push(key);
    }
  }

  return keys;
}
