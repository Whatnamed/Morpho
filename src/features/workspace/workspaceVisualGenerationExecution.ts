import { prepareIndependentImageDelivery, completeIndependentImageDelivery } from "./independentImageDelivery";
import { materializeExternalResultResponse, acknowledgePersistedExternalResult } from "./externalResultClient";
import { assertExternalRequestBody, type ExternalResultManifest } from "@/shared/externalResultProtocol";
import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import { freezeVisualLineage, isVisualLineageSnapshot, isVisualProviderInputManifest } from "@/domain/operations/visualLineage";
import { materializeVisualProviderInputs } from "./visualProviderInputs";
import { getImageCanvasSize } from "@/domain/morpho/imageSizing";
import {
  completeImageGenerationOperation,
  createImageGenerationOperation,
  failImageGenerationOperation,
  markImageGenerationOperationSubmitted,
  recordImageGenerationPlan,
  recordImageGenerationOperationResult
} from "@/domain/operations/operations";
import type { VisualGenerationPlanItem, VisualLineageSnapshot, VisualProviderInputManifest } from "@/domain/operations/types";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type {
  APlusExternalActionDescriptor,
  APlusRestoredImageActionDescriptor
} from "./agentExternalActionClientAPlus";
import {
  buildAPlusImageBatchIdentity,
  APlusExternalActionRunningError,
  buildAPlusImageChildActionId,
  classifyAPlusImageResponse,
  createAPlusExternalActionRunningError,
  createAPlusImageRestoredActionCursor,
  findAPlusImageResultObjectId,
  hashAPlusExternalActionBody,
  isAPlusExternalActionRunningError,
  postAPlusExternalAction
} from "./agentExternalActionClientAPlus";
import type {
  AgentVisualGenerationExecution,
  ExecuteAgentVisualGenerationPlan
} from "./agentToolExecutors";
import {
  IMAGE_GENERATION_MAX_CONCURRENCY,
  buildImageGenerationProgressMessage,
  mapWithConcurrency
} from "./imageGenerationConcurrency";
import {
  resolveImageGenerationSettingsForVisualIntent,
  type ImageGenerationSettings
} from "./imageGenerationSettings";
import { applyImageGenerationResultCommit } from "./imageGenerationResultCommit";
import {
  buildPendingImageGenerationSlots,
  removePendingImageGenerationSlot,
  type PendingImageGenerationSlot
} from "./pendingImageGenerationSlots";
import { planDirectionPreviewPlacements, planVisualDevelopmentPlacements } from "./visualPreviewLayout";
import { readErrorResponse } from "./httpPayload";
import { isExternalEffectSnapshot } from "@/shared/externalEffectProtocol";
import type { SaveLocalAssetResult } from "@/infrastructure/assets/localAssetWorkflow";

export type ImageTaskState =
  | "preparing"
  | "submitting"
  | "waiting"
  | "downloading"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ImageTaskStatus = {
  state: ImageTaskState;
  message: string;
};

export type WorkspaceVisualGenerationExecutionSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export type StaleVisualGenerationExecutionError = Error & {
  code: "stale_visual_generation_execution";
};

export function createStaleVisualGenerationExecutionError(
  message = "Visual Generation execution 所属的项目会话已失效。"
): StaleVisualGenerationExecutionError {
  return Object.assign(new Error(message), {
    code: "stale_visual_generation_execution" as const
  });
}

export function isStaleVisualGenerationExecutionError(
  value: unknown
): value is StaleVisualGenerationExecutionError {
  return isWorkspaceRecord(value) && value.code === "stale_visual_generation_execution";
}

export type WorkspaceVisualGenerationExecutionPorts = {
  fetch: typeof fetch;
  persistWorkspace?: () => import("./workspacePersistence").WorkspacePersistenceState;
  getCurrentSession: () => WorkspaceVisualGenerationExecutionSession;
  assertCurrentSession: (expectedSession: WorkspaceVisualGenerationExecutionSession) => void;
  commitWorkspace: <T>(
    expectedSession: WorkspaceVisualGenerationExecutionSession,
    transform: WorkspaceCommitTransform<T>
  ) => T;
  updatePendingImageGenerationSlots: (
    expectedSession: WorkspaceVisualGenerationExecutionSession,
    update: (current: PendingImageGenerationSlot[]) => PendingImageGenerationSlot[]
  ) => void;
  setImageTaskStatus: (
    expectedSession: WorkspaceVisualGenerationExecutionSession,
    status: ImageTaskStatus | null
  ) => void;
  saveGeneratedAsset: (file: File) => Promise<SaveLocalAssetResult>;
  deleteAsset: (storageKey: string) => Promise<void>;
  readReferenceAsset: (storageKey: string) => Promise<Blob | null>;
  selectObjects: (
    expectedSession: WorkspaceVisualGenerationExecutionSession,
    objectIds: string[]
  ) => void;
  focusObject: (
    expectedSession: WorkspaceVisualGenerationExecutionSession,
    objectId: string
  ) => void;
  now: () => number;
  randomSuffix: () => string;
};

export type WorkspaceVisualGenerationPlanInput = Parameters<ExecuteAgentVisualGenerationPlan>[0];

type ValidatedVisualGenerationPlan = Extract<
  ReturnType<typeof validateVisualGenerationPlan>,
  { status: "ok" }
>;
type VisualGenerationItem = ValidatedVisualGenerationPlan["plan"]["items"][number] & {
  requestSettings?: Pick<import("@/domain/morpho/types").ImageGenerationMetadata, "modelId" | "modelLabel" | "aspectRatio" | "sizeOption">;
};
type RestoredActionCursor = ReturnType<typeof createAPlusImageRestoredActionCursor>;

type VisualGenerationExecutionContext = Readonly<{
  session: WorkspaceVisualGenerationExecutionSession;
  operationId: string;
  clientRequestId: string;
  externalAction: WorkspaceVisualGenerationPlanInput["aPlusExternalAction"];
  validatedPlan: ValidatedVisualGenerationPlan;
  generationSettings: ImageGenerationSettings;
  workspaceAtPlanCommit: MorphoWorkspace;
  plannedImageSize: { w: number; h: number };
  placementMap: ReadonlyMap<string, { x: number; y: number }>;
  restoredActionCursor: RestoredActionCursor;
}>;

type VisualGenerationExecutionState = {
  readonly createdObjectIds: string[];
  readonly failedItems: string[];
  completedCount: number;
  inFlightCount: number;
  lastProviderTaskId?: string;
};

type VisualGenerationItemResult = Readonly<{ aPlusActionId?: string; delivery?: ExternalResultManifest; deliveredAction?: APlusExternalActionDescriptor; independentDeliveryKey?: string }> & (
  | {
      status: "existing";
      index: number;
      item: VisualGenerationItem;
      objectId: string;
    }
  | {
      status: "ok";
      index: number;
      item: VisualGenerationItem;
      asset: AssetRecord;
      sourceObjectIds: string[];
      providerTaskId?: string;
    }
  | {
      status: "failed";
      index: number;
      item: VisualGenerationItem;
      reason: string;
    }
);

export async function executeWorkspaceVisualGenerationPlan(
  input: WorkspaceVisualGenerationPlanInput,
  effectiveImageGenerationSettings: ImageGenerationSettings,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<AgentVisualGenerationExecution> {
  const context = await prepareVisualGenerationExecution(
    input,
    effectiveImageGenerationSettings,
    ports
  );
  const state: VisualGenerationExecutionState = {
    createdObjectIds: [],
    failedItems: [],
    completedCount: 0,
    inFlightCount: 0
  };

  try {
    await mapWithConcurrency(
      context.validatedPlan.plan.items,
      context.externalAction ? 1 : IMAGE_GENERATION_MAX_CONCURRENCY,
      (item, itemIndex) => executeVisualGenerationItem(
        context,
        state,
        input,
        item,
        itemIndex,
        ports
      ),
      {
        onSettled: (result) => applyVisualGenerationItemResult(
          context,
          state,
          result,
          ports
        )
      }
    );
  } catch (error) {
    if (isStaleVisualGenerationExecutionError(error)) {
      throw error;
    }

    const isCancelled = isAbortError(error);
    const isExternalActionRunning = isAPlusExternalActionRunningError(error);
    const reason = isCancelled
      ? "图像任务已取消。原输入、来源对象和已有结果已保留。"
      : error instanceof Error
        ? error.message
        : "图像任务失败。";
    if (!isExternalActionRunning) {
      ports.commitWorkspace(context.session, (current) => {
        const failed = failImageGenerationOperation(current, {
          operationId: context.operationId,
          status: isCancelled ? "cancelled" : "failed",
          reason,
          providerTaskId: state.lastProviderTaskId
        });
        return { workspace: failed, value: undefined };
      });
      ports.setImageTaskStatus(context.session, {
        state: isCancelled ? "cancelled" : "failed",
        message: reason
      });
    } else {
      ports.setImageTaskStatus(context.session, { state: "waiting", message: reason });
    }
    throw error;
  } finally {
    try {
      ports.updatePendingImageGenerationSlots(context.session, (current) =>
        current.filter((slot) => slot.operationId !== context.operationId)
      );
    } catch (error) {
      if (!isStaleVisualGenerationExecutionError(error)) {
        throw error;
      }
    }
  }

  return finalizeVisualGenerationExecution(context, state, ports);
}

async function prepareVisualGenerationExecution(
  input: WorkspaceVisualGenerationPlanInput,
  effectiveImageGenerationSettings: ImageGenerationSettings,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<VisualGenerationExecutionContext> {
  const session = ports.getCurrentSession();
  assertExecutionSession(session, input.workspaceSnapshot);

  const requestedGenerationCount =
    input.plan.kind === "directionPreview"
      ? input.requestedPreviewCount ?? 1
      : input.plan.items.length;
  const frozenPlan = input.recoverExactExternalActionOnly || input.restoredExternalAction ? input.plan : {
    ...input.plan, items: input.plan.items.map((item) => item.lineage ? item : {
      ...item,
      lineage: freezeVisualLineage({ workspace: input.workspaceSnapshot, kind: input.plan.kind,
        sourceObjectIds: input.selectedImageIds, intent: item.visualIntent ?? {
          id: item.id, title: item.title, purpose: item.purpose, targetDirectionId: item.targetDirectionId,
          visualBranchId: item.visualBranchId, requestedReferenceObjectIds: item.referenceObjectIds,
          changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [],
          environmentAndLighting: [], avoid: [], role: item.role
        } })
    })
  };
  const validatedPlan: ReturnType<typeof validateVisualGenerationPlan> = input.recoverExactExternalActionOnly || input.restoredExternalAction
    ? { status: "ok", plan: frozenPlan }
    : validateVisualGenerationPlan(input.workspaceSnapshot, {
    plan: frozenPlan,
    allowedObjectIds: [
      ...input.sourceObjectIds,
      ...input.plan.items.flatMap((item) => item.referenceObjectIds)
    ],
    selectedDirectionIds: input.selectedDirectionIds,
    selectedImageIds: input.selectedImageIds,
    requestedPreviewCount: requestedGenerationCount
  });
  if (validatedPlan.status === "blocked") {
    throw new Error(validatedPlan.reason);
  }

  const aPlusBatchIdentity = input.aPlusExternalAction
    ? await buildAPlusImageBatchIdentity(
        input.aPlusExternalAction.serverTurnId,
        input.aPlusExternalAction.actionId
      )
    : undefined;
  ports.assertCurrentSession(session);
  const operationId = aPlusBatchIdentity?.operationId ??
    `operation-image-${ports.now()}-${ports.randomSuffix()}`;
  const clientRequestId = aPlusBatchIdentity?.clientRequestId ??
    `client-image-${ports.now()}-${ports.randomSuffix()}`;
  const generationSettings = resolveImageGenerationSettingsForVisualIntent({
    intent: input.plan.kind === "directionPreview" ? "directionPreview" : "visualDevelopment",
    aspectRatio: effectiveImageGenerationSettings.aspectRatio
  });
  const workspaceAtPlanCommit = ports.commitWorkspace(session, (current) => {
    const existingOperation = aPlusBatchIdentity ? current.operations[operationId] : undefined;
    if (existingOperation && existingOperation.type !== "imageGeneration") {
      throw new Error("A+ 图像 Operation ID 与现有非图像 Operation 冲突。");
    }
    const existingPlan = existingOperation?.imageGeneration?.plan;
    if (input.recoverExactExternalActionOnly && (!input.restoredExternalAction || !existingPlan)) {
      throw aPlusExternalActionPayloadError("旧 Image Recovery 缺少已持久化的 Action 或原始 Operation Plan，不能重建生成任务。");
    }
    if (existingPlan && JSON.stringify(existingPlan) !== JSON.stringify(validatedPlan.plan)) {
      throw new Error("A+ 图像 Operation 的恢复计划与原计划不一致。");
    }
    const workspaceWithOperation = existingOperation
      ? current
      : createImageGenerationOperation(current, {
          operationId,
          clientRequestId,
          prompt: input.draft,
          selectedObjectIds: input.sourceObjectIds,
          imagePixels: false,
          modelId: generationSettings.modelId,
          modelLabel: generationSettings.modelLabel,
          aspectRatio: generationSettings.aspectRatio,
          sizeOption: generationSettings.sizeOption,
          referenceObjectIds: input.sourceObjectIds,
          requestedPreviewCount: input.plan.kind === "directionPreview"
            ? requestedGenerationCount
            : undefined
        }).workspace;
    const workspaceWithPlan = existingPlan
      ? workspaceWithOperation
      : recordImageGenerationPlan(workspaceWithOperation, {
          operationId,
          plan: validatedPlan.plan
        });
    return { workspace: workspaceWithPlan, value: workspaceWithPlan };
  });

  const plannedImageSize = getPlannedImageSize(effectiveImageGenerationSettings.aspectRatio);
  const placementMap = new Map(
    (validatedPlan.plan.kind === "directionPreview"
      ? planDirectionPreviewPlacements(
          workspaceAtPlanCommit,
          validatedPlan.plan.items.map((item) => ({
            id: item.id,
            targetDirectionId: item.targetDirectionId,
            width: plannedImageSize.w,
            height: plannedImageSize.h
          }))
        )
      : planVisualDevelopmentPlacements(
          workspaceAtPlanCommit,
          validatedPlan.plan.items.map((item) => ({
            id: item.id,
            referenceObjectIds: item.referenceObjectIds,
            targetDirectionId: item.targetDirectionId,
            width: plannedImageSize.w,
            height: plannedImageSize.h
          }))
        )
    ).map((placement) => [placement.planItemId, placement.position] as const)
  );
  ports.updatePendingImageGenerationSlots(session, (current) => [
    ...current.filter((slot) => slot.operationId !== operationId),
    ...buildPendingImageGenerationSlots({
      operationId,
      items: validatedPlan.plan.items,
      placements: placementMap,
      size: plannedImageSize
    })
  ]);

  return {
    session,
    operationId,
    clientRequestId,
    externalAction: input.aPlusExternalAction,
    validatedPlan,
    generationSettings,
    workspaceAtPlanCommit,
    plannedImageSize,
    placementMap,
    restoredActionCursor: createAPlusImageRestoredActionCursor(input.restoredExternalAction)
  };
}

async function executeVisualGenerationItem(
  context: VisualGenerationExecutionContext,
  state: VisualGenerationExecutionState,
  input: WorkspaceVisualGenerationPlanInput,
  item: VisualGenerationItem,
  itemIndex: number,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<VisualGenerationItemResult> {
  const itemClientRequestId = `${context.clientRequestId}-${item.id}`;
  const aPlusActionId = context.externalAction
    ? await buildAPlusImageChildActionId(context.externalAction.actionId, item.id)
    : undefined;
  ports.assertCurrentSession(context.session);
  const existingObjectId = findAPlusImageResultObjectId(context.workspaceAtPlanCommit, itemClientRequestId);
  if (existingObjectId) {
    state.completedCount += 1;
    publishVisualGenerationProgress(context, state, input, ports);
    return {
      status: "existing",
      index: itemIndex,
      item,
      aPlusActionId,
      delivery: (() => { const object = context.workspaceAtPlanCommit.objects[existingObjectId];
        return object?.type === "image" ? object.generation?.delivery : undefined; })(),
      objectId: existingObjectId
    };
  }

  state.inFlightCount += 1;
  let provisionalStorageKey: string | undefined;
  let deliveredAction: APlusExternalActionDescriptor | undefined;
  try {
    publishVisualGenerationProgress(context, state, input, ports);
    const restoredAction = context.externalAction && aPlusActionId
      ? context.restoredActionCursor.match(context.externalAction.actionId, aPlusActionId)
      : undefined;
    if ((context.restoredActionCursor.hasPending() || input.recoverExactExternalActionOnly) && !restoredAction) {
      throw aPlusExternalActionPayloadError(
        "A+ Image 的持久化 Action 不属于当前恢复的 Image 项，不能重新构造请求。"
      );
    }
    const restoredImagePayload = restoredAction
      ? parsePersistedAPlusImageRequestBody(restoredAction.requestBody)
      : undefined;
    if (restoredAction && (
      await hashAPlusExternalActionBody(restoredAction.requestBody) !== restoredAction.requestHash ||
      !restoredImagePayload
    )) {
      throw aPlusExternalActionPayloadError(
        "A+ Image 的持久化请求 Body 缺失、损坏或校验失败。"
      );
    }
    const inputMaterialization = restoredImagePayload ? undefined : await materializeVisualProviderInputs({
      workspace: context.workspaceAtPlanCommit, item, modelId: context.generationSettings.modelId,
      userInput: input.draft, signal: input.signal, readAsset: ports.readReferenceAsset
    });
    const effectiveItem = restoredImagePayload
      ? restoreVisualProviderItem(context, item, restoredImagePayload)
      : inputMaterialization!.item;
    const referenceImages = restoredImagePayload
      ? { images: [], sourceObjectIds: restoredImagePayload.sourceObjectIds }
      : inputMaterialization!;
    ports.assertCurrentSession(context.session);
    if (!restoredImagePayload) {
      ports.commitWorkspace(context.session, (current) => {
        const operation = current.operations[context.operationId];
        const generation = operation?.imageGeneration;
        if (!generation) throw new Error("生成 Operation 缺失。");
        return { workspace: { ...current, operations: { ...current.operations, [operation.id]: { ...operation,
          imageGeneration: { ...generation, materializedItems: [...(generation.materializedItems ?? []).filter((entry) => entry.id !== item.id), effectiveItem] }
        } } }, value: undefined };
      });
      if (inputMaterialization!.failure) throw new Error(inputMaterialization!.failure);
    }
    ports.commitWorkspace(context.session, (current) => ({
      workspace: markImageGenerationOperationSubmitted(current, {
        operationId: context.operationId,
        referenceObjectIds: referenceImages.sourceObjectIds,
        imagePixels: restoredImagePayload
          ? restoredImagePayload.imageCount > 0
          : referenceImages.images.length > 0
      }),
      value: undefined
    }));

    const imageInput = {
      modelId: context.generationSettings.modelId,
      prompt: effectiveItem.prompt,
      images: referenceImages.images,
      aspectRatio: context.generationSettings.aspectRatio,
      sizeOption: context.generationSettings.sizeOption,
      referenceObjectIds: referenceImages.sourceObjectIds,
      directionObjectId: effectiveItem.lineage?.direction?.objectId ?? effectiveItem.targetDirectionId,
      visualBranchId: effectiveItem.lineage?.branch?.id ?? effectiveItem.visualBranchId,
      visualLineage: effectiveItem.lineage,
      visualProviderInputs: effectiveItem.providerInputs,
      operationId: context.operationId,
      clientRequestId: itemClientRequestId
    };
    const imageRequestBody = restoredAction
      ? restoredAction.requestBody
      : JSON.stringify(context.externalAction && aPlusActionId
          ? {
              localProjectId: context.externalAction.localProjectId,
              requestId: context.externalAction.requestId,
              stepSequence: context.externalAction.stepSequence,
              actionId: aPlusActionId,
              claimCallId: context.externalAction.actionId,
              input: imageInput
            }
          : imageInput);
    if (context.externalAction && aPlusActionId && !restoredAction) {
      if (!input.onExternalActionIntent) {
        throw aPlusExternalActionPayloadError(
          "A+ Image Action 缺少发送前的 Recovery Record 持久化入口。",
          "external_action_intent_persistence_unavailable"
        );
      }
      const action: APlusExternalActionDescriptor = {
        actionId: aPlusActionId,
        actionKind: "image",
        requestBody: imageRequestBody,
        requestHash: await hashAPlusExternalActionBody(imageRequestBody)
      };
      ports.assertCurrentSession(context.session);
      if (!await input.onExternalActionIntent({ actionId: aPlusActionId, action })) {
        throw aPlusExternalActionPayloadError(
          "A+ Image Action 身份未能在发送前写入 Recovery Record。",
          "external_action_intent_persistence_failed"
        );
      }
      ports.assertCurrentSession(context.session);
    }

    if (!restoredAction) assertExternalRequestBody(imageRequestBody);
    const independentDeliveryKey = !context.externalAction && typeof window !== "undefined"
      ? await prepareIndependentImageDelivery(context.session.projectId, itemClientRequestId, imageRequestBody,
        imageCommitDraft(context, effectiveItem, itemIndex, referenceImages.sourceObjectIds, ports.now())) : undefined;
    let imageResponse = context.externalAction && aPlusActionId
      ? await postAPlusExternalAction({
          fetch: ports.fetch,
          url: `/api/ai/agent/turns/${encodeURIComponent(context.externalAction.serverTurnId)}/actions/image`,
          actionId: aPlusActionId,
          actionKind: "image",
          requestBody: imageRequestBody,
          restored: restoredAction !== undefined,
          signal: input.signal,
          message: "图像任务请求响应丢失，服务器状态未知；本地只进行同身份查询，不重复生成。"
        })
      : await ports.fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Morpho-Effect-Contract": "1" },
          body: imageRequestBody,
          signal: input.signal
        });
    const materialized = await materializeExternalResultResponse(imageResponse, ports.fetch, async (delivery) => {
      if (aPlusActionId) deliveredAction = { actionId: aPlusActionId, actionKind: "image",
        requestBody: imageRequestBody, requestHash: await hashAPlusExternalActionBody(imageRequestBody), delivery };
    });
    imageResponse = materialized.response;
    const providerTaskId = imageResponse.headers.get("X-Morpho-Provider-Task-Id") || undefined;
    if (providerTaskId) {
      state.lastProviderTaskId = providerTaskId;
    }
    const imageResponseKind = classifyAPlusImageResponse(
      imageResponse.status,
      imageResponse.headers.get("Content-Type")
    );
    if (imageResponseKind === "running") {
      if (!context.externalAction || !aPlusActionId) {
        throw new Error("图像任务仍在执行，但缺少 A+ Action 身份，无法安全恢复。");
      }
      const body: unknown = await imageResponse.json().catch(() => undefined);
      const effect = isWorkspaceRecord(body) && isExternalEffectSnapshot(body.effect) ? body.effect : undefined;
      throw await createAPlusExternalActionRunningError({
        actionId: aPlusActionId,
        actionKind: "image",
        requestBody: imageRequestBody,
        message: "图像任务仍在服务器执行；本地只进行同身份查询，不重复生成。",
        ...(effect ? { externalEffect: effect } : {})
      });
    }
    if (context.externalAction && aPlusActionId && !imageResponse.ok &&
      (imageResponse.headers.get("Content-Type") ?? "").includes("application/json")) {
      const body: unknown = await imageResponse.clone().json().catch(() => undefined);
      if (isWorkspaceRecord(body) && body.deliveryPending === true) {
        throw await createAPlusExternalActionRunningError({ actionId: aPlusActionId,
          actionKind: "image", requestBody: imageRequestBody,
          message: "同一图像结果尚未完成交付；保留原 Action，只查询同一任务。" });
      }
    }
    if (imageResponseKind === "jsonError") {
      throw new Error(await readErrorResponse(imageResponse));
    }
    if (!imageResponse.ok) {
      throw new Error(await readErrorResponse(imageResponse));
    }

    ports.assertCurrentSession(context.session);
    const mimeType = imageResponse.headers.get("Content-Type") ?? "image/png";
    const blob = await imageResponse.blob();
    ports.assertCurrentSession(context.session);
    const file = new File([blob], makeGeneratedImageFileName(mimeType, ports.now()), { type: mimeType });
    const saved = await ports.saveGeneratedAsset(file);
    if (saved.status === "failed") {
      throw new Error(saved.reason);
    }
    provisionalStorageKey = saved.asset.storageKey;
    ports.assertCurrentSession(context.session);

    return {
      status: "ok",
      index: itemIndex,
      item: effectiveItem,
      aPlusActionId,
      delivery: materialized.delivery,
      deliveredAction,
      independentDeliveryKey,
      asset: saved.asset,
      sourceObjectIds: referenceImages.sourceObjectIds,
      providerTaskId
    };
  } catch (itemError) {
    if (provisionalStorageKey && isStaleVisualGenerationExecutionError(itemError)) {
      await deleteProvisionalAsset(provisionalStorageKey, ports);
    }
    if (
      isStaleVisualGenerationExecutionError(itemError) ||
      isAbortError(itemError) ||
      isAPlusExternalActionRunningError(itemError) ||
      isAPlusExternalActionBarrierError(itemError)
    ) {
      throw itemError;
    }
    if (deliveredAction) throw new APlusExternalActionRunningError(deliveredAction,
      "图像已生成，本地保存尚未完成；只取回同一结果。");
    const reason = itemError instanceof Error ? itemError.message : "图像生成失败";
    return { status: "failed", index: itemIndex, item, aPlusActionId, reason };
  } finally {
    state.inFlightCount = Math.max(0, state.inFlightCount - 1);
    state.completedCount += 1;
    try {
      publishVisualGenerationProgress(context, state, input, ports);
    } catch (error) {
      if (!isStaleVisualGenerationExecutionError(error)) {
        throw error;
      }
    }
  }
}

async function applyVisualGenerationItemResult(
  context: VisualGenerationExecutionContext,
  state: VisualGenerationExecutionState,
  result: VisualGenerationItemResult,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<void> {
  if (result.status === "existing") {
    ports.assertCurrentSession(context.session);
    if (!state.createdObjectIds.includes(result.objectId)) {
      state.createdObjectIds.push(result.objectId);
    }
    ports.commitWorkspace(context.session, (current) => {
      const operation = current.operations[context.operationId];
      const knownResultIds = operation?.type === "imageGeneration"
        ? operation.imageGeneration?.resultObjectIds ?? []
        : [];
      return {
        workspace: knownResultIds.includes(result.objectId)
          ? current
          : recordImageGenerationOperationResult(current, {
              operationId: context.operationId,
              resultObjectId: result.objectId
            }),
        value: undefined
      };
    });
  } else if (result.status === "ok") {
    let committedLocally = false;
    try {
      ports.assertCurrentSession(context.session);
      const commitResult = ports.commitWorkspace(context.session, (current) => {
        const draft = imageCommitDraft(context, result.item, result.index, result.sourceObjectIds, ports.now());
        const committed = applyImageGenerationResultCommit(current, {
          ...draft,
          position: getGeneratedImagePlacement(current, result.item, result.index, context.placementMap.get(result.item.id)),
          providerTaskId: result.providerTaskId ?? state.lastProviderTaskId,
          asset: result.asset,
          generation: { ...draft.generation,
            delivery: result.delivery, providerTaskId: result.providerTaskId ?? state.lastProviderTaskId }
        });
        return { workspace: committed.workspace, value: committed };
      });
      committedLocally = true;
      const createdObjectId = commitResult.createdObjectId;
      if (commitResult.reusedExisting && !commitResult.workspace.assets[result.asset.id]) {
        await deleteProvisionalAsset(result.asset.storageKey, ports);
      }
      if (createdObjectId) {
        state.createdObjectIds.push(createdObjectId);
      }
      if (result.delivery) {
        const saved = ports.persistWorkspace?.();
        if (saved?.phase !== "saved" || saved.isDirty) throw new Error("图像已取回，但 Workspace 未能持久保存。");
        await acknowledgePersistedExternalResult(context.session.projectId, result.delivery, ports.fetch);
        if (result.independentDeliveryKey) await completeIndependentImageDelivery(context.session.projectId, result.independentDeliveryKey);
      }
    } catch (error) {
      if (!committedLocally) await deleteProvisionalAsset(result.asset.storageKey, ports);
      if (result.deliveredAction && !isStaleVisualGenerationExecutionError(error)) throw new APlusExternalActionRunningError(result.deliveredAction,
        "图像已生成，本地保存尚未完成；只取回同一结果。");
      throw error;
    }
  } else {
    ports.assertCurrentSession(context.session);
    state.failedItems.push(`${result.item.title}: ${result.reason}`);
    ports.commitWorkspace(context.session, (current) => {
      const committed = applyImageGenerationResultCommit(current, {
        status: "failed",
        operationId: context.operationId,
        planItemId: result.item.id,
        reason: result.reason
      });
      return { workspace: committed.workspace, value: undefined };
    });
  }

  if (result.status === "existing" && result.delivery) {
    const image = context.workspaceAtPlanCommit.objects[result.objectId];
    const asset = image?.type === "image" && image.assetId ? context.workspaceAtPlanCommit.assets[image.assetId] : undefined;
    const bytes = asset ? await ports.readReferenceAsset(asset.storageKey) : null;
    if (!bytes || bytes.size !== result.delivery.byteLength) throw new Error("已保存图像资产缺失，不能确认交付。");
    const hash = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
    const sha = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (sha !== result.delivery.sha256) throw new Error("已保存图像校验失败，不能确认交付。");
    const saved = ports.persistWorkspace?.();
    if (saved?.phase !== "saved" || saved.isDirty) throw new Error("图像 Workspace 未能持久保存。");
    await acknowledgePersistedExternalResult(context.session.projectId, result.delivery, ports.fetch);
  }

  // Remove the placeholder after the durable local result commit. A restored
  // action is consumed only after both of those local effects have succeeded.
  ports.updatePendingImageGenerationSlots(context.session, (current) =>
    removePendingImageGenerationSlot(current, context.operationId, result.item.id)
  );
  if (context.externalAction && result.aPlusActionId) {
    context.restoredActionCursor.consumeAfterLocalCommit(
      context.externalAction.actionId,
      result.aPlusActionId
    );
  }
}

async function deleteProvisionalAsset(
  storageKey: string,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<void> {
  try {
    await ports.deleteAsset(storageKey);
  } catch {
    // Cleanup is best effort; preserve the stale/commit error that stopped the
    // workspace mutation so callers still fail closed.
  }
}

function finalizeVisualGenerationExecution(
  context: VisualGenerationExecutionContext,
  state: VisualGenerationExecutionState,
  ports: WorkspaceVisualGenerationExecutionPorts
): AgentVisualGenerationExecution {
  ports.assertCurrentSession(context.session);
  if (state.createdObjectIds.length === 0) {
    const reason = state.failedItems[0] ?? "所有图像计划项都生成失败了。";
    ports.commitWorkspace(context.session, (current) => {
      const failed = failImageGenerationOperation(current, {
        operationId: context.operationId,
        status: "failed",
        reason,
        providerTaskId: state.lastProviderTaskId
      });
      return { workspace: failed, value: undefined };
    });
    ports.setImageTaskStatus(context.session, { state: "failed", message: reason });
    throw new Error(reason);
  }

  const lastCreatedObjectId = state.createdObjectIds.at(-1) ?? state.createdObjectIds[0];
  const completedWorkspace = ports.commitWorkspace(context.session, (current) => {
    const operation = current.operations[context.operationId];
    const completed = operation?.type === "imageGeneration" && operation.status === "succeeded"
      ? current
      : completeImageGenerationOperation(current, {
          operationId: context.operationId,
          providerTaskId: state.lastProviderTaskId,
          resultObjectId: lastCreatedObjectId
        });
    return { workspace: completed, value: completed };
  });
  ports.selectObjects(context.session, state.createdObjectIds);
  ports.focusObject(context.session, lastCreatedObjectId);
  ports.setImageTaskStatus(context.session, {
    state: "succeeded",
    message:
      state.failedItems.length > 0
        ? `部分完成：已保存 ${state.createdObjectIds.length} 张，失败 ${state.failedItems.length} 项。`
        : `已完成：已保存 ${state.createdObjectIds.length} 张新图像。`
  });

  return {
    workspace: completedWorkspace,
    createdObjectIds: state.createdObjectIds,
    failedItems: state.failedItems
  };
}

function publishVisualGenerationProgress(
  context: VisualGenerationExecutionContext,
  state: VisualGenerationExecutionState,
  input: WorkspaceVisualGenerationPlanInput,
  ports: WorkspaceVisualGenerationExecutionPorts
): void {
  ports.assertCurrentSession(context.session);
  const message = buildImageGenerationProgressMessage({
    total: context.validatedPlan.plan.items.length,
    completed: state.completedCount,
    inFlight: state.inFlightCount,
    concurrency: IMAGE_GENERATION_MAX_CONCURRENCY
  });
  ports.setImageTaskStatus(context.session, {
    state: state.inFlightCount > 0 ? "submitting" : "downloading",
    message
  });
  input.onProgress?.(message);
}

function assertExecutionSession(
  session: WorkspaceVisualGenerationExecutionSession,
  workspaceSnapshot: MorphoWorkspace
): void {
  if (!session.workspaceReady || session.projectId !== workspaceSnapshot.project.id) {
    throw createStaleVisualGenerationExecutionError();
  }
}

function getGeneratedImagePlacement(
  workspace: MorphoWorkspace,
  item: VisualGenerationPlanItem,
  index: number,
  precomputedPosition?: { x: number; y: number }
): { x: number; y: number } {
  if (precomputedPosition) {
    return precomputedPosition;
  }

  const sourceInstance = item.referenceObjectIds
    .map((objectId) => workspace.canvas.instances.find((instance) => instance.objectId === objectId))
    .find(Boolean);
  if (sourceInstance) {
    return {
      x: sourceInstance.position.x + sourceInstance.size.w + 92,
      y: sourceInstance.position.y + index * 34
    };
  }

  const directionInstance = item.targetDirectionId
    ? workspace.canvas.instances.find((instance) => instance.objectId === item.targetDirectionId)
    : undefined;
  if (directionInstance) {
    return {
      x: directionInstance.position.x,
      y: directionInstance.position.y + directionInstance.size.h + 72 + index * 36
    };
  }

  return {
    x: workspace.canvas.view.x + 180 + index * 42,
    y: workspace.canvas.view.y + 180 + index * 42
  };
}

function getPlannedImageSize(aspectRatio: ImageGenerationSettings["aspectRatio"]): { w: number; h: number } {
  const [width, height] = aspectRatio.split(":").map(Number);
  return getImageCanvasSize({
    aspectRatio: width && height ? width / height : undefined
  });
}

function makeGeneratedImageFileName(mimeType: string, now: number): string {
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  return `grs-result-${now}.${extension}`;
}

type PersistedImageInputs = Readonly<{ sourceObjectIds: string[]; imageCount: number; pixelHashes: string[];
  prompt?: string; modelId?: string; aspectRatio?: string; sizeOption?: string;
  lineage?: VisualLineageSnapshot; providerInputs?: VisualProviderInputManifest }>;

function parsePersistedAPlusImageRequestBody(
  requestBody: string
): PersistedImageInputs | undefined {
  try {
    const parsed = JSON.parse(requestBody) as unknown;
    if (!isWorkspaceRecord(parsed) || !isWorkspaceRecord(parsed.input)) return undefined;
    const referenceObjectIds = parsed.input.referenceObjectIds;
    const images = parsed.input.images;
    if (
      !Array.isArray(referenceObjectIds) ||
      !referenceObjectIds.every((value) => typeof value === "string") ||
      !Array.isArray(images) ||
      !images.every((value) => typeof value === "string") ||
      (parsed.input.visualLineage !== undefined && !isVisualLineageSnapshot(parsed.input.visualLineage)) ||
      (parsed.input.visualProviderInputs !== undefined && !isVisualProviderInputManifest(parsed.input.visualProviderInputs))
    ) {
      return undefined;
    }
    return {
      sourceObjectIds: [...referenceObjectIds],
      imageCount: images.length,
      pixelHashes: images.map((image) => hashProviderImageDataUrl(image as string)),
      prompt: typeof parsed.input.prompt === "string" ? parsed.input.prompt : undefined,
      modelId: typeof parsed.input.modelId === "string" ? parsed.input.modelId : undefined,
      aspectRatio: typeof parsed.input.aspectRatio === "string" ? parsed.input.aspectRatio : undefined,
      sizeOption: typeof parsed.input.sizeOption === "string" ? parsed.input.sizeOption : undefined,
      lineage: isVisualLineageSnapshot(parsed.input.visualLineage) ? parsed.input.visualLineage : undefined,
      providerInputs: isVisualProviderInputManifest(parsed.input.visualProviderInputs) ? parsed.input.visualProviderInputs : undefined
    };
  } catch {
    return undefined;
  }
}

function restoreVisualProviderItem(context: VisualGenerationExecutionContext, item: VisualGenerationItem, payload: PersistedImageInputs): VisualGenerationItem {
  const frozen = context.workspaceAtPlanCommit.operations[context.operationId]?.imageGeneration?.materializedItems?.find((entry) => entry.id === item.id);
  const providerInputs = payload.providerInputs ?? frozen?.providerInputs;
  if (providerInputs) {
    const sent = providerInputs.references.filter((entry) => entry.status === "sent");
    if (sent.length !== payload.imageCount || sent.length !== payload.sourceObjectIds.length || sent.some((entry, index) =>
      entry.source.objectId !== payload.sourceObjectIds[index] || entry.pixelHash !== payload.pixelHashes[index])) {
      throw aPlusExternalActionPayloadError("原始图像像素与冻结的实际输入清单不一致。");
    }
  }
  return { ...item, ...frozen, prompt: payload.prompt ?? frozen?.prompt ?? item.prompt,
    referenceObjectIds: providerInputs ? payload.sourceObjectIds : [],
    lineage: payload.lineage ?? frozen?.lineage,
    requestSettings: payload.modelId && payload.aspectRatio ? {
      modelId: payload.modelId, aspectRatio: payload.aspectRatio, sizeOption: payload.sizeOption,
      modelLabel: payload.modelId === context.generationSettings.modelId ? context.generationSettings.modelLabel : payload.modelId
    } : undefined,
    providerInputs, editMode: payload.imageCount ? frozen?.editMode ?? item.editMode ?? "imageToImage" : "textToImage" };
}

function aPlusExternalActionPayloadError(
  message: string,
  code = "external_action_request_payload_unavailable"
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isAPlusExternalActionBarrierError(value: unknown): boolean {
  return isWorkspaceRecord(value) && (
    value.code === "external_action_request_payload_unavailable" ||
    value.code === "external_action_intent_persistence_failed" ||
    value.code === "external_action_intent_persistence_unavailable"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isWorkspaceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageCommitDraft(context: VisualGenerationExecutionContext, item: VisualGenerationItem, index: number, sourceObjectIds: string[], now: number): Omit<Extract<import("./imageGenerationResultCommit").ImageGenerationResultCommit, { status: "succeeded" }>, "asset"> {
  return {
          status: "succeeded",
          operationId: context.operationId,
          generation: {
            modelId: item.requestSettings?.modelId ?? context.generationSettings.modelId,
            modelLabel: item.requestSettings?.modelLabel ?? context.generationSettings.modelLabel,
            aspectRatio: item.requestSettings?.aspectRatio ?? context.generationSettings.aspectRatio,
            sizeOption: item.requestSettings ? item.requestSettings.sizeOption : context.generationSettings.sizeOption,
            prompt: item.prompt,
            compiledPrompt: item.prompt,
            promptContractVersion: item.promptContractVersion,
            editMode: item.editMode,
            lineage: item.lineage,
            providerInputs: item.providerInputs,
            referenceObjectIds: item.referenceObjectIds,
            referenceResolution: item.referenceResolution,
            directionId: item.targetDirectionId,
            visualBranchId: item.visualBranchId,
            operationId: context.operationId,
            clientRequestId: `${context.clientRequestId}-${item.id}`,
            title: item.title,
            purpose: item.purpose,
            role: item.role,
            visualIntent: item.visualIntent,
            visualPlan: context.validatedPlan.plan,
            createdAt: new Date(now).toISOString()
          },
          sourceObjectIds: sourceObjectIds,
          directionObjectId: item.targetDirectionId,
          visualBranchId: item.visualBranchId,
          title: item.title,
          summary: item.lineage ? `生成目的（计划）：${item.purpose}` : item.purpose,
          role: item.role,
          position: getGeneratedImagePlacement(
            context.workspaceAtPlanCommit,
            item,
            index,
            context.placementMap.get(item.id)
          ),
          canvasSize: context.plannedImageSize
  };
}
