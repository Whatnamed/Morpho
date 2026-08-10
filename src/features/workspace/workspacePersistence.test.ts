import { describe, expect, it, vi } from "vitest";

import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  canMutateWorkspace,
  createWorkspacePersistenceController,
  type WorkspacePersistenceWriter
} from "./workspacePersistence";

describe("workspace mutation capability", () => {
  const input = {
    persistence: { phase: "idle" as const, isDirty: false },
    isWorkspaceLoaded: true,
    routeProjectId: "project-a",
    workspaceProjectId: "project-a"
  };

  it.each(["idle", "saving", "saved"] as const)("allows mutation while the owned writer is %s", (phase) => {
    expect(canMutateWorkspace({ ...input, persistence: { phase, isDirty: phase === "saving" } })).toBe(true);
  });

  it.each(["loading", "error", "readOnly"] as const)("blocks mutation in the unsafe %s phase", (phase) => {
    expect(canMutateWorkspace({ ...input, persistence: { phase, isDirty: false } })).toBe(false);
  });

  it("blocks detached, mismatched, and migration-failed workspaces", () => {
    expect(canMutateWorkspace({ ...input, isWorkspaceLoaded: false })).toBe(false);
    expect(canMutateWorkspace({ ...input, workspaceProjectId: "project-b" })).toBe(false);
    expect(canMutateWorkspace({ ...input, migrationError: "migration failed" })).toBe(false);
  });
});

describe("workspace persistence controller", () => {
  it("coalesces rapid updates and saves the newest workspace after debounce", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer: WorkspacePersistenceWriter = (workspace) => {
      writes.push(workspace.project.title);
      return { status: "ok", savedAt: `saved-${writes.length}` };
    };
    const controller = createWorkspacePersistenceController({ writer, debounceMs: 400, maxWaitMs: 1400 });

    for (let index = 0; index < 100; index += 1) {
      controller.schedule(makeWorkspace("project-a", `title-${index}`));
    }

    expect(writes).toEqual([]);
    vi.advanceTimersByTime(399);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(writes).toEqual(["title-99"]);
    expect(controller.getState()).toMatchObject({ phase: "saved", isDirty: false, lastSavedAt: "saved-1" });
    controller.dispose();
    vi.useRealTimers();
  });

  it("uses max wait so continuous updates cannot postpone saving forever", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const controller = createWorkspacePersistenceController({
      debounceMs: 400,
      maxWaitMs: 1200,
      writer: (workspace) => {
        writes.push(workspace.project.title);
        return { status: "ok", savedAt: `saved-${writes.length}` };
      }
    });

    controller.schedule(makeWorkspace("project-a", "first"));
    for (let elapsed = 300; elapsed <= 1200; elapsed += 300) {
      vi.advanceTimersByTime(300);
      controller.schedule(makeWorkspace("project-a", `at-${elapsed}`));
    }

    expect(writes).toEqual(["at-900"]);
    vi.advanceTimersByTime(400);
    expect(writes).toEqual(["at-900", "at-1200"]);
    controller.dispose();
    vi.useRealTimers();
  });

  it("flushes the latest workspace immediately and clears pending timers", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const controller = createWorkspacePersistenceController({
      debounceMs: 400,
      maxWaitMs: 1200,
      writer: (workspace) => {
        writes.push(workspace.project.title);
        return { status: "ok", savedAt: "now" };
      }
    });

    controller.schedule(makeWorkspace("project-a", "draft"));
    const state = controller.flush();
    vi.advanceTimersByTime(1200);

    expect(writes).toEqual(["draft"]);
    expect(state).toMatchObject({ phase: "saved", isDirty: false, lastSavedAt: "now" });
    controller.dispose();
    vi.useRealTimers();
  });

  it("surfaces workspace and catalog failures without pretending the project is saved", () => {
    const workspaceFailure = createWorkspacePersistenceController({
      writer: () => ({ status: "failed", stage: "workspace", kind: "quotaExceeded", reason: "quota" })
    });
    workspaceFailure.schedule(makeWorkspace("project-a", "draft"));
    expect(workspaceFailure.flush()).toMatchObject({
      phase: "error",
      isDirty: true,
      error: "quota",
      failedStage: "workspace",
      failureKind: "quotaExceeded"
    });

    const catalogFailure = createWorkspacePersistenceController({
      writer: () => ({ status: "failed", stage: "catalog", kind: "unknown", reason: "catalog blocked" })
    });
    catalogFailure.schedule(makeWorkspace("project-a", "draft"));
    expect(catalogFailure.flush()).toMatchObject({
      phase: "error",
      isDirty: true,
      error: "catalog blocked",
      failedStage: "catalog"
    });
  });

  it("retries after an error and clears the failure after a successful write", () => {
    let shouldFail = true;
    const controller = createWorkspacePersistenceController({
      writer: (workspace) => {
        if (shouldFail) {
          return { status: "failed", stage: "workspace", kind: "unknown", reason: `failed:${workspace.project.title}` };
        }
        return { status: "ok", savedAt: "saved-after-retry" };
      }
    });

    controller.schedule(makeWorkspace("project-a", "bad"));
    expect(controller.flush()).toMatchObject({ phase: "error", isDirty: true, error: "failed:bad" });

    shouldFail = false;
    controller.schedule(makeWorkspace("project-a", "good"));

    const state = controller.flush();
    expect(state).toMatchObject({
      phase: "saved",
      isDirty: false,
      lastSavedAt: "saved-after-retry"
    });
    expect(state.error).toBeUndefined();
  });
});

function makeWorkspace(projectId: string, title: string): MorphoWorkspace {
  const workspace = createBlankWorkspace(projectId);
  return {
    ...workspace,
    project: {
      ...workspace.project,
      title
    }
  };
}
