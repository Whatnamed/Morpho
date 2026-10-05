import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { createImageGenerationOperation } from "@/domain/operations/operations";
import type { AssetRecord } from "@/domain/morpho/types";
import type { ImageGenerationResultCommit } from "./imageGenerationResultCommit";
import type { WorkspaceVisualGenerationExecutionPorts } from "./workspaceVisualGenerationExecution";
import type { ExternalResultManifest } from "@/shared/externalResultProtocol";
import { prepareIndependentImageDelivery, resumeIndependentImageDeliveries } from "./independentImageDelivery";
const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("@/infrastructure/assets/indexedDbAssetStore", () => ({ indexedDbBlobStore: {
  put: async (key: string, blob: Blob) => { blobs.set(key, blob); },
  get: async (key: string) => blobs.get(key) ?? null,
  delete: async (key: string) => { blobs.delete(key); }
} }));
beforeEach(() => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  blobs.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const projectId = "independent-project", operationId = "independent-operation", clientRequestId = "independent-request";
  let workspace = createImageGenerationOperation(createInitialWorkspace(), {
    operationId, clientRequestId, prompt: "same image", selectedObjectIds: [], imagePixels: false,
    modelId: "nano-banana-fast", modelLabel: "nano-banana-fast", aspectRatio: "1:1", referenceObjectIds: []
  }).workspace;
  const draft: Omit<Extract<ImageGenerationResultCommit, { status: "succeeded" }>, "asset"> = {
    status: "succeeded", operationId, title: "same image", summary: "original", role: "conceptImage",
    position: { x: 0, y: 0 }, canvasSize: { w: 240, h: 240 }, sourceObjectIds: [],
    generation: { operationId, clientRequestId, prompt: "same image", modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast", aspectRatio: "1:1", referenceObjectIds: [], createdAt: "2026-10-01T00:00:00Z" }
  };
  const key = await prepareIndependentImageDelivery(projectId, clientRequestId, '{"original":"input"}', draft);
  const intent = JSON.parse(await blobs.get(key)!.text()) as { effectId: string };
  const manifest: ExternalResultManifest = { effectId: intent.effectId, resultId: `result:${"b".repeat(64)}`, version: 1,
    kind: "image", sha256: createHash("sha256").update("original").digest("hex"), byteLength: 8,
    mimeType: "image/png", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z" };
  const session = { projectId, workspaceReady: true, generation: Symbol() };
  let saved = false, failAsset = false, expired = false, stagingPending = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (init?.method === "POST") { expect(saved).toBe(true); return Response.json({ acknowledged: true }); }
    if (stagingPending) return Response.json({ code: "external_result_unavailable", deliveryPending: true }, { status: 503 });
    if (String(url).includes("chunk=")) return new Response("original");
    return expired ? new Response(null, { status: 410 }) : Response.json({ result: manifest }, {
      headers: { "X-Morpho-Provider-Task-Id": "original-task" }
    });
  });
  const asset: AssetRecord = { id: "independent-asset", fileName: "original.png", mimeType: "image/png", size: 8,
    createdAt: "2026-10-01T00:00:00Z", storageKey: "blob:independent-asset", sourceType: "aiGeneratedImage", width: 1, height: 1, aspectRatio: 1 };
  const saveGeneratedAsset = vi.fn<WorkspaceVisualGenerationExecutionPorts["saveGeneratedAsset"]>(async (file) => {
    if (failAsset) return { status: "failed", reason: "transaction aborted" };
    blobs.set(asset.storageKey, file);
    return { status: "ok", asset };
  });
  const ports: WorkspaceVisualGenerationExecutionPorts = {
    fetch, getCurrentSession: () => session, assertCurrentSession: () => undefined,
    commitWorkspace: (_session, transform) => { const r = transform(workspace); workspace = r.workspace; return r.value; },
    persistWorkspace: () => saved ? { phase: "saved", isDirty: false } : { phase: "error", isDirty: true, error: "quota" },
    saveGeneratedAsset, deleteAsset: async () => undefined, readReferenceAsset: async (key) => blobs.get(key) ?? null,
    updatePendingImageGenerationSlots: () => undefined, setImageTaskStatus: () => undefined,
    selectObjects: () => undefined, focusObject: () => undefined, now: () => 0, randomSuffix: () => "same"
  };
  return { ports, key, manifest, fetch, saveGeneratedAsset, workspace: () => workspace,
    saved: () => { saved = true; }, assetFailure: () => { failAsset = true; }, expire: () => { expired = true; },
    staging: (pending: boolean) => { stagingPending = pending; },
    cancel: () => { workspace.operations[operationId]!.status = "cancelled"; } };
}

describe("independent Image bounded reload delivery", () => {
  it("cannot recover from an index without its original durable intent blob; no request, asset or ACK is invented", async () => {
    const f = await fixture();
    const originalObjects = f.workspace().objects;
    blobs.delete(f.key);
    f.saved();
    await resumeIndependentImageDeliveries(f.ports);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.saveGeneratedAsset).not.toHaveBeenCalled();
    expect(f.workspace().objects).toEqual(originalObjects);
  });

  it("partial escrow stays pending, then repeated reload delivers one local Image by GET only", async () => {
    const f = await fixture(); f.saved(); f.staging(true);
    await resumeIndependentImageDeliveries(f.ports);
    expect(blobs.has(f.key)).toBe(true); expect(f.saveGeneratedAsset).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.every(([,init]) => init?.method !== "POST")).toBe(true);
    f.staging(false);
    await resumeIndependentImageDeliveries(f.ports); await resumeIndependentImageDeliveries(f.ports);
    expect(Object.values(f.workspace().objects).filter(o => o.type === "image" && o.generation?.delivery?.resultId === f.manifest.resultId)).toHaveLength(1);
    expect(f.saveGeneratedAsset).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(1); // ACK only
    expect(f.fetch.mock.calls.every(([url]) => String(url).includes("/effects/"))).toBe(true);
  });
  it("keeps failed Workspace save pending, reloads original bytes once, and ACKs after durable save", async () => {
    const f = await fixture();
    await resumeIndependentImageDeliveries(f.ports);
    expect(f.fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    expect(blobs.has(f.key)).toBe(true);
    const images = () => Object.values(f.workspace().objects).filter((o) => o.type === "image" && o.generation?.clientRequestId === "independent-request");
    expect(images()).toHaveLength(1);
    f.saved();
    await resumeIndependentImageDeliveries(f.ports);
    await resumeIndependentImageDeliveries(f.ports);
    expect(images()).toHaveLength(1);
    expect(images()[0]).toMatchObject({ generation: { providerTaskId: "original-task", delivery: f.manifest } });
    expect(f.saveGeneratedAsset).toHaveBeenCalledTimes(1);
    expect(blobs.has(f.key)).toBe(false);
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.fetch.mock.calls.every(([url]) => String(url).includes("/effects/"))).toBe(true);
  });
  it("asset transaction failure never ACKs and preserves original recovery intent", async () => {
    const f = await fixture(); f.saved(); f.assetFailure();
    await resumeIndependentImageDeliveries(f.ports);
    expect(blobs.has(f.key)).toBe(true);
    expect(f.fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it.each(["expired", "cancelled"])("%s recovery never submits or applies an image", async (state) => {
    const f = await fixture(); f.saved();
    if (state === "expired") f.expire(); else f.cancel();
    await resumeIndependentImageDeliveries(f.ports);
    expect(f.saveGeneratedAsset).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    if (state === "expired") expect(blobs.has(f.key)).toBe(false);
  });
});
