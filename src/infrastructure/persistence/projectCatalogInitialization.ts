import type { MorphoWorkspace } from "@/domain/morpho/types";
import { parseWorkspace } from "@/domain/morpho/workspaceCodec";
import {
  createCatalog, LEGACY_WORKSPACE_STORAGE_KEY, loadLocalProjectCatalogSnapshot, loadProjectWorkspace,
  parseProjectWorkspaceStorageKey, summarizeProject, writeCatalog, writeProjectWorkspace,
  type LocalProjectCatalog, type LocalProjectStoreMode
} from "./localProjectStore";
import { acquireProjectWriteLease, withProjectCatalogLock } from "./projectWriteLock";

type InitializationOptions = {
  mode?: LocalProjectStoreMode;
  ownedProjectId?: string;
  isCancelled?: () => boolean;
};
type CatalogLoadResult =
  | { status: "ok"; catalog: LocalProjectCatalog; didMigrate: boolean; migratedWorkspace?: MorphoWorkspace }
  | { status: "failed"; reason: string };

export async function initializeBrowserProjectCatalog(storage: Storage, options: InitializationOptions = {}): Promise<CatalogLoadResult> {
  try {
    const initialize = () => initializeCatalog(storage, options);
    return await (options.mode === "readOnly" ? initialize() : withProjectCatalogLock(initialize));
  } catch {
    return { status: "failed", reason: "无法初始化本地项目列表。" };
  }
}

async function initializeCatalog(storage: Storage, options: InitializationOptions): Promise<CatalogLoadResult> {
  const snapshot = loadLocalProjectCatalogSnapshot(storage);
  if (snapshot.status === "failed") return snapshot;
  const previous = snapshot.status === "ok" ? snapshot.catalog : createCatalog([]);
  const projects = [...previous.projects];
  const indexed = new Set(projects.map(project => project.id));

  // Only decode unindexed workspaces. Restore writes its blobs before publishing a workspace.
  for (let i = 0; i < storage.length; i++) {
    const id = parseProjectWorkspaceStorageKey(storage.key(i) ?? "");
    if (!id || indexed.has(id)) continue;
    const loaded = loadProjectWorkspace(storage, id, { mode: "readOnly" });
    if (loaded.status === "ok") {
      projects.push(summarizeProject(loaded.workspace));
      indexed.add(id);
    }
  }

  let initial: MorphoWorkspace | undefined;
  if (snapshot.status === "missing") {
    const legacyRaw = storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
    if (legacyRaw !== null) {
      const legacy = parseWorkspace(legacyRaw);
      if (legacy.status === "failed") return legacy;
      if (!indexed.has(legacy.workspace.project.id)) initial = legacy.workspace;
    } else if (!projects.length && !storage.getItem("morpho.case-study.install.v1")) {
      const { createCurrentCaseStudyWorkspace } = await import("@/domain/morpho/caseStudy/createCurrentCaseStudyWorkspace");
      initial = createCurrentCaseStudyWorkspace();
    }
  }

  if (snapshot.status === "ok" && !initial && projects.length === previous.projects.length) {
    return { status: "ok", catalog: previous, didMigrate: false };
  }

  const readOnly = options.mode === "readOnly";
  const lease = initial && !readOnly && initial.project.id !== options.ownedProjectId
    ? await acquireProjectWriteLease(initial.project.id) : undefined;
  try {
    if (options.isCancelled?.()) return { status: "failed", reason: "已取消初始化项目列表。" };
    if (lease?.status === "heldElsewhere") return { status: "failed", reason: "项目正在其他标签页初始化，请稍后重试。" };
    if (initial) {
      // Recheck after acquiring the lease. A corrupt or newer project must never be replaced by a seed.
      const existing = loadProjectWorkspace(storage, initial.project.id, { mode: "readOnly" });
      if (existing.status === "failed") return existing;
      if (existing.status === "ok") initial = existing.workspace;
      else if (!readOnly) {
        const saved = writeProjectWorkspace(storage, initial);
        if (saved.status === "failed") return saved;
      }
      projects.push(summarizeProject(initial));
    }
    const catalog = createCatalog(projects, previous.recentProjectId ?? initial?.project.id ?? projects[0]?.id);
    if (!readOnly) {
      const written = writeCatalog(storage, catalog);
      if (written.status === "failed") return written;
    }
    return { status: "ok", catalog, didMigrate: true, migratedWorkspace: initial };
  } finally {
    if (lease?.status === "granted") await lease.release();
  }
}
