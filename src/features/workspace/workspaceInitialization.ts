import type { MorphoWorkspace } from "@/domain/morpho/types";
import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudy";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { interruptActiveOperations } from "@/domain/operations/operations";
import { ensureCurrentCaseStudyAssets } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import {
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

  const catalog = initializeLocalProjectCatalog(storage, { mode });
  if (catalog.status === "failed") {
    return {
      workspace: createBlankWorkspace(projectId),
      migrationError: catalog.reason
    };
  }

  if (projectId === CURRENT_CASE_STUDY_ID && mode === "writer") {
    await (options.installCurrentCaseStudyAssets ?? ensureCurrentCaseStudyAssets)();
  }

  const loaded = loadProjectWorkspace(storage, projectId, { mode });
  if (loaded.status === "ok") {
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
  }> = {}
): Promise<WorkspaceLeaseLoadResult> {
  const lease = await (dependencies.acquireLease ?? acquireProjectWriteLease)(projectId);
  try {
    const loaded = await (dependencies.load ?? loadWorkspace)(projectId, {
      mode: lease.status === "heldElsewhere" ? "readOnly" : "writer"
    });
    return { lease, loaded };
  } catch (error) {
    if (lease.status === "granted") {
      lease.release();
    }
    throw error;
  }
}
