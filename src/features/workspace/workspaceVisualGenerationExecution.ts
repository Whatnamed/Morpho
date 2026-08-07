import type { AssetRecord, MorphoWorkspace } from "@/domain/morpho/types";
import { GRS_REFERENCE_IMAGE_LIMIT } from "@/domain/morpho/imageLimits";
import { getImageCanvasSize } from "@/domain/morpho/imageSizing";
import {
  completeImageGenerationOperation,
  createImageGenerationOperation,
  failImageGenerationOperation,
  markImageGenerationOperationSubmitted,
  recordImageGenerationPlan,
  recordImageGenerationOperationResult
} from "@/domain/operations/operations";
import type { VisualGenerationPlanItem } from "@/domain/operations/types";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type {
  APlusExternalActionDescriptor,
  APlusRestoredImageActionDescriptor
} from "./agentExternalActionClientAPlus";
import {
  buildAPlusImageBatchIdentity,
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

export type WorkspaceVisualGenerationExecutionPorts = {
  fetch: typeof fetch;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  updateWorkspace: (update: (current: MorphoWorkspace) => MorphoWorkspace) => void;
  updatePendingImageGenerationSlots: (
    update: (current: PendingImageGenerationSlot[]) => PendingImageGenerationSlot[]
  ) => void;
  setImageTaskStatus: (status: ImageTaskStatus | null) => void;
  saveGeneratedAsset: (file: File) => Promise<SaveLocalAssetResult>;
  readReferenceAsset: (storageKey: string) => Promise<Blob | null>;
  selectObjects: (objectIds: string[]) => void;
  focusObject: (objectId: string) => void;
  now: () => number;
  randomSuffix: () => string;
};

export type WorkspaceVisualGenerationPlanInput = Parameters<ExecuteAgentVisualGenerationPlan>[0];

export async function executeWorkspaceVisualGenerationPlan(
  input: WorkspaceVisualGenerationPlanInput,
  effectiveImageGenerationSettings: ImageGenerationSettings,
  ports: WorkspaceVisualGenerationExecutionPorts
): Promise<AgentVisualGenerationExecution> {
  const requestedGenerationCount =
    input.plan.kind === "directionPreview"
      ? input.requestedPreviewCount ?? 1
      : input.plan.items.length;
  const validatedPlan = validateVisualGenerationPlan(input.workspaceSnapshot, {
    plan: input.plan,
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
  const operationId = aPlusBatchIdentity?.operationId ??
    `operation-image-${ports.now()}-${ports.randomSuffix()}`;
  const clientRequestId = aPlusBatchIdentity?.clientRequestId ??
    `client-image-${ports.now()}-${ports.randomSuffix()}`;
  const generationSettings = resolveImageGenerationSettingsForVisualIntent({
    intent: input.plan.kind === "directionPreview" ? "directionPreview" : "visualDevelopment",
    aspectRatio: effectiveImageGenerationSettings.aspectRatio
  });
  const workspaceAtPlanCommit = ports.commitWorkspace((current) => {
    const existingOperation = aPlusBatchIdentity ? current.operations[operationId] : undefined;
    if (existingOperation && existingOperation.type !== "imageGeneration") {
      throw new Error("A+ 图像 Operation ID 与现有非图像 Operation 冲突。");
    }
    const existingPlan = existingOperation?.imageGeneration?.plan;
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
  ports.updatePendingImageGenerationSlots((current) => [
    ...current.filter((slot) => slot.operationId !== operationId),
    ...buildPendingImageGenerationSlots({
      operationId,
      items: validatedPlan.plan.items,
      placements: placementMap,
      size: plannedImageSize
    })
  ]);

  let lastProviderTaskId: string | undefined;
  const createdObjectIds: string[] = [];
  const failedItems: string[] = [];
  const restoredActionCursor = createAPlusImageRestoredActionCursor(input.restoredExternalAction);
  const totalItems = validatedPlan.plan.items.length;
  let completedCount = 0;
  let inFlightCount = 0;
  const publishProgress = () => {
    const message = buildImageGenerationProgressMessage({
      total: totalItems,
      completed: completedCount,
      inFlight: inFlightCount,
      concurrency: IMAGE_GENERATION_MAX_CONCURRENCY
    });
    ports.setImageTaskStatus({
      state: inFlightCount > 0 ? "submitting" : "downloading",
      message
    });
    input.onProgress?.(message);
  };

  type AgentItemResult = Readonly<{ aPlusActionId?: string }> & (
    | {
        status: "existing";
        index: number;
        item: (typeof validatedPlan.plan.items)[number];
        objectId: string;
      }
    | {
        status: "ok";
        index: number;
        item: (typeof validatedPlan.plan.items)[number];
        asset: AssetRecord;
        sourceObjectIds: string[];
        providerTaskId?: string;
      }
    | {
        status: "failed";
        index: number;
        item: (typeof validatedPlan.plan.items)[number];
        reason: string;
      }
  );

  const applyAgentItemResult = async (result: AgentItemResult) => {
    if (result.status === "existing") {
      if (!createdObjectIds.includes(result.objectId)) createdObjectIds.push(result.objectId);
      ports.commitWorkspace((current) => {
        const operation = current.operations[operationId];
        const knownResultIds = operation?.type === "imageGeneration"
          ? operation.imageGeneration?.resultObjectIds ?? []
          : [];
        return {
          workspace: knownResultIds.includes(result.objectId)
            ? current
            : recordImageGenerationOperationResult(current, {
                operationId,
                resultObjectId: result.objectId
              }),
          value: undefined
        };
      });
    } else if (result.status === "ok") {
      const createdObjectId = ports.commitWorkspace((current) => {
        const committed = applyImageGenerationResultCommit(current, {
          status: "succeeded",
          operationId,
          providerTaskId: result.providerTaskId ?? lastProviderTaskId,
          asset: result.asset,
          generation: {
            modelId: generationSettings.modelId,
            modelLabel: generationSettings.modelLabel,
            aspectRatio: generationSettings.aspectRatio,
            sizeOption: generationSettings.sizeOption,
            prompt: result.item.prompt,
            compiledPrompt: result.item.prompt,
            promptContractVersion: result.item.promptContractVersion,
            editMode: result.item.editMode,
            referenceObjectIds: result.item.referenceObjectIds,
            referenceResolution: result.item.referenceResolution,
            directionId: result.item.targetDirectionId,
            visualBranchId: result.item.visualBranchId,
            operationId,
            clientRequestId: `${clientRequestId}-${result.item.id}`,
            providerTaskId: result.providerTaskId ?? lastProviderTaskId,
            title: result.item.title,
            purpose: result.item.purpose,
            role: result.item.role,
            visualIntent: result.item.visualIntent,
            visualPlan: validatedPlan.plan,
            createdAt: new Date().toISOString()
          },
          sourceObjectIds: result.sourceObjectIds,
          directionObjectId: result.item.targetDirectionId,
          visualBranchId: result.item.visualBranchId,
          title: result.item.title,
          summary: result.item.purpose,
          role: result.item.role,
          position: getGeneratedImagePlacement(
            current,
            result.item,
            result.index,
            placementMap.get(result.item.id)
          ),
          canvasSize: plannedImageSize
        });
        return { workspace: committed.workspace, value: committed.createdObjectId };
      });
      if (createdObjectId) {
        createdObjectIds.push(createdObjectId);
      }
    } else {
      failedItems.push(`${result.item.title}: ${result.reason}`);
      ports.commitWorkspace((current) => {
        const committed = applyImageGenerationResultCommit(current, {
          status: "failed",
          operationId,
          planItemId: result.item.id,
          reason: result.reason
        });
        return { workspace: committed.workspace, value: undefined };
      });
    }

    // The pending shape effect runs before workspace shape sync, so this
    // removes the matching placeholder before its image object is created.
    ports.updatePendingImageGenerationSlots((current) =>
      removePendingImageGenerationSlot(current, operationId, result.item.id)
    );
    if (input.aPlusExternalAction && result.aPlusActionId) {
      restoredActionCursor.consumeAfterLocalCommit(
        input.aPlusExternalAction.actionId,
        result.aPlusActionId
      );
    }
  };

  try {
    await mapWithConcurrency(
      validatedPlan.plan.items,
      input.aPlusExternalAction ? 1 : IMAGE_GENERATION_MAX_CONCURRENCY,
      async (item, itemIndex): Promise<AgentItemResult> => {
        const itemClientRequestId = `${clientRequestId}-${item.id}`;
        const aPlusActionId = input.aPlusExternalAction
          ? await buildAPlusImageChildActionId(input.aPlusExternalAction.actionId, item.id)
          : undefined;
        const existingObjectId = input.aPlusExternalAction
          ? findAPlusImageResultObjectId(workspaceAtPlanCommit, itemClientRequestId)
          : undefined;
        if (existingObjectId) {
          completedCount += 1;
          publishProgress();
          return {
            status: "existing",
            index: itemIndex,
            item,
            aPlusActionId,
            objectId: existingObjectId
          };
        }
        inFlightCount += 1;
        publishProgress();
        try {
          const restoredAction = input.aPlusExternalAction && aPlusActionId
            ? restoredActionCursor.match(input.aPlusExternalAction.actionId, aPlusActionId)
            : undefined;
          if (restoredActionCursor.hasPending() && !restoredAction) {
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
          const referenceImages = restoredImagePayload
            ? { images: [], sourceObjectIds: restoredImagePayload.sourceObjectIds }
            : await collectImageReferenceDataUrls(
                workspaceAtPlanCommit,
                item.referenceObjectIds,
                input.signal,
                ports.readReferenceAsset
              );
          ports.updateWorkspace((current) =>
            markImageGenerationOperationSubmitted(current, {
              operationId,
              referenceObjectIds: item.referenceObjectIds,
              imagePixels: restoredImagePayload
                ? restoredImagePayload.imageCount > 0
                : referenceImages.images.length > 0
            })
          );

          const imageInput = {
            modelId: generationSettings.modelId,
            prompt: item.prompt,
            images: referenceImages.images,
            aspectRatio: generationSettings.aspectRatio,
            sizeOption: generationSettings.sizeOption,
            referenceObjectIds: item.referenceObjectIds,
            directionObjectId: item.targetDirectionId,
            visualBranchId: item.visualBranchId,
            operationId,
            clientRequestId: itemClientRequestId
          };
          const imageRequestBody = restoredAction
            ? restoredAction.requestBody
            : JSON.stringify(input.aPlusExternalAction && aPlusActionId
                ? {
                    localProjectId: input.aPlusExternalAction.localProjectId,
                    requestId: input.aPlusExternalAction.requestId,
                    stepSequence: input.aPlusExternalAction.stepSequence,
                    actionId: aPlusActionId,
                    claimCallId: input.aPlusExternalAction.actionId,
                    input: imageInput
                  }
                : imageInput);
          if (input.aPlusExternalAction && aPlusActionId && !restoredAction && input.onExternalActionIntent) {
            const action: APlusExternalActionDescriptor = {
              actionId: aPlusActionId,
              actionKind: "image",
              requestBody: imageRequestBody,
              requestHash: await hashAPlusExternalActionBody(imageRequestBody)
            };
            if (!await input.onExternalActionIntent({ actionId: aPlusActionId, action })) {
              throw aPlusExternalActionPayloadError(
                "A+ Image Action 身份未能在发送前写入 Recovery Record。",
                "external_action_intent_persistence_failed"
              );
            }
          }
          const imageResponse = input.aPlusExternalAction && aPlusActionId
            ? await postAPlusExternalAction({
                fetch: ports.fetch,
                url: `/api/ai/agent/turns/${encodeURIComponent(input.aPlusExternalAction.serverTurnId)}/actions/image`,
                actionId: aPlusActionId,
                actionKind: "image",
                requestBody: imageRequestBody,
                signal: input.signal,
                message: "图像任务请求响应丢失，服务器状态未知；本地只进行同身份查询，不重复生成。"
              })
            : await ports.fetch("/api/ai/image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: imageRequestBody,
                signal: input.signal
              });
          const providerTaskId = imageResponse.headers.get("X-Morpho-Provider-Task-Id") || undefined;
          if (providerTaskId) {
            lastProviderTaskId = providerTaskId;
          }
          const imageResponseKind = classifyAPlusImageResponse(
            imageResponse.status,
            imageResponse.headers.get("Content-Type")
          );
          if (imageResponseKind === "running") {
            if (!input.aPlusExternalAction || !aPlusActionId) {
              throw new Error("图像任务仍在执行，但缺少 A+ Action 身份，无法安全恢复。");
            }
            throw await createAPlusExternalActionRunningError({
              actionId: aPlusActionId,
              actionKind: "image",
              requestBody: imageRequestBody,
              message: "图像任务仍在服务器执行；本地只进行同身份查询，不重复生成。"
            });
          }
          if (imageResponseKind === "jsonError") {
            throw new Error(await readErrorResponse(imageResponse));
          }
          if (!imageResponse.ok) {
            throw new Error(await readErrorResponse(imageResponse));
          }

          const mimeType = imageResponse.headers.get("Content-Type") ?? "image/png";
          const blob = await imageResponse.blob();
          const file = new File([blob], makeGeneratedImageFileName(mimeType, ports.now()), { type: mimeType });
          const saved = await ports.saveGeneratedAsset(file);
          if (saved.status === "failed") {
            throw new Error(saved.reason);
          }

          return {
            status: "ok",
            index: itemIndex,
            item,
            aPlusActionId,
            asset: saved.asset,
            sourceObjectIds: referenceImages.sourceObjectIds,
            providerTaskId
          };
        } catch (itemError) {
          if (isAbortError(itemError)) {
            throw itemError;
          }
          if (isAPlusExternalActionRunningError(itemError)) {
            throw itemError;
          }
          if (isAPlusExternalActionBarrierError(itemError)) {
            throw itemError;
          }
          const reason = itemError instanceof Error ? itemError.message : "图像生成失败";
          return { status: "failed", index: itemIndex, item, aPlusActionId, reason };
        } finally {
          inFlightCount = Math.max(0, inFlightCount - 1);
          completedCount += 1;
          publishProgress();
        }
      },
      { onSettled: applyAgentItemResult }
    );
  } catch (error) {
    const isCancelled = isAbortError(error);
    const isExternalActionRunning = isAPlusExternalActionRunningError(error);
    const reason = isCancelled
      ? "图像任务已取消。原输入、来源对象和已有结果已保留。"
      : error instanceof Error
        ? error.message
        : "图像任务失败。";
    if (!isExternalActionRunning) {
      ports.commitWorkspace((current) => {
        const failed = failImageGenerationOperation(current, {
          operationId,
          status: isCancelled ? "cancelled" : "failed",
          reason,
          providerTaskId: lastProviderTaskId
        });
        return { workspace: failed, value: undefined };
      });
      ports.setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message: reason });
    } else {
      ports.setImageTaskStatus({ state: "waiting", message: reason });
    }
    throw error;
  } finally {
    ports.updatePendingImageGenerationSlots((current) =>
      current.filter((slot) => slot.operationId !== operationId)
    );
  }

  if (createdObjectIds.length === 0) {
    const reason = failedItems[0] ?? "所有图像计划项都生成失败了。";
    ports.commitWorkspace((current) => {
      const failed = failImageGenerationOperation(current, {
        operationId,
        status: "failed",
        reason,
        providerTaskId: lastProviderTaskId
      });
      return { workspace: failed, value: undefined };
    });
    ports.setImageTaskStatus({ state: "failed", message: reason });
    throw new Error(reason);
  }

  const lastCreatedObjectId = createdObjectIds.at(-1) ?? createdObjectIds[0];
  const completedWorkspace = ports.commitWorkspace((current) => {
    const operation = current.operations[operationId];
    const completed = operation?.type === "imageGeneration" && operation.status === "succeeded"
      ? current
      : completeImageGenerationOperation(current, {
          operationId,
          providerTaskId: lastProviderTaskId,
          resultObjectId: lastCreatedObjectId
        });
    return { workspace: completed, value: completed };
  });
  ports.selectObjects(createdObjectIds);
  ports.focusObject(lastCreatedObjectId);
  ports.setImageTaskStatus({
    state: "succeeded",
    message:
      failedItems.length > 0
        ? `部分完成：已保存 ${createdObjectIds.length} 张，失败 ${failedItems.length} 项。`
        : `已完成：已保存 ${createdObjectIds.length} 张新图像。`
  });

  return {
    workspace: completedWorkspace,
    createdObjectIds,
    failedItems
  };
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

async function collectImageReferenceDataUrls(
  workspace: MorphoWorkspace,
  objectIds: string[],
  signal: AbortSignal,
  readReferenceAsset: (storageKey: string) => Promise<Blob | null>
): Promise<{
  images: string[];
  sourceObjectIds: string[];
  missingPixelObjectIds: string[];
}> {
  const sourceObjectIds: string[] = [];
  const missingPixelObjectIds: string[] = [];
  const images: string[] = [];

  for (const objectId of objectIds) {
    if (signal.aborted || images.length >= GRS_REFERENCE_IMAGE_LIMIT) {
      break;
    }

    const object = workspace.objects[objectId];
    if (!object || object.type !== "image" || object.visibility !== "active") {
      continue;
    }

    if (!sourceObjectIds.includes(object.id)) {
      sourceObjectIds.push(object.id);
    }

    if (!object.assetId) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    const asset = workspace.assets[object.assetId];
    if (!asset) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    const blob = await readReferenceAsset(asset.storageKey);
    if (!blob) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    images.push(await blobToDataUrl(blob));
  }

  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return { images, sourceObjectIds, missingPixelObjectIds };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片参考转换失败。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片参考读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function makeGeneratedImageFileName(mimeType: string, now: number): string {
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  return `grs-result-${now}.${extension}`;
}

function parsePersistedAPlusImageRequestBody(
  requestBody: string
): Readonly<{ sourceObjectIds: string[]; imageCount: number }> | undefined {
  try {
    const parsed = JSON.parse(requestBody) as unknown;
    if (!isWorkspaceRecord(parsed) || !isWorkspaceRecord(parsed.input)) return undefined;
    const referenceObjectIds = parsed.input.referenceObjectIds;
    const images = parsed.input.images;
    if (
      !Array.isArray(referenceObjectIds) ||
      !referenceObjectIds.every((value) => typeof value === "string") ||
      !Array.isArray(images) ||
      !images.every((value) => typeof value === "string")
    ) {
      return undefined;
    }
    return {
      sourceObjectIds: [...referenceObjectIds],
      imageCount: images.length
    };
  } catch {
    return undefined;
  }
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
    value.code === "external_action_intent_persistence_failed"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isWorkspaceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
