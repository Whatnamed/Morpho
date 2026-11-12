import type { MorphoWorkspace } from "@/domain/morpho/types";
import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudy";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { interruptActiveOperations } from "@/domain/operations/operations";
import { ensureCurrentCaseStudyAssets } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import {
  initializeBrowserProjectCatalog,
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  type LocalProjectStoreMode
} from "@/infrastructure/persistence/localProjectStore";
import {
  acquireProjectWriteLease,
  type ProjectWriteLease
} from "@/infrastructure/persistence/projectWriteLock";

export type PersistentWorkspaceLoadResult = {
  workspace: MorphoWorkspace;
  migrationError?: string;
};

export type WorkspaceInitializationOptions = Readonly<{
  mode?: LocalProjectStoreMode;
  storage?: Storage;
  installCurrentCaseStudyAssets?: typeof ensureCurrentCaseStudyAssets;
  isCancelled?: () => boolean;
}>;

export type WorkspaceLeaseLoadResult = Readonly<{
  lease: ProjectWriteLease;
  loaded: PersistentWorkspaceLoadResult;
}>;

/**
 * Load a project after the caller has decided whether this tab is the writer.
 * Read-only tabs may parse and migrate values in memory, but never repair the
 * catalog, persist a workspace migration, or seed the shared BlobStore.
 */
export async function loadWorkspace(
  projectId: string,
  options: WorkspaceInitializationOptions = {}
): Promise<PersistentWorkspaceLoadResult> {
  const mode = options.mode ?? "writer";
  const storage = options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!storage) {
    return { workspace: createBlankWorkspace(projectId) };
  }

  const catalog = mode === "readOnly"
    ? initializeLocalProjectCatalog(storage, { mode })
    : await initializeBrowserProjectCatalog(storage, { ownedProjectId: projectId, isCancelled: options.isCancelled }).catch(() => ({
        status: "failed" as const, reason: "浏览器无法初始化本地项目列表。"
      }));
  if (catalog.status === "failed") {
    return {
      workspace: createBlankWorkspace(projectId),
      migrationError: catalog.reason
    };
  }
  if (options.isCancelled?.()) return { workspace: createBlankWorkspace(projectId) };

  const loaded = loadProjectWorkspace(storage, projectId, { mode });
  if (loaded.status === "ok") {
    if (projectId === CURRENT_CASE_STUDY_ID && mode === "writer") {
      await (options.installCurrentCaseStudyAssets ?? ensureCurrentCaseStudyAssets)().catch((error: unknown) => {
        console.warn("Morpho current case study assets could not be installed.", error);
      });
    }
    return { workspace: interruptActiveOperations(loaded.workspace, "browserReload") };
  }

  if (catalog.migratedWorkspace?.project.id === projectId) {
    return { workspace: interruptActiveOperations(catalog.migratedWorkspace, "browserReload") };
  }

  // A read-only tab may arrive while the writer is still seeding the built-in
  // project. Keep the view usable from the same deterministic fixture without
  // materializing its catalog, workspace, or binary assets in shared storage.
  if (mode === "readOnly" && projectId === CURRENT_CASE_STUDY_ID && loaded.status === "missing") {
    return { workspace: createCurrentCaseStudyWorkspace() };
  }

  return {
    workspace: createBlankWorkspace(projectId),
    migrationError: loaded.reason
  };
}

export async function acquireLeaseThenLoadWorkspace(
  projectId: string,
  dependencies: Readonly<{
    acquireLease?: typeof acquireProjectWriteLease;
    load?: typeof loadWorkspace;
    isCancelled?: () => boolean;
  }> = {}
): Promise<WorkspaceLeaseLoadResult> {
  const lease = await (dependencies.acquireLease ?? acquireProjectWriteLease)(projectId);
  try {
    const loaded = await (dependencies.load ?? loadWorkspace)(projectId, {
      mode: lease.status === "heldElsewhere" ? "readOnly" : "writer",
      isCancelled: dependencies.isCancelled
    });
    return { lease, loaded };
  } catch (error) {
    if (lease.status === "granted") {
      lease.release();
    }
    throw error;
  }
}
