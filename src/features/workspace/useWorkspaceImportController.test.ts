// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AssetRecord,
  AssetSourceType,
  MorphoWorkspace
} from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { SaveLocalAssetResult } from "@/infrastructure/assets/localAssetWorkflow";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  useWorkspaceImportController,
  type UseWorkspaceImportControllerInput,
  type WorkspaceImportController,
  type WorkspaceImportControllerServices
} from "./useWorkspaceImportController";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useWorkspaceImportController", () => {
  it("keeps an in-flight import alive across an ordinary same-project rerender", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveAsset = async () => {
      harness.saveCalls += 1;
      saveStarted.resolve();
      return save.promise;
    };
    const input = createInput(harness);
    const rendered = await renderController(input);
    const firstCallback = rendered.current().importRequest;
    const execution = rendered.current().importRequest(imageImportRequest());
    await saveStarted.promise;

    await rendered.rerender(input);
    expect(rendered.current().importRequest).toBe(firstCallback);

    save.resolve(okAsset("asset-reference", "reference.png", "originalImage"));
    await expect(execution).resolves.toBeUndefined();

    expect(harness.saveCalls).toBe(1);
    expect(Object.values(harness.workspace.objects)).toEqual([
      expect.objectContaining({ type: "image", assetId: "asset-reference" })
    ]);
    expect(harness.selected).toEqual([
      expect.any(String)
    ]);
  });

  it("drops a stale Project A import across the staged Project B transition", async () => {
    const harness = createHarness();
    const saveStarted = deferred<void>();
    const save = deferred<SaveLocalAssetResult>();
    harness.saveAsset = async () => {
      harness.saveCalls += 1;
      saveStarted.resolve();
      return save.promise;
    };
    const initialInput = createInput(harness);
    const rendered = await renderController(initialInput);
    const execution = rendered.current().importRequest(imageImportRequest());
    await saveStarted.promise;

    await rendered.rerender(createInput(harness, {
      projectId: "project-b",
      workspaceReady: false
    }));
    harness.workspace = createBlankWorkspace("project-b");
    await rendered.rerender(createInput(harness, {
      projectId: "project-b",
      workspaceReady: false
    }));
    const projectBBefore = structuredClone(harness.workspace);
    await rendered.rerender(createInput(harness, {
      projectId: "project-b",
      workspaceReady: true
    }));

    save.resolve(okAsset("stale-asset", "stale.png", "originalImage"));
    await expect(execution).resolves.toBeUndefined();

    expect(harness.workspace).toEqual(projectBBefore);
    expect(harness.selected).toEqual([]);
  });

  it("fails closed before any asset or workspace side effect when not ready", async () => {
    const harness = createHarness();
    const rendered = await renderController(createInput(harness, {
      workspaceReady: false
    }));
    const workspaceBefore = structuredClone(harness.workspace);

    await expect(rendered.current().importRequest(imageImportRequest())).resolves.toBeUndefined();

    expect(harness.saveCalls).toBe(0);
    expect(harness.workspace).toEqual(workspaceBefore);
    expect(harness.selected).toEqual([]);
  });
});

type ImportControllerHarness = {
  workspace: MorphoWorkspace;
  selected: string[];
  saveCalls: number;
  saveAsset: WorkspaceImportControllerServices["saveAsset"];
  services: WorkspaceImportControllerServices;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  selectObjects: (objectIds: string[]) => void;
};

function createHarness(): ImportControllerHarness {
  const harness = {} as ImportControllerHarness;
  harness.workspace = createBlankWorkspace("project-a");
  harness.selected = [];
  harness.saveCalls = 0;
  harness.saveAsset = async (file: File, sourceType: AssetSourceType) => {
    harness.saveCalls += 1;
    return okAsset(`asset-${file.name}`, file.name, sourceType);
  };

  harness.commitWorkspace = <T,>(transform: WorkspaceCommitTransform<T>): T => {
    const result = transform(harness.workspace);
    harness.workspace = result.workspace;
    return result.value;
  };
  harness.selectObjects = (objectIds) => {
    harness.selected = [...objectIds];
  };
  harness.services = {
    saveAsset: (...args) => harness.saveAsset(...args),
    parseDocumentFile: async (file) => ({
      status: "parsed" as const,
      text: `parsed:${file.name}`,
      mimeType: file.type || "text/plain",
      extractFileName: `${file.name}.extract.txt`
    }),
    saveDocumentExtract: async (file) => okAsset(`extract-${file.name}`, file.name, "documentExtract"),
    now: () => 1_754_000_000_000
  } satisfies WorkspaceImportControllerServices;
  return harness;
}

function createInput(
  harness: ImportControllerHarness,
  options: { projectId?: string; workspaceReady?: boolean } = {}
): UseWorkspaceImportControllerInput {
  return {
    projectId: options.projectId ?? harness.workspace.project.id,
    workspaceReady: options.workspaceReady ?? true,
    commitWorkspace: harness.commitWorkspace,
    selectObjects: harness.selectObjects,
    services: harness.services
  };
}

async function renderController(initialInput: UseWorkspaceImportControllerInput) {
  let controller: WorkspaceImportController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseWorkspaceImportControllerInput }) {
    controller = useWorkspaceImportController(input);
    return null;
  }

  const render = async (input: UseWorkspaceImportControllerInput) => {
    await act(async () => {
      root.render(createElement(Harness, { input }));
    });
  };
  await render(initialInput);

  return {
    current: () => {
      if (!controller) throw new Error("Controller did not render.");
      return controller;
    },
    rerender: render
  };
}

function imageImportRequest() {
  return {
    files: [new File(["image"], "reference.png", { type: "image/png" })],
    position: { x: 80, y: 120 }
  } as const;
}

function okAsset(id: string, fileName: string, sourceType: AssetSourceType): SaveLocalAssetResult {
  const asset: AssetRecord = {
    id,
    fileName,
    mimeType: "image/png",
    size: 5,
    createdAt: "2026-08-07T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType
  };
  return { status: "ok", asset };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
