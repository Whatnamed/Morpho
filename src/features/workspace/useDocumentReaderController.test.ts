// @vitest-environment happy-dom

import { act, createElement, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { importTextObject } from "@/domain/morpho/imports";
import type { AssetRecord, FileObject, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { DocumentReaderLoadResult } from "./documentReader";
import { buildDocumentReaderBlocks } from "./documentReader";
import type { DocumentSourcePreview } from "./documentSourcePreview";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import {
  useDocumentReaderController,
  type DocumentReaderController,
  type DocumentReaderControllerServices,
  type UseDocumentReaderControllerInput
} from "./useDocumentReaderController";

const NOW = "2026-08-05T08:00:00.000Z";
const SOURCE_TEXT = "# Course brief\n\nFirst requirement.\n\nSecond requirement.";
const roots: Root[] = [];
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useDocumentReaderController", () => {
  it("opens into loading and preserves the loaded extract, preview, and initial location", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a");
    const extract = deferred<DocumentReaderLoadResult>();
    const preview = deferred<DocumentSourcePreview>();
    const services = createServices({
      loadExtract: vi.fn(() => extract.promise),
      loadPreview: vi.fn(() => preview.promise)
    });
    const harness = await renderController({ initialWorkspace: workspace, services });
    const initialLocation = { startOffset: 2, endOffset: 16, label: "Saved fragment range" };

    act(() => harness.current().open("file-a", initialLocation));
    expect(harness.current().state).toMatchObject({
      fileObjectId: "file-a",
      requestId: 1,
      status: "loading",
      text: "",
      initialLocation
    });

    await act(async () => {
      extract.resolve(loadedResult(workspace, "file-a", SOURCE_TEXT));
      preview.resolve(readyPreview("file-a"));
      await settleAsyncWork();
    });

    expect(harness.current().state).toMatchObject({
      fileObjectId: "file-a",
      requestId: 1,
      status: "loaded",
      text: SOURCE_TEXT,
      extractAsset: workspace.assets["asset-extract-file-a"],
      sourcePreview: readyPreview("file-a"),
      initialLocation
    });
    expect(harness.current().isOpen).toBe(true);
  });

  it("aborts A when B opens and ignores A after B wins", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a", "file-b");
    const extractA = deferred<DocumentReaderLoadResult>();
    const extractB = deferred<DocumentReaderLoadResult>();
    const previewA = deferred<DocumentSourcePreview>();
    const previewB = deferred<DocumentSourcePreview>();
    const signals = new Map<string, AbortSignal>();
    const services = createServices({
      loadExtract: vi.fn((_workspace, fileObjectId, _store, signal) => {
        signals.set(fileObjectId, signal);
        return fileObjectId === "file-a" ? extractA.promise : extractB.promise;
      }),
      loadPreview: vi.fn((_workspace, fileObjectId) =>
        fileObjectId === "file-a" ? previewA.promise : previewB.promise
      )
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    act(() => harness.current().open("file-b"));
    expect(signals.get("file-a")?.aborted).toBe(true);

    await act(async () => {
      extractB.resolve(loadedResult(workspace, "file-b", "B text"));
      previewB.resolve(readyPreview("file-b"));
      await settleAsyncWork();
    });
    expect(harness.current().state).toMatchObject({ fileObjectId: "file-b", status: "loaded", text: "B text" });

    await act(async () => {
      extractA.resolve(loadedResult(workspace, "file-a", "A text"));
      previewA.resolve(readyPreview("file-a"));
      await settleAsyncWork();
    });

    expect(harness.current().state).toMatchObject({ fileObjectId: "file-b", status: "loaded", text: "B text" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:file-b");
  });

  it("closes atomically, revokes the current URL, and cannot be reopened by a late result", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a");
    const extract = deferred<DocumentReaderLoadResult>();
    const preview = deferred<DocumentSourcePreview>();
    let signal: AbortSignal | undefined;
    const services = createServices({
      loadExtract: vi.fn((_workspace, _fileObjectId, _store, currentSignal) => {
        signal = currentSignal;
        return extract.promise;
      }),
      loadPreview: vi.fn(() => preview.promise)
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    act(() => harness.current().close());
    expect(signal?.aborted).toBe(true);
    expect(harness.current().state).toBeNull();
    expect(harness.current().isOpen).toBe(false);

    await act(async () => {
      extract.resolve(loadedResult(workspace, "file-a", "late text"));
      preview.resolve(readyPreview("file-a"));
      await settleAsyncWork();
    });

    expect(harness.current().state).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");
  });

  it("immediately revokes a ready preview when closed while extraction is still pending", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a");
    const extract = deferred<DocumentReaderLoadResult>();
    const preview = deferred<DocumentSourcePreview>();
    const services = createServices({
      loadExtract: vi.fn(() => extract.promise),
      loadPreview: vi.fn(() => preview.promise)
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    await act(async () => {
      preview.resolve(readyPreview("file-a"));
      await settleAsyncWork();
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => harness.current().close());

    expect(harness.current().state).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");

    await act(async () => {
      extract.resolve(loadedResult(workspace, "file-a", "late text"));
      await settleAsyncWork();
    });

    expect(harness.current().state).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("aborts the request and revokes the owned URL on unmount", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a");
    let signal: AbortSignal | undefined;
    const services = createServices({
      loadExtract: vi.fn(async (_workspace, fileObjectId, _store, currentSignal) => {
        signal = currentSignal;
        return loadedResult(workspace, fileObjectId, SOURCE_TEXT);
      }),
      loadPreview: vi.fn(async () => readyPreview("file-a"))
    });
    const harness = await renderController({ initialWorkspace: workspace, services });
    act(() => harness.current().open("file-a"));
    await act(settleAsyncWork);

    await harness.unmount();

    expect(signal?.aborted).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");
  });

  it("immediately revokes a ready preview on unmount while extraction is still pending", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a");
    const extract = deferred<DocumentReaderLoadResult>();
    const preview = deferred<DocumentSourcePreview>();
    const services = createServices({
      loadExtract: vi.fn(() => extract.promise),
      loadPreview: vi.fn(() => preview.promise)
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    await act(async () => {
      preview.resolve(readyPreview("file-a"));
      await settleAsyncWork();
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await harness.unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");

    await act(async () => {
      extract.resolve(loadedResult(workspace, "file-a", "late text"));
      await settleAsyncWork();
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("shows a current non-Abort error and ignores an older request error", async () => {
    const workspace = createReaderWorkspace("project-reader", "file-a", "file-b");
    const extractA = deferred<DocumentReaderLoadResult>();
    const services = createServices({
      loadExtract: vi.fn((_workspace, fileObjectId) =>
        fileObjectId === "file-a"
          ? extractA.promise
          : Promise.resolve(loadedResult(workspace, "file-b", "B text"))
      ),
      loadPreview: vi.fn(async (_workspace, fileObjectId) => readyPreview(fileObjectId))
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    act(() => harness.current().open("file-b"));
    await act(settleAsyncWork);
    expect(harness.current().state).toMatchObject({ fileObjectId: "file-b", status: "loaded" });

    await act(async () => {
      extractA.reject(new Error("stale reader failure"));
      await settleAsyncWork();
    });
    expect(harness.current().state).toMatchObject({ fileObjectId: "file-b", status: "loaded" });

    const currentFailureServices = createServices({
      loadExtract: vi.fn(async () => {
        throw new Error("current reader failure");
      }),
      loadPreview: vi.fn(async () => ({ status: "missing" as const, message: "preview unavailable" }))
    });
    const currentFailureHarness = await renderController({
      initialWorkspace: createReaderWorkspace("project-error", "file-a"),
      services: currentFailureServices
    });
    act(() => currentFailureHarness.current().open("file-a"));
    await act(settleAsyncWork);

    expect(currentFailureHarness.current().state).toMatchObject({
      fileObjectId: "file-a",
      status: "error",
      text: "",
      message: "current reader failure"
    });
  });

  it("creates a real fragment, relation, canvas instance, and continuity event while keeping the reader open", async () => {
    const workspace = createReaderWorkspace("project-fragment", "file-a");
    const harness = await renderLoadedController(workspace);
    const blocks = buildDocumentReaderBlocks(SOURCE_TEXT);
    let result!: ReturnType<DocumentReaderController["extractFragment"]>;

    act(() => {
      result = harness.current().extractFragment({
        blockIds: blocks.slice(0, 2).map((block) => block.id),
        title: "Course brief fragment",
        summary: "Explicit excerpt"
      });
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error(result.reason);
    }
    const fragmentId = result.fragmentId;
    const fragment = harness.workspace().objects[fragmentId];
    expect(fragment).toMatchObject({
      id: fragmentId,
      type: "documentFragment",
      source: {
        fileObjectId: "file-a",
        sourceExtractAssetId: "asset-extract-file-a",
        startOffset: blocks[0]?.startOffset,
        endOffset: blocks[1]?.endOffset
      }
    });
    expect(harness.workspace().relations).toContainEqual(
      expect.objectContaining({
        kind: "documentFragmentExtractedFromFile",
        fromObjectId: fragmentId,
        toObjectId: "file-a"
      })
    );
    expect(harness.workspace().canvas.instances.some((instance) => instance.objectId === fragmentId)).toBe(true);
    expect(harness.workspace().projectContinuity.recordEntries.at(-1)?.sourceRefs.map((ref) => ref.id)).toContain(
      fragmentId
    );
    expect(harness.current().state).toMatchObject({
      status: "loaded",
      createdFragmentId: fragmentId,
      message: "已提取到画布"
    });
  });

  it("blocks extraction while the reader is not ready", async () => {
    const harness = await renderController({
      initialWorkspace: createReaderWorkspace("project-blocked", "file-a"),
      services: createServices()
    });
    const before = JSON.stringify(harness.workspace());

    const result = harness.current().extractFragment({ blockIds: [], title: "Fragment", summary: "" });

    expect(result).toEqual({ status: "blocked", reason: "Document reader is not ready." });
    expect(JSON.stringify(harness.workspace())).toBe(before);
  });

  it("blocks extraction when the source file becomes unavailable", async () => {
    const workspace = createReaderWorkspace("project-blocked", "file-a");
    const harness = await renderLoadedController(workspace);
    const blocks = buildDocumentReaderBlocks(SOURCE_TEXT);
    act(() => {
      harness.updateWorkspace((current) => ({
        ...current,
        objects: Object.fromEntries(Object.entries(current.objects).filter(([objectId]) => objectId !== "file-a"))
      }));
    });
    const before = JSON.stringify(harness.workspace());

    let result!: ReturnType<DocumentReaderController["extractFragment"]>;
    act(() => {
      result = harness.current().extractFragment({
        blockIds: [blocks[0]?.id ?? ""],
        title: "Fragment",
        summary: ""
      });
    });

    expect(result).toMatchObject({ status: "blocked", reason: expect.stringContaining("unavailable") });
    expect(JSON.stringify(harness.workspace())).toBe(before);
    expect(harness.current().state).toMatchObject({ status: "loaded" });
    expect(harness.current().state?.createdFragmentId).toBeUndefined();
  });

  it("blocks extraction when the current extract asset no longer matches", async () => {
    const workspace = createReaderWorkspace("project-blocked", "file-a");
    const harness = await renderLoadedController(workspace);
    const blocks = buildDocumentReaderBlocks(SOURCE_TEXT);
    act(() => {
      harness.updateWorkspace((current) => {
        const file = current.objects["file-a"];
        if (!file || file.type !== "file") {
          return current;
        }
        return {
          ...current,
          objects: {
            ...current.objects,
            [file.id]: { ...file, extractedAssetId: "asset-extract-replaced" }
          }
        };
      });
    });
    const before = JSON.stringify(harness.workspace());

    let result!: ReturnType<DocumentReaderController["extractFragment"]>;
    act(() => {
      result = harness.current().extractFragment({
        blockIds: [blocks[0]?.id ?? ""],
        title: "Fragment",
        summary: ""
      });
    });

    expect(result).toMatchObject({ status: "blocked", reason: expect.stringContaining("does not match") });
    expect(JSON.stringify(harness.workspace())).toBe(before);
  });

  it("blocks invalid reader block IDs without changing the workspace", async () => {
    const workspace = createReaderWorkspace("project-blocked", "file-a");
    const harness = await renderLoadedController(workspace);
    const before = JSON.stringify(harness.workspace());

    let result!: ReturnType<DocumentReaderController["extractFragment"]>;
    act(() => {
      result = harness.current().extractFragment({
        blockIds: ["block-not-in-reader"],
        title: "Fragment",
        summary: ""
      });
    });

    expect(result).toMatchObject({ status: "blocked", reason: expect.stringContaining("outside the current reader") });
    expect(JSON.stringify(harness.workspace())).toBe(before);
  });

  it("creates fragments from the latest workspace without dropping concurrent content", async () => {
    const workspace = createReaderWorkspace("project-latest", "file-a");
    const harness = await renderLoadedController(workspace);
    const blocks = buildDocumentReaderBlocks(SOURCE_TEXT);
    let markerObjectId = "";
    act(() => {
      harness.updateWorkspace((current) => {
        const imported = importTextObject(current, {
          text: "Concurrent workspace note",
          position: { x: 800, y: 400 }
        });
        markerObjectId = imported.objectIds[0] ?? "";
        return imported.workspace;
      });
    });

    let result!: ReturnType<DocumentReaderController["extractFragment"]>;
    act(() => {
      result = harness.current().extractFragment({
        blockIds: [blocks[0]?.id ?? ""],
        title: "Latest workspace fragment",
        summary: ""
      });
    });

    expect(result.status).toBe("created");
    expect(markerObjectId).not.toBe("");
    expect(harness.workspace().objects[markerObjectId]).toMatchObject({ type: "text" });
  });

  it("applies recovery workspace updates through the functional update boundary", async () => {
    const workspace = createReaderWorkspace("project-recovery", "file-a");
    const services = createServices({
      loadExtract: vi.fn(async (snapshot, fileObjectId, _store, _signal, applyWorkspaceUpdate) => {
        applyWorkspaceUpdate((current: MorphoWorkspace) => ({
          ...current,
          project: { ...current.project, title: "Recovered reader workspace" }
        }));
        return loadedResult(snapshot, fileObjectId, SOURCE_TEXT);
      }),
      loadPreview: vi.fn(async () => readyPreview("file-a"))
    });
    const harness = await renderController({ initialWorkspace: workspace, services });

    act(() => harness.current().open("file-a"));
    await act(settleAsyncWork);

    expect(harness.workspace().project.title).toBe("Recovered reader workspace");
    expect(harness.current().state).toMatchObject({ status: "loaded", text: SOURCE_TEXT });
  });

  it("closes and revokes before notifying the page to view a created fragment", async () => {
    const workspace = createReaderWorkspace("project-view", "file-a");
    const onViewCreatedFragment = vi.fn();
    const harness = await renderLoadedController(workspace, onViewCreatedFragment);
    const blocks = buildDocumentReaderBlocks(SOURCE_TEXT);
    let created!: ReturnType<DocumentReaderController["extractFragment"]>;
    act(() => {
      created = harness.current().extractFragment({
        blockIds: [blocks[0]?.id ?? ""],
        title: "View fragment",
        summary: ""
      });
    });
    if (created.status !== "created") {
      throw new Error(created.reason);
    }
    const fragmentId = created.fragmentId;

    act(() => harness.current().viewCreatedFragment(fragmentId));

    expect(harness.current().state).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file-a");
    expect(onViewCreatedFragment).toHaveBeenCalledTimes(1);
    expect(onViewCreatedFragment).toHaveBeenCalledWith(fragmentId);
  });
});

type RenderControllerInput = Omit<UseDocumentReaderControllerInput, "workspace" | "updateWorkspace"> & {
  initialWorkspace: MorphoWorkspace;
};

async function renderController(initialInput: RenderControllerInput) {
  let controller: DocumentReaderController | null = null;
  let workspace = initialInput.initialWorkspace;
  let updateWorkspace: Dispatch<SetStateAction<MorphoWorkspace>> | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: RenderControllerInput }) {
    const [currentWorkspace, setCurrentWorkspace] = useState(input.initialWorkspace);
    workspace = currentWorkspace;
    updateWorkspace = setCurrentWorkspace;
    controller = useDocumentReaderController({
      ...input,
      workspace: currentWorkspace,
      updateWorkspace: setCurrentWorkspace
    });
    return null;
  }

  await act(async () => {
    root.render(createElement(Harness, { input: initialInput }));
  });

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller did not render.");
      }
      return controller;
    },
    workspace: () => workspace,
    updateWorkspace: (action: SetStateAction<MorphoWorkspace>) => {
      if (!updateWorkspace) {
        throw new Error("Workspace setter is unavailable.");
      }
      updateWorkspace(action);
    },
    unmount: async () => {
      const index = roots.indexOf(root);
      if (index >= 0) {
        roots.splice(index, 1);
      }
      await act(async () => root.unmount());
    }
  };
}

async function renderLoadedController(
  workspace: MorphoWorkspace,
  onViewCreatedFragment = vi.fn()
) {
  const services = createServices({
    loadExtract: vi.fn(async (_workspace, fileObjectId) => loadedResult(workspace, fileObjectId, SOURCE_TEXT)),
    loadPreview: vi.fn(async (_workspace, fileObjectId) => readyPreview(fileObjectId))
  });
  const harness = await renderController({
    initialWorkspace: workspace,
    services,
    onViewCreatedFragment
  });
  act(() => harness.current().open("file-a"));
  await act(settleAsyncWork);
  expect(harness.current().state?.status).toBe("loaded");
  return harness;
}

function createServices(overrides: {
  loadExtract?: DocumentReaderControllerServices["loadDocumentReaderExtractWithRecovery"];
  loadPreview?: DocumentReaderControllerServices["loadDocumentSourcePreview"];
} = {}): DocumentReaderControllerServices {
  return {
    loadDocumentReaderExtractWithRecovery:
      overrides.loadExtract ??
      vi.fn(async (workspace, fileObjectId) => loadedResult(workspace, fileObjectId, SOURCE_TEXT)),
    loadDocumentSourcePreview:
      overrides.loadPreview ?? vi.fn(async (_workspace, fileObjectId) => readyPreview(fileObjectId))
  };
}

function createReaderWorkspace(projectId: string, ...fileObjectIds: string[]): MorphoWorkspace {
  const workspace = createBlankWorkspace(projectId);
  const objects = { ...workspace.objects };
  const assets = { ...workspace.assets };
  const instances = [...workspace.canvas.instances];

  for (const [index, fileObjectId] of fileObjectIds.entries()) {
    const originalAsset: AssetRecord = {
      id: `asset-original-${fileObjectId}`,
      fileName: `${fileObjectId}.pdf`,
      mimeType: "application/pdf",
      size: 128,
      createdAt: NOW,
      storageKey: `blob:original-${fileObjectId}`,
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: `asset-extract-${fileObjectId}`,
      fileName: `${fileObjectId}.extract.txt`,
      mimeType: "text/plain",
      size: SOURCE_TEXT.length,
      createdAt: NOW,
      storageKey: `blob:extract-${fileObjectId}`,
      sourceType: "documentExtract"
    };
    const file: FileObject = {
      id: fileObjectId,
      type: "file",
      title: fileObjectId,
      summary: "Reader source",
      createdBy: "user",
      visibility: "active",
      fileKind: "document",
      sourceLabel: "用户导入",
      assetId: originalAsset.id,
      fileName: originalAsset.fileName,
      mimeType: originalAsset.mimeType,
      size: originalAsset.size,
      parseStatus: "parsed",
      extractedAssetId: extractAsset.id,
      extractedCharCount: SOURCE_TEXT.length
    };
    objects[file.id] = file;
    assets[originalAsset.id] = originalAsset;
    assets[extractAsset.id] = extractAsset;
    instances.push({
      id: `canvas-${file.id}`,
      objectId: file.id,
      position: { x: 100 + index * 320, y: 100 },
      size: { w: 280, h: 188 }
    });
  }

  return {
    ...workspace,
    objects,
    assets,
    canvas: { ...workspace.canvas, instances }
  };
}

function loadedResult(
  workspace: MorphoWorkspace,
  fileObjectId: string,
  text: string
): Extract<DocumentReaderLoadResult, { status: "loaded" }> {
  const file = workspace.objects[fileObjectId];
  const asset = file?.type === "file" && file.extractedAssetId
    ? workspace.assets[file.extractedAssetId]
    : undefined;
  if (!asset) {
    throw new Error(`Missing extract asset for ${fileObjectId}.`);
  }
  return { status: "loaded", fileObjectId, asset, text };
}

function readyPreview(fileObjectId: string): DocumentSourcePreview {
  return {
    status: "ready",
    url: `blob:${fileObjectId}`,
    mimeType: "application/pdf",
    fileName: `${fileObjectId}.pdf`
  };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
