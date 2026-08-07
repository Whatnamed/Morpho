"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  isAssignableKeyConclusionCategory,
  type AiTaskMode,
  type MorphoWorkspace
} from "@/domain/morpho/types";
import {
  applyDesignDefinitionProposal,
  canStartOperation,
  createArtifactProposalOperation,
  createResearchOperation,
  recordAndApplyConceptDirectionProposal,
  recordDesignDefinitionProposal
} from "@/domain/operations/operations";
import { normalizeResearchItems } from "@/domain/operations/researchItems";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import {
  createKeyConclusion,
  deleteObject,
  collectDefaultReferenceReviewTargets,
  setDefaultReference
} from "@/domain/morpho/workspace";
import {
  applyComparisonAnalysis,
  buildComparisonAuthorization,
  validateComparisonAnalysis
} from "@/domain/morpho/comparisonAnalysis";
import { buildTaskContext } from "./taskContext";
import {
  applyResearchProposalWithSemanticPatch
} from "./researchSemanticPatch";
import {
  constrainResearchEvidence
} from "./researchExtraction";
import {
  getPlacementNearObjects,
  getProposalPlacement,
  getSiblingProposalPlacement
} from "./proposalDraftPlacement";
import { getDesignDefinitionDrafts } from "./morphoAgent";
import type { ExecuteAgentVisualGenerationPlan } from "./agentToolExecutors";
import type { ImageTaskStatus } from "./workspaceVisualGenerationExecution";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
import {
  getPendingConfirmationOrigin,
  isAgentPendingConfirmation,
  isComparisonPendingConfirmation
} from "./workspaceConfirmation";
import { applyRequestedAgentAction, appendAiAssistantFailureMessage, appendAiAssistantNotice } from "./agentConfirmationExecution";

type ImageTaskStatusUpdate = ImageTaskStatus | null | ((current: ImageTaskStatus | null) => ImageTaskStatus | null);

type LocalAbortableTask = {
  controller: AbortController;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type WorkspaceConfirmationExecutionResult =
  | { status: "ready" }
  | { status: "blocked"; reason: string };

type CommitResult =
  | {
      status: "applied";
      selectionObjectIds?: string[];
      focusObjectId?: string;
      removedObjectId?: string;
      notice?: string;
      clearDraft?: boolean;
      taskMode?: AiTaskMode;
    }
  | { status: "blocked"; reason: string }
  | { status: "stale" };

type AppliedConfirmationResult = Exclude<CommitResult, { status: "stale" }>;

export type UseWorkspaceConfirmationExecutionControllerInput = Readonly<{
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  pendingConfirmation: PendingAiConfirmation | null;
  ownsPendingConfirmation: (expected: PendingAiConfirmation) => boolean;
  updatePendingConfirmation: (
    updater: (current: PendingAiConfirmation) => PendingAiConfirmation,
    expected?: PendingAiConfirmation
  ) => boolean;
  clearPendingConfirmation: (expected?: PendingAiConfirmation) => boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  pushUndoSnapshot: () => void;
  setSelectedObjectIds: Dispatch<SetStateAction<string[]>>;
  setLocalEditObjectId: Dispatch<SetStateAction<string | null>>;
  setAiDraft: (draft: string) => void;
  setTaskMode: (taskMode: AiTaskMode) => void;
  showNotice: (message: string) => void;
  requestObjectFocus: (objectId: string) => void;
  setImageTaskStatus: (update: ImageTaskStatusUpdate) => void;
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
  beginLocalAbortableTask: () => LocalAbortableTask | null;
  finishLocalAbortableTask: (controller: AbortController) => void;
  acknowledgePendingConfirmation: () => Promise<boolean>;
}>;

export type WorkspaceConfirmationExecutionController = Readonly<{
  confirm: () => Promise<void>;
  confirmWithReviewMarks: () => Promise<void>;
  cancel: () => Promise<void>;
  updatePendingKeyConclusion: (
    patch: Partial<Extract<PendingAiConfirmation, { kind: "createKeyConclusion" }>>
  ) => void;
}>;

export function useWorkspaceConfirmationExecutionController(
  input: UseWorkspaceConfirmationExecutionControllerInput
): WorkspaceConfirmationExecutionController {
  const session = useMemo(
    () => ({ projectId: input.projectId, workspaceReady: input.workspaceReady, generation: Symbol("confirmation-execution") }),
    [input.projectId, input.workspaceReady]
  );
  const currentSessionRef = useRef(session);
  const latestWorkspaceRef = useRef(input.workspace);
  const resolvingConfirmationRef = useRef<PendingAiConfirmation | null>(null);

  useLayoutEffect(() => {
    latestWorkspaceRef.current = input.workspace;
    currentSessionRef.current = session;
  }, [input.workspace, session]);

  const isCurrentSession = useCallback((): boolean => {
    const current = currentSessionRef.current;
    return current === session && current.workspaceReady && latestWorkspaceRef.current.project.id === session.projectId;
  }, [session]);

  const preflight = useCallback((workspace: MorphoWorkspace, confirmation: PendingAiConfirmation): WorkspaceConfirmationExecutionResult => {
    switch (confirmation.kind) {
      case "setDefaultReference":
        return preflightDefaultReference(workspace, confirmation);
      case "createKeyConclusion":
        if (!confirmation.category || !isAssignableKeyConclusionCategory(confirmation.category)) {
          return { status: "blocked", reason: "请选择关键结论类别后再保存。" };
        }
        return preflightBoundObjects(workspace, confirmation.sourceObjectIds, "关键结论来源已不可用，请重新发起确认。");
      case "deleteObject":
        return preflightBoundObjects(workspace, [confirmation.targetObjectId], "待删除对象已不可用，请重新发起确认。");
      case "batchGenerateVisuals":
        return preflightVisualPlan(workspace, confirmation.plan, confirmation.sourceObjectIds, confirmation.selectedDirectionIds, confirmation.selectedImageIds);
      case "agentCreateResearchAnalysis":
        return preflightAgentOperation(workspace, confirmation.sourceObjectIds);
      case "agentCreateDesignDefinitionProposal":
        return preflightAgentOperation(workspace, confirmation.sourceObjectIds, confirmation.basedOnDesignDefinitionId, confirmation.basedOnRevisionId);
      case "agentCreateConceptDirectionProposal":
        return preflightAgentOperation(workspace, confirmation.sourceObjectIds, confirmation.basedOnDesignDefinitionId, confirmation.basedOnRevisionId);
      case "agentCreateComparisonAnalysis": {
        const sources = preflightBoundObjects(workspace, confirmation.selectedObjectIds, "Compare 来源已变化，请重新发起确认。");
        if (sources.status !== "ready") return sources;
        const authorization = buildComparisonAuthorization({
          workspace,
          selectedObjectIds: confirmation.selectedObjectIds,
          userMessageId: confirmation.userMessageId,
          assistantMessageId: confirmation.assistantMessageId,
          createdAt: new Date().toISOString(),
          comparisonGoal: confirmation.args.comparisonGoal,
          imageAttachmentObjectIds: confirmation.imageAttachmentObjectIds,
          documentExtractObjectIds: confirmation.documentExtractObjectIds,
          documentFragmentExtractObjectIds: confirmation.documentFragmentExtractObjectIds
        });
        if (!("authorization" in authorization)) {
          return { status: "blocked", reason: authorization.status === "blocked" ? authorization.reason : "Compare authorization 不再有效，请重新发起确认。" };
        }
        const validation = validateComparisonAnalysis(confirmation.args, authorization.authorization);
        return validation.status === "ok"
          ? { status: "ready" }
          : { status: "blocked", reason: validation.reason };
      }
      case "agentGenerateVisuals":
        return preflightVisualPlan(workspace, confirmation.plan, confirmation.sourceObjectIds, confirmation.selectedDirectionIds, confirmation.selectedImageIds);
      case "agentRequestedAction":
        return preflightRequestedAgentAction(workspace, confirmation, preflightVisualPlan);
      case "compareSetPrimary":
      case "compareSetAlternative":
      case "compareEliminate":
      case "compareRestoreAlternative":
      case "compareSetDefaultReference":
      case "compareClearDefaultReference":
      case "compareCreateKeyConclusion":
        return { status: "blocked", reason: "Compare 决策由 Compare controller 处理。" };
    }
  }, []);

  const commitSynchronous = useCallback(
    (confirmation: PendingAiConfirmation): CommitResult =>
      input.commitWorkspace<CommitResult>((current) => {
        if (!isCurrentSession() || !input.ownsPendingConfirmation(confirmation) || current.project.id !== session.projectId) {
          return { workspace: current, value: { status: "stale" } };
        }
        const currentPreflight = preflight(current, confirmation);
        if (currentPreflight.status !== "ready") {
          return { workspace: current, value: { status: "blocked", reason: currentPreflight.reason } };
        }
        const applied = applyConfirmation(current, confirmation, input);
        return { workspace: applied.workspace, value: applied.result };
      }),
    [input, isCurrentSession, preflight, session.projectId]
  );

  const clearAfterStale = useCallback((confirmation: PendingAiConfirmation, reason: string): void => {
    if (isCurrentSession() && input.ownsPendingConfirmation(confirmation)) {
      input.clearPendingConfirmation(confirmation);
      input.showNotice(reason);
    }
  }, [input, isCurrentSession]);

  const executeVisual = useCallback(async (
    confirmation: Extract<PendingAiConfirmation, { kind: "batchGenerateVisuals" | "agentGenerateVisuals" | "agentRequestedAction" }>,
    task: LocalAbortableTask
  ): Promise<void> => {
    const plan = confirmation.kind === "agentRequestedAction" ? confirmation.visualPlan : confirmation.plan;
    if (!plan) {
      input.showNotice("缺少可执行的视觉生成计划，未改变项目状态。");
      return;
    }
    input.setImageTaskStatus({
      state: "preparing",
      message: `正在批量生成 ${plan.items.length} 张图像`
    });
    try {
      const currentWorkspace = input.readWorkspace();
      const result = await input.executeVisualGenerationPlan({
        workspaceSnapshot: currentWorkspace,
        draft: confirmation.draft,
        plan,
        sourceObjectIds: confirmation.sourceObjectIds,
        selectedDirectionIds: confirmation.selectedDirectionIds,
        selectedImageIds: confirmation.selectedImageIds,
        signal: task.signal
      });
      if (!task.isCurrent() || !isCurrentSession()) return;
      input.commitWorkspace((current) => ({
        workspace: appendAiAssistantNotice(
          current,
          "agent-confirm-visuals",
          result.failedItems.length > 0
            ? `已按确认生成并保存 ${result.createdObjectIds.length} 张新图像，另有 ${result.failedItems.length} 项失败。`
            : `已按确认生成并保存 ${result.createdObjectIds.length} 张新图像。`
        ),
        value: undefined
      }));
    } catch (error) {
      if (!task.isCurrent() || !isCurrentSession()) return;
      const isCancelled = error instanceof DOMException && error.name === "AbortError";
      const message = isCancelled
        ? "批量图像生成已取消。"
        : error instanceof Error
          ? error.message
          : "批量图像生成失败。";
      input.setAiDraft(confirmation.draft);
      input.setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message });
      input.commitWorkspace((current) => ({
        workspace: appendAiAssistantFailureMessage(current, "agent-confirm-visuals", message),
        value: undefined
      }));
    } finally {
      input.finishLocalAbortableTask(task.controller);
    }
  }, [input, isCurrentSession]);

  const confirm = useCallback(async (): Promise<void> => {
    const confirmation = input.pendingConfirmation;
    if (
      !confirmation ||
      isComparisonPendingConfirmation(confirmation) ||
      resolvingConfirmationRef.current !== null ||
      !isCurrentSession() ||
      !input.ownsPendingConfirmation(confirmation)
    ) {
      return;
    }
    resolvingConfirmationRef.current = confirmation;
    let task: LocalAbortableTask | null = null;
    try {
      const initialPreflight = preflight(input.readWorkspace(), confirmation);
      if (initialPreflight.status !== "ready") {
        input.showNotice(initialPreflight.reason);
        return;
      }

      const origin = getPendingConfirmationOrigin(confirmation);
      const isVisual = isVisualConfirmation(confirmation);
      if (origin === "agent" && isVisual) {
        task = input.beginLocalAbortableTask();
        if (!task) {
          input.showNotice("当前图像任务资源不可用，请稍后重新确认。");
          return;
        }
      }

      if (origin === "agent") {
        const acknowledged = await input.acknowledgePendingConfirmation();
        if (!acknowledged) {
          input.showNotice("A+ 确认状态未成功确认，未改变项目状态。请稍后重试。");
          return;
        }
      }

      if (!isCurrentSession() || !input.ownsPendingConfirmation(confirmation)) {
        return;
      }
      const afterAckPreflight = preflight(input.readWorkspace(), confirmation);
      if (afterAckPreflight.status !== "ready") {
        clearAfterStale(confirmation, `${afterAckPreflight.reason} 已清除旧确认，请重新发起。`);
        return;
      }

      if (isVisual) {
        if (!task) {
          task = input.beginLocalAbortableTask();
          if (!task) {
            clearAfterStale(confirmation, "当前图像任务资源不可用，已清除旧确认，请重新发起。");
            return;
          }
        }
        input.clearPendingConfirmation(confirmation);
        input.setAiDraft("");
        await executeVisual(confirmation, task);
        task = null;
        return;
      }

      if (shouldPushUndo(confirmation)) {
        input.pushUndoSnapshot();
      }
      const result = commitSynchronous(confirmation);
      if (result.status === "stale") return;
      if (result.status === "blocked") {
        clearAfterStale(confirmation, `${result.reason} 已清除旧确认，请重新发起。`);
        return;
      }

      input.clearPendingConfirmation(confirmation);
      if (result.selectionObjectIds) input.setSelectedObjectIds(result.selectionObjectIds);
      if (result.removedObjectId) {
        input.setSelectedObjectIds((current) => current.filter((objectId) => objectId !== result.removedObjectId));
        input.setLocalEditObjectId((current) => current === result.removedObjectId ? null : current);
      }
      if (result.focusObjectId) input.requestObjectFocus(result.focusObjectId);
      if (result.clearDraft !== false) input.setAiDraft("");
      if (result.taskMode) input.setTaskMode(result.taskMode);
      if (result.notice) input.showNotice(result.notice);
    } finally {
      resolvingConfirmationRef.current = null;
      if (task) input.finishLocalAbortableTask(task.controller);
    }
  }, [clearAfterStale, commitSynchronous, executeVisual, input, isCurrentSession, preflight]);

  const confirmWithReviewMarks = useCallback(async (): Promise<void> => {
    const confirmation = input.pendingConfirmation;
    if (
      !confirmation ||
      confirmation.kind !== "setDefaultReference" ||
      resolvingConfirmationRef.current !== null ||
      !isCurrentSession() ||
      !input.ownsPendingConfirmation(confirmation)
    ) return;

    resolvingConfirmationRef.current = confirmation;
    try {
      const before = preflight(input.readWorkspace(), confirmation);
      if (before.status !== "ready") {
        input.showNotice(before.reason);
        return;
      }
      if (!isCurrentSession() || !input.ownsPendingConfirmation(confirmation)) return;
      input.pushUndoSnapshot();
      const result = input.commitWorkspace<CommitResult>((current) => {
        if (!isCurrentSession() || !input.ownsPendingConfirmation(confirmation)) {
          return { workspace: current, value: { status: "stale" } };
        }
        const currentPreflight = preflight(current, confirmation);
        if (currentPreflight.status !== "ready") {
          return { workspace: current, value: { status: "blocked", reason: currentPreflight.reason } };
        }
        return {
          workspace: setDefaultReference(current, confirmation.targetObjectId, {
            reason: "用户在默认参考确认卡中选择替换默认参考，并标记直接延展素材待复核。",
            markReplacedDerivativesForReview: true
          }),
          value: {
            status: "applied",
            notice: `已替换默认参考为「${confirmation.targetTitle}」，直接延展素材已标记待复核`
          }
        };
      });
      if (result.status === "stale") return;
      if (result.status === "blocked") {
        clearAfterStale(confirmation, `${result.reason} 已清除旧确认，请重新发起。`);
        return;
      }
      input.clearPendingConfirmation(confirmation);
      input.setAiDraft("");
      if (result.notice) input.showNotice(result.notice);
    } finally {
      resolvingConfirmationRef.current = null;
    }
  }, [clearAfterStale, input, isCurrentSession, preflight]);

  const cancel = useCallback(async (): Promise<void> => {
    const confirmation = input.pendingConfirmation;
    if (
      !confirmation ||
      isComparisonPendingConfirmation(confirmation) ||
      resolvingConfirmationRef.current !== null ||
      !isCurrentSession() ||
      !input.ownsPendingConfirmation(confirmation)
    ) return;

    resolvingConfirmationRef.current = confirmation;
    try {
      if (isAgentPendingConfirmation(confirmation)) {
        const acknowledged = await input.acknowledgePendingConfirmation();
        if (!acknowledged) {
          input.showNotice("A+ 取消确认未成功，恢复事实仍保留；未改变项目状态。请稍后重试。");
          return;
        }
      }
      if (isCurrentSession() && input.ownsPendingConfirmation(confirmation)) {
        input.clearPendingConfirmation(confirmation);
      }
    } finally {
      resolvingConfirmationRef.current = null;
    }
  }, [input, isCurrentSession]);

  const updatePendingKeyConclusion = useCallback(
    (patch: Partial<Extract<PendingAiConfirmation, { kind: "createKeyConclusion" }>>): void => {
      input.updatePendingConfirmation((current) =>
        current.kind === "createKeyConclusion" ? { ...current, ...patch } : current
      );
    },
    [input]
  );

  return { confirm, confirmWithReviewMarks, cancel, updatePendingKeyConclusion };
}

function preflightBoundObjects(
  workspace: MorphoWorkspace,
  objectIds: readonly string[],
  reason: string
): WorkspaceConfirmationExecutionResult {
  return objectIds.every((objectId) => {
    const object = workspace.objects[objectId];
    return Boolean(object && object.visibility === "active");
  })
    ? { status: "ready" }
    : { status: "blocked", reason };
}

function preflightAgentOperation(
  workspace: MorphoWorkspace,
  sourceObjectIds: readonly string[],
  basedOnDesignDefinitionId?: string,
  basedOnRevisionId?: string
): WorkspaceConfirmationExecutionResult {
  const sources = preflightBoundObjects(workspace, sourceObjectIds, "确认所绑定的来源对象已变化，请重新发起确认。");
  if (sources.status !== "ready") return sources;
  const gate = canStartOperation(workspace);
  if (gate.status === "blocked") return gate;
  if (basedOnDesignDefinitionId || basedOnRevisionId) {
    const currentId = workspace.workingState.currentDesignDefinitionId;
    const current = currentId ? workspace.objects[currentId] : undefined;
    if (
      current?.type !== "designDefinition" ||
      current.id !== basedOnDesignDefinitionId ||
      current.currentRevisionId !== basedOnRevisionId
    ) {
      return { status: "blocked", reason: "当前设计定义基础已变化，请重新生成并确认草稿。" };
    }
  }
  return { status: "ready" };
}

function preflightDefaultReference(
  workspace: MorphoWorkspace,
  confirmation: Extract<PendingAiConfirmation, { kind: "setDefaultReference" }>
): WorkspaceConfirmationExecutionResult {
  if (!Array.isArray(confirmation.reviewImageIds) || !Array.isArray(confirmation.reviewCollectionIds)) {
    return { status: "blocked", reason: "默认参考确认范围无法恢复，请重新发起确认。" };
  }
  if (
    confirmation.reviewImageIds.length !== confirmation.reviewImageCount ||
    confirmation.reviewCollectionIds.length !== confirmation.reviewCollectionCount
  ) {
    return { status: "blocked", reason: "默认参考确认范围无法恢复，请重新发起确认。" };
  }
  const target = workspace.objects[confirmation.targetObjectId];
  if (target?.type !== "image" || target.visibility !== "active") {
    return { status: "blocked", reason: "新的默认参考已不可用，请重新发起确认。" };
  }
  const previous = workspace.objects[confirmation.previousReferenceObjectId];
  if (
    previous?.type !== "image" ||
    previous.visibility !== "active" ||
    !previous.isDefaultReference
  ) {
    return { status: "blocked", reason: "原默认参考已变化，请重新发起确认。" };
  }
  const currentScope = collectDefaultReferenceReviewTargets(
    workspace,
    confirmation.previousReferenceObjectId,
    confirmation.targetObjectId
  );
  return sameIdSet(currentScope.imageIds, confirmation.reviewImageIds) &&
    sameIdSet(currentScope.collectionIds, confirmation.reviewCollectionIds)
    ? { status: "ready" }
    : { status: "blocked", reason: "直接延展素材范围已变化，请重新发起确认。" };
}

function preflightVisualPlan(
  workspace: MorphoWorkspace,
  plan: Extract<PendingAiConfirmation, { kind: "batchGenerateVisuals" | "agentGenerateVisuals" }>['plan'],
  sourceObjectIds: readonly string[],
  selectedDirectionIds: readonly string[],
  selectedImageIds: readonly string[]
): WorkspaceConfirmationExecutionResult {
  const allReferencedIds = [
    ...sourceObjectIds,
    ...plan.items.flatMap((item) => item.referenceObjectIds),
    ...plan.items.flatMap((item) => item.targetDirectionId ? [item.targetDirectionId] : [])
  ];
  const bound = preflightBoundObjects(workspace, allReferencedIds, "视觉确认所绑定的来源对象已变化，请重新发起确认。");
  if (bound.status !== "ready") return bound;
  const requestedPreviewCount = plan.kind === "directionPreview" && selectedDirectionIds.length > 0
    ? plan.items.length / selectedDirectionIds.length
    : plan.items.length;
  if (!Number.isSafeInteger(requestedPreviewCount) || requestedPreviewCount < 1) {
    return { status: "blocked", reason: "视觉确认计划范围已变化，请重新发起确认。" };
  }
  const validation = validateVisualGenerationPlan(workspace, {
    plan,
    allowedObjectIds: allReferencedIds,
    selectedDirectionIds: [...selectedDirectionIds],
    selectedImageIds: [...selectedImageIds],
    requestedPreviewCount
  });
  return validation.status === "ok" ? { status: "ready" } : { status: "blocked", reason: validation.reason };
}

function preflightRequestedAgentAction(
  workspace: MorphoWorkspace,
  confirmation: Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }>,
  visualPreflight: (
    workspace: MorphoWorkspace,
    plan: Extract<PendingAiConfirmation, { kind: "batchGenerateVisuals" | "agentGenerateVisuals" }>['plan'],
    sourceObjectIds: readonly string[],
    selectedDirectionIds: readonly string[],
    selectedImageIds: readonly string[]
  ) => WorkspaceConfirmationExecutionResult
): WorkspaceConfirmationExecutionResult {
  const sources = preflightBoundObjects(workspace, confirmation.sourceObjectIds, "Agent 绑定的来源对象已变化，请重新发起确认。");
  if (sources.status !== "ready") return sources;
  const gate = canStartOperation(workspace);
  if (gate.status === "blocked") return gate;
  switch (confirmation.action) {
    case "batchGenerateVisuals":
      return confirmation.visualPlan
        ? visualPreflight(workspace, confirmation.visualPlan, confirmation.sourceObjectIds, confirmation.selectedDirectionIds, confirmation.selectedImageIds)
        : { status: "blocked", reason: "缺少已绑定的视觉生成计划，请重新发起确认。" };
    case "applyDesignDefinition":
      return confirmation.targetObjectId && workspace.artifactProposals[confirmation.targetObjectId]
        ? { status: "ready" }
        : { status: "blocked", reason: "设计定义 proposal 已不可用，请重新发起确认。" };
    case "setDirectionPrimary":
    case "setDirectionAlternative":
    case "eliminateDirection": {
      const target = confirmation.targetObjectId ? workspace.objects[confirmation.targetObjectId] : undefined;
      return target?.type === "conceptDirection" && target.visibility === "active"
        ? { status: "ready" }
        : { status: "blocked", reason: "方向对象已不可用，请重新发起确认。" };
    }
    case "setDefaultReference": {
      const target = confirmation.targetObjectId ? workspace.objects[confirmation.targetObjectId] : undefined;
      return target?.type === "image" && target.visibility === "active"
        ? { status: "ready" }
        : { status: "blocked", reason: "默认参考图像已不可用，请重新发起确认。" };
    }
  }
}

function isVisualConfirmation(
  confirmation: PendingAiConfirmation
): confirmation is Extract<PendingAiConfirmation, { kind: "batchGenerateVisuals" | "agentGenerateVisuals" | "agentRequestedAction" }> {
  return confirmation.kind === "batchGenerateVisuals" ||
    confirmation.kind === "agentGenerateVisuals" ||
    (confirmation.kind === "agentRequestedAction" && confirmation.action === "batchGenerateVisuals");
}

function shouldPushUndo(confirmation: PendingAiConfirmation): boolean {
  return confirmation.kind === "setDefaultReference" || confirmation.kind === "deleteObject" ||
    (confirmation.kind === "agentRequestedAction" && confirmation.action !== "batchGenerateVisuals");
}

function applyConfirmation(
  workspace: MorphoWorkspace,
  confirmation: PendingAiConfirmation,
  input: UseWorkspaceConfirmationExecutionControllerInput
): { workspace: MorphoWorkspace; result: AppliedConfirmationResult } {
  switch (confirmation.kind) {
    case "setDefaultReference":
      return {
        workspace: setDefaultReference(workspace, confirmation.targetObjectId, {
          reason: "用户在默认参考确认卡中明确只替换后续默认参考。"
        }),
        result: {
          status: "applied",
          notice: `已替换后续默认参考为「${confirmation.targetTitle}」`
        }
      };
    case "deleteObject": {
      const result = deleteObject(workspace, confirmation.targetObjectId, {
        confirmed: true,
        reason: "用户在确认卡中确认删除该对象。"
      });
      return {
        workspace: result.workspace,
        result: {
          status: "applied",
          removedObjectId: confirmation.targetObjectId,
          notice: `已删除「${confirmation.targetTitle}」`
        }
      };
    }
    case "createKeyConclusion": {
      const result = createKeyConclusion(workspace, {
        title: confirmation.conclusionTitle,
        body: confirmation.body,
        summary: confirmation.summary,
        sourceObjectIds: confirmation.sourceObjectIds,
        citationIds: confirmation.citationIds,
        category: confirmation.category!,
        confidence: confirmation.confidence,
        state: confirmation.state,
        note: confirmation.note,
        position: { x: workspace.canvas.view.x + 240, y: workspace.canvas.view.y + 180 }
      });
      return {
        workspace: result.workspace,
        result: { status: "applied", focusObjectId: result.keyConclusion.id, taskMode: "chatAnalysis" }
      };
    }
    case "agentCreateResearchAnalysis": {
      const created = createResearchOperation(workspace, {
        userInput: confirmation.draft,
        selectedObjectIds: confirmation.sourceObjectIds,
        allowWebSearch: confirmation.citations.length > 0
      });
      const applied = applyResearchProposalWithSemanticPatch({
        workspace: created.workspace,
        proposal: {
          proposalId: `proposal-research-${created.operation.id}-${Date.now()}`,
          operationId: created.operation.id,
          title: confirmation.args.title,
          summary: confirmation.args.summary,
          findings: normalizeResearchItems(confirmation.args.findings),
          opportunities: normalizeResearchItems(confirmation.args.opportunities),
          constraints: normalizeResearchItems(confirmation.args.constraints),
          openQuestions: normalizeResearchItems(confirmation.args.openQuestions),
          evidence: constrainResearchEvidence(confirmation.args, confirmation.sourceObjectIds, confirmation.citations),
          sourceObjectIds: confirmation.sourceObjectIds,
          citations: confirmation.citations
        },
        position: getPlacementNearObjects(created.workspace, confirmation.sourceObjectIds, {
          x: created.workspace.canvas.view.x + 220,
          y: created.workspace.canvas.view.y + 180
        }),
        context: buildTaskContext(workspace, {
          kind: "general",
          draft: confirmation.draft,
          selectedObjectIds: confirmation.sourceObjectIds
        }),
        draft: confirmation.draft,
        userMessageId: `ai-user-confirm-${Date.now()}`,
        userMessageCreatedAt: new Date().toISOString(),
        assistantText: ""
      });
      return { workspace: applied.workspace, result: { status: "applied", clearDraft: true } };
    }
    case "agentCreateDesignDefinitionProposal": {
      const operationId = `operation-designDefinition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = createArtifactProposalOperation(workspace, {
        operationId,
        type: "designDefinition",
        userInput: confirmation.draft,
        selectedObjectIds: confirmation.sourceObjectIds,
        workIntent: "createDesignDefinition"
      });
      const proposalPlacement = getProposalPlacement(created.workspace, confirmation.sourceObjectIds, "definition");
      let nextWorkspace = created.workspace;
      for (const [proposalIndex, proposalDraft] of getDesignDefinitionDrafts(confirmation.args).entries()) {
        nextWorkspace = recordDesignDefinitionProposal(nextWorkspace, {
          operationId,
          workIntent: "createDesignDefinition",
          title: proposalDraft.title,
          summary: proposalDraft.summary,
          projectGoal: proposalDraft.projectGoal,
          targetUsers: proposalDraft.targetUsers,
          primaryScenarios: proposalDraft.primaryScenarios,
          coreProblem: proposalDraft.coreProblem,
          designPrinciples: proposalDraft.designPrinciples,
          constraints: proposalDraft.constraints,
          avoidDirections: proposalDraft.avoidDirections,
          opportunities: proposalDraft.opportunities,
          openQuestions: proposalDraft.openQuestions,
          changeNote: proposalDraft.changeNote,
          sourceObjectIds: confirmation.sourceObjectIds,
          citations: confirmation.citations,
          basedOnDesignDefinitionId: confirmation.basedOnDesignDefinitionId,
          basedOnRevisionId: confirmation.basedOnRevisionId,
          position: getSiblingProposalPlacement(proposalPlacement, proposalIndex)
        }).workspace;
      }
      return { workspace: nextWorkspace, result: { status: "applied", clearDraft: true } };
    }
    case "agentCreateConceptDirectionProposal": {
      const operationId = `operation-conceptDirection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = createArtifactProposalOperation(workspace, {
        operationId,
        type: "conceptDirection",
        userInput: confirmation.draft,
        selectedObjectIds: confirmation.sourceObjectIds,
        workIntent: "createConceptDirections"
      });
      const placed = recordAndApplyConceptDirectionProposal(created.workspace, {
        operationId,
        workIntent: "createConceptDirections",
        title: confirmation.args.title,
        summary: confirmation.args.summary,
        directions: confirmation.args.directions,
        sourceObjectIds: confirmation.sourceObjectIds,
        citations: confirmation.citations,
        basedOnDesignDefinitionId: confirmation.basedOnDesignDefinitionId,
        basedOnRevisionId: confirmation.basedOnRevisionId,
        position: getProposalPlacement(created.workspace, confirmation.sourceObjectIds, "direction")
      });
      if (placed.status === "blocked") {
        return {
          workspace: appendAiAssistantFailureMessage(
            placed.workspace,
            "agent-confirm-direction",
            placed.reason,
            placed.proposal.id
          ),
          result: { status: "applied", clearDraft: true }
        };
      }
      return {
        workspace: appendNotice(placed.workspace, `已应用到画布：${placed.directions.length} 个概念方向。我已选中并定位到第一个方向。`),
        result: {
          status: "applied",
          selectionObjectIds: placed.directions.map((direction) => direction.id),
          focusObjectId: placed.directions[0]?.id,
          clearDraft: true
        }
      };
    }
    case "agentCreateComparisonAnalysis": {
      const authorization = buildComparisonAuthorization({
        workspace,
        selectedObjectIds: confirmation.selectedObjectIds,
        userMessageId: confirmation.userMessageId,
        assistantMessageId: confirmation.assistantMessageId,
        createdAt: new Date().toISOString(),
        comparisonGoal: confirmation.args.comparisonGoal,
        imageAttachmentObjectIds: confirmation.imageAttachmentObjectIds,
        documentExtractObjectIds: confirmation.documentExtractObjectIds,
        documentFragmentExtractObjectIds: confirmation.documentFragmentExtractObjectIds
      });
      if (!("authorization" in authorization)) {
        return {
          workspace,
          result: {
            status: "blocked",
            reason: authorization.status === "blocked" ? authorization.reason : "Compare authorization 不再有效。"
          }
        };
      }
      const validation = validateComparisonAnalysis(confirmation.args, authorization.authorization);
      if (validation.status !== "ok") {
        return { workspace, result: { status: "blocked", reason: validation.reason } };
      }
      return { workspace: applyComparisonAnalysis(workspace, validation.analysis), result: { status: "applied", clearDraft: true } };
    }
    case "agentRequestedAction":
      return {
        workspace: applyRequestedAgentAction(workspace, confirmation, {
          executeVisuals: confirmation.visualPlan ? undefined : "缺少可执行的视觉生成计划，未改变项目状态。"
        }),
        result: { status: "applied", clearDraft: true }
      };
    case "batchGenerateVisuals":
    case "agentGenerateVisuals":
    case "compareSetPrimary":
    case "compareSetAlternative":
    case "compareEliminate":
    case "compareRestoreAlternative":
    case "compareSetDefaultReference":
    case "compareClearDefaultReference":
    case "compareCreateKeyConclusion":
      return { workspace, result: { status: "applied" } };
  }
}

function appendNotice(workspace: MorphoWorkspace, body: string): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `agent-confirm-direction-applied-${Date.now()}`,
          role: "assistant",
          body,
          status: "done",
          createdAt: new Date().toISOString()
        }
      ]
    }
  };
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
