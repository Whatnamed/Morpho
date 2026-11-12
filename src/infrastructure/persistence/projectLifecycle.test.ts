import { describe, expect, it, vi } from "vitest";

import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";

import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  loadLocalProjectCatalogSnapshot,
  loadProjectWorkspace,
  saveProjectWorkspace,
  summarizeProject,
  writeCatalog
} from "./localProjectStore";
import { createMemoryStorage } from "./memoryStorage";
import {
  deleteLocalProjectRecords,
  MAX_PROJECT_TITLE_LENGTH,
  planLocalProjectDeletion,
  renameLocalProject,
  sameProjectDeletionPlan
} from "./projectLifecycle";

function asset(id: string, storageKey: string): AssetRecord {
  return {
    id,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 1024,
    createdAt: "2026-07-01T00:00:00.000Z",
    storageKey,
    sourceType: "originalImage"
  };
}

function projectWith(projectId: string, assets: AssetRecord[]): MorphoWorkspace {
  const workspace = createBlankWorkspace(projectId);
  return {
    ...workspace,
    assets: Object.fromEntries(assets.map((entry) => [entry.id, entry]))
  };
}

function seedProjects(storage: Storage, workspaces: MorphoWorkspace[]): void {
  for (const workspace of workspaces) {
    saveProjectWorkspace(storage, workspace);
  }
  writeCatalog(storage, createCatalog(workspaces.map(summarizeProject), workspaces[0]?.project.id));
}

describe("planLocalProjectDeletion", () => {
  it("reports the blobs only this project references", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [
      projectWith("project-a", [asset("asset-1", "blob:asset-1"), asset("asset-2", "blob:asset-2")]),
      projectWith("project-b", [asset("asset-9", "blob:asset-9")])
    ]);

    const result = planLocalProjectDeletion(storage, "project-a");

    expect(result).toMatchObject({
      status: "ok",
      plan: {
        projectId: "project-a",
        title: expect.any(String),
        exclusiveStorageKeys: ["blob:asset-1", "blob:asset-2"],
        sharedStorageKeys: [],
        unreadableProjectCount: 0
      }
    });
  });

  it("keeps a blob another project still references", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [
      projectWith("project-a", [asset("asset-1", "blob:shared"), asset("asset-2", "blob:only-a")]),
      projectWith("project-b", [asset("asset-3", "blob:shared")])
    ]);

    const result = planLocalProjectDeletion(storage, "project-a");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.exclusiveStorageKeys).toEqual(["blob:only-a"]);
    expect(result.plan.sharedStorageKeys).toEqual(["blob:shared"]);
  });

  it("counts a workspace missing from the catalog as an owner", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [asset("asset-1", "blob:shared")])]);
    // Present in storage, absent from the catalog: still recoverable data.
    storage.setItem(
      getProjectWorkspaceStorageKey("project-orphan"),
      serializeWorkspace(projectWith("project-orphan", [asset("asset-7", "blob:shared")]))
    );

    const result = planLocalProjectDeletion(storage, "project-a");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.exclusiveStorageKeys).toEqual([]);
    expect(result.plan.sharedStorageKeys).toEqual(["blob:shared"]);
  });

  it("reclaims nothing while any stored workspace cannot be read", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [asset("asset-1", "blob:only-a")])]);
    storage.setItem(getProjectWorkspaceStorageKey("project-corrupt"), "{not-json");

    const result = planLocalProjectDeletion(storage, "project-a");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.exclusiveStorageKeys).toEqual([]);
    expect(result.plan.sharedStorageKeys).toEqual(["blob:only-a"]);
    expect(result.plan.unreadableProjectCount).toBe(1);
  });

  it("refuses to plan a deletion for a project it cannot read", () => {
    const storage = createMemoryStorage();

    expect(planLocalProjectDeletion(storage, "project-missing").status).toBe("missing");
  });

  it("reads old workspace data without migrating it on disk, and detects changes to the previewed content", () => {
    const storage = createMemoryStorage();
    const key = getProjectWorkspaceStorageKey("project-a");
    const workspace = projectWith("project-a", []);
    const legacy = JSON.stringify({ ...workspace, schemaVersion: 17 });
    storage.setItem(key, legacy);
    expect(loadProjectWorkspace(storage, "project-a", { mode: "readOnly" })).toMatchObject({ didMigrate: true });
    const before = planLocalProjectDeletion(storage, "project-a");
    expect(storage.getItem(key)).toBe(legacy);

    saveProjectWorkspace(storage, { ...workspace, ui: { ...workspace.ui, aiOpen: false } });
    const after = planLocalProjectDeletion(storage, "project-a");
    if (before.status !== "ok" || after.status !== "ok") throw new Error("Expected two readable previews.");
    expect(sameProjectDeletionPlan(before.plan, after.plan)).toBe(false);
  });

  it("retains every blob when storage key enumeration fails", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [asset("asset-1", "blob:only-a")])]);
    vi.spyOn(storage, "key").mockImplementation(() => { throw new Error("blocked"); });
    expect(planLocalProjectDeletion(storage, "project-a")).toMatchObject({
      status: "ok",
      plan: { exclusiveStorageKeys: [], sharedStorageKeys: ["blob:only-a"], unreadableProjectCount: 1 }
    });
  });
});

describe("deleteLocalProjectRecords", () => {
  it("removes the workspace and its catalog entry, leaving other projects intact", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [
      projectWith("project-a", [asset("asset-1", "blob:asset-1")]),
      projectWith("project-b", [])
    ]);

    const result = deleteLocalProjectRecords(storage, "project-a");

    expect(result.status).toBe("ok");
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-a"))).toBeNull();
    expect(loadProjectWorkspace(storage, "project-b").status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.catalog.projects.map((project) => project.id)).toEqual(["project-b"]);
  });

  it("moves the recent pointer off the deleted project", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", []), projectWith("project-b", [])]);
    writeCatalog(
      storage,
      createCatalog(
        [summarizeProject(projectWith("project-a", [])), summarizeProject(projectWith("project-b", []))],
        "project-a"
      )
    );

    const result = deleteLocalProjectRecords(storage, "project-a");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.catalog.recentProjectId).toBe("project-b");
    expect(result.catalog.recentProjectId).not.toBe("project-a");
  });

  it("leaves an empty catalog behind when the last project is deleted", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-only", [])]);

    const result = deleteLocalProjectRecords(storage, "project-only");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.catalog.projects).toEqual([]);
    expect(result.catalog.recentProjectId).toBeUndefined();
  });

  it("does not delete blob data itself", () => {
    // Blob cleanup is the caller's job, ordered after this write so that an
    // IndexedDB failure cannot leave a half-deleted project behind.
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [asset("asset-1", "blob:asset-1")])]);

    expect(deleteLocalProjectRecords(storage, "project-a").status).toBe("ok");
  });

  it("reports a catalog write failure without pretending the project survived", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", []), projectWith("project-b", [])]);

    const originalCatalog = storage.getItem(CATALOG_STORAGE_KEY);
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const result = deleteLocalProjectRecords(storage, "project-a");

    expect(result).toMatchObject({ status: "failed", workspaceDeleted: true });
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBe(originalCatalog);
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-a"))).toBeNull();
    setItem.mockRestore();
    expect(deleteLocalProjectRecords(storage, "project-a")).toMatchObject({
      status: "ok", catalog: { projects: [expect.objectContaining({ id: "project-b" })] }
    });
  });

  it.each(["throw", "ignore", "read-back"] as const)("retains the catalog after a %s deletion failure", (failure) => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", []), projectWith("project-b", [])]);
    const originalCatalog = storage.getItem(CATALOG_STORAGE_KEY);
    const key = getProjectWorkspaceStorageKey("project-a");
    const remove = storage.removeItem;
    const get = storage.getItem;
    let attempted = false;
    vi.spyOn(storage, "removeItem").mockImplementation((key) => {
      attempted = true;
      if (failure === "throw") throw new Error("blocked");
      if (failure === "read-back") remove(key);
    });
    vi.spyOn(storage, "getItem").mockImplementation((name) => {
      if (attempted && name === key && failure === "read-back") throw new Error("blocked");
      return get(name);
    });
    expect(deleteLocalProjectRecords(storage, "project-a")).toMatchObject({ status: "failed", workspaceDeleted: false });
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBe(originalCatalog);
  });
});

describe("renameLocalProject", () => {
  it("renames the workspace and the catalog entry together", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [])]);

    const result = renameLocalProject(storage, "project-a", "  折叠伞骨结构  ");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.workspace.project.title).toBe("折叠伞骨结构");

    const reloaded = loadProjectWorkspace(storage, "project-a");
    expect(reloaded.status).toBe("ok");
    if (reloaded.status !== "ok") return;
    expect(reloaded.workspace.project.title).toBe("折叠伞骨结构");

    const catalog = loadLocalProjectCatalogSnapshot(storage);
    expect(catalog.status).toBe("ok");
    if (catalog.status !== "ok") return;
    expect(catalog.catalog.projects.find((project) => project.id === "project-a")?.title).toBe("折叠伞骨结构");
  });

  it("does not move the project in recently-updated order", () => {
    const storage = createMemoryStorage();
    const original = projectWith("project-a", []);
    seedProjects(storage, [original]);

    const result = renameLocalProject(storage, "project-a", "新名称");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.workspace.project.updatedAt).toBe(original.project.updatedAt);
  });

  it("rejects an empty or oversized name without touching stored data", () => {
    const storage = createMemoryStorage();
    seedProjects(storage, [projectWith("project-a", [])]);
    const before = storage.getItem(getProjectWorkspaceStorageKey("project-a"));

    expect(renameLocalProject(storage, "project-a", "   ").status).toBe("failed");
    expect(renameLocalProject(storage, "project-a", "长".repeat(MAX_PROJECT_TITLE_LENGTH + 1)).status).toBe("failed");
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-a"))).toBe(before);
  });

  it("refuses to rename a project it cannot read", () => {
    const storage = createMemoryStorage();

    expect(renameLocalProject(storage, "project-missing", "新名称").status).toBe("failed");
  });

  it("keeps an unreadable catalog and repairs only the latest summary on retry", () => {
    const storage = createMemoryStorage();
    const target = projectWith("project-a", []);
    const other = summarizeProject(projectWith("project-b", []));
    seedProjects(storage, [target]);
    writeCatalog(storage, createCatalog([summarizeProject(target), other], other.id));
    const rawCatalog = storage.getItem(CATALOG_STORAGE_KEY);
    const get = storage.getItem;
    const read = vi.spyOn(storage, "getItem").mockImplementation((key) => {
      if (key === CATALOG_STORAGE_KEY) throw new DOMException("blocked", "SecurityError");
      return get(key);
    });
    expect(renameLocalProject(storage, target.project.id, "已写入")).toMatchObject({ status: "failed", titleSaved: true });
    expect(loadProjectWorkspace(storage, target.project.id)).toMatchObject({ workspace: { project: { title: "已写入" } } });
    read.mockRestore();
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBe(rawCatalog);

    saveProjectWorkspace(storage, { ...target, project: { ...target.project, title: "后来修改" } });
    const latest = storage.getItem(getProjectWorkspaceStorageKey(target.project.id));
    expect(renameLocalProject(storage, target.project.id)).toMatchObject({
      status: "ok", catalog: { recentProjectId: other.id, projects: expect.arrayContaining([
        other, expect.objectContaining({ id: target.project.id, title: "后来修改" })
      ]) }
    });
    expect(storage.getItem(getProjectWorkspaceStorageKey(target.project.id))).toBe(latest);
  });
});
