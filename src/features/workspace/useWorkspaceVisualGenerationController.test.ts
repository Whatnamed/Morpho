// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { resolveGenerationSettings } from "./imageGenerationSettings";
import type { WorkspaceVisualGenerationPlanInput } from "./workspaceVisualGenerationExecution";
import type { PendingImageGenerationSlot } from "./pendingImageGenerationSlots";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  useWorkspaceVisualGenerationController,
  type UseWorkspaceVisualGenerationControllerInput,
  type WorkspaceVisualGenerationController
} from "./useWorkspaceVisualGenerationController";

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

describe("useWorkspaceVisualGenerationController", () => {
  it("uses the latest effective settings after a rerender", async () => {
    const harness = createControllerHarness();
    const firstSettings = resolveGenerationSettings({ aspectRatio: "1:1" });
    const latestSettings = resolveGenerationSettings({ aspectRatio: "16:9" });
    const services = createServices(harness);
    const firstInput = createInput(harness, firstSettings, services);
    const rendered = await renderController(firstInput);

    await rendered.rerender({ ...firstInput, effectiveImageGenerationSettings: latestSettings });
    await act(async () => {
      const execution = rendered.current().executeVisualGenerationPlan(createPlanInput(harness));
      harness.response.resolve(controllerImageResponse());
      await execution;
    });

    expect(JSON.parse(harness.requests[0]?.body ?? "")).toMatchObject({ aspectRatio: "16:9" });
  });

  it("keeps the execution callback stable across ordinary workspace rerenders", async () => {
    const harness = createControllerHarness();
    const settings = resolveGenerationSettings({ aspectRatio: "1:1" });
    const services = createServices(harness);
    const initialInput = createInput(harness, settings, services);
    const rendered = await renderController(initialInput);
    const firstCallback = rendered.current().executeVisualGenerationPlan;

    await rendered.rerender(initialInput);

    expect(rendered.current().executeVisualGenerationPlan).toBe(firstCallback);
  });

  it("does not cancel an in-flight execution when the controller unmounts", async () => {
    const harness = createControllerHarness();
    const rendered = await renderController(createInput(harness, resolveGenerationSettings({ aspectRatio: "1:1" })));
    const execution = rendered.current().executeVisualGenerationPlan(createPlanInput(harness));
    await act(async () => {
      await Promise.resolve();
      rendered.unmount();
    });
    harness.response.resolve(new Response(new Blob(["image"], { type: "image/png" }), {
      status: 200,
      headers: { "Content-Type": "image/png" }
    }));

    await expect(execution).resolves.toMatchObject({ createdObjectIds: expect.any(Array) });
    expect(harness.requests).toHaveLength(1);
  });
});

type ControllerHarness = {
  workspace: MorphoWorkspace;
  pending: PendingImageGenerationSlot[];
  statuses: unknown[];
  requests: Array<{ body: string }>;
  selected: string[];
  focused: string | null;
  response: ReturnType<typeof deferred<Response>>;
};

function createControllerHarness(): ControllerHarness {
  const harness = {
    workspace: createTestWorkspace(),
    pending: [],
    statuses: [],
    requests: [],
    selected: [],
    focused: null,
    response: deferred<Response>()
  } satisfies ControllerHarness;
  return harness;
}

function createInput(
  harness: ControllerHarness,
  effectiveImageGenerationSettings: ReturnType<typeof resolveGenerationSettings>,
  services = createServices(harness)
): UseWorkspaceVisualGenerationControllerInput {
  return {
    effectiveImageGenerationSettings,
    commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>) => {
      const result = transform(harness.workspace);
      harness.workspace = result.workspace;
      return result.value;
    },
    updateWorkspace: (update) => {
      harness.workspace = update(harness.workspace);
    },
    setPendingImageGenerationSlots: (update) => {
      harness.pending = update(harness.pending);
    },
    setImageTaskStatus: (status) => {
      if (status) harness.statuses.push(status);
    },
    selectObjects: (objectIds) => {
      harness.selected = [...objectIds];
    },
    focusObject: (objectId) => {
      harness.focused = objectId;
    },
    services
  };
}

function createServices(harness: ControllerHarness): NonNullable<UseWorkspaceVisualGenerationControllerInput["services"]> {
  return {
    fetch: async (_input, init) => {
      harness.requests.push({ body: typeof init?.body === "string" ? init.body : "" });
      return harness.response.promise;
    },
    saveGeneratedAsset: async () => ({
      status: "ok",
      asset: controllerAsset()
    }),
    readReferenceAsset: async () => null,
    now: () => 1_700_000_000_000 + harness.requests.length,
    randomSuffix: () => `controller-${harness.requests.length}`
  };
}

function createPlanInput(harness: ControllerHarness): WorkspaceVisualGenerationPlanInput {
  return {
    workspaceSnapshot: harness.workspace,
    draft: "Create a direction preview.",
    plan: {
      kind: "directionPreview",
      items: [{
        id: "preview-1",
        targetDirectionId: "direction-soft-rail",
        title: "Preview",
        purpose: "Explore the direction.",
        prompt: "Create a direction preview.",
        referenceObjectIds: [],
        role: "conceptImage"
      }]
    },
    sourceObjectIds: ["direction-soft-rail"],
    selectedDirectionIds: ["direction-soft-rail"],
    selectedImageIds: [],
    requestedPreviewCount: 1,
    signal: new AbortController().signal
  };
}

async function renderController(initialInput: UseWorkspaceVisualGenerationControllerInput) {
  let controller: WorkspaceVisualGenerationController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseWorkspaceVisualGenerationControllerInput }) {
    controller = useWorkspaceVisualGenerationController(input);
    return null;
  }

  const render = async (input: UseWorkspaceVisualGenerationControllerInput) => {
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
    rerender: render,
    unmount: async () => {
      await act(async () => root.unmount());
    }
  };
}

function controllerAsset(): AssetRecord {
  return {
    id: "controller-asset",
    fileName: "controller.png",
    mimeType: "image/png",
    size: 5,
    createdAt: "2026-08-07T00:00:00.000Z",
    storageKey: "blob:controller-asset",
    sourceType: "aiGeneratedImage",
    width: 320,
    height: 240,
    aspectRatio: 4 / 3
  };
}

function controllerImageResponse(): Response {
  return new Response(new Blob(["image"], { type: "image/png" }), {
    status: 200,
    headers: { "Content-Type": "image/png" }
  });
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
