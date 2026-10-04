import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import * as imageAttachments from "./aiAttachments";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeWorkspaceVisualGenerationPlan } from "./workspaceVisualGenerationExecution";
import { resolveGenerationSettings } from "./imageGenerationSettings";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { getTurnAllowedTools } from "@/shared/turnTaskContract";
import { buildAPlusAgentProviderContract, parseAPlusAgentProviderRequest } from "@/server/ai/agentTurnProviderRequest";
import type { ImageObject } from "@/domain/morpho/types";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { captureDeliveryGenerationBaseline, inspectDeliveryDraft } from "@/domain/morpho/deliveryInspection";
import { applyDeliverySectionDraft, updateDeliverySection } from "@/domain/morpho/deliveryPreparation";
import type {
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent,
  APlusAgentProviderMessage,
  APlusToolCall
} from "@/shared/agentTurnJournalProtocol";
import type {
  AgentTurnCoordinatorExecutionHandshake,
  AgentTurnCoordinatorHost
} from "./agentTurnCoordinator";
import {
  createAgentTurnHostSessionDetachedError,
  type AgentTurnHost
} from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  detachMorphoAgentTurnForPageUnload,
  cancelMorphoAgentTurn,
  recoverMorphoAgentTurn,
  resumeMorphoAgentTurn,
  runMorphoAgentTurn,
  type AgentTurnRunnerAPlusDependencies
} from "./agentTurnRunner";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import type {
  AgentTurnRecoveryStore,
  APlusTurnRecoveryRecord
} from "./agentTurnRecoveryStore";
import type { WorkspacePersistenceState } from "./workspacePersistence";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { ExternalResultManifest } from "@/shared/externalResultProtocol";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const LOCAL_PROJECT_ID = createTestWorkspace().project.id;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
});

describe("A+ Agent turn runner", () => {
  it.each([false, true])("late cancellation Text with tools=%s saves cancelled conversation before exact ACK", async tools => {
    const f = finalTextFixture({ late: true, tools });
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    const before = structuredClone(f.fixture.fake.getWorkspace().objects);
    expect(await cancelMorphoAgentTurn(LOCAL_PROJECT_ID, "user stopped")).toBe(true);
    expect(latestAssistant(f.durable)).toMatchObject({ body: "durable final Text", status: "cancelled", agentTurnOutcome: "cancelledDuringProvider" });
    expect(f.fixture.fake.getWorkspace().objects).toEqual(before);
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
    expect(f.fixture.fake.getEvents().filter(event => event.name === "confirmation")).toHaveLength(0);
    expect(f.acks).toHaveLength(1); expect(f.fixture.store.record).toBeUndefined();
  });
  it("preserves a late Tool-only envelope through cancelled final save without executing it", async () => {
    const f = finalTextFixture({ late: true, tools: true, toolOnly: true });
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    const before = structuredClone(f.fixture.fake.getWorkspace().objects);
    await cancelMorphoAgentTurn(LOCAL_PROJECT_ID, "user stopped");
    expect(latestAssistant(f.durable)).toMatchObject({ body: "当前 Agent 回合已取消，已有本地结果会保留。", status: "cancelled", agentTurnOutcome: "cancelledDuringProvider" });
    expect(f.fixture.fake.getWorkspace().objects).toEqual(before);
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
    expect(f.acks).toHaveLength(1); expect(f.fixture.store.record).toBeUndefined();
  });
  it.each([false, true])("late cancellation save failure tools=%s reloads only original delivery and local save", async tools => {
    const f = finalTextFixture({ late: true, tools });
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    f.failWorkspace = true;
    await cancelMorphoAgentTurn(LOCAL_PROJECT_ID, "user stopped");
    const envelope = structuredClone(f.fixture.store.record!.coordinator.latestProviderOutput);
    expect(f.fixture.store.record?.coordinator.lifecycle).toMatchObject({ phase: "recovering", resumePhase: "cancelling",
      serverExecutionStatus: tools ? "awaitingNextRequest" : "externallyCompleted", persistence: "failed", providerEffectProduced: true,
      cancellation: { reason: "user stopped", providerEffectProducedBeforeCancellation: false } });
    expect(f.acks).toHaveLength(0);
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    f.fixture.fake.commitWorkspace(() => ({ workspace: structuredClone(f.durable), value: undefined }));
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, f.fixture.host, f.fixture.dependencies)).toBe("pending");
    expect(f.fixture.store.record?.coordinator.latestProviderOutput).toEqual(envelope);
    expect(f.acks).toHaveLength(0);
    f.failWorkspace = false;
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    f.fixture.fake.commitWorkspace(() => ({ workspace: structuredClone(f.durable), value: undefined }));
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, f.fixture.host, f.fixture.dependencies)).toBe("recovered");
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(f.durable)).toMatchObject({ body: "durable final Text", status: "cancelled", agentTurnOutcome: "cancelledDuringProvider" });
    expect(f.acks).toHaveLength(1); expect(f.fixture.store.record).toBeUndefined();
    expect(f.fixture.fake.getEvents().filter(event => event.name === "confirmation")).toHaveLength(0);
  });
  it.each([false, true])("Text final-save failure=%s preserves local authority and ACK ordering", async (failSave) => {
    const f = finalTextFixture(); f.failWorkspace = failSave;
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
    if (failSave) {
      expect(f.acks).toHaveLength(0);
      expect(f.fixture.store.record).toMatchObject({ coordinator: { lifecycle: {
        phase: "recovering", serverExecutionStatus: "externallyCompleted", persistence: "failed",
        fault: { error: { code: "final_text_persistence_failed", recoverable: true } }
      } }, metadata: { localPersistence: "failed" } });
      expect(f.fixture.store.record?.coordinator.latestProviderOutput?.delivery).toEqual(finalTextDelivery);
      expect(latestAssistant(f.durable)?.body).not.toContain("durable final Text");
      expect(latestAssistant(f.fixture.fake.getWorkspace())?.agentTurnOutcome).not.toBe("success");
    } else {
      expect(latestAssistant(f.durable)).toMatchObject({ body: "durable final Text", status: "done", agentTurnOutcome: "success" });
      expect(f.acks).toEqual([{ resultId: finalTextDelivery.resultId, version: 1, sha256: finalTextDelivery.sha256 }]);
      expect(f.fixture.store.record).toBeUndefined();
    }
  });
  it("repeated Text final-save failure then reload saves the same envelope and completes without another execution", async () => {
    const f = finalTextFixture(); f.failWorkspace = true;
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    const envelope = structuredClone(f.fixture.store.record!.coordinator.latestProviderOutput);
    for (let i = 0; i < 2; i++) {
      detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
      f.fixture.fake.commitWorkspace(() => ({ workspace: structuredClone(f.durable), value: undefined }));
      expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, f.fixture.host, f.fixture.dependencies)).toBe("pending");
      expect(f.fixture.store.record?.coordinator.latestProviderOutput).toEqual(envelope);
      expect(f.fixture.store.record?.coordinator.lifecycle).toMatchObject({ phase: "recovering", persistence: "failed", serverExecutionStatus: "externallyCompleted" });
      expect(f.acks).toHaveLength(0);
    }
    f.failWorkspace = false;
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    f.fixture.fake.commitWorkspace(() => ({ workspace: structuredClone(f.durable), value: undefined }));
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, f.fixture.host, f.fixture.dependencies)).toBe("recovered");
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(f.durable)).toMatchObject({ body: "durable final Text", status: "done", agentTurnOutcome: "success" });
    expect(f.acks).toHaveLength(1); expect(f.fixture.store.record).toBeUndefined();
  });
  it("distinguishes final Text Recovery write failure from recoverable Workspace save failure", async () => {
    const f = finalTextFixture(); const save = f.fixture.store.save.bind(f.fixture.store);
    let rejected = false;
    f.fixture.store.save = async record => {
      if (!rejected && record.metadata.localPersistence === "required" && record.coordinator.lifecycle.serverExecutionStatus === "externallyCompleted") {
        rejected = true; throw new Error("Recovery IndexedDB quota failure");
      }
      await save(record);
    };
    await runMorphoAgentTurn(f.fixture.input, f.fixture.host, f.fixture.dependencies);
    expect(f.acks).toHaveLength(0);
    expect(f.fixture.store.record?.coordinator.lifecycle).toMatchObject({ serverExecutionStatus: "externallyCompleted", persistence: "failed",
      fault: { error: { code: "recovery_record_persistence_failed", recoverable: false } } });
    expect(f.fixture.coordinatorHost.executions).toHaveLength(1);
  });
  it.each([1, 2])("does not send request step %i until Recovery Store has durably saved its intent", async (step) => {
    const fixture = createFixture(step === 1 ? [{ status: "externallyCompleted", outputText: "正常完成" }] : [
      { status: "awaitingNextRequest", toolCalls: [{ callId: "read-first", name: "read_selected_context", argumentsText: "{}" }] },
      { status: "externallyCompleted", outputText: "continuation 完成" }
    ]);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let intent: APlusTurnRecoveryRecord | undefined;
    const save = fixture.store.save.bind(fixture.store);
    fixture.store.save = async (record) => {
      if (record.coordinator.activeRequest?.stepSequence === step && !intent) {
        intent = structuredClone(record);
        await barrier;
      }
      await save(record);
    };
    const running = runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    await waitForCondition(() => Boolean(intent));
    expect(fixture.coordinatorHost.executions).toHaveLength(step - 1);
    expect(fixture.store.record?.coordinator.activeRequest?.stepSequence).not.toBe(step);
    release();
    await running;
    const execution = fixture.coordinatorHost.executions[step - 1]!;
    expect(execution.requestId).toBe(intent?.coordinator.activeRequest?.requestId);
    expect(execution.stepSequence).toBe(step);
    expect(execution.providerRequest).toEqual(intent?.coordinator.activeRequest?.providerRequest);
    expect(latestAssistant(fixture.fake.getWorkspace())?.status).toBe("done");
  });

  it.each([1, 2])("fails closed on Recovery intent save failure for step %i", async (step) => {
    const fixture = createFixture(step === 1 ? [] : [
      { status: "awaitingNextRequest", toolCalls: [{ callId: "read-first", name: "read_selected_context", argumentsText: "{}" }] }
    ]);
    const save = fixture.store.save.bind(fixture.store);
    fixture.store.save = async (record) => {
      if (record.coordinator.activeRequest?.stepSequence === step) throw new Error("Intent quota failure");
      await save(record);
    };
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(step - 1);
    expect(latestAssistant(fixture.fake.getWorkspace())?.agentTurnOutcome).not.toBe("success");
    expect(fixture.fake.getEvents().some((event) => event.name === "failure")).toBe(true);
  });

  it("does not retry an unobserved legacy Text request through the current-only server parser", async () => {
    const fixture = createFixture([{ status: "transportFailure" }]);
    fixture.coordinatorHost.queryError = new Error("Journal temporarily unavailable");
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    makeLegacyRecovery(fixture);
    fixture.coordinatorHost.queryError = undefined;
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies)).toBe("failed");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())?.body).toContain("Prompt Contract 已不支持继续");
  });
  it("observes a contract-less v3.7 Provider completion without submitting a new request", async () => {
    const fixture = createFixture([{ status: "providerRunning", outputText: "旧回合的已提交结果。" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    makeLegacyRecovery(fixture);
    expect(parseAPlusAgentProviderRequest(fixture.store.record!.metadata.runtime.providerBaseRequest).status).toBe("failed");
    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies)).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())?.body).toContain("旧回合的已提交结果");
    expect(fixture.store.record).toBeUndefined();
  });

  it.each(["oldPrompt", "currentPrompt", "newEffects"] as const)("recovers only the exact legacy Search action: %s", async (variant) => {
    const fixture = createFixture([{ status: "awaitingNextRequest", toolCalls: [searchToolCall("legacy-search")] },
      variant === "newEffects" ? { status: "awaitingNextRequest", toolCalls: [researchToolCall("new-write"), visualToolCall("new-image"), searchToolCall("new-search")] } :
      { status: "externallyCompleted", outputText: "只读兼容恢复。" },
      { status: "externallyCompleted", outputText: "已拒绝所有新效果。" }]);
    fixture.input.draft = "请联网搜索当前资料。";
    let running = true;
    const bodies: string[] = [];
    fixture.fake.setFetchRoute(`/api/ai/agent/turns/${TURN_ID}/actions/web-search`, async (request) => {
      bodies.push(await request.clone().text());
      return running ? Response.json({ action: { status: "running" } }, { status: 202 }) :
        Response.json({ replayed: true, sources: [{ title: "Recovered", url: "https://example.com/exact" }] });
    });
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const exact = structuredClone(fixture.store.record!.metadata.pendingExternalAction);
    makeLegacyRecovery(fixture, variant === "oldPrompt" ? undefined : MORPHO_AGENT_PROMPT_CONTRACT_VERSION);
    const generate = vi.spyOn(fixture.host, "executeVisualGenerationPlan");
    const beforeObjects = structuredClone(fixture.fake.getWorkspace().objects);
    if (variant === "oldPrompt") {
      expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies)).toBe("pending");
      expect(fixture.store.record?.metadata.pendingExternalAction).toMatchObject({ actionId: exact!.actionId, requestBody: exact!.requestBody, requestHash: exact!.requestHash });
      expect(fixture.coordinatorHost.executions).toHaveLength(1);
    }
    running = false;
    await resumeMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies);
    expect(new Set(bodies)).toEqual(new Set([exact!.requestBody]));
    expect(bodies).toHaveLength(variant === "oldPrompt" ? 9 : 5);
    expect(generate).not.toHaveBeenCalled();
    expect(fixture.fake.getWorkspace().objects).toEqual(beforeObjects);
    if (variant === "oldPrompt") {
      expect(fixture.coordinatorHost.executions).toHaveLength(1);
      expect(latestAssistant(fixture.fake.getWorkspace())?.body).toContain("Prompt Contract 已不支持继续");
    } else {
      expect(fixture.coordinatorHost.executions).toHaveLength(variant === "newEffects" ? 3 : 2);
      const continuation = fixture.coordinatorHost.executions[1]!.providerRequest;
      expect(continuation.taskContract).toBeUndefined();
      expect(continuation.continuationItems?.some((item) => item.type === "function_call_output" && item.output.includes("https://example.com/exact"))).toBe(true);
      const parsed = parseAPlusAgentProviderRequest(continuation);
      if (parsed.status !== "ok") throw new Error(parsed.reason);
      expect(buildAPlusAgentProviderContract({ localProjectId: LOCAL_PROJECT_ID, request: parsed.value, webSearchEnabled: true }).request.tools).toHaveLength(4);
    }
    expect(fixture.store.record).toBeUndefined();
  });

  it.each([1, 2])("recovers a legacy Image via the frozen Operation Plan without new child authority (%i items)", async (count) => {
    const call = visualToolCall("legacy-image");
    const args = JSON.parse(call.argumentsText) as { items: Array<{ requestedReferenceObjectIds: string[] }> };
    args.items = args.items.slice(0, count);
    const fixture = createFixture([]);
    fixture.input.draft = `生成 ${count} 张图`;
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration";
    const image = fixture.fake.getWorkspace().objects["image-soft-rail-v2"]!;
    if (image.type !== "image") throw new Error("Need image fixture");
    image.assetId = "legacy-source-asset";
    fixture.input.selectedObjectIds = [image.id]; fixture.input.selectedObjects = [image];
    args.items.forEach((item) => { item.requestedReferenceObjectIds = [image.id]; Object.assign(item, { identityParentObjectId: null }); });
    fixture.coordinatorHost.appendScripts([{ status: "awaitingNextRequest", toolCalls: [{ ...call, argumentsText: JSON.stringify(args) }] }]);
    let running = true;
    const bodies: string[] = [];
    let saved = 0;
    const session = { projectId: LOCAL_PROJECT_ID, workspaceReady: true, generation: Symbol("legacy-image") };
    const reads = vi.fn(async () => null);
    const host: AgentTurnHost = { ...fixture.host, executeVisualGenerationPlan: (input) => executeWorkspaceVisualGenerationPlan(input,
      resolveGenerationSettings({ modelId: "gpt-image-2", aspectRatio: "1:1" }), {
        fetch: async (_url, init) => {
          bodies.push(String(init?.body));
          return running ? Response.json({ action: { status: "running" } }, { status: 202 }) :
            new Response(new Blob(["recovered"], { type: "image/png" }), { headers: { "content-type": "image/png" } });
        },
        getCurrentSession: () => session, assertCurrentSession: () => {},
        commitWorkspace: (_session, transform) => fixture.fake.commitWorkspace(transform),
        updatePendingImageGenerationSlots: () => {}, setImageTaskStatus: () => {}, readReferenceAsset: reads,
        saveGeneratedAsset: async () => ({ status: "ok", asset: { id: `legacy-asset-${++saved}`, fileName: "legacy.png", mimeType: "image/png",
          size: 9, createdAt: "2026-10-01T00:00:00Z", storageKey: `blob:legacy-${saved}`, sourceType: "aiGeneratedImage", width: 1, height: 1 } }),
        deleteAsset: async () => {}, selectObjects: () => {}, focusObject: () => {}, now: fixture.fake.now, randomSuffix: fixture.fake.randomSuffix
      }) };
    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);
    expect(fixture.store.record, JSON.stringify(fixture.coordinatorHost.executions.at(-1)?.providerRequest.continuationItems)).toBeDefined();
    const exact = structuredClone(fixture.store.record!.metadata.pendingExternalAction!);
    const beforeIds = new Set(Object.keys(fixture.fake.getWorkspace().objects));
    makeLegacyRecovery(fixture);
    // Today's selection/draft cannot remint authority or change the frozen plan.
    fixture.store.record = { ...fixture.store.record!, metadata: { ...fixture.store.record!.metadata,
      runtime: { ...fixture.store.record!.metadata.runtime, input: { ...fixture.store.record!.metadata.runtime.input, draft: "生成 12 张全新图", selectedObjectIds: [] } } } };
    running = false;
    reads.mockClear();
    await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, host, fixture.dependencies);
    expect(new Set(bodies)).toEqual(new Set([exact.requestBody]));
    expect(bodies).toHaveLength(2);
    expect(reads).not.toHaveBeenCalled();
    expect(saved).toBe(1);
    expect(Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.type === "image" && !beforeIds.has(object.id))).toHaveLength(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    if (count === 1) expect(latestAssistant(fixture.fake.getWorkspace())?.body).toContain("Prompt Contract 已不支持继续");
    expect(fixture.store.record).toBeUndefined();
  });
  it.each(["referenceB", "compareWrite", "primaryWrite", "autoPaid"] as const)("rejects %s in a scoped mixed turn before any new effect", async (attack) => {
    const fixture = createFixture([]);
    const images = Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.type === "image" && object.visibility === "active").slice(0, 2);
    images.forEach((image, index) => { image.title = index === 0 ? "A" : "B"; });
    let call = visualToolCall("hostile-effect");
    if (attack === "referenceB") {
      const args = JSON.parse(call.argumentsText) as { items: Array<{ requestedReferenceObjectIds: string[] }> };
      args.items.forEach((item) => { item.requestedReferenceObjectIds = [images[1]!.id]; });
      call = { ...call, argumentsText: JSON.stringify(args) };
    }
    if (attack === "compareWrite") {
      call = { ...call, name: "create_comparison_analysis",
        argumentsText: JSON.stringify({ comparisonGoal: "A/B", conclusionSummary: "save without grant", objectComparisons: [], recommendedQuestions: [], evidenceLimits: [] }) };
    }
    if (attack === "primaryWrite") {
      call = { ...call, name: "request_confirmation",
        argumentsText: JSON.stringify({ action: "setDirectionPrimary", targetObjectId: images[1]!.id, reason: "model chooses", impact: "state change" }) };
    }
    fixture.coordinatorHost.appendScripts([{ status: "awaitingNextRequest", toolCalls: [call] }, { status: "externallyCompleted", outputText: "已停止越权动作。" }]);
    fixture.input.draft = "比较 A/B；只继续 A，生成两张 CMF 图；不要保存比较记录，不要修改主方向。";
    fixture.input.taskMode = attack === "autoPaid" ? "chatAnalysis" : "imageGeneration";
    fixture.input.recommendedTaskMode = "imageGeneration";
    fixture.input.selectedObjects = images; fixture.input.selectedObjectIds = images.map((image) => image.id);
    const before = fixture.fake.getWorkspace();
    const generate = vi.spyOn(fixture.host, "executeVisualGenerationPlan");
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(generate).not.toHaveBeenCalled();
    const after = fixture.fake.getWorkspace();
    expect(after.objects).toEqual(before.objects);
    expect(after.ai.comparisonAnalyses).toEqual(before.ai.comparisonAnalyses);
    expect(after.workingState.primaryDirectionId).toEqual(before.workingState.primaryDirectionId);
    expect(fixture.fake.getEvents().some((event) => event.name === "confirmation")).toBe(false);
    const first = fixture.coordinatorHost.executions[0]!.providerRequest.taskContract!;
    if (attack !== "referenceB") expect(getTurnAllowedTools(first)).not.toContain(call.name);
  });

  it("keeps a mixed-turn pending generation confirmation scoped to A", async () => {
    const fixture = createFixture([{ status: "awaitingNextRequest", toolCalls: [visualToolCall("confirm-a")] }]);
    const images = Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.type === "image" && object.visibility === "active").slice(0, 2);
    images.forEach((image, index) => { image.title = index === 0 ? "A" : "B"; });
    fixture.input.draft = "比较 A/B；只继续 A，生成两张 CMF 图。";
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration";
    fixture.input.agentTurnMode = "confirm";
    fixture.input.selectedObjects = images; fixture.input.selectedObjectIds = images.map((image) => image.id);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const pending = fixture.store.record?.metadata.pendingConfirmation?.value;
    expect(pending).toMatchObject({ kind: "agentGenerateVisuals", selectedImageIds: [images[0]!.id] });
    expect(pending && "sourceObjectIds" in pending && pending.sourceObjectIds).not.toContain(images[1]!.id);
  });

  it("executes compare A+B then generates two persisted CMF images only from A through the real visual core", async () => {
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload?: () => void;
      readAsDataURL() { this.result = "data:image/png;base64,AAAA"; this.onload?.(); }
    });
    const fixture = createFixture([
      { status: "awaitingNextRequest", outputText: "A 与 B 的比较：A 更适合继续探索 CMF。", toolCalls: [
        { callId: "read-ab", name: "read_selected_context", argumentsText: "{}" }, visualToolCall("generate-a")
      ] },
      { status: "externallyCompleted", outputText: "已比较 A/B，并只继续 A 生成两张 CMF；未保存比较或更改主方向。" }
    ]);
    const workspace = fixture.fake.getWorkspace();
    const images = Object.values(workspace.objects).filter((object): object is ImageObject => object.type === "image" && object.visibility === "active").slice(0, 2);
    if (images.length !== 2) throw new Error("Need A/B images");
    images.forEach((image, index) => {
      image.title = index === 0 ? "A" : "B";
      image.assetId = `asset-${image.title}`;
      workspace.assets[image.assetId] = { id: image.assetId, fileName: `${image.title}.png`, mimeType: "image/png", size: 3,
        createdAt: "2026-10-01T00:00:00Z", storageKey: `blob:${image.title}`, sourceType: "originalImage", width: 1, height: 1 };
    });
    const [a, b] = images;
    workspace.workingState.currentDefaultReferenceId = b!.id;
    const beforeIds = new Set(Object.keys(workspace.objects));
    const beforePrimary = workspace.workingState.primaryDirectionId;
    const beforeComparisons = structuredClone(workspace.ai.comparisonAnalyses);
    const imageRequests: Array<{ input: { referenceObjectIds: string[]; images: string[] } }> = [];
    const reads: string[] = [];
    const session = { projectId: workspace.project.id, workspaceReady: true, generation: Symbol("mixed-intent") };
    let saved = 0;
    const host: AgentTurnHost = { ...fixture.host, executeVisualGenerationPlan: (input) => executeWorkspaceVisualGenerationPlan(input,
      resolveGenerationSettings({ modelId: "gpt-image-2", aspectRatio: "1:1" }), {
        fetch: async (_url, init) => {
          imageRequests.push(JSON.parse(String(init?.body)));
          return new Response(new Blob(["new-result"], { type: "image/png" }), { headers: { "content-type": "image/png" } });
        },
        getCurrentSession: () => session, assertCurrentSession: () => {},
        commitWorkspace: (_session, transform) => fixture.fake.commitWorkspace(transform),
        updatePendingImageGenerationSlots: () => {}, setImageTaskStatus: () => {},
        readReferenceAsset: async (key) => { reads.push(key); return new Blob(["A pixels"], { type: "image/png" }); },
        saveGeneratedAsset: async () => ({ status: "ok", asset: { id: `cmf-asset-${++saved}`, fileName: `cmf-${saved}.png`,
          mimeType: "image/png", size: 10, createdAt: "2026-10-01T00:00:00Z", storageKey: `blob:cmf-${saved}`,
          sourceType: "aiGeneratedImage", width: 1, height: 1 } }),
        deleteAsset: async () => {}, selectObjects: () => {}, focusObject: () => {}, now: fixture.fake.now, randomSuffix: fixture.fake.randomSuffix
      }) };
    fixture.input.draft = "比较 A/B，给出取舍；不要保存 Compare；然后只继续 A，生成两张 CMF 图；不要修改主方向。";
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration";
    fixture.input.workIntent = "discussion";
    fixture.input.recommendedWorkIntent = "comparison";
    fixture.input.selectedObjects = images;
    fixture.input.selectedObjectIds = images.map((image) => image.id);

    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);

    const result = fixture.fake.getWorkspace();
    const created = Object.values(result.objects).filter((object) => !beforeIds.has(object.id) && object.type === "image");
    expect(created).toHaveLength(2);
    expect(created.every((object) => object.type === "image" && object.generation?.referenceObjectIds.join() === a!.id)).toBe(true);
    expect(imageRequests).toHaveLength(2);
    expect(imageRequests.every((request) => request.input.referenceObjectIds.join() === a!.id && request.input.images.length === 1)).toBe(true);
    expect(reads).toEqual(["blob:A", "blob:A"]);
    expect(result.ai.comparisonAnalyses).toEqual(beforeComparisons);
    expect(result.workingState.primaryDirectionId).toBe(beforePrimary);
    expect(latestAssistant(result)?.agentTurnOutcome).toBe("success");
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    const first = fixture.coordinatorHost.executions[0]!.providerRequest;
    expect(first.taskContract?.activities.find((activity) => activity.kind === "comparison")?.sourceObjectIds).toEqual([a!.id, b!.id]);
    expect(first.methodPacks).toEqual(expect.arrayContaining(["comparisonDecision", "cmfExploration"]));
    expect(fixture.coordinatorHost.executions[1]!.providerRequest.taskContract).toEqual(first.taskContract);
    const continuation = fixture.coordinatorHost.executions[1]!.providerRequest.continuationItems;
    expect(continuation?.find((item) => item.type === "function_call_output" && item.callId === "read-ab")).toMatchObject({ output: expect.stringContaining(b!.id) });
    for (const execution of fixture.coordinatorHost.executions) {
      const parsed = parseAPlusAgentProviderRequest(execution.providerRequest);
      if (parsed.status !== "ok") throw new Error(parsed.reason);
      const provider = buildAPlusAgentProviderContract({ localProjectId: workspace.project.id, request: parsed.value, webSearchEnabled: false });
      expect(provider.request.tools?.map((tool) => tool.type === "function" ? tool.name : "").sort()).toEqual(getTurnAllowedTools(first.taskContract!).sort());
    }
  });
  it("runs the Workspace entry through Coordinator, display, persistence and reducer outcome", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "A+ 已完成当前讨论。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "A+ 已完成当前讨论。",
      status: "done",
      agentTurnOutcome: "success"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();
    expect(fixture.store.loadCalls).toBe(0);
    expect(fixture.fake.getEvents().filter((event) => event.name === "persist").length).toBeGreaterThan(0);
  });

  it("preserves a Server Turn creation error and releases the project for a clean retry", async () => {
    const fixture = createFixture([]);
    fixture.coordinatorHost.createError = new Error("请先登录 Morpho。");

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "请先登录 Morpho。",
      status: "failed",
      agentTurnOutcome: "failedBeforeExecution"
    });
    fixture.coordinatorHost.createError = undefined;
    fixture.coordinatorHost.appendScripts([
      { status: "externallyCompleted", outputText: "重新登录后已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "重新登录后已完成。",
      status: "done",
      agentTurnOutcome: "success"
    });
  });

  it("keeps a bounded stream failure detail in the failed assistant message", async () => {
    const secretDiagnostic = "internal-host.local api_key=secret raw upstream body /private/path";
    const fixture = createFixture([{
      status: "externallyFailed",
      externalErrorCode: "provider_execution_failed",
      externalErrorMessage: secretDiagnostic
    }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "模型返回异常，本轮未完成。",
      status: "failed",
      agentTurnOutcome: "failedDuringProvider"
    });
    expect(JSON.stringify(fixture.fake.getWorkspace())).not.toContain(secretDiagnostic);
    expect(JSON.stringify(fixture.store.record ?? null)).not.toContain(secretDiagnostic);
  });

  it("displays honest unknown execution copy without automatically running another request", async () => {
    const fixture = createFixture([{ status: "externallyFailed", externalErrorCode: "external_execution_state_unknown" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({ body: "无法确认外部请求是否已经执行；Morpho 已停止自动重试，不会基于该不确定状态继续提交新请求。", status: "failed" });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it.each(["external_execution_state_unknown", "provider_http_422", undefined])(
    "reload saves authoritative failure detail %s before terminal cleanup without new execution", async failureCode => {
      const fixture = createFixture([{ status: "providerRunning" }]);
      await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
      const identity = structuredClone(fixture.store.record!.coordinator.activeRequest);
      detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
      fixture.coordinatorHost.setJournalFailure(failureCode);
      const fetch = vi.fn(fixture.fake.fetch); fixture.host.fetch = fetch;
      let durable = structuredClone(fixture.fake.getWorkspace());
      fixture.host.persistWorkspace = () => {
        const result = fixture.fake.persistWorkspace();
        if (result.phase === "saved" && !result.isDirty) durable = structuredClone(fixture.fake.getWorkspace());
        return result;
      };
      const clear = fixture.store.clear.bind(fixture.store);
      const unknown = failureCode === "external_execution_state_unknown";
      let clearCalls = 0;
      fixture.store.clear = async () => {
        clearCalls++;
        expect(latestAssistant(durable)).toMatchObject({ status: "failed", agentTurnOutcome: "failedDuringProvider",
          agentTurnOutcomeSummary: unknown ? "external_execution_state_unknown" : "externalExecutionFailed" });
        expect(latestAssistant(durable)?.body).toBe(unknown
          ? "无法确认外部请求是否已经执行；Morpho 已停止自动重试，不会基于该不确定状态继续提交新请求。"
          : "当前 Agent 回合未能完成。");
        expect(fixture.store.record?.coordinator.lifecycle).toMatchObject({ phase: "terminal", outcome: { kind: "failed" } });
        expect(fixture.store.record?.coordinator.lifecycle.serverFailureCode).toBe(unknown ? failureCode : undefined);
        await clear();
      };
      expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies)).toBe("recovered");
      expect(clearCalls).toBe(1); expect(fixture.store.record).toBeUndefined();
      expect(fixture.coordinatorHost.executions).toHaveLength(1);
      expect(fixture.coordinatorHost.executions[0]).toMatchObject({ requestId: identity!.requestId, stepSequence: identity!.stepSequence });
      expect(fetch).not.toHaveBeenCalled(); // No result means no ACK or result fabrication.
    });

  it("keeps terminal unknown detail in Recovery when its final Workspace save fails", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    fixture.coordinatorHost.setJournalFailure("external_execution_state_unknown");
    fixture.host.persistWorkspace = failedPersistence;
    const clear = vi.spyOn(fixture.store, "clear");
    await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies);
    expect(clear).not.toHaveBeenCalled();
    expect(fixture.store.record).toMatchObject({ coordinator: { lifecycle: { phase: "terminal",
      serverFailureCode: "external_execution_state_unknown", outcome: { reasons: ["external_execution_state_unknown"] } } },
      metadata: { localPersistence: "failed" } });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("keeps a successful local Tool effect when the Provider continuation fails", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先建立研究草案。",
        toolCalls: [researchToolCall("call-research")]
      },
      { status: "externallyFailed" }
    ]);
    fixture.input.draft = "创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    const assistant = latestAssistant(fixture.fake.getWorkspace());
    expect(assistant).toMatchObject({
      status: "done",
      agentTurnOutcome: "partialSuccess"
    });
    expect(assistant?.agentTrace?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "toolActivity",
        toolCallId: "call-research",
        source: "local",
        state: "done"
      })
    ]));
    expect(Object.values(fixture.fake.getWorkspace().objects).some((object) =>
      object.type === "research"
    )).toBe(true);
    expect(fixture.coordinatorHost.executions.map((execution) => execution.stepSequence)).toEqual([1, 2]);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function_call", callId: "call-research" }),
        expect.objectContaining({ type: "function_call_output", callId: "call-research" })
      ])
    );
  });

  it("retries request_not_observed with the exact Request ID, Sequence and body", async () => {
    const fixture = createFixture([
      { status: "transportFailure" },
      { status: "externallyCompleted", outputText: "安全重试完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[1]).toEqual(fixture.coordinatorHost.executions[0]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "安全重试完成。",
      agentTurnOutcome: "success"
    });
  });

  it("preserves the webSearch authority bit from Preparation to the Coordinator host and Recovery", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "已核实。" }
    ]);
    fixture.input.draft = "查一下最新的行业标准，联网核实。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    // Preparation → Coordinator start: the host captures webSearch:true.
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
    // Recovery export keeps the bit in both the active request and the base request.
    expect(fixture.store.record?.coordinator.activeRequest?.providerRequest.capabilityIntent.webSearch).toBe(true);
    expect(fixture.store.record?.metadata.runtime.providerBaseRequest.capabilityIntent.webSearch).toBe(true);
    // Restore reconciles the same authority without regenerating a different bit.
    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    const resumed = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("keeps webSearch absent/false across the whole chain when the turn is not authorized", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).not.toBe(true);
    expect(fixture.store.record?.coordinator.activeRequest?.providerRequest.capabilityIntent.webSearch).not.toBe(true);
    expect(fixture.store.record?.metadata.runtime.providerBaseRequest.capabilityIntent.webSearch).not.toBe(true);
  });

  it("reuses the exact webSearch authority on an exact retry", async () => {
    const fixture = createFixture([
      { status: "transportFailure" },
      { status: "externallyCompleted", outputText: "重试完成。" }
    ]);
    fixture.input.draft = "查一下最新的行业标准，联网核实。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[1]).toEqual(fixture.coordinatorHost.executions[0]);
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
  });

  it("keeps the webSearch authority on the continuation request", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先建立研究草案。",
        toolCalls: [researchToolCall("call-research-searchable")]
      },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    fixture.input.draft = "联网查最新标准，并创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.capabilityIntent.webSearch).toBe(true);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.capabilityIntent.webSearch).toBe(true);
  });

  it("arms the deterministic memory final check only when the turn has candidates", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    // No candidates: no reminder anywhere.
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    fixture.store.clear();
    const fixture2 = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "完成。" }
    ]);
    fixture2.input.draft = "预算不能超过 500 元。";
    await runMorphoAgentTurn(fixture2.input, fixture2.host, fixture2.dependencies);
    expect(fixture2.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(true);
    expect(fixture2.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(true);
    expect(
      fixture2.store.record?.metadata.runtime.providerBaseRequest.input.filter(reminderText)
    ).toHaveLength(1);
  });

  it("keeps non-declarations free of reminder and memory authority end to end", async () => {
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    // Representative negatives: scope-only question, ordinary design
    // discussion, threshold question, open-question query, temporary
    // avoidance, and current-turn agent/tool operation commands. None may
    // produce a candidate, a reminder, or memory authority.
    let fixture = createFixture([{ status: "providerRunning" }]);
    for (const draft of [
      "后续怎么做？",
      "这个材质怎么样？",
      "高度低于多少合适？",
      "有哪些待确认问题？",
      "先别用蓝色。",
      "不要比较，只分析。",
      "不要联网，只总结本地内容。",
      "不要创建研究分析。",
      "必须先联网查一下。"
    ]) {
      detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
      fixture.store.clear();
      const run = createFixture([{ status: "providerRunning" }]);
      run.input.draft = draft;
      await runMorphoAgentTurn(run.input, run.host, run.dependencies);
      expect(run.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
      expect(run.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);
      expect(run.store.record?.metadata.runtime.facts.handledMemoryCandidateIndexes).toEqual([]);
      fixture = run;
    }
  });

  it("executes an explicit comparison turn through the provider end to end", async () => {
    // H: comparison turns must reach the provider with comparison strategy,
    // the comparisonDecision pack and comparisonAnalysis intent, and settle
    // like any completed turn (chat-only; no memory candidates from a plain
    // comparison).
    const fixture = createFixture([{ status: "externallyCompleted", outputText: "比较完成。" }]);
    const sources = selectComparableSources(fixture);
    fixture.input.selectedObjectIds = sources.map((object) => object.id);
    fixture.input.selectedObjects = sources;
    fixture.input.draft = "把这两个比较一下。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    const request = fixture.coordinatorHost.executions[0]?.providerRequest;
    expect(request?.strategy).toBe("comparison");
    expect(request?.capabilityIntent.comparisonAnalysis).toBe(true);
    expect(request?.methodPacks).toContain("comparisonDecision");
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({ body: "比较完成。" });
  });

  it("keeps a compare-without-persist request free of memory authority end to end", async () => {
    // The clause 但不要保存记录 is a current-turn operation boundary, never a
    // long-term avoidance: comparison stays on (strategy + pack) while the
    // memory side produces no candidate, no reminder and no submit authority.
    // providerRunning keeps the turn in recovery so the runtime facts remain
    // readable, like the other memory-authority e2e rows.
    const fixture = createFixture([{ status: "providerRunning" }]);
    const sources = selectComparableSources(fixture);
    fixture.input.selectedObjectIds = sources.map((object) => object.id);
    fixture.input.selectedObjects = sources;
    fixture.input.draft = "比较一下，但不要保存记录。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    const request = fixture.coordinatorHost.executions[0]?.providerRequest;
    expect(request?.strategy).toBe("comparison");
    expect(request?.capabilityIntent.comparisonAnalysis).toBe(true);
    expect(request?.methodPacks).toContain("comparisonDecision");
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.memoryUpdateReminderInserted).toBe(false);
    expect(fixture.store.record?.metadata.runtime.facts.handledMemoryCandidateIndexes).toEqual([]);
  });

  it("reminds exactly once when the model would end without handling a candidate", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "好的，我会注意预算。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: expect.stringContaining("好的，我会注意预算。"),
      taskFulfillment: { status: "partial" },
      agentTurnOutcome: "success"
    });
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    const reminders = fixture.coordinatorHost.executions[0]?.providerRequest.input.filter(reminderText) ?? [];
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.content[0]).toMatchObject({
      type: "input_text",
      text: expect.stringContaining("submit_memory_update")
    });
  });

  it("completes normally when the model submits the candidate via the tool", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "我先记录预算约束。",
        toolCalls: [memoryConstraintToolCall("call-memory-budget")]
      },
      { status: "externallyCompleted", outputText: "已记录预算约束。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "success"
    });
    // The candidate is handled; the reminder is still the same single transient
    // message (never regenerated) and no second reminder round occurs.
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.input.filter(reminderText)).toHaveLength(1);
  });

  it("marks candidates handled when the model skips with items: [] and skippedReason", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "这条先不写入长期记忆。",
        toolCalls: [memorySkipToolCall("call-memory-skip")]
      },
      { status: "externallyCompleted", outputText: "已跳过。" }
    ]);
    fixture.input.draft = "预算不能超过 500 元。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "success"
    });
    expect(fixture.fake.getWorkspace().projectContinuity.recordEntries.length).toBeGreaterThanOrEqual(0);
  });

  it("keeps one-off turns free of both memory authority and the reminder", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "尝试写入。",
        toolCalls: [memoryConstraintToolCall("call-memory-one-off")]
      },
      { status: "externallyCompleted", outputText: "已说明不可写入。" }
    ]);
    fixture.input.draft = "这张图不要高反光。";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    const reminderText = (message: APlusAgentProviderMessage) =>
      message.content.some((part) => part.type === "input_text" && part.text.includes("确定性补检"));
    expect(fixture.coordinatorHost.executions[0]?.providerRequest.input.some(reminderText)).toBe(false);
    // The un-authorized submit call is blocked locally; nothing was written.
    expect(fixture.fake.getWorkspace().projectContinuity.recordEntries).toHaveLength(0);
  });

  it("restores a terminal Pending Confirmation card without reopening the old Turn", async () => {
    const fixture = createFixture([{
      status: "awaitingNextRequest",
      outputText: "这个写入需要确认。",
      toolCalls: [researchToolCall("call-confirm")]
    }]);
    fixture.input.agentTurnMode = "confirm";
    fixture.input.draft = "创建研究分析，并在执行前向我确认。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.store.record?.coordinator.lifecycle.phase).toBe("terminal");
    const before = fixture.fake.getEvents().filter((event) => event.name === "confirmation").length;

    await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(fixture.fake.getEvents().filter((event) => event.name === "confirmation").length).toBe(before + 1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("uses query-only reconciliation after refresh while Provider is still running", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.fake.getEvents().filter((event) => event.name === "streaming").at(-1)).toEqual(
      expect.objectContaining({ value: [false] })
    );
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);

    const recovered = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(recovered).toBe("pending");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("routes a persisted recovery record through the full loader without appending a duplicate user message", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const userMessageIds = fixture.fake.getWorkspace().ai.messages
      .filter((message) => message.role === "user")
      .map((message) => message.id);
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.store.loadCalls).toBe(1);
    expect(fixture.fake.getWorkspace().ai.messages
      .filter((message) => message.role === "user")
      .map((message) => message.id)).toEqual(userMessageIds);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);
  });

  it("closes stale local recovery when the retained Server Turn no longer exists", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record).toBeDefined();
    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    fixture.coordinatorHost.queryError = Object.assign(new Error("Server Turn no longer exists."), {
      code: "not_found"
    });

    await expect(
      recoverMorphoAgentTurn(
        fixture.fake.getWorkspace().project.id,
        fixture.host,
        fixture.dependencies
      )
    ).resolves.toBe("failed");

    expect(fixture.store.record).toBeUndefined();
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      status: "failed",
      agentTurnOutcome: "failedDuringProvider"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    fixture.coordinatorHost.queryError = undefined;
    fixture.coordinatorHost.appendScripts([{ status: "externallyCompleted", outputText: "新请求完成。" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "新请求完成。",
      agentTurnOutcome: "success"
    });
  });

  it("keeps A+ recovery recoverable when a local confirmation already occupies the slot", async () => {
    const fixture = createFixture([{
      status: "awaitingNextRequest",
      outputText: "这个写入需要确认。",
      toolCalls: [researchToolCall("call-confirm-collision")]
    }]);
    fixture.input.agentTurnMode = "confirm";
    fixture.input.draft = "创建研究分析，并在执行前向我确认。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const occupiedHost: AgentTurnHost = {
      ...fixture.host,
      ui: {
        ...fixture.host.ui,
        requestPendingConfirmation: () => ({
          status: "rejected" as const,
          code: "confirmation_slot_occupied" as const,
          origin: "agent" as const
        })
      }
    };

    await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      occupiedHost,
      fixture.dependencies
    );

    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);
    expect(fixture.store.record).toBeDefined();
  });

  it("detaches a stale host without finalizing a failed turn into the new workspace", async () => {
    const fixture = createFixture([
      { status: "externallyCompleted", outputText: "旧页面结果" }
    ]);
    const host: AgentTurnHost = {
      ...fixture.host,
      commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>) => {
        if (fixture.fake.getWorkspace().project.id !== LOCAL_PROJECT_ID) {
          throw createAgentTurnHostSessionDetachedError();
        }
        return fixture.host.commitWorkspace(transform);
      }
    };
    const releaseCompletion = fixture.coordinatorHost.deferNextCompletion();
    const run = runMorphoAgentTurn(fixture.input, host, fixture.dependencies);

    await waitForCondition(() => fixture.coordinatorHost.executions.length === 1);
    const current = fixture.fake.getWorkspace();
    current.project = { ...current.project, id: "project-new" };
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    host.abortSlot.get()?.abort(createAgentTurnHostSessionDetachedError());
    releaseCompletion();
    await expect(run).resolves.toBeUndefined();

    expect(fixture.fake.getWorkspace().project.id).toBe("project-new");
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "",
      status: "streaming"
    });
    expect(latestAssistant(fixture.fake.getWorkspace())?.agentTurnOutcome).toBeUndefined();
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.cancelCalls).toBe(0);
  });

  it("resumes an active provider-running session on the same page and permits the next Turn", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "下一回合已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    const resumed = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(fixture.store.record).toBeUndefined();

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "下一回合已完成。",
      agentTurnOutcome: "success"
    });
  });

  it("keeps the same-page recovery entry through repeated pending checks", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "检查后下一回合完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const firstCheck = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(firstCheck).toBe("pending");
    expect(fixture.fake.getEvents().filter((event) => event.name === "recoveryPending")).not.toHaveLength(0);

    fixture.coordinatorHost.setJournalStatus("externallyCompleted");
    await expect(resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    )).resolves.toBe("recovered");

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "检查后下一回合完成。",
      agentTurnOutcome: "success"
    });
  });

  it("replays a running Search Action from the Runner and executes it only once", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-running")]
      },
      { status: "externallyCompleted", outputText: "Search Receipt 已恢复。" }
    ]);
    fixture.input.draft = "请联网搜索当前资料。";
    let running = true;
    const requestBodies: string[] = [];
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      async (_request) => {
        requestBodies.push(_request.body ? await _request.clone().text() : "");
        if (running) {
          return Response.json({ replayed: true, action: { status: "running" } }, { status: 202 });
        }
        return Response.json({
          replayed: true,
          sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
          failedSourceCount: 0,
          timedOutSourceCount: 0
        });
      }
    );

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.pendingExternalAction).toMatchObject({
      status: "running",
      actionKind: "webSearch",
      callId: "call-search-running"
    });
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    running = false;
    const resumed = await resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(resumed).toBe("recovered");

    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(new Set(requestBodies)).toHaveProperty("size", 1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "Search Receipt 已恢复。",
      agentTurnOutcome: "success"
    });
  });

  it("persists the exact Search request before send and recovers when the first page never receives a response", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-page-loss")]
      },
      { status: "externallyCompleted", outputText: "Search 已从发送前快照恢复。" }
    ]);
    fixture.input.draft = "请联网搜索当前资料。";
    const requestBodies: string[] = [];
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      async (request) => {
        requestBodies.push(await request.clone().text());
        if (requestBodies.length === 1) {
          return new Promise<Response>(() => undefined);
        }
        return Response.json({
          replayed: true,
          sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
          failedSourceCount: 0,
          timedOutSourceCount: 0
        });
      }
    );

    void runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    await waitForCondition(() =>
      fixture.store.record?.metadata.pendingExternalAction?.status === "acquired"
    );
    const persistedBody = fixture.store.record?.metadata.pendingExternalAction?.requestBody;
    expect(persistedBody).toBeTruthy();
    expect(requestBodies).toEqual([persistedBody]);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    const recovered = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );

    expect(recovered).toBe("recovered");
    expect(requestBodies).toEqual([persistedBody, persistedBody]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "Search 已从发送前快照恢复。",
      agentTurnOutcome: "success"
    });
  });

  it("restores Search citations and Required Read facts before a later Research Tool", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [searchToolCall("call-search-facts")]
      },
      {
        status: "providerRunning",
        outputText: "继续建立研究草案。",
        toolCalls: [researchToolCall("call-research-after-refresh")]
      },
      { status: "externallyCompleted", outputText: "研究草案已完成。" }
    ]);
    fixture.input.draft = "请联网搜索并创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";
    fixture.fake.setFetchRoute(
      `/api/ai/agent/turns/${TURN_ID}/actions/web-search`,
      () => Response.json({
        replayed: true,
        sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
        failedSourceCount: 0,
        timedOutSourceCount: 0
      })
    );

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.store.record?.metadata.runtime.facts.hasWebSearchEvidence).toBe(true);
    expect(fixture.store.record?.metadata.runtime.facts.collectedCitations).toHaveLength(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);

    detachMorphoAgentTurnForPageUnload(fixture.fake.getWorkspace().project.id);
    const refreshed = await recoverMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    );
    expect(refreshed).toBe("pending");
    fixture.coordinatorHost.setJournalStatus("awaitingNextRequest");

    await expect(resumeMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      fixture.host,
      fixture.dependencies
    )).resolves.toBe("recovered");

    const research = Object.values(fixture.fake.getWorkspace().objects)
      .find((object) => object.type === "research" && object.provenance?.didUseWebSearch);
    expect(research).toMatchObject({
      type: "research",
      provenance: { didUseWebSearch: true }
    });
  });

  it("cancels local display, requests server cancellation, queries Journal, and never repeats Provider", async () => {
    const fixture = createFixture([{ status: "providerRunning" }]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    const cancelled = await cancelMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      "用户停止了 Provider Stream。"
    );

    expect(cancelled).toBe(true);
    expect(fixture.coordinatorHost.cancelCalls).toBe(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      status: "cancelled",
      agentTurnOutcome: "cancelledDuringProvider"
    });
    expect(fixture.fake.getEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "streaming", value: [false] })
    ]));
  });

  it("does not let a detached old session release a newer same-project owner", async () => {
    const first = createFixture([
      { status: "externallyCompleted", outputText: "旧页面结果" }
    ]);
    const releaseFirstCompletion = first.coordinatorHost.deferNextCompletion();
    const firstRun = runMorphoAgentTurn(first.input, first.host, first.dependencies);

    await waitForCondition(() => first.coordinatorHost.executions.length === 1);
    detachMorphoAgentTurnForPageUnload(first.fake.getWorkspace().project.id);

    const second = createFixture([{ status: "providerRunning" }]);
    await runMorphoAgentTurn(second.input, second.host, second.dependencies);
    expect(second.coordinatorHost.executions).toHaveLength(1);

    // Remove durable recovery so a successful resume proves the in-memory
    // second owner survived the first owner's late finalization.
    second.store.record = undefined;
    releaseFirstCompletion();
    await expect(firstRun).resolves.toBeUndefined();

    await expect(resumeMorphoAgentTurn(
      second.fake.getWorkspace().project.id,
      second.host,
      second.dependencies
    )).resolves.toBe("pending");
    await expect(cancelMorphoAgentTurn(
      second.fake.getWorkspace().project.id,
      "用户停止了第二个 Provider Stream。"
    )).resolves.toBe(true);
    expect(second.coordinatorHost.cancelCalls).toBe(1);
  });

  it("releases a terminal cancellation so the next Turn can start immediately", async () => {
    const fixture = createFixture([
      { status: "providerRunning" },
      { status: "externallyCompleted", outputText: "第二回合已完成。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);

    await expect(cancelMorphoAgentTurn(
      fixture.fake.getWorkspace().project.id,
      "用户停止了 Provider Stream。"
    )).resolves.toBe(true);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "第二回合已完成。",
      agentTurnOutcome: "success"
    });
  });

  it("gives every invalid Tool call one failed result and continues with bounded output", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [{
          callId: "call-invalid",
          name: "create_research_analysis",
          argumentsText: "{}"
        }]
      },
      { status: "externallyCompleted", outputText: "已说明无法执行该 Tool。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    const continuation = fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems;
    expect(continuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", callId: "call-invalid" }),
      expect.objectContaining({
        type: "function_call_output",
        callId: "call-invalid",
        output: expect.stringContaining("invalid_tool_arguments")
      })
    ]));
  });

  it("finalizes a mixed multi-Tool batch with exactly one terminal output per Call", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [
          {
            callId: "call-read",
            name: "read_project_memory",
            argumentsText: "{}"
          },
          {
            callId: "call-invalid",
            name: "create_research_analysis",
            argumentsText: "{}"
          }
        ]
      },
      { status: "externallyCompleted", outputText: "已综合可用结果。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    const continuation = fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems ?? [];
    expect(continuation.filter((item) => item.type === "function_call_output")).toEqual([
      expect.objectContaining({ callId: "call-read" }),
      expect.objectContaining({
        callId: "call-invalid",
        output: expect.stringContaining("invalid_tool_arguments")
      })
    ]);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
  });

  it("keeps successful Image items and marks failed items as unresolved partial work", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        toolCalls: [visualToolCall("call-visual")]
      },
      { status: "externallyCompleted", outputText: "已保留成功生成项。" }
    ], {
      visualGenerationResult: {
        createdObjectIds: ["image-created-a"],
        failedItems: [{ itemId: "visual-b", reason: "provider failed" }]
      }
    });
    fixture.input.draft = "生成两张方向图";
    fixture.input.taskMode = "imageGeneration";
    fixture.input.recommendedTaskMode = "imageGeneration";
    fixture.input.directionPreviewCount = 2;

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          callId: "call-visual",
          output: expect.stringContaining("failedItems")
        })
      ])
    );
  });

  it("completes a delivery draft Tool as a persisted local write and continues the Turn", async () => {
    const fixture = createFixture([]);
    const delivery = Object.values(fixture.fake.getWorkspace().objects)
      .find((object) => object.type === "delivery");
    if (!delivery || delivery.type !== "delivery") throw new Error("Fixture 缺少 delivery object。");
    const section = delivery.sections.find((candidate) => candidate.referenceIds.length > 0);
    if (!section) throw new Error("Fixture 缺少带引用的 delivery section。");
    fixture.input.draft = "为当前交付章节创建草案";
    fixture.input.pendingDeliveryDraftTarget = {
      deliveryObjectId: delivery.id,
      sectionId: section.id
    };
    fixture.coordinatorHost.appendScripts([
      {
        status: "awaitingNextRequest",
        toolCalls: [deliveryToolCall("call-delivery-runner", section.referenceIds[0]!)]
      },
      { status: "externallyCompleted", outputText: "交付章节草案已准备好。" }
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(Object.keys(fixture.fake.getWorkspace().deliverySectionDrafts)).toHaveLength(1);
    expect(fixture.coordinatorHost.executions[1]?.providerRequest.continuationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          callId: "call-delivery-runner",
          output: expect.stringContaining('"status":"draftCreated"')
        })
      ])
    );
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      body: "交付章节草案已准备好。",
      status: "done",
      agentTurnOutcome: "success"
    });
    expect(fixture.fake.getEvents().filter((event) => event.name === "confirmation")).toHaveLength(0);
    expect(fixture.store.record).toBeUndefined();
  });

  it("does not report full success when a local write happened but durable persistence failed", async () => {
    const fixture = createFixture([
      {
        status: "awaitingNextRequest",
        outputText: "先写入研究草案。",
        toolCalls: [researchToolCall("call-persistence")]
      }
    ], {
      persistenceStates: [savedPersistence(), failedPersistence()]
    });
    fixture.input.draft = "创建研究分析。";
    fixture.input.taskMode = "researchOperation";
    fixture.input.recommendedTaskMode = "researchOperation";

    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);

    expect(Object.values(fixture.fake.getWorkspace().objects).some((object) =>
      object.type === "research"
    )).toBe(true);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({
      agentTurnOutcome: "partialSuccess"
    });
    expect(fixture.store.record).toBeDefined();
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });
});

type Script =
  | Readonly<{ status: "transportFailure" }>
  | Readonly<{
      status: "providerRunning" | "awaitingNextRequest" | "externallyCompleted" | "externallyFailed";
      outputText?: string;
      toolCalls?: readonly APlusToolCall[];
      delivery?: ExternalResultManifest;
      externalErrorCode?: string;
      externalErrorMessage?: string;
    }>;

type ScriptEntry = Script | ((input: Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0]) => Script);

class CoordinatorHostFake implements AgentTurnCoordinatorHost {
  readonly executions: Array<Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0]> = [];
  cancelCalls = 0;
  createError: Error | undefined;
  queryError: Error | undefined;
  private deferredCompletion: { promise: Promise<void>; resolve: () => void } | undefined;
  private index = 0;
  private snapshot: AgentTurnJournalSnapshot = snapshotFor("created", null, 0, 0);

  private readonly scripts: ScriptEntry[];

  constructor(scripts: readonly ScriptEntry[]) {
    this.scripts = [...scripts];
  }

  appendScripts(scripts: readonly ScriptEntry[]): void {
    this.scripts.push(...scripts);
  }

  deferNextCompletion(): () => void {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    this.deferredCompletion = { promise, resolve };
    return resolve;
  }

  async createServerTurn(input: { localProjectId: string }): Promise<{
    snapshot: AgentTurnJournalSnapshot;
    replayed: boolean;
  }> {
    if (this.createError) throw this.createError;
    this.snapshot = snapshotFor("created", null, 0, 0, input.localProjectId);
    return { snapshot: this.snapshot, replayed: false };
  }

  async executeExternalRequest(
    input: Parameters<AgentTurnCoordinatorHost["executeExternalRequest"]>[0],
    observer: (event: AgentTurnRequestStreamEvent) => void
  ): Promise<AgentTurnCoordinatorExecutionHandshake> {
    this.executions.push(structuredClone(input));
    const entry = this.scripts[this.index++];
    const script = typeof entry === "function" ? entry(input) : entry;
    if (!script) throw new Error("Unexpected A+ execution.");
    if (script.status === "transportFailure") throw new Error("headers unavailable");
    return {
      status: "started",
      complete: async () => {
        const deferred = this.deferredCompletion;
        this.deferredCompletion = undefined;
        if (deferred) await deferred.promise;
        const toolCalls = script.toolCalls ?? [];
        if (
          script.status !== "externallyFailed" &&
          (script.status !== "providerRunning" || Boolean(script.outputText?.trim()) || toolCalls.length > 0)
        ) {
          observer({
            type: "providerOutput",
            requestId: input.requestId,
            stepSequence: input.stepSequence,
            outputText: script.outputText ?? "",
            producedUserVisibleEffect: Boolean(script.outputText?.trim()),
            toolCallIds: toolCalls.map((call) => call.callId),
            toolCalls,
            ...(script.delivery ? { delivery: script.delivery } : {})
          });
        }
        if (script.externalErrorCode) {
          observer({
            type: "externalError",
            requestId: input.requestId,
            stepSequence: input.stepSequence,
            code: script.externalErrorCode,
            message: script.externalErrorMessage ?? "文本 AI 服务暂时不可用，请稍后重试。",
            recoverable: true
          });
        }
        this.snapshot = snapshotFor(
          script.status,
          input.requestId,
          input.stepSequence,
          this.snapshot.counters.provider + 1,
          input.localProjectId
        );
        return script.status === "providerRunning"
          ? { status: "interrupted", code: "display_detached" }
          : { status: "ended", finalFrameReceived: true };
      }
    };
  }

  async queryServerTurn(): Promise<AgentTurnJournalSnapshot> {
    if (this.queryError) throw this.queryError;
    return structuredClone(this.snapshot);
  }

  setJournalStatus(status: AgentTurnJournalSnapshot["status"]): void {
    this.snapshot = snapshotFor(
      status,
      this.snapshot.latestRequestId,
      this.snapshot.latestStepSequence,
      this.snapshot.counters.provider,
      this.snapshot.localProjectId
    );
  }

  setJournalFailure(failureCode?: string): void {
    this.setJournalStatus("externallyFailed");
    this.snapshot = { ...this.snapshot, failureCode, externalEffect: { version: 1, effectId: `effect:${"a".repeat(64)}`,
      kind: "text", requestDigest: "b".repeat(64), namespace: null,
      executionState: failureCode === "external_execution_state_unknown" ? "unknown" : "failed",
      cancelRequestedAt: null, localAbortObservedAt: null, attemptId: TURN_ID, taskId: null, responseId: null } };
  }

  setJournalResult(status: "externallyCompleted" | "awaitingNextRequest"): void {
    this.setJournalStatus(status);
    this.snapshot = { ...this.snapshot, externalEffect: { version: 1, effectId: finalTextDelivery.effectId,
      kind: "text", requestDigest: "b".repeat(64), namespace: null, executionState: "succeeded",
      cancelRequestedAt: "2026-10-04T00:00:00Z", localAbortObservedAt: null, attemptId: TURN_ID, taskId: null, responseId: "original" } };
  }

  async cancelExternalRequest(): Promise<void> {
    this.cancelCalls += 1;
    this.snapshot = snapshotFor(
      "externallyCancelled",
      this.snapshot.latestRequestId,
      this.snapshot.latestStepSequence,
      this.snapshot.counters.provider,
      this.snapshot.localProjectId
    );
  }
}

class MemoryRecoveryStore implements AgentTurnRecoveryStore {
  record: APlusTurnRecoveryRecord | undefined;
  loadCalls = 0;

  hasPersistedRecord(localProjectId: string): boolean {
    return this.record?.localProjectId === localProjectId;
  }

  async save(record: APlusTurnRecoveryRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async load(localProjectId: string): Promise<
    | { status: "none" }
    | { status: "ok"; record: APlusTurnRecoveryRecord }
  > {
    this.loadCalls += 1;
    return this.record?.localProjectId === localProjectId
      ? { status: "ok", record: structuredClone(this.record) }
      : { status: "none" };
  }

  async clear(): Promise<void> {
    this.record = undefined;
  }
}

function createFixture(
  scripts: readonly ScriptEntry[],
  options: {
    persistenceStates?: WorkspacePersistenceState[];
    visualGenerationResult?: Readonly<{
      createdObjectIds: string[];
      failedItems: unknown[];
    }>;
  } = {}
) {
  const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
  const persistenceStates = [...(options.persistenceStates ?? [])];
  const host: AgentTurnHost = {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    persistWorkspace: () => persistenceStates.shift() ?? fake.persistWorkspace(),
    ui: {
      setContextWarning: fake.createUiRecorder("warning"),
      clearPendingDeliveryDraftTarget: fake.createUiRecorder("clearDelivery"),
      setStreaming: fake.createUiRecorder("streaming"),
      setDraft: fake.createUiRecorder("draft"),
      setTaskMode: fake.createUiRecorder("taskMode"),
      openConversation: fake.createUiRecorder("openConversation"),
      showFailure: fake.createUiRecorder("failure"),
      showRecoveryPending: fake.createUiRecorder("recoveryPending"),
      requestPendingConfirmation: (value) => {
        fake.createUiRecorder("confirmation")(value);
        return { status: "accepted", origin: "agent" };
      },
      selectObjects: fake.createUiRecorder("selection"),
      focusObject: fake.createUiRecorder("focus"),
      openProposal: fake.createUiRecorder("proposal")
    },
    abortSlot: fake.abortSlot,
    streamFlushSlot: fake.streamFlushSlot,
    fetch: fake.fetch,
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: options.visualGenerationResult?.createdObjectIds ?? [],
      failedItems: options.visualGenerationResult?.failedItems ?? []
    }),
    now: fake.now,
    randomSuffix: fake.randomSuffix
  };
  const coordinatorHost = new CoordinatorHostFake(scripts);
  const store = new MemoryRecoveryStore();
  const ids = ["creation-a", "request-1", "request-2", "request-3"];
  const dependencies: AgentTurnRunnerAPlusDependencies = {
    coordinatorHost,
    recoveryStore: store,
    createId: () => ids.shift() ?? "request-fallback"
  };
  const input: RunMorphoAgentTurnAPlusInput = {
    draft: "讨论当前项目",
    taskMode: "chatAnalysis",
    recommendedTaskMode: "chatAnalysis",
    workIntent: "discussion",
    recommendedWorkIntent: "discussion",
    selectedObjectIds: [],
    selectedObjects: [],
    pendingDeliveryDraftTarget: null,
    directionPreviewCount: 1,
    agentTurnMode: "auto",
    imageGenerationModelId: "test-image-model",
    readConversationTokenLimits: () => undefined
  };
  return { fake, host, input, coordinatorHost, store, dependencies };
}

const finalTextDelivery: ExternalResultManifest = {
  kind: "text", effectId: `effect:${"d".repeat(64)}`, resultId: `result:${"e".repeat(64)}`, version: 1,
  sha256: "f".repeat(64), byteLength: 24, mimeType: "application/json", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z"
};

function finalTextFixture(options: { late?: boolean; tools?: boolean; toolOnly?: boolean } = {}) {
  const fixture = createFixture([options.late ? { status: "providerRunning" } :
    { status: "externallyCompleted", outputText: "durable final Text", delivery: finalTextDelivery }]);
  const outcome = options.late ? "cancelled" : "completed";
  const assistant = options.late ? { body: options.toolOnly ? "当前 Agent 回合已取消，已有本地结果会保留。" : "durable final Text", status: "cancelled", agentTurnOutcome: "cancelledDuringProvider" } :
    { body: "durable final Text", status: "done", agentTurnOutcome: "success" };
  if (options.late) {
    fixture.coordinatorHost.cancelExternalRequest = async () => {
      fixture.coordinatorHost.cancelCalls += 1;
      fixture.coordinatorHost.setJournalResult(options.tools ? "awaitingNextRequest" : "externallyCompleted");
    };
    Object.assign(fixture.coordinatorHost, { readProviderResult: vi.fn(async (input: { requestId: string; stepSequence: number }) => ({
      type: "providerOutput", ...input, outputText: options.toolOnly ? "" : "durable final Text", producedUserVisibleEffect: !options.toolOnly,
      toolCalls: options.tools ? [researchToolCall("late-research")] : [],
      toolCallIds: options.tools ? ["late-research"] : [], delivery: finalTextDelivery
    })) });
  }
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  const state = { fixture, failWorkspace: false, durable: structuredClone(fixture.fake.getWorkspace()), acks: [] as unknown[] };
  fixture.host.persistWorkspace = () => {
    if (state.failWorkspace && latestAssistant(fixture.fake.getWorkspace())?.body.includes("durable final Text")) return failedPersistence();
    state.durable = structuredClone(fixture.fake.getWorkspace()); return savedPersistence();
  };
  const save = fixture.store.save.bind(fixture.store);
  fixture.store.save = async record => {
    if (record.coordinator.lifecycle.phase === "terminal" && record.coordinator.lifecycle.outcome.kind === outcome) {
      expect(latestAssistant(state.durable)).toMatchObject(assistant);
      if (options.late) expect(record.coordinator.lifecycle.toolBatches).toEqual([]);
    }
    await save(record);
  };
  fixture.fake.setFetchRoute(`/api/ai/effects/${encodeURIComponent(finalTextDelivery.effectId)}/result`, async request => {
    expect(request.method).toBe("POST");
    expect(latestAssistant(state.durable)).toMatchObject(assistant);
    expect(fixture.store.record?.coordinator.lifecycle).toMatchObject({ phase: "terminal", persistence: "succeeded", outcome: { kind: outcome } });
    state.acks.push(await request.json()); return Response.json({ acknowledged: true });
  });
  return state;
}

function savedPersistence(): WorkspacePersistenceState {
  return {
    phase: "saved",
    isDirty: false,
    lastSavedAt: "2026-07-29T00:00:00.000Z"
  };
}

function makeLegacyRecovery(fixture: ReturnType<typeof createFixture>, version = "morpho-agent-v3.7-2026-08-16") {
  detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
  const record = fixture.store.record!;
  const { taskContract: omitted, ...request } = record.metadata.runtime.providerBaseRequest;
  void omitted;
  fixture.store.record = { ...record, coordinator: { ...record.coordinator,
    ...(record.coordinator.activeRequest ? { activeRequest: { ...record.coordinator.activeRequest,
      providerRequest: { ...request, promptContractVersion: version } } } : {}) },
    metadata: { ...record.metadata, runtime: { ...record.metadata.runtime,
    providerBaseRequest: { ...request, promptContractVersion: version } } } };
}

function failedPersistence(): WorkspacePersistenceState {
  return {
    phase: "error",
    isDirty: true,
    error: "simulated persistence failure"
  };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the A+ Recovery barrier.");
}

function snapshotFor(
  status: AgentTurnJournalSnapshot["status"],
  latestRequestId: string | null,
  latestStepSequence: number,
  providerCount: number,
  localProjectId = "project-test"
): AgentTurnJournalSnapshot {
  return {
    serverTurnId: TURN_ID,
    localProjectId,
    status,
    latestRequestId,
    latestStepSequence,
    counters: { provider: providerCount, webSearch: 0, image: 0 },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status.startsWith("externally") ? "2026-07-29T00:00:00.000Z" : null
  };
}

function latestAssistant(workspace: ReturnType<typeof createTestWorkspace>) {
  return [...workspace.ai.messages].reverse().find((message) => message.role === "assistant");
}

function selectComparableSources(fixture: ReturnType<typeof createFixture>) {
  const objects = Object.values(fixture.fake.getWorkspace().objects)
    .filter((object) => object.visibility === "active" && (object.type === "image" || object.type === "research"))
    .slice(0, 2);
  if (objects.length !== 2) throw new Error("Fixture 缺少两个可 Compare 对象。");
  return objects;
}

function researchToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "create_research_analysis",
    argumentsText: JSON.stringify({
      title: "研究草案",
      summary: "本地效果必须保留。",
      findings: [],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      evidence: []
    })
  };
}

function visualToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "generate_visuals",
    argumentsText: JSON.stringify({
      kind: "visualDevelopment",
      items: [
        {
          id: "visual-a",
          title: "方向图 A",
          purpose: "验证 A+ 图像生命周期",
          requestedReferenceObjectIds: [],
          changeGoals: [],
          preserve: [],
          allowToChange: [],
          productForm: [],
          materialsAndCmf: [],
          environmentAndLighting: [],
          avoid: [],
          role: "preview"
        },
        {
          id: "visual-b",
          title: "方向图 B",
          purpose: "验证部分失败",
          requestedReferenceObjectIds: [],
          changeGoals: [],
          preserve: [],
          allowToChange: [],
          productForm: [],
          materialsAndCmf: [],
          environmentAndLighting: [],
          avoid: [],
          role: "preview"
        }
      ]
    })
  };
}

function deliveryToolCall(callId: string, referenceId: string): APlusToolCall {
  return {
    callId,
    name: "prepare_delivery_section_draft",
    argumentsText: JSON.stringify({
      title: "交付章节草案",
      narrative: "这份草案等待用户在交付面板中应用或放弃。",
      captions: [{ referenceId, caption: "核心参考" }],
      suggestedGaps: []
    })
  };
}

function searchToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "search_web_evidence",
    argumentsText: JSON.stringify({
      reason: "验证 Search 恢复",
      queries: ["Morpho A+ runtime"]
    })
  };
}

function memoryConstraintToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "submit_memory_update",
    argumentsText: JSON.stringify({
      items: [{
        kind: "constraint",
        scope: "project",
        evidenceQuote: "预算不能超过 500 元",
        relatedObjectIds: [],
        relatedRevisionIds: []
      }]
    })
  };
}

function memorySkipToolCall(callId: string): APlusToolCall {
  return {
    callId,
    name: "submit_memory_update",
    argumentsText: JSON.stringify({
      items: [],
      skippedReason: "审慎判断该候选不需要写入长期记忆"
    })
  };
}


describe("P2B Runner structural fulfillment", () => {
  it.each([false, true])("recomputes delivered memory completion before continuation (mutation: %s)", async (mutate) => {
    const read = (callId: string): APlusToolCall => ({ callId, name: "read_project_memory", argumentsText: JSON.stringify({ keys: ["userPreferences"] }) });
    const fixture = createFixture([]);
    let continuationFacts: APlusTurnRecoveryRecord["metadata"]["runtime"]["facts"] | undefined;
    fixture.input.draft = "请读取项目偏好；预算不能超过 500 元";
    fixture.coordinatorHost.appendScripts([
      { status: "awaitingNextRequest", toolCalls: [read("before-mutation")] },
      (request) => {
        expect(JSON.stringify(request.providerRequest.input)).not.toContain("下一步先调用");
        return { status: "awaitingNextRequest", toolCalls: [mutate ? memoryConstraintToolCall("mutate-memory") : memorySkipToolCall("no-mutation")] };
      },
      () => {
        continuationFacts = structuredClone(fixture.store.record!.metadata.runtime.facts);
        return mutate ? { status: "awaitingNextRequest", toolCalls: [read("after-mutation")] } : { status: "externallyCompleted", outputText: "已核实原则。" };
      },
      { status: "externallyCompleted", outputText: "已按最新项目记忆核实原则。" }
    ]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const facts = continuationFacts!;
    expect(facts.readReceipts?.find((item) => item.id === "before-mutation:userPreferences")?.delivered).toBe(true);
    expect(facts.requiredReadState.completedTools.includes("read_project_memory")).toBe(!mutate);
    expect(JSON.stringify(fixture.coordinatorHost.executions[2]!.providerRequest.input).includes("下一步先调用")).toBe(mutate);
    expect(facts.requiredReadState.reminderInserted).toBe(mutate);
    expect(facts.requiredReadState.repairAttempted).toBe(false);
    expect(fixture.coordinatorHost.executions).toHaveLength(mutate ? 4 : 3);
    const fulfillment = latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment;
    expect(fulfillment?.status).toBe("fulfilled");
    if (mutate) {
      const before = fulfillment!.reads.find((receipt) => receipt.id === "before-mutation:userPreferences")!;
      const after = fulfillment!.reads.find((receipt) => receipt.id === "after-mutation:userPreferences")!;
      expect(after.delivered).toBe(true);
      expect(after.revisionId).not.toBe(before.revisionId);
    }
  });

  it("reports omitted reads unverified at terminal and never starts a paid repair", async () => {
    const fixture = createFixture([{ status: "externallyCompleted", outputText: "已核实当前设计原则。" }]);
    fixture.input.draft = "请读取项目记忆，告诉我当前设计原则";
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
    expect(latestAssistant(fixture.fake.getWorkspace())).toMatchObject({ agentTurnOutcome: "success", taskFulfillment: { status: "partial", obligations: expect.arrayContaining([expect.objectContaining({ id: "read:0", status: "blocked" })]) } });
    expect(latestAssistant(fixture.fake.getWorkspace())?.body).toContain("尚未完整核实");
  });

  it("reminds for a missing read during a legal continuation, then completes exact keys", async () => {
    const fixture = createFixture([
      { status: "awaitingNextRequest", outputText: "当前原则已经核实。", toolCalls: [{ callId: "summary-only", name: "read_selected_context", argumentsText: "{}" }] },
      { status: "awaitingNextRequest", toolCalls: [{ callId: "brief-read", name: "read_project_memory", argumentsText: JSON.stringify({ keys: ["designBrief"] }) }] },
      { status: "externallyCompleted", outputText: "已根据真实项目记忆回答。" }
    ]);
    fixture.input.draft = "请读取当前设计原则";
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(JSON.stringify(fixture.coordinatorHost.executions[1]!.providerRequest.input)).toContain("下一步先调用");
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment).toMatchObject({ status: "fulfilled", reads: expect.arrayContaining([expect.objectContaining({ kind: "memory", keys: ["designBrief"], delivered: true })]) });
  });

  it("does not count a narrow memory read as covering another required key", async () => {
    const fixture = createFixture([
      { status: "awaitingNextRequest", toolCalls: [{ callId: "wrong-keys", name: "read_project_memory", argumentsText: JSON.stringify({ keys: ["projectOverview"] }) }] },
      { status: "externallyCompleted", outputText: "已核实原则。" }
    ]);
    fixture.input.draft = "读取当前设计原则";
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).toBe("partial");
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
  });

  it("reads the actual document in successive ranges after an initially truncated extract", async () => {
    const fixture = createFixture([]);
    const file = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "file")!;
    if (file.type !== "file") throw new Error("file");
    file.parseStatus = "parsed"; file.extractedAssetId = "p2b-text"; file.extractedCharCount = 9000;
    fixture.fake.getWorkspace().assets[file.extractedAssetId] = { id: file.extractedAssetId, storageKey: "p2b-text", sourceType: "documentExtract", mimeType: "text/plain", fileName: "text.txt", size: 9000, createdAt: "2026-10-01T00:00:00Z" };
    vi.spyOn(indexedDbBlobStore, "get").mockResolvedValue(new Blob(["文".repeat(9000)]));
    fixture.input.selectedObjects = [file]; fixture.input.selectedObjectIds = [file.id]; fixture.input.draft = "通读整份文档后回答";
    fixture.coordinatorHost.appendScripts([
      { status: "awaitingNextRequest", toolCalls: [{ callId: "range-1", name: "read_workspace_source", argumentsText: JSON.stringify({ kind: "document", objectId: file.id, start: 2200, length: 6800 }) }] },
      { status: "externallyCompleted", outputText: "已读完整文档。" }
    ]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const fulfillment = latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment;
    expect(fulfillment?.status).toBe("fulfilled");
    expect(fulfillment?.reads).toEqual(expect.arrayContaining([expect.objectContaining({ source: "request", status: "partial", range: { start: 0, end: 2200, total: 9000, nextStart: 2200 } }), expect.objectContaining({ source: "tool", range: { start: 2200, end: 9000, total: 9000 }, delivered: true })]));
  });

  it.each(["revise", "split", "merge"] as const)("executes Concept %s through existing domain semantics", async (mode) => {
    const fixture = createFixture([]);
    const directions = Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.type === "conceptDirection").slice(0, mode === "merge" ? 2 : 1);
    const direction = directions[0]!;
    if (direction.type !== "conceptDirection") throw new Error("direction");
    const beforeRevision = direction.currentRevisionId;
    fixture.input.selectedObjects = directions; fixture.input.selectedObjectIds = directions.map((object) => object.id);
    fixture.input.draft = mode === "revise" ? `修订 ${direction.title}` : mode === "split" ? `拆分 ${direction.title}` : "合并这两个方向";
    fixture.input.workIntent = fixture.input.recommendedWorkIntent = mode === "revise" ? "reviseConceptDirection" : mode === "split" ? "splitConceptDirection" : "mergeConceptDirections";
    const args = { applicationMode: mode, ...(mode === "revise" ? { targetDirectionId: direction.id, targetRevisionId: beforeRevision } : { parentDirectionIds: directions.map((object) => object.id) }), title: "改进", summary: "改进", directions: Array.from({ length: mode === "split" ? 2 : 1 }, (_, index) => ({ title: `新方向${index}`, summary: "新摘要", conceptStatement: "concept", keywords: [], strategy: "strategy", differentiators: [], visualSignals: [], risks: [], openQuestions: [] })) };
    fixture.coordinatorHost.appendScripts([{ status: "awaitingNextRequest", toolCalls: [{ callId: "concept", name: "create_concept_direction_proposal", argumentsText: JSON.stringify(args) }] }, { status: "externallyCompleted", outputText: "已完成方向操作。" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const workspace = fixture.fake.getWorkspace();
    const fulfillment = latestAssistant(workspace)?.taskFulfillment;
    expect(fulfillment?.status, JSON.stringify(fulfillment)).toBe("fulfilled");
    if (mode === "revise") {
      const revised = workspace.objects[direction.id];
      expect(revised).toMatchObject({ id: direction.id, incarnationId: direction.incarnationId });
      if (revised?.type !== "conceptDirection") throw new Error("revised");
      expect(workspace.directionRevisions[revised.currentRevisionId]?.previousRevisionId).toBe(beforeRevision);
      expect(Object.keys(workspace.objects)).toHaveLength(Object.keys(createTestWorkspace().objects).length);
    } else expect(workspace.directionLineage.filter((record) => record.kind === (mode === "split" ? "splitFromDirection" : "mergedFromDirection"))).toHaveLength(2);
  });

  it("rejects unrelated create when the contract requires revise", async () => {
    const fixture = createFixture([]);
    const direction = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "conceptDirection")!;
    fixture.input.selectedObjects = [direction]; fixture.input.selectedObjectIds = [direction.id]; fixture.input.draft = `修订 ${direction.title}`;
    fixture.input.workIntent = fixture.input.recommendedWorkIntent = "reviseConceptDirection";
    const before = structuredClone(direction);
    fixture.coordinatorHost.appendScripts([{ status: "awaitingNextRequest", toolCalls: [{ callId: "wrong-create", name: "create_concept_direction_proposal", argumentsText: JSON.stringify({ title: "无关 B", summary: "无关", directions: [] }) }] }, { status: "externallyCompleted", outputText: "已修订。" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.fake.getWorkspace().objects[direction.id]).toEqual(before);
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).not.toBe("fulfilled");
  });

  it.each([0, 1, 2])("checks %i/2 actual image objects and preserved assets", async (count) => {
    const fixture = createFixture(count ? [{ status: "awaitingNextRequest", toolCalls: [visualToolCall("images")] }, { status: "externallyCompleted", outputText: "已经生成两张。" }] : [{ status: "externallyCompleted", outputText: "已经生成两张。" }]);
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration"; fixture.input.draft = "生成 2 张图";
    const host = hostWithGeneratedImages(fixture, count);
    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).toBe(count === 0 ? "notPerformed" : count === 1 ? "partial" : "fulfilled");
    expect(Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.id.startsWith("p2b-generated"))).toHaveLength(count);
  });

  it("observes new pixels only when explicitly requested and does not grant a second generation", async () => {
    const fixture = createFixture([
      { status: "awaitingNextRequest", toolCalls: [visualToolCall("images")] },
      { status: "awaitingNextRequest", toolCalls: [{ callId: "observe", name: "read_workspace_source", argumentsText: JSON.stringify({ kind: "image", objectId: "p2b-generated-0" }) }] },
      { status: "externallyCompleted", outputText: "已评价图像。" }
    ]);
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration"; fixture.input.draft = "生成 2 张图后再评价新生成的图";
    vi.spyOn(imageAttachments, "collectAiProviderImageAttachments").mockResolvedValue({ attachments: [{ id: "pixels", kind: "image", objectId: "p2b-generated-0", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=", representation: "single", status: "ready" }], entries: [{ objectId: "p2b-generated-0", representation: "single", attachmentId: "pixels", status: "ready" }], skippedObjectIds: [] });
    const host = hostWithGeneratedImages(fixture, 2);
    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions[2]!.providerRequest.input.some((message) => message.content.some((part) => part.type === "input_image"))).toBe(true);
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.reads).toEqual(expect.arrayContaining([expect.objectContaining({ objectId: "p2b-generated-0", representation: "pixels", delivered: true })]));
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).toBe("partial"); // second image still unread
    const observed = fixture.fake.getWorkspace().objects["p2b-generated-0"];
    const unobserved = fixture.fake.getWorkspace().objects["p2b-generated-1"];
    expect(observed?.type === "image" && observed.generation?.observations).toEqual([expect.objectContaining({ receiptId: "observe", objectId: "p2b-generated-0", representation: "pixels", stepSequence: 3 })]);
    expect(unobserved?.type === "image" && unobserved.generation?.observations).toBeUndefined();
    expect(fixture.coordinatorHost.executions[2]!.providerRequest.taskContract).toEqual(fixture.coordinatorHost.executions[0]!.providerRequest.taskContract);
  });

  it("retains all uncompressed history past the former 96-message slice", async () => {
    const fixture = createFixture([{ status: "externallyCompleted", outputText: "回答" }]);
    fixture.fake.commitWorkspace((workspace) => ({ workspace: { ...workspace, ai: { ...workspace.ai, messages: Array.from({ length: 130 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? "assistant" as const : "user" as const, body: `uncompressed-${index}`, status: "done" as const })) } }, value: undefined }));
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const body = JSON.stringify(fixture.coordinatorHost.executions[0]!.providerRequest.input);
    expect(body).toContain("uncompressed-0"); expect(body).toContain("uncompressed-129");
  });
});

function hostWithGeneratedImages(fixture: ReturnType<typeof createFixture>, count: number): AgentTurnHost {
  return { ...fixture.host, executeVisualGenerationPlan: async () => {
    const ids = Array.from({ length: count }, (_, index) => `p2b-generated-${index}`);
    fixture.fake.commitWorkspace((workspace) => {
      const objects = { ...workspace.objects }; const assets = { ...workspace.assets };
      const base = Object.values(objects).find((object) => object.type === "image")!;
      if (base.type !== "image") throw new Error("image fixture");
      for (const id of ids) {
        objects[id] = { ...base, id, incarnationId: `identity-${id}`, assetId: `asset-${id}`, title: id,
          generation: { modelId: "fixture", modelLabel: "fixture", aspectRatio: "1:1", prompt: "fixture", referenceObjectIds: [], editMode: "textToImage", createdAt: "2026-10-01T00:00:00Z" } };
        assets[`asset-${id}`] = { id: `asset-${id}`, storageKey: `blob-${id}`, sourceType: "aiGeneratedImage", mimeType: "image/png", fileName: `${id}.png`, size: 10, createdAt: "2026-10-01T00:00:00Z" };
      }
      return { workspace: { ...workspace, objects, assets }, value: undefined };
    });
    return { workspace: fixture.fake.getWorkspace(), createdObjectIds: ids, failedItems: count < 2 ? [{ reason: "fixture failure" }] : [] };
  } };
}


describe("P2B request materialization and Recovery", () => {
  it.each([1, 3])("keeps %i original scoped images beside observed results and freezes the submitted visual body", async (sourceCount) => {
    const visualTemplate = visualToolCall("images");
    const visualArgs = JSON.parse(visualTemplate.argumentsText) as { items: Array<{ identityParentObjectId?: string }> };
    visualArgs.items.forEach((item) => { item.identityParentObjectId = "source-0"; });
    const visualCall = { ...visualTemplate, argumentsText: JSON.stringify(visualArgs) };
    const fixture = createFixture([
      { status: "awaitingNextRequest", toolCalls: [visualCall] },
      { status: "awaitingNextRequest", toolCalls: [{ callId: "observe-0", name: "read_workspace_source", argumentsText: JSON.stringify({ kind: "image", objectId: "p2b-generated-0" }) }] },
      { status: "awaitingNextRequest", toolCalls: [{ callId: "observe-1", name: "read_workspace_source", argumentsText: JSON.stringify({ kind: "image", objectId: "p2b-generated-1" }) }] },
      { status: "providerRunning", outputText: "正在对照原图评价" }
    ]);
    const workspace = fixture.fake.getWorkspace();
    const image = Object.values(workspace.objects).find((object) => object.type === "image")!;
    if (image.type !== "image") throw new Error("image");
    const sources = Array.from({ length: sourceCount }, (_, index) => ({ ...image, id: `source-${index}`, title: String.fromCharCode(65 + index), incarnationId: `source-identity-${index}` }));
    sources.forEach((source) => { workspace.objects[source.id] = source; });
    workspace.workingState.currentDefaultReferenceId = undefined;
    Object.values(workspace.objects).forEach((object) => { if (object.type === "image") object.isDefaultReference = false; });
    fixture.input.selectedObjects = sources; fixture.input.selectedObjectIds = sources.map((source) => source.id);
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration";
    const names = sources.map((source) => source.title).join("+");
    fixture.input.draft = `基于 ${names} 生成两张；然后对照 ${names} 评价新生成的图`;
    vi.spyOn(imageAttachments, "collectAiProviderImageAttachments").mockImplementation(async (_workspace, objectIds) => ({
      attachments: [...objectIds].map((objectId) => ({ id: objectId, kind: "image", objectId, mimeType: "image/png", dataUrl: `data:image/png;base64,${Buffer.from(objectId).toString("base64")}`, representation: "single", status: "ready" })),
      entries: [...objectIds].map((objectId) => ({ objectId, representation: "single", attachmentId: objectId, status: "ready" })), skippedObjectIds: []
    }));
    const host = hostWithGeneratedImages(fixture, 2);
    const generate = vi.spyOn(host, "executeVisualGenerationPlan");
    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fixture.coordinatorHost.executions).toHaveLength(4);
    const first = fixture.coordinatorHost.executions[0]!.providerRequest;
    expect(first.input.flatMap((message) => message.content).filter((part) => part.type === "input_image")).toHaveLength(sourceCount);
    const final = fixture.coordinatorHost.executions[3]!.providerRequest;
    expect(parseAPlusAgentProviderRequest(final).status).toBe("ok");
    const images = final.input.flatMap((message) => message.content).flatMap((part) => part.type === "input_image" ? [part.image_url] : []);
    expect(images).toHaveLength(Math.min(sourceCount + 2, 4));
    sources.forEach((source) => expect(images).toContain(`data:image/png;base64,${Buffer.from(source.id).toString("base64")}`));
    const coveragePart = final.input.flatMap((message) => message.content).find((part) => "text" in part && part.text.startsWith("<morpho_input_coverage>"));
    if (!coveragePart || !("text" in coveragePart)) throw new Error("coverage");
    const coverage = JSON.parse(coveragePart.text.split("\n")[1]!) as import("@/shared/agentReadCoverage").AgentReadReceipt[];
    expect(coverage.filter((receipt) => receipt.requestImageStatus === "materialized")).toHaveLength(images.length);
    if (sourceCount === 3) expect(coverage).toContainEqual(expect.objectContaining({ objectId: "p2b-generated-1", requestImageStatus: "omitted", imageOmissionReason: "imageCount", delivered: false, status: "unavailable", representation: "metadata" }));
    const frozen = structuredClone(fixture.store.record!.coordinator.activeRequest);
    sources[0]!.assetId = "changed-after-submission";
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, host, fixture.dependencies)).toBe("pending");
    expect(fixture.store.record!.coordinator.activeRequest).toEqual(frozen);
    expect(fixture.coordinatorHost.executions).toHaveLength(4);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("lets the Provider choose Delivery references from its actual section input", async () => {
    const fixture = createFixture([]);
    const delivery = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "delivery")!;
    if (delivery.type !== "delivery") throw new Error("delivery");
    const section = delivery.sections.find((section) => section.referenceIds.length)!;
    fixture.input.pendingDeliveryDraftTarget = { deliveryObjectId: delivery.id, sectionId: section.id };
    fixture.input.draft = "准备该交付章节草稿";
    fixture.coordinatorHost.appendScripts([(request) => {
      const text = request.providerRequest.input.flatMap((message) => message.content).find((part) => "text" in part && part.text.startsWith("<untrusted_delivery_section>"));
      if (!text || !("text" in text)) throw new Error("Model cannot know reference IDs without section input");
      const received = JSON.parse(text.text.split("\n")[1]!) as { sectionId: string; references: Array<{ referenceId: string }> };
      expect(received.sectionId).toBe(section.id);
      expect(received.references.map((reference) => reference.referenceId)).toEqual(section.referenceIds);
      return { status: "awaitingNextRequest", toolCalls: [deliveryToolCall("received-target", received.references[0]!.referenceId)] };
    }, { status: "externallyCompleted", outputText: "草稿已准备" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).toBe("fulfilled");
    expect(Object.values(fixture.fake.getWorkspace().deliverySectionDrafts)[0]).toMatchObject({ deliveryObjectId: delivery.id, sectionId: section.id });
  });

  it("binds Delivery Tool output to the delivered A input even when a user edits B during the request", async () => {
    const fixture = createFixture([]);
    const delivery = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "delivery")!;
    if (delivery.type !== "delivery") throw new Error("delivery");
    const section = delivery.sections.find((item) => item.referenceIds.length)!;
    fixture.input.pendingDeliveryDraftTarget = { deliveryObjectId: delivery.id, sectionId: section.id };
    fixture.input.draft = "准备本节交付草稿";
    const baselineA = captureDeliveryGenerationBaseline(fixture.fake.getWorkspace(), delivery.id, section.id);
    fixture.coordinatorHost.appendScripts([(request) => {
      const text = request.providerRequest.input.flatMap((message) => message.content).find((part) => "text" in part && part.text.startsWith("<untrusted_delivery_section>"));
      if (!text || !("text" in text)) throw new Error("missing actual input");
      const received = JSON.parse(text.text.split("\n")[1]!) as { existingNarrative?: string; references: Array<{ referenceId: string }> };
      expect(received.existingNarrative).toBe(section.narrative);
      fixture.host.commitWorkspace((current) => {
        const result = updateDeliverySection(current, { deliveryObjectId: delivery.id, sectionId: section.id, narrative: "later manual B" });
        return { workspace: result.workspace, value: undefined };
      });
      return { status: "awaitingNextRequest", toolCalls: [deliveryToolCall("p5-baseline-A", received.references[0].referenceId)] };
    }, { status: "externallyCompleted", outputText: "草稿已创建，待复核" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const workspace = fixture.fake.getWorkspace();
    const saved = Object.values(workspace.deliverySectionDrafts)[0];
    expect(saved.generationBaseline).toEqual(baselineA);
    expect(saved.sourceFingerprints).toEqual(baselineA?.sourceFingerprints);
    expect(inspectDeliveryDraft(workspace, saved).status).toBe("stale");
    expect(applyDeliverySectionDraft(workspace, { deliveryObjectId: delivery.id, draftId: saved.id, acknowledgeReview: true }).status).toBe("blocked");
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
  });

  it("rematerializes the exact current Delivery chapter and its baseline for a fresh generation request", async () => {
    const fixture = createFixture([]);
    const delivery = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "delivery")!;
    if (delivery.type !== "delivery") throw new Error("delivery");
    const section = delivery.sections.find((item) => item.referenceIds.length)!;
    fixture.input.pendingDeliveryDraftTarget = { deliveryObjectId: delivery.id, sectionId: section.id };
    fixture.input.draft = "准备本节交付草稿";
    let baselineB: ReturnType<typeof captureDeliveryGenerationBaseline>;
    fixture.coordinatorHost.appendScripts([() => {
      fixture.host.commitWorkspace((current) => ({ workspace: updateDeliverySection(current, { deliveryObjectId: delivery.id, sectionId: section.id, narrative: "current B before fresh continuation" }).workspace, value: undefined }));
      return { status: "awaitingNextRequest", toolCalls: [{ callId: "read-before-generation", name: "read_selected_context", argumentsText: "{}" }] };
    }, (request) => {
      const sections = request.providerRequest.input.flatMap((message) => message.content).filter((part) => "text" in part && part.text.startsWith("<untrusted_delivery_section>"));
      const text = sections.at(-1); if (!text || !("text" in text)) throw new Error("missing chapter");
      const received = JSON.parse(text.text.split("\n")[1]!) as { existingNarrative: string; references: Array<{ referenceId: string }> };
      expect(received.existingNarrative).toBe("current B before fresh continuation");
      baselineB = captureDeliveryGenerationBaseline(fixture.fake.getWorkspace(), delivery.id, section.id);
      return { status: "awaitingNextRequest", toolCalls: [deliveryToolCall("p5-fresh-B", received.references[0].referenceId)] };
    }, { status: "externallyCompleted", outputText: "基于 B 创建草稿" }]);
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const workspace = fixture.fake.getWorkspace(), saved = Object.values(workspace.deliverySectionDrafts)[0];
    expect(saved.generationBaseline).toEqual(baselineB);
    expect(inspectDeliveryDraft(workspace, saved).status).not.toBe("stale");
  });

  it("keeps an in-flight continuation frozen while a later legal request reads fresh state", async () => {
    const fixture = createFixture([
      { status: "awaitingNextRequest", toolCalls: [{ callId: "read-first", name: "read_selected_context", argumentsText: "{}" }] },
      { status: "providerRunning", toolCalls: [{ callId: "read-next", name: "read_selected_context", argumentsText: "{}" }] },
      { status: "externallyCompleted", outputText: "完成" }
    ]);
    const direction = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "conceptDirection")!;
    if (direction.type !== "conceptDirection") throw new Error("direction");
    fixture.input.selectedObjectIds = [direction.id]; fixture.input.selectedObjects = [direction];
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    const frozen = structuredClone(fixture.store.record!.coordinator.activeRequest);
    fixture.fake.getWorkspace().directionRevisions[direction.currentRevisionId]!.summary = "latest-after-submission-marker";
    detachMorphoAgentTurnForPageUnload(LOCAL_PROJECT_ID);
    expect(await recoverMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies)).toBe("pending");
    expect(fixture.store.record!.coordinator.activeRequest).toEqual(frozen);
    expect(fixture.coordinatorHost.executions).toHaveLength(2);
    fixture.coordinatorHost.setJournalStatus("awaitingNextRequest");
    await resumeMorphoAgentTurn(LOCAL_PROJECT_ID, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions).toHaveLength(3);
    expect(JSON.stringify(fixture.coordinatorHost.executions[2]!.providerRequest.input)).toContain("latest-after-submission-marker");
    expect(JSON.stringify(fixture.coordinatorHost.executions[1]!.providerRequest.input)).not.toContain("latest-after-submission-marker");
  });

  it("does not repeat a required revision read already present in the exact initial body", async () => {
    const fixture = createFixture([{ status: "externallyCompleted", outputText: "根据指定 revision 回答" }]);
    const direction = Object.values(fixture.fake.getWorkspace().objects).find((object) => object.type === "conceptDirection")!;
    if (direction.type !== "conceptDirection") throw new Error("direction");
    fixture.input.selectedObjectIds = [direction.id]; fixture.input.selectedObjects = [direction];
    fixture.input.draft = `请基于指定 revision ${direction.currentRevisionId} 回答`;
    await runMorphoAgentTurn(fixture.input, fixture.host, fixture.dependencies);
    expect(fixture.coordinatorHost.executions[0]!.providerRequest.taskContract?.requiredReads).toContainEqual({ tool: "read_workspace_source", kind: "object", objectId: direction.id, revisionId: direction.currentRevisionId });
    expect(latestAssistant(fixture.fake.getWorkspace())?.taskFulfillment?.status).toBe("fulfilled");
    expect(fixture.coordinatorHost.executions).toHaveLength(1);
  });

  it("refuses a second paid batch after successful image observation", async () => {
    const fixture = createFixture([{ status: "awaitingNextRequest", toolCalls: [visualToolCall("first-images")] }, { status: "awaitingNextRequest", toolCalls: [visualToolCall("another-images")] }, { status: "externallyCompleted", outputText: "完成" }]);
    fixture.input.taskMode = fixture.input.recommendedTaskMode = "imageGeneration"; fixture.input.draft = "生成两张图后再评价";
    const host = hostWithGeneratedImages(fixture, 2);
    const generate = vi.spyOn(host, "executeVisualGenerationPlan");
    await runMorphoAgentTurn(fixture.input, host, fixture.dependencies);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.coordinatorHost.executions[2]!.providerRequest.continuationItems)).toContain("agent_tool_not_authorized");
    expect(Object.values(fixture.fake.getWorkspace().objects).filter((object) => object.id.startsWith("p2b-generated"))).toHaveLength(2);
  });
});
