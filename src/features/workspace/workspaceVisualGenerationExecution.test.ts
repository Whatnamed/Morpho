import { describe, expect, it, vi } from "vitest";

import type { AssetRecord, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import {
  buildAPlusImageBatchIdentity,
  buildAPlusImageChildActionId,
  createAPlusImageRestoredActionCursor,
  hashAPlusExternalActionBody
} from "./agentExternalActionClientAPlus";
import {
  IMAGE_GENERATION_MAX_CONCURRENCY,
  mapWithConcurrency
} from "./imageGenerationConcurrency";
import {
  resolveGenerationSettings,
  resolveImageGenerationSettingsForVisualIntent
} from "./imageGenerationSettings";
import type {
  ImageTaskStatus,
  WorkspaceVisualGenerationExecutionPorts,
  WorkspaceVisualGenerationPlanInput
} from "./workspaceVisualGenerationExecution";
import { executeWorkspaceVisualGenerationPlan } from "./workspaceVisualGenerationExecution";
import type { PendingImageGenerationSlot } from "./pendingImageGenerationSlots";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

describe("visual generation execution characterization", () => {
  it("blocks an incomplete direction preview before any execution work", () => {
    const workspace = createTestWorkspace();
    const plan: VisualGenerationPlan = {
      kind: "directionPreview",
      items: [
        {
          id: "preview-1",
          targetDirectionId: "direction-soft-rail",
          title: "Preview",
          purpose: "Explore the direction.",
          prompt: "A warm product concept.",
          referenceObjectIds: [],
          role: "conceptImage"
        }
      ]
    };

    expect(validateVisualGenerationPlan(workspace, {
      plan,
      allowedObjectIds: ["direction-soft-rail"],
      selectedDirectionIds: ["direction-soft-rail", "direction-support-island"],
      selectedImageIds: [],
      requestedPreviewCount: 1
    })).toEqual({
      status: "blocked",
      reason: "方向预览计划必须覆盖每个已选方向，并且每方向精确生成 1 张。"
    });
  });

  it("keeps visual-intent routing and the caller-provided aspect ratio", () => {
    expect(resolveImageGenerationSettingsForVisualIntent({
      intent: "directionPreview",
      aspectRatio: "16:9"
    })).toMatchObject({
      modelId: "nano-banana-2-lite",
      aspectRatio: "16:9"
    });
    expect(resolveImageGenerationSettingsForVisualIntent({
      intent: "visualDevelopment",
      aspectRatio: "3:4"
    })).toMatchObject({
      modelId: "gpt-image-2",
      aspectRatio: "3:4"
    });
  });

  it("keeps ordinary generation bounded by the configured concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency(
      ["a", "b", "c", "d", "e"],
      IMAGE_GENERATION_MAX_CONCURRENCY,
      async (item) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return item;
      }
    );

    expect(result).toEqual(["a", "b", "c", "d", "e"]);
    expect(maximum).toBeLessThanOrEqual(IMAGE_GENERATION_MAX_CONCURRENCY);
  });

  it("keeps A+ batch and child identities deterministic", async () => {
    const firstBatch = await buildAPlusImageBatchIdentity("turn-1", "call-1");
    const secondBatch = await buildAPlusImageBatchIdentity("turn-1", "call-1");
    const firstChild = await buildAPlusImageChildActionId("call-1", "item-a");
    const secondChild = await buildAPlusImageChildActionId("call-1", "item-a");

    expect(secondBatch).toEqual(firstBatch);
    expect(secondChild).toBe(firstChild);
    expect(await buildAPlusImageChildActionId("call-1", "item-b")).not.toBe(firstChild);
  });

  it("only consumes a restored A+ action after the matching local commit", async () => {
    const requestBody = JSON.stringify({
      input: { images: [], referenceObjectIds: [] }
    });
    const cursor = createAPlusImageRestoredActionCursor({
      actionId: "img:item-a",
      actionKind: "image",
      requestBody,
      requestHash: await hashAPlusExternalActionBody(requestBody),
      callId: "call-1"
    });

    expect(cursor.hasPending()).toBe(true);
    expect(cursor.consumeAfterLocalCommit("call-1", "img:item-b")).toBe(false);
    expect(cursor.hasPending()).toBe(true);
    expect(cursor.consumeAfterLocalCommit("call-1", "img:item-a")).toBe(true);
    expect(cursor.hasPending()).toBe(false);
  });
});

describe("workspace visual generation execution core", () => {
  it("creates an image operation, persists the result, and selects all results", async () => {
    const harness = createExecutionHarness();
    const result = await executeWorkspaceVisualGenerationPlan(
      createDirectionInput(harness),
      resolveGenerationSettings({ modelId: "gpt-image-2", aspectRatio: "16:9" }),
      harness.ports
    );

    expect(result.createdObjectIds).toHaveLength(1);
    expect(result.failedItems).toEqual([]);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.url).toBe("/api/ai/image");
    expect(JSON.parse(harness.requests[0]?.body ?? "")).toMatchObject({
      modelId: "nano-banana-2-lite",
      aspectRatio: "16:9",
      prompt: "Make a warm concept image."
    });
    expect(harness.selectedObjectIds).toEqual(result.createdObjectIds);
    expect(harness.focusedObjectId).toBe(result.createdObjectIds[0]);
    const operation = Object.values(harness.workspace.operations).find(
      (candidate) => candidate.type === "imageGeneration"
    );
    expect(operation?.status).toBe("succeeded");
    expect(operation?.imageGeneration?.plan?.items).toHaveLength(1);
  });

  it("fails plan validation before operation, pending slot, provider, or selection side effects", async () => {
    const harness = createExecutionHarness();
    const input = createDirectionInput(harness, {
      selectedDirectionIds: ["direction-soft-rail", "direction-support-island"]
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("方向预览计划必须覆盖每个已选方向");
    expect(harness.requests).toHaveLength(0);
    expect(harness.commitCount).toBe(0);
    expect(harness.pendingImageGenerationSlots).toEqual([]);
    expect(harness.selectedObjectIds).toEqual([]);
    expect(harness.focusedObjectId).toBeNull();
  });

  it("keeps planned placement when provider responses settle in reverse order", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const harness = createExecutionHarness({
      respond: ({ body }) => body.includes("item-a") ? first.promise : second.promise
    });
    const input = createVisualInput(harness, 2);

    const execution = executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );
    await waitFor(() => harness.requests.length === 2);
    second.resolve(imageResponse("provider-second"));
    await Promise.resolve();
    first.resolve(imageResponse("provider-first"));
    const result = await execution;

    const firstObject = Object.values(harness.workspace.objects).find(
      (object): object is Extract<MorphoObject, { type: "image" }> =>
        object.type === "image" && object.generation?.clientRequestId?.endsWith("-item-a") === true
    );
    const secondObject = Object.values(harness.workspace.objects).find(
      (object): object is Extract<MorphoObject, { type: "image" }> =>
        object.type === "image" && object.generation?.clientRequestId?.endsWith("-item-b") === true
    );
    expect(firstObject?.generation?.visualPlan?.items.map((item) => item.id)).toEqual(["item-a", "item-b"]);
    expect(firstObject && secondObject).toBeTruthy();
    const firstPosition = firstObject
      ? harness.workspace.canvas.instances.find((instance) => instance.objectId === firstObject.id)?.position
      : undefined;
    const secondPosition = secondObject
      ? harness.workspace.canvas.instances.find((instance) => instance.objectId === secondObject.id)?.position
      : undefined;
    expect(firstPosition).toBeDefined();
    expect(secondPosition).toBeDefined();
    expect(firstPosition).not.toEqual(secondPosition);
  });

  it("keeps partial success durable and completes the operation", async () => {
    const harness = createExecutionHarness({
      respond: ({ body }) => body.includes("item-a")
        ? imageResponse("provider-a")
        : new Response(JSON.stringify({ error: "provider rejected item-b" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          })
    });

    const result = await executeWorkspaceVisualGenerationPlan(
      createVisualInput(harness, 2),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );

    expect(result.createdObjectIds).toHaveLength(1);
    expect(result.failedItems).toEqual(["Item 2: provider rejected item-b"]);
    expect(harness.imageTaskStatuses.at(-1)).toMatchObject({
      state: "succeeded",
      message: "部分完成：已保存 1 张，失败 1 项。"
    });
    const operation = Object.values(harness.workspace.operations).find(
      (candidate) => candidate.type === "imageGeneration"
    );
    expect(operation?.status).toBe("succeeded");
    expect(operation?.imageGeneration?.failedItems).toEqual([
      { planItemId: "item-b", reason: "provider rejected item-b" }
    ]);
  });

  it("fails an all-failed operation and leaves no generated object", async () => {
    const harness = createExecutionHarness({
      respond: () => new Response(JSON.stringify({ error: "provider unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      createVisualInput(harness, 2),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("Item 1: provider unavailable");
    expect(Object.values(harness.workspace.objects).filter(
      (object) => object.type === "image" && object.generation?.operationId?.startsWith("operation-image-")
    )).toHaveLength(0);
    expect(harness.imageTaskStatuses.at(-1)).toMatchObject({ state: "failed" });
    const operation = Object.values(harness.workspace.operations).find(
      (candidate) => candidate.type === "imageGeneration"
    );
    expect(operation?.status).toBe("failed");
  });

  it("keeps A+ image actions serial and persists intent before fetch", async () => {
    const events: string[] = [];
    const harness = createExecutionHarness({
      respond: () => imageResponse("a-plus"),
      onFetch: () => events.push("fetch")
    });
    const input = createAPlusInput(harness, 2, {
      onExternalActionIntent: async () => {
        events.push("intent");
        return true;
      }
    });
    await executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );

    expect(harness.requests).toHaveLength(2);
    expect(events).toEqual(["intent", "fetch", "intent", "fetch"]);
    expect(harness.maximumInFlight).toBe(1);
    expect(harness.requests.every((request) => request.url.includes("/actions/image"))).toBe(true);
  });

  it("does not fetch when A+ intent persistence fails", async () => {
    const harness = createExecutionHarness();
    const input = createAPlusInput(harness, 1, {
      onExternalActionIntent: () => false
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("Recovery Record");
    expect(harness.requests).toHaveLength(0);
    expect(harness.imageTaskStatuses.at(-1)).toMatchObject({ state: "failed" });
  });

  it("does not mark an A+ running response as failed or cancelled", async () => {
    const harness = createExecutionHarness({
      respond: () => new Response(JSON.stringify({ replayed: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toMatchObject({ code: "external_action_running" });
    expect(harness.imageTaskStatuses.at(-1)).toMatchObject({ state: "waiting" });
    const operation = Object.values(harness.workspace.operations).find(
      (candidate) => candidate.type === "imageGeneration"
    );
    expect(operation?.status).toBe("running");
  });

  it("reuses an existing A+ result without another fetch or generated object", async () => {
    const harness = createExecutionHarness();
    const first = await executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );
    const objectCountAfterFirst = Object.keys(harness.workspace.objects).length;
    const requestCountAfterFirst = harness.requests.length;

    const second = await executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );

    expect(second.createdObjectIds).toEqual(first.createdObjectIds);
    expect(harness.requests).toHaveLength(requestCountAfterFirst);
    expect(Object.keys(harness.workspace.objects)).toHaveLength(objectCountAfterFirst);
  });

  it("replays a restored request body exactly and does not read current reference pixels", async () => {
    const readReferenceAsset = vi.fn(async () => {
      throw new Error("restored actions must not rebuild reference pixels");
    });
    const harness = createExecutionHarness({ readReferenceAsset });
    const childActionId = await buildAPlusImageChildActionId("parent-call", "item-a");
    const requestBody = JSON.stringify({
      localProjectId: harness.workspace.project.id,
      requestId: "request-1",
      stepSequence: 1,
      actionId: childActionId,
      claimCallId: "parent-call",
      input: {
        modelId: "gpt-image-2",
        prompt: "persisted prompt",
        images: ["data:image/png;base64,AAAA"],
        referenceObjectIds: ["persisted-reference"],
        aspectRatio: "1:1",
        operationId: "persisted-operation",
        clientRequestId: "persisted-client"
      }
    });
    const input = createAPlusInput(harness, 1, {
      restoredExternalAction: {
        actionId: childActionId,
        actionKind: "image",
        requestBody,
        requestHash: await hashAPlusExternalActionBody(requestBody),
        callId: "parent-call"
      }
    });

    await executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "16:9" }),
      harness.ports
    );

    expect(harness.requests[0]?.body).toBe(requestBody);
    expect(readReferenceAsset).not.toHaveBeenCalled();
  });

  it("fails closed on a restored request hash mismatch without fetching", async () => {
    const harness = createExecutionHarness();
    const childActionId = await buildAPlusImageChildActionId("parent-call", "item-a");
    const requestBody = JSON.stringify({ input: { images: [], referenceObjectIds: [] } });

    await expect(executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1, {
        restoredExternalAction: {
          actionId: childActionId,
          actionKind: "image",
          requestBody,
          requestHash: "wrong-hash",
          callId: "parent-call"
        }
      }),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("校验失败");
    expect(harness.requests).toHaveLength(0);
  });

  it("stops an A+ batch at a restored-action barrier instead of skipping to a new charge", async () => {
    const harness = createExecutionHarness();
    const childActionId = await buildAPlusImageChildActionId("parent-call", "item-b");
    const requestBody = JSON.stringify({ input: { images: [], referenceObjectIds: [] } });

    await expect(executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 2, {
        restoredExternalAction: {
          actionId: childActionId,
          actionKind: "image",
          requestBody,
          requestHash: await hashAPlusExternalActionBody(requestBody),
          callId: "parent-call"
        }
      }),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("不能重新构造请求");
    expect(harness.requests).toHaveLength(0);
  });

  it("cancels the operation on AbortError while preserving already committed results", async () => {
    const harness = createExecutionHarness({
      respond: () => Promise.reject(new DOMException("cancelled", "AbortError"))
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      createVisualInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.imageTaskStatuses.at(-1)).toMatchObject({ state: "cancelled" });
    const operation = Object.values(harness.workspace.operations).find(
      (candidate) => candidate.type === "imageGeneration"
    );
    expect(operation?.status).toBe("cancelled");
  });

  it("uses four ordinary workers but only one A+ worker", async () => {
    const ordinaryGates: Array<ReturnType<typeof deferred<Response>>> = [];
    const ordinary = createExecutionHarness({
      respond: () => {
        const gate = deferred<Response>();
        ordinaryGates.push(gate);
        return gate.promise;
      }
    });
    const ordinaryExecution = executeWorkspaceVisualGenerationPlan(
      createVisualInput(ordinary, 5),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      ordinary.ports
    );
    await waitFor(() => ordinary.requests.length === IMAGE_GENERATION_MAX_CONCURRENCY);
    expect(ordinary.maximumInFlight).toBe(IMAGE_GENERATION_MAX_CONCURRENCY);
    for (let index = 0; index < 5; index += 1) {
      await waitFor(() => ordinaryGates[index] !== undefined);
      ordinaryGates[index]!.resolve(imageResponse(`ordinary-${index}`));
    }
    await ordinaryExecution;

    const aPlusGate = deferred<Response>();
    const aPlus = createExecutionHarness({ respond: () => aPlusGate.promise });
    const aPlusExecution = executeWorkspaceVisualGenerationPlan(
      createAPlusInput(aPlus, 2),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      aPlus.ports
    );
    await waitFor(() => aPlus.requests.length === 1);
    expect(aPlus.maximumInFlight).toBe(1);
    aPlusGate.resolve(imageResponse("a-plus-one"));
    await waitFor(() => aPlus.requests.length === 2);
    await aPlusExecution;
    expect(aPlus.maximumInFlight).toBe(1);
  });

  it("commits each item before removing its matching pending slot and clears the remainder", async () => {
    const gate = deferred<Response>();
    const harness = createExecutionHarness({ respond: () => gate.promise });
    const execution = executeWorkspaceVisualGenerationPlan(
      createVisualInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );
    await waitFor(() => harness.pendingImageGenerationSlots.length === 1);
    expect(harness.pendingImageGenerationSlots[0]?.planItemId).toBe("item-a");
    gate.resolve(imageResponse("pending-order"));
    await execution;

    const saveIndex = harness.events.indexOf("asset:save");
    const commitAfterSave = harness.events.findIndex((event, index) => index > saveIndex && event === "workspace:commit");
    const pendingAfterCommit = harness.events.findIndex((event, index) => index > commitAfterSave && event === "pending:update");
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(commitAfterSave).toBeGreaterThan(saveIndex);
    expect(pendingAfterCommit).toBeGreaterThan(commitAfterSave);
    expect(harness.pendingImageGenerationSlots).toEqual([]);
  });

  it("does not fabricate reference pixels when an image asset is missing", async () => {
    const readReferenceAsset = vi.fn(async () => null);
    const harness = createExecutionHarness({ readReferenceAsset });
    harness.ports.updateWorkspace((current) => {
      const image = current.objects["image-soft-rail-v2"];
      if (!image || image.type !== "image") return current;
      const referenceAsset = makeAsset("reference-asset");
      return {
        ...current,
        assets: { ...current.assets, [referenceAsset.id]: referenceAsset },
        objects: {
          ...current.objects,
          [image.id]: { ...image, assetId: referenceAsset.id }
        }
      };
    });
    const input = createVisualInput(harness, 1);
    input.plan.items[0] = {
      ...input.plan.items[0]!,
      referenceObjectIds: ["image-soft-rail-v2"]
    };
    input.sourceObjectIds = ["image-soft-rail-v2"];
    input.selectedImageIds = ["image-soft-rail-v2"];

    await executeWorkspaceVisualGenerationPlan(
      input,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );

    const body = JSON.parse(harness.requests[0]?.body ?? "") as { images?: unknown; referenceObjectIds?: unknown };
    expect(body.images).toEqual([]);
    expect(body.referenceObjectIds).toEqual(["image-soft-rail-v2"]);
    expect(readReferenceAsset).toHaveBeenCalled();
  });

  it("includes a real reference blob in the new request when the asset is available", async () => {
    class FakeFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(_blob: Blob): void {
        this.result = "data:image/png;base64,AAAA";
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    try {
      const harness = createExecutionHarness({
        readReferenceAsset: async () => new Blob(["reference"], { type: "image/png" })
      });
      harness.ports.updateWorkspace((current) => {
        const image = current.objects["image-soft-rail-v2"];
        if (!image || image.type !== "image") return current;
        const referenceAsset = makeAsset("reference-asset");
        return {
          ...current,
          assets: { ...current.assets, [referenceAsset.id]: referenceAsset },
          objects: {
            ...current.objects,
            [image.id]: { ...image, assetId: referenceAsset.id }
          }
        };
      });
      const input = createVisualInput(harness, 1);
      input.plan.items[0] = {
        ...input.plan.items[0]!,
        referenceObjectIds: ["image-soft-rail-v2"]
      };
      input.sourceObjectIds = ["image-soft-rail-v2"];
      input.selectedImageIds = ["image-soft-rail-v2"];

      await executeWorkspaceVisualGenerationPlan(
        input,
        resolveGenerationSettings({ aspectRatio: "1:1" }),
        harness.ports
      );

      expect(JSON.parse(harness.requests[0]?.body ?? "").images).toEqual(["data:image/png;base64,AAAA"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not create an image object when saving the generated asset fails", async () => {
    const harness = createExecutionHarness({
      saveGeneratedAsset: async () => ({ status: "failed", reason: "asset store unavailable" })
    });

    await expect(executeWorkspaceVisualGenerationPlan(
      createDirectionInput(harness),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("asset store unavailable");
    expect(Object.values(harness.workspace.objects).some(
      (object) => object.type === "image" && object.generation?.operationId?.startsWith("operation-image-")
    )).toBe(false);
  });

  it("rejects an A+ deterministic operation type conflict before fetch", async () => {
    const harness = createExecutionHarness();
    const identity = await buildAPlusImageBatchIdentity("turn-1", "parent-call");
    const conflictingWorkspace = {
      ...harness.workspace,
      operations: {
        ...harness.workspace.operations,
        [identity.operationId]: {
          id: identity.operationId,
          type: "research" as const,
          projectId: harness.workspace.project.id,
          createdAt: "2026-08-07T00:00:00.000Z",
          updatedAt: "2026-08-07T00:00:00.000Z",
          status: "queued" as const,
          userInput: "conflict",
          inputSnapshot: {
            userInput: "conflict",
            selectedObjectIds: [],
            sourceSnapshots: [],
            objectSnapshots: []
          },
          allowedCapabilities: { webSearch: false, imagePixels: false },
          steps: [],
          events: [],
          sourceIds: [],
          proposalIds: [],
          retryable: true
        }
      }
    };
    harness.ports.updateWorkspace(() => conflictingWorkspace);

    await expect(executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("现有非图像 Operation 冲突");
    expect(harness.requests).toHaveLength(0);
    expect(harness.pendingImageGenerationSlots).toEqual([]);
  });

  it("rejects a mismatched recovery plan instead of creating a second operation", async () => {
    const harness = createExecutionHarness();
    await executeWorkspaceVisualGenerationPlan(
      createAPlusInput(harness, 1),
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    );
    const requestCount = harness.requests.length;
    const mismatched = createAPlusInput(harness, 1);
    mismatched.plan = {
      ...mismatched.plan,
      items: [{
        ...mismatched.plan.items[0]!,
        id: "different-item"
      }]
    };

    await expect(executeWorkspaceVisualGenerationPlan(
      mismatched,
      resolveGenerationSettings({ aspectRatio: "1:1" }),
      harness.ports
    )).rejects.toThrow("恢复计划与原计划不一致");
    expect(harness.requests).toHaveLength(requestCount);
    expect(Object.values(harness.workspace.operations).filter((operation) => operation.type === "imageGeneration")).toHaveLength(1);
  });
});

type ExecutionRequest = {
  url: string;
  body: string;
};

type ExecutionHarness = {
  readonly workspace: MorphoWorkspace;
  readonly ports: WorkspaceVisualGenerationExecutionPorts;
  readonly requests: ExecutionRequest[];
  readonly imageTaskStatuses: ImageTaskStatus[];
  readonly pendingImageGenerationSlots: PendingImageGenerationSlot[];
  readonly selectedObjectIds: string[];
  readonly focusedObjectId: string | null;
  readonly events: string[];
  readonly commitCount: number;
  readonly maximumInFlight: number;
};

function createExecutionHarness(options: {
  respond?: (request: ExecutionRequest) => Response | Promise<Response>;
  onFetch?: (request: ExecutionRequest) => void;
  readReferenceAsset?: (storageKey: string) => Promise<Blob | null>;
  saveGeneratedAsset?: (file: File) => Promise<{ status: "ok"; asset: AssetRecord } | { status: "failed"; reason: string }>;
} = {}): ExecutionHarness {
  let currentWorkspace = createTestWorkspace();
  let pendingImageGenerationSlots: PendingImageGenerationSlot[] = [];
  let focusedObjectId: string | null = null;
  let commitCount = 0;
  let activeFetches = 0;
  let maximumInFlight = 0;
  const requests: ExecutionRequest[] = [];
  const imageTaskStatuses: ImageTaskStatus[] = [];
  const selectedObjectIds: string[] = [];
  const events: string[] = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const request = { url, body };
    requests.push(request);
    options.onFetch?.(request);
    activeFetches += 1;
    maximumInFlight = Math.max(maximumInFlight, activeFetches);
    try {
      return await (options.respond?.(request) ?? imageResponse("default"));
    } finally {
      activeFetches -= 1;
    }
  };

  const harness = {
    get workspace() {
      return currentWorkspace;
    },
    ports: undefined as unknown as WorkspaceVisualGenerationExecutionPorts,
    requests,
    imageTaskStatuses,
    get pendingImageGenerationSlots() {
      return pendingImageGenerationSlots;
    },
    selectedObjectIds,
    get focusedObjectId() {
      return focusedObjectId;
    },
    events,
    get commitCount() {
      return commitCount;
    },
    get maximumInFlight() {
      return maximumInFlight;
    }
  } satisfies ExecutionHarness;

  const ports: WorkspaceVisualGenerationExecutionPorts = {
    fetch: fakeFetch,
    commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>) => {
      events.push("workspace:commit");
      commitCount += 1;
      const result = transform(currentWorkspace);
      currentWorkspace = result.workspace;
      return result.value;
    },
    updateWorkspace: (update) => {
      events.push("workspace:update");
      currentWorkspace = update(currentWorkspace);
    },
    updatePendingImageGenerationSlots: (update) => {
      events.push("pending:update");
      pendingImageGenerationSlots = update(pendingImageGenerationSlots);
    },
    setImageTaskStatus: (status) => {
      if (status) imageTaskStatuses.push(status);
    },
    saveGeneratedAsset: options.saveGeneratedAsset ?? (async (_file) => {
      events.push("asset:save");
      return {
        status: "ok",
        asset: makeAsset(`generated-${requests.length}`)
      };
    }),
    readReferenceAsset: options.readReferenceAsset ?? (async () => null),
    selectObjects: (objectIds) => {
      selectedObjectIds.splice(0, selectedObjectIds.length, ...objectIds);
    },
    focusObject: (objectId) => {
      focusedObjectId = objectId;
    },
    now: () => 1_700_000_000_000,
    randomSuffix: () => "fixed"
  };
  harness.ports = ports;
  return harness;
}

function createDirectionInput(
  harness: ExecutionHarness,
  overrides: Partial<WorkspaceVisualGenerationPlanInput> = {}
): WorkspaceVisualGenerationPlanInput {
  return {
    workspaceSnapshot: harness.workspace,
    draft: "Make a warm concept image.",
    plan: {
      kind: "directionPreview",
      items: [
        {
          id: "preview-1",
          targetDirectionId: "direction-soft-rail",
          title: "Preview",
          purpose: "Explore the direction.",
          prompt: "Make a warm concept image.",
          referenceObjectIds: [],
          role: "conceptImage"
        }
      ]
    },
    sourceObjectIds: ["direction-soft-rail"],
    selectedDirectionIds: ["direction-soft-rail"],
    selectedImageIds: [],
    requestedPreviewCount: 1,
    signal: new AbortController().signal,
    ...overrides
  };
}

function createVisualInput(
  harness: ExecutionHarness,
  count: number
): WorkspaceVisualGenerationPlanInput {
  return {
    workspaceSnapshot: harness.workspace,
    draft: "Develop these visuals.",
    plan: {
      kind: "visualDevelopment",
      items: Array.from({ length: count }, (_, index) => ({
        id: `item-${String.fromCharCode(97 + index)}`,
        title: `Item ${index + 1}`,
        purpose: `Develop visual ${index + 1}.`,
        prompt: `Develop visual item-${String.fromCharCode(97 + index)}.`,
        referenceObjectIds: [],
        role: "preview" as const
      }))
    },
    sourceObjectIds: [],
    selectedDirectionIds: [],
    selectedImageIds: [],
    signal: new AbortController().signal
  };
}

function createAPlusInput(
  harness: ExecutionHarness,
  count: number,
  overrides: Partial<WorkspaceVisualGenerationPlanInput> = {}
): WorkspaceVisualGenerationPlanInput {
  return {
    ...createVisualInput(harness, count),
    aPlusExternalAction: {
      serverTurnId: "turn-1",
      localProjectId: harness.workspace.project.id,
      requestId: "request-1",
      stepSequence: 1,
      actionId: "parent-call"
    },
    ...overrides
  };
}

function imageResponse(label: string): Response {
  return new Response(new Blob([label], { type: "image/png" }), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "X-Morpho-Provider-Task-Id": `provider-${label}`
    }
  });
}

function makeAsset(id: string): AssetRecord {
  return {
    id,
    fileName: `${id}.png`,
    mimeType: "image/png",
    size: 10,
    createdAt: "2026-08-07T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType: "aiGeneratedImage",
    width: 320,
    height: 240,
    aspectRatio: 4 / 3
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the execution harness.");
}
