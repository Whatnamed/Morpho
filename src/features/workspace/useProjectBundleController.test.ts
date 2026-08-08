// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  exportEditableProjectBackupBundle as buildEditableProjectBackup,
  inspectEditableProjectBackupBundle as inspectBuiltEditableProjectBackup,
  type InspectedEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import {
  useProjectBundleController,
  type ProjectBundleController,
  type ProjectBundleControllerServices,
  type UseProjectBundleControllerInput
} from "./useProjectBundleController";

const NOW = "2026-08-05T08:00:00.000Z";
const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useProjectBundleController", () => {
  it("opens and closes while preserving archive option defaults", async () => {
    const harness = await renderController(createInput());

    expect(harness.current()).toMatchObject({
      isOpen: false,
      archiveIncludeFullChat: false,
      archiveIncludeContinuity: false
    });
    act(() => harness.current().open());
    expect(harness.current().isOpen).toBe(true);
    act(() => harness.current().close());
    expect(harness.current().isOpen).toBe(false);
  });

  it("updates both human-readable archive options", async () => {
    const harness = await renderController(createInput());

    act(() => {
      harness.current().setArchiveIncludeFullChat(true);
      harness.current().setArchiveIncludeContinuity(true);
    });

    expect(harness.current().archiveIncludeFullChat).toBe(true);
    expect(harness.current().archiveIncludeContinuity).toBe(true);
  });

  it("keeps editable backup export parameters and download behavior", async () => {
    const file = new File(["backup"], "backup.zip", { type: "application/zip" });
    const exportEditable = vi.fn(async () => ({ status: "ok" as const, file, diagnostics: [] }));
    const download = vi.fn();
    const workspace = createBlankWorkspace("project-backup");
    const harness = await renderController(createInput({ workspace, exportEditable, download }));

    await act(async () => {
      await harness.current().exportEditableBackup();
    });

    expect(exportEditable).toHaveBeenCalledWith(workspace, {
      blobStore: nullBlobStore,
      chat: "full",
      projectContinuity: "current"
    });
    expect(download).toHaveBeenCalledWith(file);
    expect(harness.current().message).toEqual({ tone: "success", text: "备份已导出。" });
  });

  it("keeps readable archive parameters for both option values", async () => {
    const file = new File(["archive"], "archive.zip", { type: "application/zip" });
    const exportArchive = vi.fn(async () => ({ status: "ok" as const, file, diagnostics: [] }));
    const workspace = createBlankWorkspace("project-archive");
    const harness = await renderController(createInput({ workspace, exportArchive }));

    await act(async () => {
      await harness.current().exportReadableArchive();
    });
    expect(exportArchive).toHaveBeenLastCalledWith(workspace, {
      blobStore: nullBlobStore,
      chat: "none",
      projectContinuity: "none"
    });

    act(() => {
      harness.current().setArchiveIncludeFullChat(true);
      harness.current().setArchiveIncludeContinuity(true);
    });
    await act(async () => {
      await harness.current().exportReadableArchive();
    });
    expect(exportArchive).toHaveBeenLastCalledWith(workspace, {
      blobStore: nullBlobStore,
      chat: "full",
      projectContinuity: "current"
    });
  });

  it("stores the exact inspected backup returned by the client", async () => {
    const backup = await createInspectedBackup("project-inspected");
    const inspect = vi.fn(async () => successfulInspection(backup));
    const harness = await renderController(createInput({ inspect }));

    await act(async () => {
      await harness.current().inspectBackup(new File(["first"], "first.zip"));
    });

    expect(harness.current().inspectedBackup).toBe(backup);
    expect(harness.current().message).toEqual({
      tone: backup.preview.warningCount > 0 ? "warning" : "neutral",
      text:
        backup.preview.warningCount > 0
          ? `备份已读取，有 ${backup.preview.warningCount} 条 warning。确认后将恢复为新项目副本。`
          : "备份已读取。请确认后恢复为新项目副本。"
    });
  });

  it("does not restore an older inspect result after a newer file wins", async () => {
    const firstBackup = await createInspectedBackup("project-first");
    const secondBackup = await createInspectedBackup("project-second");
    const first = deferred<Awaited<ReturnType<ProjectBundleControllerServices["inspectEditableProjectBackupBundle"]>>>();
    const second = deferred<Awaited<ReturnType<ProjectBundleControllerServices["inspectEditableProjectBackupBundle"]>>>();
    const inspect = vi.fn((file: File | Blob) =>
      file instanceof File && file.name === "first.zip" ? first.promise : second.promise
    );
    const harness = await renderController(createInput({ inspect }));
    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;

    await act(async () => {
      firstRun = harness.current().inspectBackup(new File(["first"], "first.zip"));
      secondRun = harness.current().inspectBackup(new File(["second"], "second.zip"));
    });
    await act(async () => {
      second.resolve(successfulInspection(secondBackup));
      await secondRun;
    });
    expect(harness.current().inspectedBackup).toBe(secondBackup);

    await act(async () => {
      first.resolve(successfulInspection(firstBackup));
      await firstRun;
    });
    expect(harness.current().inspectedBackup).toBe(secondBackup);
  });

  it("requires an inspected backup before restore", async () => {
    const restore = vi.fn();
    const harness = await renderController(createInput({ restore }));

    await act(async () => {
      await harness.current().restoreBackup();
    });

    expect(restore).not.toHaveBeenCalled();
    expect(harness.current().message).toEqual({
      tone: "error",
      text: "请先选择并预览一个可编辑备份包。"
    });
  });

  it("restores the inspected backup, closes the panel, and reports the new project", async () => {
    const backup = await createInspectedBackup("project-source");
    const restoredWorkspace = createBlankWorkspace("project-restored");
    const restore = vi.fn(async () => ({
      status: "ok" as const,
      projectId: restoredWorkspace.project.id,
      workspace: restoredWorkspace,
      diagnostics: []
    }));
    const onWorkspaceRestored = vi.fn();
    const harness = await renderController(createInput({
      inspect: vi.fn(async () => successfulInspection(backup)),
      restore,
      onWorkspaceRestored
    }));
    act(() => harness.current().open());
    await act(async () => {
      await harness.current().inspectBackup(new File(["backup"], "backup.zip"));
      await harness.current().restoreBackup();
    });

    expect(restore).toHaveBeenCalledWith(backup, {
      blobStore: nullBlobStore,
      storage: window.localStorage
    });
    expect(onWorkspaceRestored).toHaveBeenCalledWith({
      projectId: restoredWorkspace.project.id,
      workspace: restoredWorkspace
    });
    expect(harness.current().isOpen).toBe(false);
    expect(harness.current().inspectedBackup).toBeNull();
  });

  it("does not report or replace the current workspace when restore fails", async () => {
    const currentWorkspace = createBlankWorkspace("project-current");
    const backup = await createInspectedBackup("project-source");
    const onWorkspaceRestored = vi.fn();
    const restore = vi.fn(async () => ({
      status: "failed" as const,
      reason: "catalog write failed",
      diagnostics: []
    }));
    const harness = await renderController(createInput({
      workspace: currentWorkspace,
      inspect: vi.fn(async () => successfulInspection(backup)),
      restore,
      onWorkspaceRestored
    }));

    await act(async () => {
      await harness.current().inspectBackup(new File(["backup"], "backup.zip"));
      await harness.current().restoreBackup();
    });

    expect(onWorkspaceRestored).not.toHaveBeenCalled();
    expect(harness.current().inspectedBackup).toBe(backup);
    expect(harness.current().message).toEqual({ tone: "error", text: "catalog write failed" });
    expect(currentWorkspace.project.id).toBe("project-current");
  });

  it("ignores an inspect completion from an older project session", async () => {
    const firstBackup = await createInspectedBackup("project-a-backup");
    const pending = deferred<Awaited<ReturnType<ProjectBundleControllerServices["inspectEditableProjectBackupBundle"]>>>();
    const inspect = vi.fn(() => pending.promise);
    const harness = await renderController(createInput({
      workspace: createBlankWorkspace("project-a"),
      inspect
    }));
    let inspectRun!: Promise<void>;

    await act(async () => {
      inspectRun = harness.current().inspectBackup(new File(["a"], "a.zip"));
    });
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-b"), inspect }));
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-a"), inspect }));

    await act(async () => {
      pending.resolve(successfulInspection(firstBackup));
      await inspectRun;
    });

    expect(harness.current().inspectedBackup).toBeNull();
    expect(harness.current().message).toBeNull();
    expect(harness.current().busyLabel).toBeNull();
  });

  it("does not download an export completed by an older project session", async () => {
    const pending = deferred<Awaited<ReturnType<ProjectBundleControllerServices["exportEditableProjectBackupBundle"]>>>();
    const exportEditable = vi.fn(() => pending.promise);
    const download = vi.fn();
    const harness = await renderController(createInput({
      workspace: createBlankWorkspace("project-a"),
      exportEditable,
      download
    }));
    let exportRun!: Promise<void>;

    await act(async () => {
      exportRun = harness.current().exportEditableBackup();
    });
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-b"), exportEditable, download }));
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-a"), exportEditable, download }));

    await act(async () => {
      pending.resolve({
        status: "ok",
        file: new File(["backup"], "backup.zip", { type: "application/zip" }),
        diagnostics: []
      });
      await exportRun;
    });

    expect(download).not.toHaveBeenCalled();
    expect(harness.current().message).toBeNull();
    expect(harness.current().busyLabel).toBeNull();
  });

  it("does not report a restore completed by an older project session", async () => {
    const backup = await createInspectedBackup("project-source");
    const pending = deferred<Awaited<ReturnType<ProjectBundleControllerServices["restoreEditableProjectBackupBundle"]>>>();
    const restore = vi.fn(() => pending.promise);
    const onWorkspaceRestored = vi.fn();
    const harness = await renderController(createInput({
      workspace: createBlankWorkspace("project-a"),
      inspect: vi.fn(async () => successfulInspection(backup)),
      restore,
      onWorkspaceRestored
    }));

    await act(async () => {
      await harness.current().inspectBackup(new File(["backup"], "backup.zip"));
    });
    let restoreRun!: Promise<void>;
    await act(async () => {
      restoreRun = harness.current().restoreBackup();
    });
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-b"), restore, onWorkspaceRestored }));
    await harness.rerender(createInput({ workspace: createBlankWorkspace("project-a"), restore, onWorkspaceRestored }));

    await act(async () => {
      pending.resolve({
        status: "ok",
        projectId: "project-restored",
        workspace: createBlankWorkspace("project-restored"),
        diagnostics: []
      });
      await restoreRun;
    });

    expect(onWorkspaceRestored).not.toHaveBeenCalled();
    expect(harness.current().message).toBeNull();
    expect(harness.current().busyLabel).toBeNull();
  });

  it("blocks duplicate restore and clears busy state after a thrown client error", async () => {
    const backup = await createInspectedBackup("project-source");
    const pending = deferred<Awaited<ReturnType<ProjectBundleControllerServices["restoreEditableProjectBackupBundle"]>>>();
    const restore = vi.fn(() => pending.promise);
    const harness = await renderController(createInput({
      inspect: vi.fn(async () => successfulInspection(backup)),
      restore
    }));
    await act(async () => {
      await harness.current().inspectBackup(new File(["backup"], "backup.zip"));
    });
    let firstRun!: Promise<void>;

    await act(async () => {
      firstRun = harness.current().restoreBackup();
    });
    expect(harness.current().busyLabel).toBe("正在恢复可编辑备份…");
    await act(async () => {
      await harness.current().restoreBackup();
    });
    expect(restore).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.reject(new Error("restore crashed"));
      await firstRun;
    });
    expect(harness.current().busyLabel).toBeNull();
    expect(harness.current().message).toEqual({
      tone: "error",
      text: "恢复备份失败，请重新选择备份包后再试。"
    });
  });
});

function createInput(
  overrides: {
    workspace?: MorphoWorkspace;
    exportEditable?: ProjectBundleControllerServices["exportEditableProjectBackupBundle"];
    exportArchive?: ProjectBundleControllerServices["exportHumanReadableArchiveBundle"];
    inspect?: ProjectBundleControllerServices["inspectEditableProjectBackupBundle"];
    restore?: ProjectBundleControllerServices["restoreEditableProjectBackupBundle"];
    download?: ProjectBundleControllerServices["downloadProjectBundleFile"];
    onWorkspaceRestored?: UseProjectBundleControllerInput["onWorkspaceRestored"];
  } = {}
): UseProjectBundleControllerInput {
  return {
    projectId: (overrides.workspace ?? createBlankWorkspace("project-current")).project.id,
    workspaceReady: true,
    workspace: overrides.workspace ?? createBlankWorkspace("project-current"),
    blobStore: nullBlobStore,
    storage: window.localStorage,
    onWorkspaceRestored: overrides.onWorkspaceRestored ?? vi.fn(),
    services: {
      exportEditableProjectBackupBundle:
        overrides.exportEditable ?? vi.fn(async () => failedExport("backup test stop")),
      exportHumanReadableArchiveBundle:
        overrides.exportArchive ?? vi.fn(async () => failedExport("archive test stop")),
      inspectEditableProjectBackupBundle:
        overrides.inspect ??
        vi.fn(async (_file: File | Blob) => failedInspection("inspect test stop")),
      restoreEditableProjectBackupBundle:
        overrides.restore ??
        vi.fn(
          async (
            _backup: Parameters<ProjectBundleControllerServices["restoreEditableProjectBackupBundle"]>[0],
            _options: Parameters<ProjectBundleControllerServices["restoreEditableProjectBackupBundle"]>[1]
          ) => failedRestore("restore test stop")
        ),
      downloadProjectBundleFile: overrides.download ?? vi.fn()
    }
  };
}

async function renderController(initialInput: UseProjectBundleControllerInput) {
  let controller: ProjectBundleController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseProjectBundleControllerInput }) {
    controller = useProjectBundleController(input);
    return null;
  }

  const render = async (input: UseProjectBundleControllerInput) => {
    await act(async () => {
      root.render(createElement(Harness, { input }));
    });
  };
  await render(initialInput);

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller did not render.");
      }
      return controller;
    },
    rerender: render
  };
}

async function createInspectedBackup(projectId: string): Promise<InspectedEditableProjectBackupBundle> {
  const exported = await buildEditableProjectBackup(createBlankWorkspace(projectId), {
    blobStore: nullBlobStore,
    chat: "full",
    projectContinuity: "current",
    createdAt: NOW
  });
  if (exported.status !== "ok") {
    throw new Error(exported.reason);
  }
  const inspected = await inspectBuiltEditableProjectBackup(exported.file);
  if (inspected.status !== "ok") {
    throw new Error(inspected.reason);
  }
  return inspected.backup;
}

function successfulInspection(backup: InspectedEditableProjectBackupBundle) {
  return {
    status: "ok" as const,
    preview: backup.preview,
    backup,
    diagnostics: backup.diagnostics
  };
}

function failedExport(reason: string): Awaited<
  ReturnType<ProjectBundleControllerServices["exportEditableProjectBackupBundle"]>
> {
  return { status: "failed", reason, diagnostics: [] };
}

function failedInspection(reason: string): Awaited<
  ReturnType<ProjectBundleControllerServices["inspectEditableProjectBackupBundle"]>
> {
  return { status: "failed", reason, diagnostics: [] };
}

function failedRestore(reason: string): Awaited<
  ReturnType<ProjectBundleControllerServices["restoreEditableProjectBackupBundle"]>
> {
  return { status: "failed", reason, diagnostics: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const nullBlobStore: BlobStore = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {}
};
