import type { MorphoWorkspace } from "../../domain/morpho/types";
import { parseWorkspace } from "../../domain/morpho/workspace";
import {
  deleteProjectWorkspace,
  LEGACY_WORKSPACE_STORAGE_KEY,
  loadLocalProjectCatalogSnapshot,
  loadProjectWorkspace,
  parseProjectWorkspaceStorageKey,
  persistProjectSummary,
  removeProjectSummary,
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
  raw: string;
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
  | { status: "ok"; plan: ProjectDeletionPlan }
  | { status: "failed"; reason: string }
  | { status: "missing"; reason: string };

export type ProjectRecordDeletionResult =
  | {
      status: "ok";
      catalog: LocalProjectCatalog;
    }
  | {
      status: "failed";
      reason: string;
      workspaceDeleted: boolean;
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
      titleSaved?: boolean;
    };

export const MAX_PROJECT_TITLE_LENGTH = 80;

/**
 * Works out what deleting one project would remove, without removing anything.
 * The caller shows this to the user and only then commits.
 */
export function planLocalProjectDeletion(storage: Storage, projectId: string): ProjectDeletionPlanResult {
  const target = loadProjectWorkspace(storage, projectId, { mode: "readOnly" });
  if (target.status !== "ok") {
    return target;
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
      raw: target.raw,
      exclusiveStorageKeys,
      sharedStorageKeys,
      unreadableProjectCount: neighbours.unreadableProjectCount
    }
  };
}

export function sameProjectDeletionPlan(previous: ProjectDeletionPlan, next: ProjectDeletionPlan): boolean {
  return previous.raw === next.raw &&
    previous.unreadableProjectCount === next.unreadableProjectCount &&
    JSON.stringify(previous.exclusiveStorageKeys) === JSON.stringify(next.exclusiveStorageKeys) &&
    JSON.stringify(previous.sharedStorageKeys) === JSON.stringify(next.sharedStorageKeys);
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
      reason: loadedCatalog.reason,
      workspaceDeleted: false
    };
  }

  const removed = deleteProjectWorkspace(storage, projectId);
  if (removed.status === "failed") {
    return { status: "failed", workspaceDeleted: false, reason: "无法确认项目内容已删除。项目列表和文件已保留，可以重试。" };
  }

  const written = removeProjectSummary(storage, projectId);
  if (written.status === "failed") {
    return {
      status: "failed",
      reason: "项目内容已删除，项目列表更新失败。可以重试更新列表，图片和文件将保留。",
      workspaceDeleted: true
    };
  }

  return written;
}

export function renameLocalProject(storage: Storage, projectId: string, title?: string): ProjectRenameResult {
  const nextTitle = title?.trim();
  if (nextTitle === "") {
    return { status: "failed", reason: "项目名称不能为空。" };
  }
  if (nextTitle !== undefined && nextTitle.length > MAX_PROJECT_TITLE_LENGTH) {
    return { status: "failed", reason: `项目名称请控制在 ${MAX_PROJECT_TITLE_LENGTH} 个字符以内。` };
  }

  const loaded = loadProjectWorkspace(storage, projectId, { mode: "readOnly" });
  if (loaded.status !== "ok") {
    return { status: "failed", reason: loaded.reason };
  }

  // A rename is metadata. It must not move the project in "recently updated",
  // which reports when the design work last changed.
  const workspace: MorphoWorkspace = nextTitle === undefined ? loaded.workspace : {
    ...loaded.workspace,
    project: {
      ...loaded.workspace.project,
      title: nextTitle
    }
  };

  if (nextTitle !== undefined && nextTitle !== loaded.workspace.project.title) {
    const written = writeProjectWorkspace(storage, workspace);
    if (written.status === "failed") {
      return { status: "failed", reason: "未能确认项目名称已保存。请重试。" };
    }
  }

  const summary = persistProjectSummary(storage, workspace, false);
  if (summary.status === "failed") {
    return { status: "failed", titleSaved: true, reason: "项目名称已写入，项目列表更新失败。可以重试更新列表。" };
  }
  return { status: "ok", catalog: summary.catalog, workspace };
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

  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        unreadableProjectCount += 1;
        continue;
      }
      const projectId = parseProjectWorkspaceStorageKey(key);
      if (key !== LEGACY_WORKSPACE_STORAGE_KEY && (!projectId || projectId === excludedProjectId)) continue;

      try {
        const raw = storage.getItem(key);
        const parsed = raw === null ? null : parseWorkspace(raw);
        if (parsed?.status !== "ok" || (projectId && parsed.workspace.project.id !== projectId)) {
          unreadableProjectCount += 1;
          continue;
        }
        for (const assetStorageKey of collectAssetStorageKeys(parsed.workspace)) {
          storageKeys.add(assetStorageKey);
        }
      } catch {
        unreadableProjectCount += 1;
      }
    }
    if (storage.length !== length) unreadableProjectCount += 1;
  } catch {
    unreadableProjectCount += 1;
  }

  return { storageKeys, unreadableProjectCount };
}
