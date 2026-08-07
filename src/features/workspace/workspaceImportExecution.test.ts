import { describe, expect, it } from "vitest";

import type {
  AssetRecord,
  AssetSourceType,
  MorphoWorkspace
} from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { DocumentParseResult } from "@/domain/morpho/documentParsing";
import type { SaveLocalAssetResult } from "@/infrastructure/assets/localAssetWorkflow";
import {
  createStaleWorkspaceImportExecutionError,
  executeWorkspaceImport,
  type WorkspaceImportExecutionPorts,
  type WorkspaceImportExecutionSession
} from "./workspaceImportExecution";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

describe("workspace import execution", () => {
  it("drops a pending asset success after switching from Project A to Project B", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveAsset = async () => {
      saveStarted.resolve();
      return save.promise;
    };
    const run = executeWorkspaceImport(importRequest("brief.pdf"), harness.ports);
    await saveStarted.promise;

    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    save.resolve(okAsset("asset-brief", "brief.pdf", "originalFile"));

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
  });

  it("drops a pending asset failure without writing an error into Project B", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveAsset = async () => {
      saveStarted.resolve();
      return save.promise;
    };
    const run = executeWorkspaceImport(importRequest("failed.pdf"), harness.ports);
    await saveStarted.promise;

    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    save.resolve({ status: "failed", reason: "quota exceeded" });

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
    expect(harness.workspace.ai.messages).toEqual([]);
  });

  it("drops a pending document parse success after switching projects", async () => {
    const harness = createHarness();
    const parseStarted = deferred<void>();
    const parse = deferred<DocumentParseResult>();
    harness.parseDocumentFile = async () => {
      parseStarted.resolve();
      return parse.promise;
    };
    const run = executeWorkspaceImport(importRequest("brief.md", "text/markdown"), harness.ports);
    await parseStarted.promise;

    expect(fileParseStatus(harness.workspace)).toBe("parsing");
    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    parse.resolve({
      status: "parsed",
      text: "提取结果",
      mimeType: "text/markdown",
      extractFileName: "brief.extract.txt"
    });

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
  });

  it("drops a pending document parse failure and preserves Project B", async () => {
    const harness = createHarness();
    const parseStarted = deferred<void>();
    const parse = deferred<DocumentParseResult>();
    harness.parseDocumentFile = async () => {
      parseStarted.resolve();
      return parse.promise;
    };
    const run = executeWorkspaceImport(importRequest("broken.md", "text/markdown"), harness.ports);
    await parseStarted.promise;

    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    parse.resolve({ status: "failed", reason: "解析失败：内容损坏" });

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
  });

  it("drops a pending document extract success after switching projects", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveDocumentExtract = async () => {
      saveStarted.resolve();
      return save.promise;
    };
    const run = executeWorkspaceImport(importRequest("brief.md", "text/markdown"), harness.ports);
    await saveStarted.promise;

    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    save.resolve(okAsset("asset-extract", "brief.extract.txt", "documentExtract"));

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
  });

  it("drops a pending document extract failure after switching projects", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveDocumentExtract = async () => {
      saveStarted.resolve();
      return save.promise;
    };
    const run = executeWorkspaceImport(importRequest("brief.md", "text/markdown"), harness.ports);
    await saveStarted.promise;

    harness.switchToProject("project-b");
    const projectBBefore = structuredClone(harness.workspace);
    save.resolve({ status: "failed", reason: "extract asset quota exceeded" });

    await expect(run).rejects.toMatchObject({ code: "stale_workspace_import_execution" });
    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selectedObjectIds).toEqual([]);
  });

  it("keeps successful assets when another asset fails and records the failure", async () => {
    const harness = createHarness();
    harness.saveAsset = async (file, sourceType) => file.name === "broken.pdf"
      ? { status: "failed", reason: "quota exceeded" }
      : okAsset("asset-success", file.name, sourceType);

    await expect(executeWorkspaceImport({
      files: [
        new File(["image"], "success.png", { type: "image/png" }),
        new File(["pdf"], "broken.pdf", { type: "application/pdf" })
      ],
      position: { x: 10, y: 20 }
    }, harness.ports)).resolves.toBeUndefined();

    expect(Object.values(harness.workspace.objects)).toEqual([
      expect.objectContaining({ type: "image", assetId: "asset-success" })
    ]);
    expect(harness.workspace.ai.messages.at(-1)).toMatchObject({
      status: "failed",
      body: expect.stringContaining("broken.pdf: quota exceeded")
    });
    expect(harness.selectedObjectIds).toHaveLength(1);
  });

  it("persists a document extract and attaches parsed metadata", async () => {
    const harness = createHarness();
    harness.parseDocumentFile = async () => ({
      status: "parsed",
      text: "一段解析结果",
      pageCount: 3,
      mimeType: "application/pdf",
      extractFileName: "brief.extract.txt"
    });

    await executeWorkspaceImport(importRequest("brief.pdf"), harness.ports);

    const file = Object.values(harness.workspace.objects).find((object) => object.type === "file");
    expect(file).toMatchObject({
      type: "file",
      parseStatus: "parsed",
      extractedCharCount: 6,
      extractedPageCount: 3,
      extractedAssetId: "extract-brief.extract.txt"
    });
    expect(Object.values(harness.workspace.assets)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "documentExtract" })
    ]));
  });

  it("preserves parse failure and extract-save failure reasons", async () => {
    const parseFailureHarness = createHarness();
    parseFailureHarness.parseDocumentFile = async () => ({
      status: "failed",
      reason: "PDF 解析失败：内容损坏"
    });
    await executeWorkspaceImport(importRequest("broken.pdf"), parseFailureHarness.ports);
    expect(Object.values(parseFailureHarness.workspace.objects).find((object) => object.type === "file")).toMatchObject({
      parseStatus: "failed",
      parseError: "PDF 解析失败：内容损坏"
    });

    const extractFailureHarness = createHarness();
    extractFailureHarness.saveDocumentExtract = async () => ({
      status: "failed",
      reason: "extract asset quota exceeded"
    });
    await executeWorkspaceImport(importRequest("extract-failed.pdf"), extractFailureHarness.ports);
    expect(Object.values(extractFailureHarness.workspace.objects).find((object) => object.type === "file")).toMatchObject({
      parseStatus: "failed",
      parseError: "extract asset quota exceeded"
    });
  });

  it("keeps an import alive when the same project session is rerendered", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveAsset = async () => {
      saveStarted.resolve();
      return save.promise;
    };
    const run = executeWorkspaceImport(importRequest("reference.png", "image/png"), harness.ports);
    await saveStarted.promise;

    // An ordinary rerender changes neither the session object nor its ownership.
    harness.renderCount += 1;
    save.resolve(okAsset("asset-reference", "reference.png", "originalImage"));
    await expect(run).resolves.toBeUndefined();

    expect(harness.renderCount).toBe(1);
    expect(Object.values(harness.workspace.objects)).toEqual([
      expect.objectContaining({ type: "image", assetId: "asset-reference" })
    ]);
    expect(harness.selectedObjectIds).toEqual(expect.arrayContaining([
      expect.any(String)
    ]));
  });
});

type ImportHarness = {
  workspace: MorphoWorkspace;
  session: WorkspaceImportExecutionSession;
  selectedObjectIds: string[];
  renderCount: number;
  saveAsset: WorkspaceImportExecutionPorts["saveAsset"];
  parseDocumentFile: WorkspaceImportExecutionPorts["parseDocumentFile"];
  saveDocumentExtract: WorkspaceImportExecutionPorts["saveDocumentExtract"];
  ports: WorkspaceImportExecutionPorts;
  switchToProject: (projectId: string) => void;
};

function createHarness(): ImportHarness {
  const harness: ImportHarness = {
    workspace: createBlankWorkspace("project-a"),
    session: createSession("project-a"),
    selectedObjectIds: [],
    renderCount: 0,
    saveAsset: async (file: File, sourceType: AssetSourceType) =>
      okAsset(`asset-${file.name}`, file.name, sourceType),
    parseDocumentFile: async (file: File) => ({
      status: "parsed" as const,
      text: `parsed:${file.name}`,
      mimeType: file.type || "text/plain",
      extractFileName: `${file.name}.extract.txt`
    }),
    saveDocumentExtract: async (file: File) =>
      okAsset(`extract-${file.name}`, file.name, "documentExtract" as const),
    ports: undefined as unknown as WorkspaceImportExecutionPorts,
    switchToProject: () => undefined
  };

  const ports: WorkspaceImportExecutionPorts = {
    getCurrentSession: () => harness.session,
    assertCurrentSession: (expectedSession) => {
      if (
        harness.session !== expectedSession ||
        !harness.session.workspaceReady ||
        harness.workspace.project.id !== expectedSession.projectId
      ) {
        throw createStaleWorkspaceImportExecutionError();
      }
    },
    commitWorkspace: <T>(
      expectedSession: WorkspaceImportExecutionSession,
      transform: WorkspaceCommitTransform<T>
    ) => {
      harness.ports.assertCurrentSession(expectedSession);
      const committed = transform(harness.workspace);
      harness.ports.assertCurrentSession(expectedSession);
      harness.workspace = committed.workspace;
      return committed.value;
    },
    selectObjects: (expectedSession, objectIds) => {
      harness.ports.assertCurrentSession(expectedSession);
      harness.selectedObjectIds = [...objectIds];
    },
    saveAsset: (...args) => harness.saveAsset(...args),
    parseDocumentFile: (...args) => harness.parseDocumentFile(...args),
    saveDocumentExtract: (...args) => harness.saveDocumentExtract(...args),
    now: () => 1_754_000_000_000
  };
  harness.ports = ports;
  harness.switchToProject = (projectId) => {
    harness.workspace = createBlankWorkspace(projectId);
    harness.session = createSession(projectId);
    harness.selectedObjectIds = [];
  };
  return harness;
}

function createSession(projectId: string): WorkspaceImportExecutionSession {
  return { projectId, workspaceReady: true, generation: Symbol(projectId) };
}

function importRequest(fileName: string, mimeType = "application/pdf") {
  return {
    files: [new File(["file contents"], fileName, { type: mimeType })],
    position: { x: 100, y: 120 }
  } as const;
}

function fileParseStatus(workspace: MorphoWorkspace): string | undefined {
  return Object.values(workspace.objects).find((object) => object.type === "file")?.parseStatus;
}

function okAsset(id: string, fileName: string, sourceType: AssetSourceType): SaveLocalAssetResult {
  const asset: AssetRecord = {
    id,
    fileName,
    mimeType: sourceType === "documentExtract" ? "text/plain" : fileName.endsWith(".png") ? "image/png" : "application/pdf",
    size: 12,
    createdAt: "2026-08-07T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType
  };
  return { status: "ok", asset };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
