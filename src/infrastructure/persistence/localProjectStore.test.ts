import { describe, expect, it, vi } from "vitest";

import { CURRENT_CASE_STUDY_ID } from "../../domain/morpho/caseStudy/currentCaseStudy";
import { fingerprintCaseStudyWorkspace } from "../../domain/morpho/caseStudy/caseStudyFingerprint";
import { CASE_STUDY_INSTALLATION_STORAGE_KEY } from "../../domain/morpho/caseStudy/caseStudyInstallation";
import { createBlankWorkspace, createTestWorkspace, serializeWorkspace } from "../../domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  LEGACY_WORKSPACE_STORAGE_KEY,
  getProjectWorkspaceStorageKey,
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  persistProjectWorkspaceAndSummary,
  saveProjectWorkspace
} from "./localProjectStore";
import { createMemoryStorage } from "./memoryStorage";
import { deleteLocalProjectRecords } from "./projectLifecycle";

describe("local project catalog persistence", () => {
  it("replaces the sole pristine legacy Nightrail workspace with the current case study", () => {
    const storage = createMemoryStorage();
    const legacyRaw = serializeWorkspace(createTestWorkspace());
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, legacyRaw);

    const result = initializeLocalProjectCatalog(storage);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected catalog migration to succeed.");
    }
    expect(result.catalog.projects.map((project) => project.id)).toEqual([CURRENT_CASE_STUDY_ID]);
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-nightrail"))).toBeNull();
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeTruthy();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBeNull();
    const loaded = loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID);
    if (loaded.status !== "ok") throw new Error("Installed workspace missing");
    expect(JSON.parse(storage.getItem(CASE_STUDY_INSTALLATION_STORAGE_KEY)!)).toMatchObject({ workspaceFingerprint: fingerprintCaseStudyWorkspace(loaded.workspace) });
    const identities = Object.values(loaded.workspace.objects).map((object) => object.incarnationId);
    initializeLocalProjectCatalog(storage);
    const reloaded = loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID);
    if (reloaded.status !== "ok") throw new Error("Reloaded workspace missing");
    expect(Object.values(reloaded.workspace.objects).map((object) => object.incarnationId)).toEqual(identities);
  });

  it("still recognizes pristine Nightrail after only view and selection state changes", () => {
    const storage = createMemoryStorage();
    const legacy = createTestWorkspace();
    storage.setItem(
      LEGACY_WORKSPACE_STORAGE_KEY,
      serializeWorkspace({
        ...legacy,
        project: {
          ...legacy.project,
          lastOpenedAt: "2026-07-13T00:00:00.000Z",
          updatedAt: "2026-07-13T00:00:00.000Z"
        },
        canvas: {
          ...legacy.canvas,
          view: { x: 100, y: 40, zoom: 1.2 }
        },
        ui: {
          ...legacy.ui,
          lastSelectionIds: [],
          canvasView: { x: 100, y: 40, zoom: 1.2 }
        }
      })
    );

    const result = initializeLocalProjectCatalog(storage);

    expect(result).toMatchObject({ status: "ok", catalog: { recentProjectId: CURRENT_CASE_STUDY_ID } });
  });

  it("does not replace legacy Nightrail after the user adds an object or a chat message", () => {
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

    const result = initializeLocalProjectCatalog(storage);

    expect(result).toMatchObject({ status: "ok", catalog: { recentProjectId: "project-nightrail" } });
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeNull();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBeTruthy();
  });

  it("adds the current case study beside a modified catalogued Nightrail project", () => {
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
          summary: "保留这条笔记。",
          body: "保留这条笔记。",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    saveProjectWorkspace(storage, modified);
    storage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        recentProjectId: modified.project.id,
        projects: [
          {
            id: modified.project.id,
            title: modified.project.title,
            subtitle: modified.project.subtitle,
            lastOpenedAt: modified.project.lastOpenedAt,
            updatedAt: modified.project.updatedAt
          }
        ]
      })
    );

    const result = initializeLocalProjectCatalog(storage);

    expect(result).toMatchObject({
      status: "ok",
      didMigrate: true,
      catalog: {
        recentProjectId: CURRENT_CASE_STUDY_ID,
        projects: expect.arrayContaining([
          expect.objectContaining({ id: modified.project.id }),
          expect.objectContaining({ id: CURRENT_CASE_STUDY_ID })
        ])
      }
    });
    expect(storage.getItem(getProjectWorkspaceStorageKey(modified.project.id))).toBeTruthy();
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeTruthy();
  });

  it("preserves a legacy project when another local project already exists", () => {
    const storage = createMemoryStorage();
    const legacy = createTestWorkspace();
    const other = createBlankWorkspace("project-other");
    saveProjectWorkspace(storage, legacy);
    saveProjectWorkspace(storage, other);
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

    const result = initializeLocalProjectCatalog(storage);

    expect(result).toMatchObject({ status: "ok", catalog: { projects: expect.arrayContaining([expect.objectContaining({ id: "project-nightrail" })]) } });
    expect(storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBeNull();
  });

  it("rebuilds an empty catalog from valid local project workspaces without replacing them", () => {
    const storage = createMemoryStorage();
    const existing = createBlankWorkspace("project-existing");
    saveProjectWorkspace(storage, existing);
    storage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        projects: []
      })
    );

    const result = initializeLocalProjectCatalog(storage);

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

  it("does not reinstall a deleted case study when a legacy project remains in the catalog", () => {
    const storage = createMemoryStorage();
    expect(initializeLocalProjectCatalog(storage).status).toBe("ok");
    const legacy = createTestWorkspace();
    legacy.project.title = "用户的旧项目";
    expect(persistProjectWorkspaceAndSummary(storage, legacy)).toMatchObject({ status: "ok" });
    expect(deleteLocalProjectRecords(storage, CURRENT_CASE_STUDY_ID).status).toBe("ok");
    expect(initializeLocalProjectCatalog(storage)).toMatchObject({
      status: "ok", catalog: { projects: [expect.objectContaining({ id: legacy.project.id })] }
    });
    expect(loadProjectWorkspace(storage, CURRENT_CASE_STUDY_ID).status).toBe("missing");
  });

  it("keeps corrupt legacy workspace raw data when migration fails", () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, "{not-json");

    const result = initializeLocalProjectCatalog(storage);

    expect(result.status).toBe("failed");
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe("{not-json");
  });

  it("keeps the legacy source and the same case-study workspace when publishing the new catalog fails", () => {
    const storage = createMemoryStorage();
    const legacyRaw = serializeWorkspace(createTestWorkspace());
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, legacyRaw);
    const setItem = storage.setItem;
    const blockCatalog = vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === CATALOG_STORAGE_KEY) throw new DOMException("quota", "QuotaExceededError");
      setItem(key, value);
    });

    expect(initializeLocalProjectCatalog(storage)).toMatchObject({ status: "failed", kind: "quotaExceeded" });
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
    expect(storage.getItem(CATALOG_STORAGE_KEY)).toBeNull();
    const caseKey = getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID);
    const installed = storage.getItem(caseKey);
    expect(installed).not.toBeNull();

    blockCatalog.mockRestore();
    expect(initializeLocalProjectCatalog(storage)).toMatchObject({
      status: "ok", catalog: { recentProjectId: CURRENT_CASE_STUDY_ID }
    });
    expect(storage.getItem(caseKey)).toBe(installed);
    expect(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBeNull();
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
