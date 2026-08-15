import { describe, expect, it, vi } from "vitest";

import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudy";
import { LEGACY_NIGHTRAIL_PROJECT_ID } from "@/domain/morpho/caseStudy/legacyNightrailMigration";
import { createBlankWorkspace, createTestWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import { LEGACY_WORKSPACE_STORAGE_KEY } from "@/infrastructure/persistence/localProjectStore";
import { createMemoryStorage } from "@/infrastructure/persistence/memoryStorage";
import { acquireLeaseThenLoadWorkspace, loadWorkspace } from "./workspaceInitialization";

describe("workspace initialization lease boundary", () => {
  it("acquires the lease before selecting a writer or read-only loader", async () => {
    const events: string[] = [];
    const load = vi.fn(async (_projectId: string, options: { mode?: "writer" | "readOnly" } = {}) => {
      events.push(`load:${options.mode}`);
      return { workspace: createBlankWorkspace("project-a") };
    });
    const acquireLease = vi.fn(async () => {
      events.push("lease");
      return { status: "heldElsewhere" as const };
    });

    const result = await acquireLeaseThenLoadWorkspace("project-a", { acquireLease, load });

    expect(result.lease.status).toBe("heldElsewhere");
    expect(events).toEqual(["lease", "load:readOnly"]);
  });

  it("keeps a read-only initialization entirely out of shared storage and BlobStore", async () => {
    const tracked = createTrackedStorage();
    const installCurrentCaseStudyAssets = vi.fn(async () => []);

    const result = await loadWorkspace(CURRENT_CASE_STUDY_ID, {
      mode: "readOnly",
      storage: tracked.storage,
      installCurrentCaseStudyAssets
    });

    expect(result.workspace.project.id).toBe(CURRENT_CASE_STUDY_ID);
    expect(tracked.setCalls).toBe(0);
    expect(tracked.removeCalls).toBe(0);
    expect(installCurrentCaseStudyAssets).not.toHaveBeenCalled();
  });

  it("keeps read-only in-memory legacy migration from removing the legacy workspace", async () => {
    const tracked = createTrackedStorage();
    tracked.storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, serializeWorkspace(createTestWorkspace()));
    tracked.resetCounts();
    const legacyRaw = tracked.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);

    const result = await loadWorkspace(CURRENT_CASE_STUDY_ID, {
      mode: "readOnly",
      storage: tracked.storage
    });

    expect(result.workspace.project.id).toBe(CURRENT_CASE_STUDY_ID);
    expect(tracked.setCalls).toBe(0);
    expect(tracked.removeCalls).toBe(0);
    expect(tracked.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
  });

  it("loads a modified legacy workspace from memory without persisting the migration", async () => {
    const tracked = createTrackedStorage();
    const legacy = createTestWorkspace();
    tracked.storage.setItem(
      LEGACY_WORKSPACE_STORAGE_KEY,
      serializeWorkspace({
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
      })
    );
    tracked.resetCounts();
    const legacyRaw = tracked.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);

    const result = await loadWorkspace(LEGACY_NIGHTRAIL_PROJECT_ID, {
      mode: "readOnly",
      storage: tracked.storage
    });

    expect(result.workspace.project.id).toBe(LEGACY_NIGHTRAIL_PROJECT_ID);
    expect(result.workspace.objects["user-note"]).toBeDefined();
    expect(tracked.setCalls).toBe(0);
    expect(tracked.removeCalls).toBe(0);
    expect(tracked.storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY)).toBe(legacyRaw);
  });

  it("keeps writer initialization able to seed the catalog and current case-study assets", async () => {
    const tracked = createTrackedStorage();
    const installCurrentCaseStudyAssets = vi.fn(async () => []);

    const result = await loadWorkspace(CURRENT_CASE_STUDY_ID, {
      mode: "writer",
      storage: tracked.storage,
      installCurrentCaseStudyAssets
    });

    expect(result.workspace.project.id).toBe(CURRENT_CASE_STUDY_ID);
    expect(tracked.setCalls).toBeGreaterThan(0);
    expect(installCurrentCaseStudyAssets).toHaveBeenCalledTimes(1);
  });
});

function createTrackedStorage() {
  const base = createMemoryStorage();
  let setCalls = 0;
  let removeCalls = 0;
  const storage: Storage = {
    get length() {
      return base.length;
    },
    clear: () => base.clear(),
    getItem: (key) => base.getItem(key),
    key: (index) => base.key(index),
    removeItem: (key) => {
      removeCalls += 1;
      base.removeItem(key);
    },
    setItem: (key, value) => {
      setCalls += 1;
      base.setItem(key, value);
    }
  };

  return {
    storage,
    get setCalls() {
      return setCalls;
    },
    get removeCalls() {
      return removeCalls;
    },
    resetCounts() {
      setCalls = 0;
      removeCalls = 0;
    }
  };
}
