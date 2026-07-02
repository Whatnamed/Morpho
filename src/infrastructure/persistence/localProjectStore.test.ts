import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace, serializeWorkspace } from "../../domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  LEGACY_WORKSPACE_STORAGE_KEY,
  getProjectWorkspaceStorageKey,
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  persistProjectWorkspaceAndSummary,
  saveProjectWorkspace
} from "./localProjectStore";

describe("local project catalog persistence", () => {
  it("migrates the legacy single Nightrail workspace into a project catalog without deleting legacy raw data", () => {
    const storage = createMemoryStorage();
    const legacyRaw = serializeWorkspace(createInitialWorkspace());
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, legacyRaw);

    const result = initializeLocalProjectCatalog(storage);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected catalog migration to succeed.");
    }
    expect(result.catalog.projects.map((project) => project.id)).toContain("project-nightrail");
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-nightrail"))).toBeTruthy();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
  });

  it("keeps corrupt legacy workspace raw data when migration fails", () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, "{not-json");

    const result = initializeLocalProjectCatalog(storage);

    expect(result.status).toBe("failed");
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe("{not-json");
  });

  it("saves and loads each project workspace independently", () => {
    const storage = createMemoryStorage();
    const workspaceA = createBlankWorkspace("project-a");
    const workspaceB = createBlankWorkspace("project-b");

    saveProjectWorkspace(storage, workspaceA);
    saveProjectWorkspace(storage, workspaceB);

    const loadedA = loadProjectWorkspace(storage, "project-a");
    const loadedB = loadProjectWorkspace(storage, "project-b");

    expect(loadedA.status).toBe("ok");
    expect(loadedB.status).toBe("ok");
    if (loadedA.status === "ok" && loadedB.status === "ok") {
      expect(loadedA.workspace.project.id).toBe("project-a");
      expect(loadedB.workspace.project.id).toBe("project-b");
    }
  });

  it("reports workspace write failures without updating the catalog", () => {
    const storage = createMemoryStorage({
      failSetKeys: [getProjectWorkspaceStorageKey("project-a")]
    });
    const workspace = createBlankWorkspace("project-a");

    const result = persistProjectWorkspaceAndSummary(storage, workspace);

    expect(result).toMatchObject({ status: "failed", stage: "workspace" });
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
  });

  it("reports catalog write failures while keeping the written workspace", () => {
    const storage = createMemoryStorage({
      failSetKeys: [CATALOG_STORAGE_KEY]
    });
    const workspace = createBlankWorkspace("project-a");

    const result = persistProjectWorkspaceAndSummary(storage, workspace);

    expect(result).toMatchObject({ status: "failed", stage: "catalog" });
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-a"))).toBeTruthy();
  });
});

function createMemoryStorage(options: { failSetKeys?: string[] } = {}): Storage {
  const values = new Map<string, string>();
  const failSetKeys = new Set(options.failSetKeys ?? []);

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      if (failSetKeys.has(key)) {
        throw new Error(`Blocked write for ${key}`);
      }
      values.set(key, value);
    }
  };
}
