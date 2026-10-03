// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { compileVisualGenerationPlan } from "@/domain/operations/imagePromptCompiler";
import { freezeVisualLineage, isVisualLineageSnapshot, isVisualProviderInputManifest } from "@/domain/operations/visualLineage";
import type { VisualIntentItem } from "@/domain/operations/types";
import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import { traceDesignChain } from "@/domain/morpho/designTrace";
import { validateCurrentMorphoWorkspace } from "@/domain/morpho/currentWorkspaceValidation";
import { createInitialWorkspace, parseWorkspace, serializeWorkspace, collectDefaultReferenceReviewTargets, deleteObject } from "@/domain/morpho/workspace";
import { createEditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import { createEditableProjectBackupBundle, validateEditableProjectBackupBundle, planEditableProjectBackupRestore } from "@/domain/morpho/projectBundles";
import type { AssetRecord, ImageObject, MorphoWorkspace } from "@/domain/morpho/types";
import { recordDeliveredVisualObservations, hasDeliveredVisualObservation } from "@/domain/morpho/visualObservation";
import type { AgentReadReceipt } from "@/shared/agentReadCoverage";
import { materializeVisualProviderInputs } from "./visualProviderInputs";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import { EXTERNAL_INPUT_IMAGE_MAX_BYTES } from "@/shared/externalResultProtocol";
import { collectPrimaryCanvasEdges } from "./tldraw/primaryCanvasEdges";
import { collectPrimaryCanvasTrace } from "./tldraw/primaryCanvasTrace";

const PARENT = "image-rail-detail";
const CMF = "image-path-reference";
const ENVIRONMENT = "image-night-scenario";
const NOW = "2026-10-03T00:00:00.000Z";
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oAAAAABJRU5ErkJggg==", "base64"));

function asset(id: string): AssetRecord {
  return { id, fileName: `${id}.png`, mimeType: "image/png", size: PNG.length, createdAt: NOW,
    storageKey: `blob:${id}`, sourceType: "aiGeneratedImage", width: 1, height: 1 };
}
function fixture(): MorphoWorkspace {
  const workspace = createInitialWorkspace();
  for (const object of Object.values(workspace.objects)) {
    if (object.type !== "image") continue;
    const record = asset(`asset-p4-${object.id}`);
    workspace.assets[record.id] = record;
    workspace.objects[object.id] = { ...object, assetId: record.id, ...(object.id === ENVIRONMENT ? { directionId: "direction-support-island", visualBranchId: undefined } : {}) };
  }
  return workspace;
}
function intent(overrides: Partial<VisualIntentItem> = {}): VisualIntentItem {
  return { id: "p4", title: "发展方案", purpose: "保持身份，借用 CMF 与环境", identityParentObjectId: PARENT,
    requestedReferenceObjectIds: [CMF, ENVIRONMENT], excludeDefaultReference: true,
    referenceBindings: [{ objectId: CMF, role: "cmf", required: false }, { objectId: ENVIRONMENT, role: "environment", required: false }],
    changeGoals: ["颜色"], preserve: ["主体结构"], allowToChange: ["环境"], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [], role: "cmfStudy", ...overrides };
}
function plan(workspace: MorphoWorkspace, visualIntent = intent(), providerReferenceLimit = 8) {
  return compileVisualGenerationPlan({ workspace, kind: "visualDevelopment", intents: [visualIntent],
    selectedSourceObjectIds: [PARENT], modelId: "nano-banana-2-lite", currentUserInput: "从 A 继续，借用材质与环境", providerReferenceLimit });
}
async function materialize(workspace: MorphoWorkspace, visualIntent = intent(), missing: string[] = [], limit = 8) {
  return materializeVisualProviderInputs({ workspace, item: plan(workspace, visualIntent, limit).items[0]!, modelId: "nano-banana-2-lite",
    userInput: "从 A 继续，借用材质与环境", signal: new AbortController().signal,
    readAsset: async (key) => missing.some((id) => key === `blob:asset-p4-${id}`) ? null : new Blob([PNG], { type: "image/png" }) });
}
async function generated(workspace = fixture()) {
  const actual = await materialize(workspace);
  expect(actual.failure).toBeUndefined();
  const result = createGeneratedImageFromAsset(workspace, { asset: asset("p4-result"), sourceObjectIds: [...actual.sourceObjectIds].reverse(),
    generation: { modelId: "nano-banana-2-lite", modelLabel: "fixture", aspectRatio: "1:1", createdAt: NOW,
      prompt: actual.item.prompt, compiledPrompt: actual.item.prompt, editMode: actual.item.editMode, role: actual.item.role,
      referenceObjectIds: actual.item.referenceObjectIds, lineage: actual.item.lineage, providerInputs: actual.item.providerInputs,
      visualIntent: actual.item.visualIntent, visualPlan: plan(workspace), referenceResolution: actual.item.referenceResolution } });
  return { ...result, image: result.workspace.objects[result.createdObjectId] as ImageObject, actual };
}

describe("P4 visual lineage and actual input", () => {
  it("keeps a single identity parent with multiple references regardless of array order", async () => {
    const workspace = fixture();
    const first = plan(workspace).items[0]!;
    const reordered = plan(workspace, intent({ requestedReferenceObjectIds: [ENVIRONMENT, CMF],
      referenceBindings: [...intent().referenceBindings!].reverse() })).items[0]!;
    expect(first.lineage).toEqual(reordered.lineage);
    expect(first.lineage?.identityParent?.objectId).toBe(PARENT);
    expect(first.referenceObjectIds[0]).toBe(PARENT);
    const result = await generated(workspace);
    expect(result.image.directionId).toBe("direction-soft-rail");
    expect(result.image.visualBranchId).toBe("visual-branch-soft-rail-detail");
    expect(result.workspace.relations.filter((relation) => relation.toObjectId === result.createdObjectId && relation.kind === "version"))
      .toEqual([expect.objectContaining({ fromObjectId: PARENT })]);
    expect(result.workspace.relations.filter((relation) => relation.toObjectId === result.createdObjectId && relation.kind === "usesReference"))
      .toHaveLength(3);
  });

  it("does not use ancestor references, defaults or cross-direction auxiliaries as parent or ownership", () => {
    const workspace = fixture();
    const parent = workspace.objects[PARENT] as ImageObject;
    parent.generation = { modelId: "legacy", modelLabel: "legacy", aspectRatio: "1:1", prompt: "legacy", referenceObjectIds: [CMF, ENVIRONMENT], createdAt: NOW };
    const item = plan(workspace).items[0]!;
    expect(item.lineage?.direction?.objectId).toBe("direction-soft-rail");
    expect(item.lineage?.branch?.id).toBe("visual-branch-soft-rail-detail");
    expect(item.referenceResolution?.candidates.some((entry) => entry.reason === "directParent")).toBe(false);
    expect(item.referenceResolution?.candidates).toContainEqual(expect.objectContaining({ objectId: ENVIRONMENT, role: "environment", included: true, crossDirection: true }));
    expect(item.prompt).toContain("只借用材料、颜色和表面工艺，不继承几何");
  });

  it("requires a parent for ambiguous continuation and supports explicit new identity", () => {
    const workspace = fixture();
    expect(() => freezeVisualLineage({ workspace, kind: "visualDevelopment", intent: intent({ identityParentObjectId: undefined }), sourceObjectIds: [PARENT, CMF] })).toThrow("多个视觉来源");
    const lineage = freezeVisualLineage({ workspace, kind: "visualDevelopment", intent: intent({ identityParentObjectId: null }), sourceObjectIds: [PARENT, CMF] });
    expect(lineage.identityParent).toBeNull();
    expect(lineage.direction).toBeNull();
    expect(lineage.branch).toBeNull();
  });

  it("uses an explicit task Direction/Branch without auxiliary ownership inheritance", () => {
    const workspace = fixture();
    const item = plan(workspace, intent({ targetDirectionId: "direction-support-island", visualBranchId: undefined })).items[0]!;
    expect(item.lineage?.directionSource).toBe("explicitTask");
    expect(item.lineage?.direction?.objectId).toBe("direction-support-island");
    expect(item.lineage?.branch).toBeNull();
    expect(() => plan(workspace, intent({ targetDirectionId: "direction-support-island", visualBranchId: "visual-branch-soft-rail-detail" }))).toThrow("显式分支");
  });

  it("applies explicit exclusions to actual pixels and records their reason", async () => {
    const actual = await materialize(fixture(), intent({ excludedReferenceObjectIds: [CMF] }));
    expect(actual.failure).toBeUndefined();
    expect(actual.sourceObjectIds).not.toContain(CMF);
    expect(actual.item.providerInputs?.references).toContainEqual(expect.objectContaining({ source: expect.objectContaining({ objectId: CMF }), status: "omitted", omissionReason: "explicitExcluded" }));
    expect(actual.images).toHaveLength(2);
    expect(actual.item.prompt).not.toContain("只借用材料、颜色和表面工艺");
  });

  it("records provider-limit omissions while retaining necessary identity pixels first", async () => {
    const actual = await materialize(fixture(), intent(), [], 1);
    expect(actual.failure).toBeUndefined();
    expect(actual.sourceObjectIds).toEqual([PARENT]);
    expect(actual.item.providerInputs?.references.filter((entry) => entry.omissionReason === "providerLimit").map((entry) => entry.source.objectId))
      .toEqual(expect.arrayContaining([CMF, ENVIRONMENT]));
  });

  it.each(["parent", "structure", "providerLimit", "exclusion"])("blocks a missing required reference (%s)", async (caseName) => {
    const visualIntent = caseName === "structure" || caseName === "providerLimit" ? intent({ referenceBindings: [{ objectId: CMF, role: "structure", required: true }] }) :
      caseName === "exclusion" ? intent({ excludedReferenceObjectIds: [PARENT] }) : intent();
    const actual = await materialize(fixture(), visualIntent, caseName === "parent" ? [PARENT] : caseName === "structure" ? [CMF] : [], caseName === "providerLimit" ? 1 : 8);
    expect(actual.failure).toContain("必要参考像素不可用");
  });

  it("records optional pixel omission and recompiles prompt/edit mode to match actual inputs", async () => {
    const actual = await materialize(fixture(), intent(), [CMF]);
    expect(actual.failure).toBeUndefined();
    expect(actual.item.referenceObjectIds).toEqual([PARENT, ENVIRONMENT]);
    expect(actual.item.providerInputs?.references.find((entry) => entry.source.objectId === CMF)).toMatchObject({ status: "omitted", omissionReason: "missingPixels" });
    expect(actual.item.prompt).toContain("参考图 2：");
    expect(actual.item.prompt).not.toContain("参考图 3：");
    expect(actual.item.providerInputs?.references.filter((entry) => entry.status === "sent").map((entry) => entry.payloadIndex)).toEqual([0, 1]);
    expect(isVisualProviderInputManifest(actual.item.providerInputs)).toBe(true);
    expect(actual.item.providerInputs?.references.filter((entry) => entry.status === "sent").map((entry) => entry.pixelHash)).toEqual(actual.images.map(hashProviderImageDataUrl));
    expect(isVisualLineageSnapshot(actual.item.lineage)).toBe(true);
    const text = await materialize(fixture(), intent({ identityParentObjectId: null }), [PARENT, CMF, ENVIRONMENT]);
    expect(text.images).toEqual([]);
    expect(text.item.editMode).toBe("textToImage");
    expect(text.item.referenceObjectIds).toEqual([]);
  });

  it("keeps the owning P2A instruction when recompiling for optional omission", async () => {
    const workspace = fixture();
    const item = plan(workspace).items[0]!;
    const actual = await materializeVisualProviderInputs({ workspace, item, modelId: "nano-banana-2-lite", userInput: "unrelated comparison instruction",
      signal: new AbortController().signal, readAsset: async () => new Blob([PNG], { type: "image/png" }) });
    expect(actual.item.prompt).not.toContain("unrelated comparison instruction");
    expect(actual.item.prompt).toContain(item.userInstruction!);
  });

  it("records optional Provider byte-limit omission and blocks the same required input", async () => {
    const workspace = fixture();
    const large = new Blob([new Uint8Array(EXTERNAL_INPUT_IMAGE_MAX_BYTES + 1)], { type: "image/png" });
    const run = (required: boolean) => materializeVisualProviderInputs({ workspace,
      item: plan(workspace, intent({ referenceBindings: [{ objectId: CMF, role: "structure", required }] })).items[0]!, modelId: "nano-banana-2-lite",
      userInput: "continue", signal: new AbortController().signal,
      readAsset: async (key) => key.endsWith(CMF) ? large : new Blob([PNG], { type: "image/png" }) });
    const optional = await run(false);
    expect(optional.failure).toBeUndefined();
    expect(optional.item.providerInputs?.references.find((entry) => entry.source.objectId === CMF)).toMatchObject({ status: "omitted", omissionReason: "providerBytes" });
    expect((await run(true)).failure).toContain("providerBytes");
  });

  it("rejects source identity changes between the frozen plan and input materialization", async () => {
    const workspace = fixture();
    const item = plan(workspace).items[0]!;
    (workspace.objects[PARENT] as ImageObject).incarnationId = "reused-parent";
    const actual = await materializeVisualProviderInputs({ workspace, item, modelId: "nano-banana-2-lite", userInput: "continue", signal: new AbortController().signal,
      readAsset: async () => new Blob([PNG], { type: "image/png" }) });
    expect(actual.failure).toContain("必要参考像素不可用");
  });

  it("freezes historical Trace across default, representative, Direction revision and Branch changes", async () => {
    const result = await generated();
    const before = traceDesignChain(result.workspace, result.createdObjectId);
    const workspace = structuredClone(result.workspace);
    workspace.workingState.currentDefaultReferenceId = ENVIRONMENT;
    const branch = workspace.visualBranches["visual-branch-soft-rail-detail"]!;
    branch.rootObjectId = ENVIRONMENT; branch.label = "later branch"; branch.archivedAt = NOW;
    const direction = workspace.objects["direction-soft-rail"]!;
    if (direction.type === "conceptDirection") workspace.directionRevisions[direction.currentRevisionId]!.sourceObjectIds = [ENVIRONMENT];
    (workspace.objects[ENVIRONMENT] as ImageObject).role = "primaryVisual";
    workspace.objects[PARENT]!.title = "later title";
    expect(traceDesignChain(workspace, result.createdObjectId)).toEqual(before);
    expect(before.edges.find((edge) => edge.kind === "version")?.fromObjectId).toBe(PARENT);
    expect(before.objectIds).not.toContain("direction-soft-rail");
    expect(before.edges.some((edge) => edge.fromObjectId === ENVIRONMENT && edge.kind === "version")).toBe(false);
  });

  it("uses the frozen parent in canvas traces and keeps auxiliary references secondary", async () => {
    const result = await generated();
    const edges = collectPrimaryCanvasEdges(result.workspace).filter((edge) => edge.toObjectId === result.createdObjectId);
    expect(edges).toEqual([expect.objectContaining({ fromObjectId: PARENT, relationKind: "version" })]);
    const trace = collectPrimaryCanvasTrace(result.workspace, result.createdObjectId, "chain")!;
    expect(trace.highlightedObjectIds).toEqual([result.createdObjectId, PARENT]);
    expect(trace.secondaryObjectIds).toEqual(expect.arrayContaining([CMF, ENVIRONMENT]));
    expect(trace.highlightedObjectIds).not.toContain("direction-soft-rail");
    const parent = result.workspace.objects[PARENT] as ImageObject;
    parent.directionId = "direction-support-island";
    result.workspace.visualBranches["visual-branch-soft-rail-detail"]!.rootObjectId = ENVIRONMENT;
    expect(collectPrimaryCanvasTrace(result.workspace, result.createdObjectId, "chain")).toEqual(trace);
  });

  it("does not promote the first auxiliary input of a new identity to a canvas parent", async () => {
    const workspace = fixture();
    const actual = await materialize(workspace, intent({ identityParentObjectId: null }));
    const result = createGeneratedImageFromAsset(workspace, { asset: asset("new-identity"), sourceObjectIds: actual.sourceObjectIds,
      generation: { modelId: "fixture", modelLabel: "fixture", aspectRatio: "1:1", prompt: actual.item.prompt, createdAt: NOW,
        editMode: actual.item.editMode, referenceObjectIds: actual.item.referenceObjectIds, lineage: actual.item.lineage, providerInputs: actual.item.providerInputs } });
    expect(collectPrimaryCanvasEdges(result.workspace).filter((edge) => edge.toObjectId === result.createdObjectId)).toEqual([]);
    expect(collectPrimaryCanvasTrace(result.workspace, result.createdObjectId, "direct")?.secondaryObjectIds).toEqual(expect.arrayContaining(actual.sourceObjectIds));
  });

  it("does not mark cross-direction auxiliary users as default-reference derivatives", async () => {
    const result = await generated();
    expect(collectDefaultReferenceReviewTargets(result.workspace, ENVIRONMENT, CMF).imageIds).not.toContain(result.createdObjectId);
    expect(collectDefaultReferenceReviewTargets(result.workspace, PARENT, CMF).imageIds).toContain(result.createdObjectId);
  });

  it("preserves frozen history when current parent and Direction are deleted", async () => {
    const result = await generated();
    const lineage = structuredClone(result.image.generation?.lineage);
    const parentDeleted = deleteObject(result.workspace, PARENT, { confirmed: true }).workspace;
    const workspace = deleteObject(parentDeleted, "direction-soft-rail", { confirmed: true }).workspace;
    const image = workspace.objects[result.createdObjectId] as ImageObject;
    expect(image.directionId).toBeUndefined();
    expect(image.visualBranchId).toBeUndefined();
    expect(image.generation?.lineage).toEqual(lineage);
    expect(validateCurrentMorphoWorkspace(workspace).status).toBe("ok");
    expect(parseWorkspace(JSON.stringify(workspace)).status).toBe("ok");
    expect(traceDesignChain(workspace, result.createdObjectId).edges).toContainEqual(expect.objectContaining({ fromObjectId: PARENT, kind: "version" }));
  });

  it("retains the planned Branch membership if archived before result commit", async () => {
    const workspace = fixture();
    const actual = await materialize(workspace);
    workspace.visualBranches["visual-branch-soft-rail-detail"]!.archivedAt = NOW;
    const result = createGeneratedImageFromAsset(workspace, { asset: asset("archived-result"), sourceObjectIds: actual.sourceObjectIds,
      generation: { modelId: "fixture", modelLabel: "fixture", aspectRatio: "1:1", prompt: actual.item.prompt, createdAt: NOW,
        editMode: actual.item.editMode, referenceObjectIds: actual.item.referenceObjectIds, lineage: actual.item.lineage, providerInputs: actual.item.providerInputs } });
    const image = result.workspace.objects[result.createdObjectId] as ImageObject;
    expect(image.visualBranchId).toBe("visual-branch-soft-rail-detail");
    actual.item.lineage!.branch!.label = "mutated caller";
    expect(image.generation?.lineage?.branch?.label).not.toBe("mutated caller");
  });

  it("accepts only delivered matching pixels as observation and persists no quality verdict", async () => {
    const result = await generated();
    const receipt: AgentReadReceipt = { id: "observe", source: "tool", kind: "image", objectId: result.image.id,
      incarnationId: result.image.incarnationId, assetId: result.image.assetId, contentHash: "pixels-hash", representation: "pixels", status: "full",
      delivered: true, requestImageStatus: "materialized", requestStepSequence: 3 };
    for (const patch of [{ delivered: false }, { requestImageStatus: "omitted" as const }, { representation: "metadata" as const },
      { assetId: "wrong-asset" }, { incarnationId: "wrong-incarnation" }, { status: "unavailable" as const }, { requestStepSequence: 4 }]) {
      expect(recordDeliveredVisualObservations(result.workspace, [{ ...receipt, ...patch }], "request-3", 3)).toBe(result.workspace);
    }
    const observed = recordDeliveredVisualObservations(result.workspace, [receipt], "request-3", 3);
    const image = observed.objects[result.createdObjectId] as ImageObject;
    expect(image.generation?.observations).toEqual([expect.objectContaining({ requestId: "request-3", receiptId: "observe", contentHash: "pixels-hash", objectId: image.id })]);
    expect(recordDeliveredVisualObservations(observed, [receipt], "request-3", 3)).toBe(observed);
    expect(hasDeliveredVisualObservation(image)).toBe(true);
    expect(hasDeliveredVisualObservation({ ...image, assetId: "changed-current-image" })).toBe(false);
    expect(JSON.stringify(image.generation)).not.toContain("verified");
    const inconsistent = structuredClone(observed);
    const inconsistentImage = inconsistent.objects[result.createdObjectId] as ImageObject;
    inconsistentImage.generation!.observations![0]!.objectId = PARENT;
    expect(validateCurrentMorphoWorkspace(inconsistent).status).toBe("failed");
  });

  it("preserves lineage through current validation, reload, JSON and Editable Backup", async () => {
    const result = await generated();
    const receipt: AgentReadReceipt = { id: "backup-observe", source: "tool", kind: "image", objectId: result.image.id, incarnationId: result.image.incarnationId,
      assetId: result.image.assetId, contentHash: "hash", representation: "pixels", status: "full", delivered: true, requestImageStatus: "materialized" };
    const workspace = recordDeliveredVisualObservations(result.workspace, [receipt], "request-backup", 2);
    expect(validateCurrentMorphoWorkspace(workspace).status).toBe("ok");
    const reloaded = parseWorkspace(serializeWorkspace(workspace));
    expect(reloaded.status).toBe("ok");
    if (reloaded.status !== "ok") throw new Error(reloaded.reason);
    expect((reloaded.workspace.objects[result.createdObjectId] as ImageObject).generation).toEqual((workspace.objects[result.createdObjectId] as ImageObject).generation);
    const manifestResult = createEditableProjectBackupManifest(workspace, { createdAt: NOW, chat: "full", projectContinuity: "current" });
    expect(manifestResult.status).toBe("ok");
    if (manifestResult.status !== "ok") throw new Error(manifestResult.reason);
    const manifest = manifestResult.manifest;
    const bundle = createEditableProjectBackupBundle(manifest, manifest.assetInventory.entries.map((entry) => ({
      sourceAssetId: entry.sourceAssetId, portableBundleKey: entry.portableBundleKey, fileName: entry.fileName, mimeType: entry.mimeType,
      sourceType: entry.sourceType, expectedByteLength: entry.size, actualByteLength: entry.size, availability: "embedded", required: true,
      bytes: entry.mimeType === "image/png" && entry.size === PNG.length ? PNG : new Uint8Array(entry.size)
    })));
    expect(bundle.status).toBe("ok");
    if (bundle.status !== "ok") throw new Error(bundle.reason);
    const files = Object.fromEntries(bundle.bundle.files.map((file) => [file.path, file.bytes]));
    const validation = validateEditableProjectBackupBundle({ bundle: bundle.bundle.envelope, manifest: JSON.parse(JSON.stringify(manifest)), files });
    expect(validation.status).toBe("ok");
    if (validation.status !== "ok") throw new Error(validation.reason);
    const restored = planEditableProjectBackupRestore(validation.manifest, validation.files, { restoredAt: NOW, projectId: "p4-restored", projectTitle: "P4 restored",
      createRuntimeStorageKey: (id) => `blob:restored:${id}` });
    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") throw new Error(restored.reason);
    expect((restored.workspace.objects[result.createdObjectId] as ImageObject).generation).toEqual((workspace.objects[result.createdObjectId] as ImageObject).generation);
  });

  it("keeps legacy parent/roles unknown after reload and rejects inconsistent current provenance", async () => {
    const workspace = fixture();
    const old = workspace.objects[PARENT] as ImageObject;
    old.generation = { modelId: "legacy", modelLabel: "legacy", aspectRatio: "1:1", prompt: "legacy", referenceObjectIds: [CMF, ENVIRONMENT], createdAt: NOW };
    const legacy = parseWorkspace(JSON.stringify(workspace));
    expect(legacy.status).toBe("ok");
    if (legacy.status !== "ok") throw new Error(legacy.reason);
    expect((legacy.workspace.objects[PARENT] as ImageObject).generation?.lineage).toBeUndefined();
    const result = await generated();
    result.image.generation!.referenceObjectIds.reverse();
    expect(validateCurrentMorphoWorkspace(result.workspace).status).toBe("failed");
  });
});
