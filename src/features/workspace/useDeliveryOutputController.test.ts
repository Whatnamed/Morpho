// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeliveryOutputManifest } from "@/domain/morpho/deliveryOutput";
import type { DeliveryObject, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type {
  ExportDeliveryOutputResult,
  InspectDeliveryOutputResult
} from "@/features/delivery-output/deliveryOutputClient";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import {
  useDeliveryOutputController,
  type DeliveryOutputController,
  type DeliveryOutputControllerServices,
  type UseDeliveryOutputControllerInput
} from "./useDeliveryOutputController";

const NOW = "2026-08-05T08:00:00.000Z";
const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useDeliveryOutputController", () => {
  it("opens and closes without clearing state on a direct close", async () => {
    const harness = await renderController(createInput());

    expect(harness.current().isOpen).toBe(false);
    act(() => harness.current().open());
    expect(harness.current().isOpen).toBe(true);
    act(() => harness.current().close());
    expect(harness.current().isOpen).toBe(false);
  });

  it("stores successful preflight results", async () => {
    const workspace = createDeliveryWorkspace("project-a", "delivery-a");
    const preflight = successfulPreflight(workspace, "delivery-a");
    const inspect = vi.fn(async () => preflight);
    const harness = await renderController(createInput({ workspace, inspect }));

    await act(async () => {
      await harness.current().inspect("delivery-a");
    });

    expect(harness.current().preflight).toBe(preflight);
    expect(harness.current().message).toBeNull();
    expect(harness.current().busyLabel).toBeNull();
  });

  it("keeps the existing failed inspect result and message", async () => {
    const failed: InspectDeliveryOutputResult = {
      status: "failed",
      reason: "素材检查失败。",
      diagnostics: []
    };
    const harness = await renderController(
      createInput({ inspect: vi.fn(async () => failed) })
    );

    await act(async () => {
      await harness.current().inspect("delivery-a");
    });

    expect(harness.current().preflight).toBe(failed);
    expect(harness.current().message).toEqual({ tone: "error", text: "素材检查失败。" });
  });

  it("allows only the latest concurrent inspect to update preflight", async () => {
    const workspace = createDeliveryWorkspace("project-a", "delivery-a", "delivery-b");
    const first = deferred<InspectDeliveryOutputResult>();
    const second = deferred<InspectDeliveryOutputResult>();
    const firstResult = successfulPreflight(workspace, "delivery-a");
    const secondResult = successfulPreflight(workspace, "delivery-b");
    const inspect = vi.fn(
      (_workspace: MorphoWorkspace, options: { deliveryObjectId: string }) =>
        options.deliveryObjectId === "delivery-a" ? first.promise : second.promise
    );
    const harness = await renderController(createInput({ workspace, inspect }));
    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;

    await act(async () => {
      firstRun = harness.current().inspect("delivery-a");
      secondRun = harness.current().inspect("delivery-b");
    });
    await act(async () => {
      second.resolve(secondResult);
      await secondRun;
    });
    expect(harness.current().preflight).toBe(secondResult);

    await act(async () => {
      first.resolve(firstResult);
      await firstRun;
    });
    expect(harness.current().preflight).toBe(secondResult);
    expect(harness.current().busyLabel).toBeNull();
  });

  it("exports with the latest rendered workspace", async () => {
    const initialWorkspace = createDeliveryWorkspace("project-old", "delivery-a");
    const latestWorkspace = createDeliveryWorkspace("project-latest", "delivery-a");
    const failed: ExportDeliveryOutputResult = {
      status: "failed",
      reason: "test stop",
      diagnostics: []
    };
    const exportPackage = vi.fn(
      async (
        _workspace: MorphoWorkspace,
        _options: Parameters<DeliveryOutputControllerServices["exportDeliveryOutputPackage"]>[1]
      ) => failed
    );
    const harness = await renderController(createInput({ workspace: initialWorkspace, exportPackage }));

    await harness.rerender(createInput({ workspace: latestWorkspace, exportPackage }));
    await act(async () => {
      await harness.current().exportPackage("delivery-a");
    });

    expect(exportPackage).toHaveBeenCalledTimes(1);
    expect(exportPackage.mock.calls[0]?.[0]).toBe(latestWorkspace);
    expect(exportPackage.mock.calls[0]?.[1]).toMatchObject({
      deliveryObjectId: "delivery-a",
      blobStore: nullBlobStore,
      download: true
    });
  });

  it("blocks duplicate exports and clears busy state after a thrown client error", async () => {
    const pending = deferred<ExportDeliveryOutputResult>();
    const exportPackage = vi.fn(() => pending.promise);
    const harness = await renderController(createInput({ exportPackage }));
    let firstRun!: Promise<void>;

    await act(async () => {
      firstRun = harness.current().exportPackage("delivery-a");
    });
    expect(harness.current().busyLabel).toBe("正在导出交付输出包…");

    await act(async () => {
      await harness.current().exportPackage("delivery-a");
    });
    expect(exportPackage).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.reject(new Error("network failed"));
      await firstRun;
    });
    expect(harness.current().busyLabel).toBeNull();
    expect(harness.current().message).toEqual({
      tone: "error",
      text: "交付输出包导出失败，请稍后重试。"
    });
  });
});

function createInput(
  overrides: {
    workspace?: MorphoWorkspace;
    inspect?: DeliveryOutputControllerServices["inspectDeliveryOutputPackage"];
    exportPackage?: DeliveryOutputControllerServices["exportDeliveryOutputPackage"];
  } = {}
): UseDeliveryOutputControllerInput {
  const workspace = overrides.workspace ?? createDeliveryWorkspace("project-a", "delivery-a");
  const defaultExportResult: ExportDeliveryOutputResult = {
    status: "failed",
    reason: "test stop",
    diagnostics: []
  };
  return {
    workspace,
    blobStore: nullBlobStore,
    services: {
      inspectDeliveryOutputPackage:
        overrides.inspect ?? vi.fn(async () => successfulPreflight(workspace, "delivery-a")),
      exportDeliveryOutputPackage:
        overrides.exportPackage ??
        vi.fn(
          async (
            _workspace: MorphoWorkspace,
            _options: Parameters<DeliveryOutputControllerServices["exportDeliveryOutputPackage"]>[1]
          ) => defaultExportResult
        )
    }
  };
}

async function renderController(initialInput: UseDeliveryOutputControllerInput) {
  let controller: DeliveryOutputController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseDeliveryOutputControllerInput }) {
    controller = useDeliveryOutputController(input);
    return null;
  }

  const render = async (input: UseDeliveryOutputControllerInput) => {
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

function createDeliveryWorkspace(projectId: string, ...deliveryIds: string[]): MorphoWorkspace {
  const workspace = createBlankWorkspace(projectId);
  const deliveries = Object.fromEntries(
    deliveryIds.map((deliveryId) => {
      const delivery: DeliveryObject = {
        id: deliveryId,
        type: "delivery",
        title: deliveryId,
        summary: `${deliveryId} output`,
        createdBy: "user",
        visibility: "active",
        format: "board",
        sections: [
          {
            id: `${deliveryId}-section`,
            title: "Overview",
            purpose: "Describe the output.",
            order: 0,
            referenceIds: [],
            narrative: "Ready copy",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        references: [],
        gaps: [],
        createdAt: NOW,
        updatedAt: NOW
      };
      return [deliveryId, delivery];
    })
  );
  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      ...deliveries
    }
  };
}

function successfulPreflight(
  workspace: MorphoWorkspace,
  deliveryObjectId: string
): Extract<InspectDeliveryOutputResult, { status: "ok" }> {
  const result = createDeliveryOutputManifest(workspace, { deliveryObjectId, createdAt: NOW });
  if (result.status === "blocked") {
    throw new Error(result.reason);
  }
  return {
    status: "ok",
    manifest: result.manifest,
    diagnostics: result.manifest.integrity.diagnostics,
    summary: {
      sections: result.manifest.sections.length,
      references: result.manifest.references.length,
      embeddedAssets: 0,
      referenceOnlyOrNoBinary: 0,
      missingOrMismatchedAssets: 0,
      openGaps: result.manifest.gaps.filter((gap) => gap.status === "open").length,
      pendingDrafts: result.manifest.pendingSectionDrafts.length
    }
  };
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
