import { initializeBrowserProjectCatalog } from "./projectCatalogInitialization";
import { describe, expect, it, vi } from "vitest";

import { CURRENT_CASE_STUDY_ID } from "../../domain/morpho/caseStudy/currentCaseStudy";
import { createBlankWorkspace } from "../../domain/morpho/workspace";
import { serializeWorkspace } from "../../domain/morpho/workspaceCodec";
import { createTestWorkspace } from "@/test/createTestWorkspace";
import {
  CATALOG_STORAGE_KEY,
  LEGACY_WORKSPACE_STORAGE_KEY,
  getProjectWorkspaceStorageKey,
  loadProjectWorkspace,
  persistProjectWorkspaceAndSummary,
  writeProjectWorkspace
} from "./localProjectStore";
import { createMemoryStorage } from "./memoryStorage";
import { deleteLocalProjectRecords } from "./projectLifecycle";

describe("local project catalog persistence", () => {
  it("does not replace legacy Nightrail after the user adds an object or a chat message", async () => {
    const storage = createMemoryStorage();
    const legacy = createTestWorkspace();
    const modified = {
      ...legacy,
      objects: {
        ...legacy.objects,
        "user-note": {
          id: "user-note",
          type: "text" as const,
          title: "用户补充",
          summary: "用户自己的内容",
          body: "保留这条笔记。",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      },
      ai: {
        ...legacy.ai,
        messages: [...legacy.ai.messages, { id: "user-message-added", role: "user" as const, body: "继续推进。" }]
      }
    };
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, serializeWorkspace(modified));

    const result = await initializeBrowserProjectCatalog(storage);

    expect(result).toMatchObject({ status: "ok", catalog: { recentProjectId: "project-nightrail" } });
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeNull();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBeTruthy();
  });

  it("preserves a legacy project when another local project already exists", async () => {
    const storage = createMemoryStorage();
    const legacy = createTestWorkspace();
    const other = createBlankWorkspace("project-other");
    writeProjectWorkspace(storage, legacy);
    writeProjectWorkspace(storage, other);
    storage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        recentProjectId: "project-other",
        projects: [
          {
            id: legacy.project.id,
            title: legacy.project.title,
            subtitle: legacy.project.subtitle,
            lastOpenedAt: legacy.project.lastOpenedAt,
            updatedAt: legacy.project.updatedAt
          },
          {
            id: other.project.id,
            title: other.project.title,
            subtitle: other.project.subtitle,
            lastOpenedAt: other.project.lastOpenedAt,
            updatedAt: other.project.updatedAt
          }
        ]
      })
    );

    const result = await initializeBrowserProjectCatalog(storage);

    expect(result).toMatchObject({ status: "ok", catalog: { projects: expect.arrayContaining([expect.objectContaining({ id: "project-nightrail" })]) } });
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeNull();
  });

  it("rebuilds an empty catalog from valid local project workspaces without replacing them", async () => {
    const storage = createMemoryStorage();
    const existing = createBlankWorkspace("project-existing");
    writeProjectWorkspace(storage, existing);
    storage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        projects: []
      })
    );

    const result = await initializeBrowserProjectCatalog(storage);

    expect(result).toMatchObject({
      status: "ok",
      didMigrate: true,
      catalog: {
        recentProjectId: "project-existing",
        projects: [expect.objectContaining({ id: "project-existing" })]
      }
    });
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-existing"))).toBeTruthy();
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeNull();
  });

  it("does not reinstall a deleted case study when a legacy project remains in the catalog", async () => {
    const storage = createMemoryStorage();
    expect((await initializeBrowserProjectCatalog(storage)).status).toBe("ok");
    const legacy = createTestWorkspace();
    legacy.project.title = "用户的旧项目";
    expect(persistProjectWorkspaceAndSummary(storage, legacy)).toMatchObject({ status: "ok" });
    expect(deleteLocalProjectRecords(storage, CURRENT_CASE_STUDY_ID).status).toBe("ok");
    expect(await initializeBrowserProjectCatalog(storage)).toMatchObject({
      status: "ok", catalog: { projects: [expect.objectContaining({ id: legacy.project.id })] }
    });
    expect(loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID).status).toBe("missing");
  });

  it("keeps corrupt legacy workspace raw data when migration fails", async () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, "{not-json");

    const result = await initializeBrowserProjectCatalog(storage);

    expect(result.status).toBe("failed");
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe("{not-json");
  });

  it("keeps the legacy source and the same migrated workspace when publishing the new catalog fails", async () => {
    const storage = createMemoryStorage();
    const legacyRaw = serializeWorkspace(createTestWorkspace());
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, legacyRaw);
    const setItem = storage.setItem;
    const blockCatalog = vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === CATALOG_STORAGE_KEY) throw new DOMException("quota", "QuotaExceededError");
      setItem(key, value);
    });

    expect(await initializeBrowserProjectCatalog(storage)).toMatchObject({ status: "failed", kind: "quotaExceeded" });
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    const caseKey = getProjectWorkspaceStorageKey("project-nightrail");
    const installed = storage.getItem(caseKey);
    expect(installed).not.toBeNull();

    blockCatalog.mockRestore();
    expect(await initializeBrowserProjectCatalog(storage)).toMatchObject({
      status: "ok", catalog: { recentProjectId: "project-nightrail" }
    });
    expect(storage.getItem(caseKey)).toBe(installed);
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
  });

  it("recovers a new project after a catalog write failure and restart without reopening listed workspaces", async () => {
    const storage = createMemoryStorage();
    const a = createBlankWorkspace("already-listed");
    const b = createBlankWorkspace("unlisted");
    expect(persistProjectWorkspaceAndSummary(storage, a).status).toBe("ok");
    const setItem = storage.setItem;
    const fault = vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === CATALOG_STORAGE_KEY) throw new Error("catalog unavailable");
      setItem(key, value);
    });
    expect(persistProjectWorkspaceAndSummary(storage, b)).toMatchObject({ status: "failed", stage: "catalog" });
    fault.mockRestore();
    storage.setItem(getProjectWorkspaceStorageKey("invalid"), "{");
    storage.setItem(getProjectWorkspaceStorageKey("wrong-id"), serializeWorkspace(b));
    const reads = vi.spyOn(storage, "getItem");
    const result = await initializeBrowserProjectCatalog(storage);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error(result.reason);
    expect(result.catalog.projects.map(project => project.id).sort()).toEqual([a.project.id, b.project.id]);
    expect(result.catalog.recentProjectId).toBe(a.project.id);
    expect(reads).not.toHaveBeenCalledWith(getProjectWorkspaceStorageKey(a.project.id));
    expect(await initializeBrowserProjectCatalog(storage)).toMatchObject({ status: "ok", didMigrate: false });
  });

  it("saves and loads each project workspace independently", () => {
    const storage = createMemoryStorage();
    const workspaceA = createBlankWorkspace("project-a");
    const workspaceB = createBlankWorkspace("project-b");

    writeProjectWorkspace(storage, workspaceA);
    writeProjectWorkspace(storage, workspaceB);

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
