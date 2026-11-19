import { createObjectIncarnationId } from "./objectIdentity";
import { reconcileWorkspaceDerivedState, createEmptyProjectWorkingState } from "./derivedState";
import {
  createDeliveryReferenceSnapshot as createStableDeliveryReferenceSnapshot,
  makeDeliveryReferenceId
} from "./deliveryPreparation";
import { createDeliverySourceFingerprint } from "./deliveryInspection";
import {
  applyProjectContinuityEvent,
  createInitialProjectContinuity,
  resolveContinuityValidity
} from "./projectContinuity";
import { createEmptyProjectMemoryState, reconcileProjectMemory } from "./projectMemory";
import { createEmptyConversationCompactionState } from "./conversationCompaction";
import { isAssignableKeyConclusionCategory } from "./types";
import type {
  AiDraftResult,
  AiSuggestionInput,
  AssetRecord,
  CanvasInstance,
  CanvasInstanceId,
  CanvasPoint,
  CanvasSize,
  ConceptDirectionStatus,
  DeliveryObject,
  DeliveryReference,
  DeliveryReferenceId,
  FileObject,
  ImageObject,
  ImageRole,
  AssignableKeyConclusionCategory,
  KeyConclusionObject,
  ComparisonDecisionMetadata,
  MorphoObject,
  MorphoObjectId,
  MorphoRelation,
  MorphoWorkspace,
  ObjectSnapshot,
  RelationKind,
  VisualBranchId,
  VisualReviewMark
} from "./types";
import { captureEvidenceBasis, qualifyEvidence } from "./evidenceAuthority";
import { CURRENT_SCHEMA_VERSION } from "./types";

export type DeleteObjectResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
    }
  | {
      status: "requiresConfirmation";
      workspace: MorphoWorkspace;
      reasons: string[];
    };

export type CreateDeliveryReferenceResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      deliveryReferenceId: DeliveryReferenceId;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type CreateKeyConclusionResult = {
  workspace: MorphoWorkspace;
  keyConclusion: KeyConclusionObject;
};

export type ResearchKeyConclusionSource =
  | {
      kind: "finding" | "opportunity" | "constraint" | "openQuestion";
      index: number;
    }
  | {
      kind: "evidence";
      index: number;
      category: AssignableKeyConclusionCategory;
    };

export type KeyConclusionDraftFromResearchResult =
  | {
      status: "ready";
      draft: {
        title: string;
        body: string;
        summary: string;
        sourceObjectIds: MorphoObjectId[];
        citationIds: string[];
        category: AssignableKeyConclusionCategory;
        confidence: KeyConclusionObject["confidence"];
        state?: "active" | "needsVerification";
        note: string;
        evidence?: import("../operations/types").ResearchEvidence[];
        researchOrigin?: KeyConclusionObject["researchOrigin"];
      };
    }
  | {
      status: "blocked";
      reason: string;
    };

export type SetKeyConclusionStateResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      keyConclusion: KeyConclusionObject;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type SetKeyConclusionCategoryResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      keyConclusion: KeyConclusionObject;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type VisualBranchActionResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export function createBlankWorkspace(projectId: string): MorphoWorkspace {
  const now = new Date().toISOString();

  return reconcileProjectMemory(reconcileWorkspaceDerivedState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: projectId,
      title: "未命名项目",
      subtitle: "从一句话、图片、文件或链接开始。",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    },
    objects: {},
    assets: {},
    relations: [],
    deliveryReferences: {},
    deliverySectionDrafts: {},
    decisionRecords: [],
    operations: {},
    artifactProposals: {},
    citationSnapshots: {},
    designDefinitionRevisions: {},
    directionRevisions: {},
    directionLineage: [],
    visualBranches: {},
    workingState: createEmptyProjectWorkingState(now),
    projectContinuity: createInitialProjectContinuity({
      workspace: {
        project: {
          id: projectId,
          title: "未命名项目",
          subtitle: "从一句话、图片、文件或链接开始。",
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now
        },
        objects: {},
        designDefinitionRevisions: {},
        directionRevisions: {}
      },
      now
    }),
    projectMemory: createEmptyProjectMemoryState(now),
    canvas: {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: {
      messages: [],
      conversationCompaction: createEmptyConversationCompactionState(),
      conversationSummaryRevisions: {},
      providerContextFrames: [],
      comparisonAnalyses: {}
    },
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: { x: 0, y: 0, zoom: 1 },
      workIntent: "discussion"
    }
  }), now);
}

export function updateCanvasInstancePosition(
  workspace: MorphoWorkspace,
  instanceId: CanvasInstanceId,
  position: CanvasPoint
): MorphoWorkspace {
  let didFindInstance = false;
  const instances = workspace.canvas.instances.map((instance) => {
    if (instance.id !== instanceId) {
      return instance;
    }

    didFindInstance = true;
    return {
      ...instance,
      position
    };
  });

  if (!didFindInstance) {
    throw new Error(`Canvas instance not found: ${instanceId}`);
  }

  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      instances
    }
  };
}

export type CanvasLayerReorderAction = "bringForward" | "sendBackward" | "bringToFront" | "sendToBack";

export function reorderCanvasInstances(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  action: CanvasLayerReorderAction
): MorphoWorkspace {
  const objectIdSet = new Set(objectIds);
  if (objectIdSet.size === 0) {
    return workspace;
  }

  const selected = workspace.canvas.instances.filter((instance) => objectIdSet.has(instance.objectId));
  if (selected.length === 0) {
    return workspace;
  }

  const selectedInstanceIds = new Set(selected.map((instance) => instance.id));
  const instances =
    action === "bringForward" || action === "sendBackward"
      ? moveSelectedInstancesOneStep(workspace.canvas.instances, selectedInstanceIds, action)
      : moveSelectedInstancesToEdge(workspace.canvas.instances, selectedInstanceIds, action);

  if (instances === workspace.canvas.instances) {
    return workspace;
  }

  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      instances
    }
  };
}

function moveSelectedInstancesToEdge(
  instances: CanvasInstance[],
  selectedInstanceIds: Set<CanvasInstanceId>,
  action: Extract<CanvasLayerReorderAction, "bringToFront" | "sendToBack">
): CanvasInstance[] {
  const selected = instances.filter((instance) => selectedInstanceIds.has(instance.id));
  const others = instances.filter((instance) => !selectedInstanceIds.has(instance.id));
  return action === "bringToFront" ? [...others, ...selected] : [...selected, ...others];
}

function moveSelectedInstancesOneStep(
  instances: CanvasInstance[],
  selectedInstanceIds: Set<CanvasInstanceId>,
  action: Extract<CanvasLayerReorderAction, "bringForward" | "sendBackward">
): CanvasInstance[] {
  const next = [...instances];
  if (action === "bringForward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selectedInstanceIds.has(next[index].id) && !selectedInstanceIds.has(next[index + 1].id)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selectedInstanceIds.has(next[index].id) && !selectedInstanceIds.has(next[index - 1].id)) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }

  return areCanvasInstancesInSameOrder(instances, next) ? instances : next;
}

function areCanvasInstancesInSameOrder(left: CanvasInstance[], right: CanvasInstance[]): boolean {
  return left.length === right.length && left.every((instance, index) => instance.id === right[index].id);
}

export function createAiDraftFromSuggestion(
  workspace: MorphoWorkspace,
  input: AiSuggestionInput
): AiDraftResult {
  return {
    workspace,
    draft: input.suggestion,
    contextObjectIds: [...input.selectedObjectIds]
  };
}

export function hideObject(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.visibility === "hidden") {
    return workspace;
  }

  return resolveContinuityValidity(reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "hidden",
        updatedAt: new Date().toISOString()
      }
    }
  }));
}

export function hideObjects(workspace: MorphoWorkspace, objectIds: MorphoObjectId[]): MorphoWorkspace {
  return uniqueObjectIds(objectIds).reduce((current, objectId) => hideObject(current, objectId), workspace);
}

export function restoreObject(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.visibility === "active") {
    return workspace;
  }

  return resolveContinuityValidity(reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "active",
        updatedAt: new Date().toISOString()
      }
    }
  }));
}

export function getRenderableCanvasInstances(workspace: MorphoWorkspace): CanvasInstance[] {
  return workspace.canvas.instances.filter((instance) => workspace.objects[instance.objectId]?.visibility === "active");
}

export function markFileObjectParsing(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];
  if (!object || object.type !== "file") {
    return workspace;
  }

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        parseStatus: "parsing",
        parseError: undefined,
        updatedAt: new Date().toISOString()
      }
    }
  };
}

export function attachDocumentExtractToFileObject(
  workspace: MorphoWorkspace,
  input: {
    fileObjectId: MorphoObjectId;
    extractAsset: AssetRecord;
    extractedCharCount: number;
    extractedPageCount?: number;
    sourcePageCount?: number;
    extractionTruncated?: boolean;
    parsedAt?: string;
  }
): MorphoWorkspace {
  const object = workspace.objects[input.fileObjectId];
  if (!object || object.type !== "file") {
    return workspace;
  }

  const parsedAt = input.parsedAt ?? new Date().toISOString();
  const updatedFile: FileObject = {
    ...object,
    summary: `${object.mimeType || "未知类型"} · ${formatFileSize(object.size ?? 0)} · ${
      input.extractionTruncated ? "部分解析" : "已解析"
    } ${input.extractedCharCount} 字符${input.extractedPageCount ? ` · ${input.extractedPageCount}${
      input.sourcePageCount && input.sourcePageCount !== input.extractedPageCount
        ? `/${input.sourcePageCount}`
        : ""
    } 页/张` : ""}`,
    parseStatus: "parsed",
    extractedAssetId: input.extractAsset.id,
    extractedCharCount: input.extractedCharCount,
    extractedPageCount: input.extractedPageCount,
    sourcePageCount: input.sourcePageCount,
    extractionTruncated: input.extractionTruncated,
    parsedAt,
    parseError: undefined,
    updatedAt: parsedAt
  };

  return {
    ...workspace,
    assets: {
      ...workspace.assets,
      [input.extractAsset.id]: input.extractAsset
    },
    objects: {
      ...workspace.objects,
      [input.fileObjectId]: updatedFile
    }
  };
}

export function markFileObjectParseFailed(
  workspace: MorphoWorkspace,
  input: {
    fileObjectId: MorphoObjectId;
    reason: string;
    parsedAt?: string;
  }
): MorphoWorkspace {
  const object = workspace.objects[input.fileObjectId];
  if (!object || object.type !== "file") {
    return workspace;
  }

  const parsedAt = input.parsedAt ?? new Date().toISOString();
  const updatedFile: FileObject = {
    ...object,
    summary: `${object.mimeType || "未知类型"} · ${formatFileSize(object.size ?? 0)} · 解析失败`,
    parseStatus: "failed",
    parseError: input.reason,
    parsedAt,
    updatedAt: parsedAt
  };

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [input.fileObjectId]: updatedFile
    }
  };
}

export function deleteObject(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { confirmed?: boolean; reason?: string } = {}
): DeleteObjectResult {
  const object = workspace.objects[objectId];

  if (!object) {
    return {
      status: "updated",
      workspace
    };
  }

  const reasons = getDeleteConfirmationReasons(workspace, object);

  if (reasons.length > 0 && !options.confirmed) {
    return {
      status: "requiresConfirmation",
      workspace,
      reasons
    };
  }

  const objects = omitRecordKey(workspace.objects, objectId);
  // Branch ownership and image membership are live organizational state;
  // generation metadata, revisions and lineage remain historical provenance.
  const removedBranchIds = new Set(
    Object.values(workspace.visualBranches).filter((branch) => branch.directionId === objectId).map((branch) => branch.id)
  );
  const visualBranches = Object.fromEntries(
    Object.entries(workspace.visualBranches)
      .filter(([id]) => !removedBranchIds.has(id))
      .map(([id, branch]) => {
        if (branch.rootObjectId !== objectId) return [id, branch];
        const { rootObjectId: _rootObjectId, ...withoutRoot } = branch;
        return [id, withoutRoot];
      })
  );
  for (const candidate of Object.values(objects)) {
    if (candidate.type === "image" && (candidate.directionId === objectId || removedBranchIds.has(candidate.visualBranchId ?? ""))) {
      const updated = { ...candidate };
      if (updated.directionId === objectId) delete updated.directionId;
      if (removedBranchIds.has(updated.visualBranchId ?? "")) delete updated.visualBranchId;
      objects[candidate.id] = updated;
    } else if (candidate.type === "imageCollection" && candidate.memberObjectIds.includes(objectId)) {
      objects[candidate.id] = { ...candidate, memberObjectIds: candidate.memberObjectIds.filter((id) => id !== objectId) };
    }
  }
  const deliveryReferences = Object.fromEntries(
    Object.entries(workspace.deliveryReferences).filter(([, reference]) => reference.deliveryObjectId !== objectId)
  );
  const deliverySectionDrafts = Object.fromEntries(
    Object.entries(workspace.deliverySectionDrafts).filter(([, draft]) => draft.deliveryObjectId !== objectId)
  );
  const relations = workspace.relations.filter(
    (relation) => relation.fromObjectId !== objectId && relation.toObjectId !== objectId
  );
  const canvasInstances = workspace.canvas.instances.filter((instance) => instance.objectId !== objectId);
  const decisionRecords = options.reason
    ? [
        ...workspace.decisionRecords,
        {
          id: makeDecisionId(workspace, "deleteObject", objectId),
          kind: "deleteObject" as const,
        effect: { kind: "deleteObject" as const, targetObjectId: objectId, targetIncarnationId: object.incarnationId },
          createdAt: new Date().toISOString(),
          summary: `删除 ${object.title}`,
          reason: options.reason,
          objectSnapshot: snapshotObject(object),
          relatedObjectIds: []
        }
      ]
    : workspace.decisionRecords;

  return {
    status: "updated",
    workspace: resolveContinuityValidity(reconcileWorkspaceDerivedState({
      ...workspace,
      objects,
      relations,
      visualBranches,
      deliveryReferences,
      deliverySectionDrafts,
      decisionRecords,
      canvas: {
        ...workspace.canvas,
        instances: canvasInstances,
        ...(workspace.canvas.stageRegions ? {
          stageRegions: workspace.canvas.stageRegions.map((region) => ({
            ...region, memberObjectIds: region.memberObjectIds.filter((id) => id !== objectId)
          }))
        } : {})
      },
      ui: { ...workspace.ui, lastSelectionIds: workspace.ui.lastSelectionIds.filter((id) => id !== objectId) }
    }))
  };
}

export function deleteObjects(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  options: { confirmed?: boolean; reason?: string } = {}
): DeleteObjectResult {
  let current = workspace;
  for (const objectId of uniqueObjectIds(objectIds)) {
    const result = deleteObject(current, objectId, options);
    if (result.status === "requiresConfirmation") {
      return result;
    }
    current = result.workspace;
  }

  return {
    status: "updated",
    workspace: current
  };
}

export function eliminateDirection(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { reason: string; comparison?: ComparisonDecisionMetadata }
): MorphoWorkspace {
  return setConceptDirectionStatus(workspace, objectId, "eliminated", options.reason, options.comparison);
}

export function setConceptDirectionStatus(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  status: ConceptDirectionStatus,
  reason: string,
  comparison?: ComparisonDecisionMetadata
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "conceptDirection") {
    return workspace;
  }

  const now = new Date().toISOString();
  const objects: Record<MorphoObjectId, MorphoObject> = { ...workspace.objects };
  if (status === "primary") {
    for (const candidate of Object.values(workspace.objects)) {
      if (candidate.type === "conceptDirection" && candidate.status === "primary" && candidate.id !== objectId) {
        objects[candidate.id] = {
          ...candidate,
          status: "alternative",
          updatedAt: now
        };
      }
    }
  }

  objects[objectId] = {
    ...object,
    status,
    updatedAt: now
  };

  const decisionId = makeDecisionId(workspace, "setDirectionStatus", objectId);
  const updated = reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: decisionId,
        kind: "setDirectionStatus",
        effect: { kind: "setDirectionStatus", targetObjectId: objectId, targetIncarnationId: object.incarnationId, status },
        createdAt: now,
        summary: `${object.title} -> ${status}`,
        reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId],
        comparison
      }
    ]
  });
  return applyProjectContinuityEvent(updated, {
    type: "directionStatusChanged",
    directionObjectId: objectId,
    status,
    decisionId,
    createdAt: now
  });
}

export function setImageRole(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  role: ImageRole,
  options: { reason: string }
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "image") {
    return workspace;
  }

  if (object.role === role) {
    return workspace;
  }

  const now = new Date().toISOString();
  const updatedObject: ImageObject = {
    ...object,
    role,
    updatedAt: now
  };

  return reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: updatedObject
    },
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setImageRole", objectId),
        kind: "setImageRole",
        effect: { kind: "setImageRole", targetObjectId: objectId, targetIncarnationId: object.incarnationId, role },
        createdAt: now,
        summary: `${object.title} -> ${role}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(updatedObject),
        relatedObjectIds: object.directionId ? [objectId, object.directionId] : [objectId]
      }
    ]
  });
}

export function createVisualBranch(
  workspace: MorphoWorkspace,
  input: { branchId?: VisualBranchId; directionId: MorphoObjectId; label: string; rootObjectId?: MorphoObjectId }
): VisualBranchActionResult {
  const direction = workspace.objects[input.directionId];
  const label = input.label.trim();
  if (!direction || direction.type !== "conceptDirection") {
    return { status: "blocked", workspace, reason: "视觉分支必须属于一个可用的概念方向。" };
  }
  if (!label) {
    return { status: "blocked", workspace, reason: "视觉分支需要可读名称。" };
  }

  const rootObject = input.rootObjectId ? workspace.objects[input.rootObjectId] : undefined;
  if (input.rootObjectId && rootObject?.type !== "image") {
    return { status: "blocked", workspace, reason: "视觉分支的根对象必须是图片。" };
  }
  if (rootObject?.type === "image" && rootObject.directionId && rootObject.directionId !== direction.id) {
    return { status: "blocked", workspace, reason: "视觉分支根图片不能来自其他方向。" };
  }

  const now = new Date().toISOString();
  const branchId = nextAvailableId(
    workspace.visualBranches,
    input.branchId ?? `visual-branch-${direction.id}-${slugifyLabel(label)}`
  );

  const nextWorkspace = {
    ...workspace,
    visualBranches: {
      ...workspace.visualBranches,
      [branchId]: {
        id: branchId,
        directionId: direction.id,
        label,
        rootObjectId: input.rootObjectId,
        createdAt: now
      }
    }
  };
  return {
    status: "updated",
    workspace: applyProjectContinuityEvent(nextWorkspace, {
      type: "visualBranchChanged",
      action: "created",
      occurrenceId: branchId,
      branchId,
      directionId: direction.id,
      createdAt: now
    })
  };
}

export function renameVisualBranch(
  workspace: MorphoWorkspace,
  branchId: VisualBranchId,
  label: string
): VisualBranchActionResult {
  const branch = workspace.visualBranches[branchId];
  const nextLabel = label.trim();
  if (!branch) {
    return { status: "blocked", workspace, reason: "视觉分支不存在。" };
  }
  if (!nextLabel) {
    return { status: "blocked", workspace, reason: "视觉分支需要可读名称。" };
  }

  return {
    status: "updated",
    workspace: {
      ...workspace,
      visualBranches: {
        ...workspace.visualBranches,
        [branchId]: {
          ...branch,
          label: nextLabel
        }
      }
    }
  };
}

export function archiveVisualBranch(
  workspace: MorphoWorkspace,
  branchId: VisualBranchId
): VisualBranchActionResult {
  const branch = workspace.visualBranches[branchId];
  if (!branch) {
    return { status: "blocked", workspace, reason: "视觉分支不存在。" };
  }
  if (branch.archivedAt) {
    return { status: "updated", workspace };
  }

  const now = new Date().toISOString();
  const nextWorkspace = {
    ...workspace,
    visualBranches: {
      ...workspace.visualBranches,
      [branchId]: {
        ...branch,
        archivedAt: now
      }
    }
  };
  return {
    status: "updated",
    workspace: applyProjectContinuityEvent(nextWorkspace, {
      type: "visualBranchChanged",
      action: "archived",
      occurrenceId: crypto.randomUUID(),
      branchId,
      directionId: branch.directionId,
      createdAt: now
    })
  };
}

export function restoreVisualBranch(
  workspace: MorphoWorkspace,
  branchId: VisualBranchId
): VisualBranchActionResult {
  const branch = workspace.visualBranches[branchId];
  if (!branch) {
    return { status: "blocked", workspace, reason: "视觉分支不存在。" };
  }

  const { archivedAt: _archivedAt, ...restoredBranch } = branch;
  if (!branch.archivedAt) return { status: "updated", workspace };
  const now = new Date().toISOString();
  const nextWorkspace = {
    ...workspace,
    visualBranches: {
      ...workspace.visualBranches,
      [branchId]: restoredBranch
    }
  };
  return {
    status: "updated",
    workspace: applyProjectContinuityEvent(nextWorkspace, {
      type: "visualBranchChanged",
      action: "restored",
      occurrenceId: crypto.randomUUID(),
      branchId,
      directionId: restoredBranch.directionId,
      createdAt: now
    })
  };
}

export function assignImageToVisualBranch(
  workspace: MorphoWorkspace,
  imageId: MorphoObjectId,
  branchId: VisualBranchId
): VisualBranchActionResult {
  const branch = workspace.visualBranches[branchId];
  const image = workspace.objects[imageId];
  if (!branch) {
    return { status: "blocked", workspace, reason: "视觉分支不存在。" };
  }
  if (branch.archivedAt) {
    return { status: "blocked", workspace, reason: "视觉分支已归档，恢复后才能继续加入图片。" };
  }
  if (!image || image.type !== "image") {
    return { status: "blocked", workspace, reason: "只能把图片加入视觉分支。" };
  }
  if (image.directionId && image.directionId !== branch.directionId) {
    return { status: "blocked", workspace, reason: "图片不能跨方向加入视觉分支。" };
  }

  const nextImage: ImageObject = {
    ...image,
    directionId: image.directionId ?? branch.directionId,
    visualBranchId: branchId,
    updatedAt: new Date().toISOString()
  };

  return {
    status: "updated",
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [nextImage.id]: nextImage
      },
      relations: ensureBelongsToDirectionRelation(workspace, nextImage.id, branch.directionId)
    })
  };
}

export function removeImageFromVisualBranch(
  workspace: MorphoWorkspace,
  imageId: MorphoObjectId
): VisualBranchActionResult {
  const image = workspace.objects[imageId];
  if (!image || image.type !== "image") {
    return { status: "blocked", workspace, reason: "只能从视觉分支移出图片。" };
  }

  const nextImage: ImageObject = {
    ...image,
    visualBranchId: undefined,
    updatedAt: new Date().toISOString()
  };

  return {
    status: "updated",
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [nextImage.id]: nextImage
      }
    })
  };
}

/** 直接延展素材的角色：多角度 / 继续发展、展示主视觉、使用场景、CMF、细节、结构或设计示意。 */
const DIRECT_DERIVATIVE_IMAGE_ROLES: ReadonlySet<ImageRole> = new Set<ImageRole>([
  "conceptImage",
  "primaryVisual",
  "sceneVisual",
  "cmfStudy",
  "detailStudy",
  "structureDiagram",
  "interactionDiagram"
]);

const DERIVATIVE_LINK_RELATION_KINDS: ReadonlySet<RelationKind> = new Set<RelationKind>([
  "source",
  "usesReference",
  "version"
]);

export type DefaultReferenceReviewTargets = {
  imageIds: MorphoObjectId[];
  collectionIds: MorphoObjectId[];
};

/**
 * 只收集旧默认参考的直接延展素材：由旧锚点直接生成或引用旧锚点、
 * 且角色属于延展表达的图片。研究资料、方向预览、普通候选与交付模块不进入。
 * 成组素材标记合集，单张素材标记单张图。
 */
export function collectDefaultReferenceReviewTargets(
  workspace: MorphoWorkspace,
  previousReferenceId: MorphoObjectId,
  nextReferenceId: MorphoObjectId
): DefaultReferenceReviewTargets {
  const derivedImageIds = new Set<MorphoObjectId>();
  for (const object of Object.values(workspace.objects)) {
    if (object.type !== "image" || object.visibility !== "active") {
      continue;
    }
    if (object.id === previousReferenceId || object.id === nextReferenceId) {
      continue;
    }
    if (!DIRECT_DERIVATIVE_IMAGE_ROLES.has(object.role)) {
      continue;
    }

    const lineage = object.generation?.lineage;
    const linkedByGeneration = lineage ? lineage.identityParent?.objectId === previousReferenceId : object.generation?.referenceObjectIds?.includes(previousReferenceId) ?? false;
    const linkedByRelation = workspace.relations.some(
      (relation) =>
        DERIVATIVE_LINK_RELATION_KINDS.has(relation.kind) &&
        relation.fromObjectId === previousReferenceId &&
        relation.toObjectId === object.id
    );
    if (linkedByGeneration || (!lineage && linkedByRelation)) {
      derivedImageIds.add(object.id);
    }
  }

  const collectionIds: MorphoObjectId[] = [];
  const groupedImageIds = new Set<MorphoObjectId>();
  for (const object of Object.values(workspace.objects)) {
    if (object.type !== "imageCollection" || object.visibility !== "active") {
      continue;
    }
    const groupedMembers = object.memberObjectIds.filter((memberId) => derivedImageIds.has(memberId));
    if (groupedMembers.length === 0) {
      continue;
    }
    collectionIds.push(object.id);
    groupedMembers.forEach((memberId) => groupedImageIds.add(memberId));
  }

  return {
    imageIds: [...derivedImageIds].filter((imageId) => !groupedImageIds.has(imageId)),
    collectionIds
  };
}

export function setDefaultReference(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: {
    reason: string;
    comparison?: ComparisonDecisionMetadata;
    /** 替换已有锚点时可选：把旧锚点的直接延展素材标记待复核。不删除、不重排、不重新生成。 */
    markReplacedDerivativesForReview?: boolean;
  }
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "image" || object.visibility !== "active") {
    return workspace;
  }

  const now = new Date().toISOString();
  const previousDefaultReference = Object.values(workspace.objects).find(
    (candidate) => candidate.type === "image" && candidate.isDefaultReference && candidate.id !== objectId
  );
  const decisionId = makeDecisionId(workspace, "setDefaultReference", objectId);
  const reviewTargets: DefaultReferenceReviewTargets =
    options.markReplacedDerivativesForReview && previousDefaultReference
      ? collectDefaultReferenceReviewTargets(workspace, previousDefaultReference.id, objectId)
      : { imageIds: [], collectionIds: [] };
  const reviewImageIdSet = new Set(reviewTargets.imageIds);
  const reviewCollectionIdSet = new Set(reviewTargets.collectionIds);
  const reviewMark: VisualReviewMark | null = previousDefaultReference
    ? {
        reason: "defaultReferenceReplaced",
        previousDefaultReferenceId: previousDefaultReference.id,
        newDefaultReferenceId: objectId,
        decisionId,
        markedAt: now
      }
    : null;

  const objects = Object.fromEntries(
    Object.entries(workspace.objects).map(([entryId, entry]) => {
      if (entry.type === "imageCollection" && reviewMark && reviewCollectionIdSet.has(entry.id)) {
        return [entryId, { ...entry, pendingReview: reviewMark, updatedAt: now }];
      }

      if (entry.type !== "image") {
        return [entryId, entry];
      }

      const nextIsDefaultReference = entry.id === objectId;
      const shouldMarkForReview = Boolean(reviewMark) && reviewImageIdSet.has(entry.id);
      if ((entry.isDefaultReference ?? false) === nextIsDefaultReference && !shouldMarkForReview) {
        return [entryId, entry];
      }

      return [
        entryId,
        {
          ...entry,
          isDefaultReference: nextIsDefaultReference,
          ...(shouldMarkForReview && reviewMark ? { pendingReview: reviewMark } : {}),
          updatedAt: now
        } satisfies ImageObject
      ];
    })
  ) as Record<MorphoObjectId, MorphoObject>;

  const relationsWithoutDefault = workspace.relations.filter((relation) => relation.kind !== "defaultReference");
  const defaultReferenceRelation: MorphoRelation | null = object.directionId
    ? {
        id: `rel-${objectId}-default`,
        kind: "defaultReference",
        fromObjectId: objectId,
        toObjectId: object.directionId,
        note: `${object.title} 是后续默认参考。`
      }
    : null;

  const markedCount = reviewTargets.imageIds.length + reviewTargets.collectionIds.length;
  const updated = reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    relations: defaultReferenceRelation ? [...relationsWithoutDefault, defaultReferenceRelation] : relationsWithoutDefault,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: decisionId,
        kind: "setDefaultReference",
        effect: { kind: "setDefaultReference", targetObjectId: objectId, targetIncarnationId: object.incarnationId, referenceObjectId: objectId },
        createdAt: now,
        summary:
          markedCount > 0
            ? `设为后续默认参考：${object.title}；已标记 ${markedCount} 项直接延展素材待复核`
            : `设为后续默认参考：${object.title}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId, ...reviewTargets.imageIds, ...reviewTargets.collectionIds],
        comparison: options.comparison
      }
    ]
  });
  return applyProjectContinuityEvent(updated, {
    type: "defaultReferenceChanged",
    imageObjectId: objectId,
    previousImageObjectId: previousDefaultReference?.id,
    decisionId,
    createdAt: now
  });
}

/** 用户对待复核素材选择“保留”：只清除待复核标记，不改变其他状态。 */
export function clearVisualReviewMark(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];
  if (!object || (object.type !== "image" && object.type !== "imageCollection") || !object.pendingReview) {
    return workspace;
  }

  const { pendingReview: _cleared, ...rest } = object;
  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...rest,
        updatedAt: new Date().toISOString()
      } as MorphoObject
    }
  };
}

export function clearDefaultReference(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { reason: string; comparison?: ComparisonDecisionMetadata }
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "image") {
    return workspace;
  }

  const currentDefaultReference = Object.values(workspace.objects).find(
    (candidate) => candidate.type === "image" && candidate.isDefaultReference && candidate.id === objectId
  );
  if (!currentDefaultReference) {
    return workspace;
  }

  const now = new Date().toISOString();
  const objects = Object.fromEntries(
    Object.entries(workspace.objects).map(([entryId, entry]) => {
      if (entry.type !== "image" || entry.id !== objectId || !entry.isDefaultReference) {
        return [entryId, entry];
      }

      return [
        entryId,
        {
          ...entry,
          isDefaultReference: false,
          updatedAt: now
        } satisfies ImageObject
      ];
    })
  ) as Record<MorphoObjectId, MorphoObject>;

  const relationsWithoutDefault = workspace.relations.filter((relation) => relation.kind !== "defaultReference");
  const decisionId = makeDecisionId(workspace, "setDefaultReference", objectId);
  const updated = reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    relations: relationsWithoutDefault,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: decisionId,
        kind: "setDefaultReference",
        effect: { kind: "setDefaultReference", targetObjectId: objectId, targetIncarnationId: object.incarnationId, referenceObjectId: null },
        createdAt: now,
        summary: `清除后续默认参考：${object.title}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId],
        comparison: options.comparison
      }
    ]
  });

  return applyProjectContinuityEvent(updated, {
    type: "defaultReferenceChanged",
    imageObjectId: objectId,
    previousImageObjectId: currentDefaultReference.id,
    decisionId,
    createdAt: now
  });
}

export function createKeyConclusion(
  workspace: MorphoWorkspace,
  input: {
    title: string;
    body: string;
    summary?: string;
    sourceObjectIds: MorphoObjectId[];
    citationIds?: string[];
    category: AssignableKeyConclusionCategory;
    confidence: KeyConclusionObject["confidence"];
    state?: KeyConclusionObject["state"];
    note?: string;
    position: CanvasPoint;
    size?: CanvasSize;
    comparison?: ComparisonDecisionMetadata;
    evidence?: import("../operations/types").ResearchEvidence[];
    researchOrigin?: KeyConclusionObject["researchOrigin"];
  }
): CreateKeyConclusionResult {
  const now = new Date().toISOString();
  const objectId = nextAvailableId(workspace.objects, "key-conclusion");
  const evidence = input.evidence ?? (() => {
    const entry = { claim: input.body, sourceObjectIds: input.sourceObjectIds, citationIds: input.citationIds ?? [], confidence: input.confidence };
    return [{ ...entry, basis: captureEvidenceBasis(workspace, entry) }];
  })();
  const qualifications = evidence.map((entry) => qualifyEvidence(workspace, entry));
  const confidence = qualifications.length === 0 || qualifications.some((entry) => entry.confidence === "needsVerification") ? "needsVerification" : qualifications.every((entry) => entry.confidence === "supported") ? "supported" : "partial";
  const keyConclusion: KeyConclusionObject = {
    id: objectId,
    incarnationId: createObjectIncarnationId(),
    type: "keyConclusion",
    title: input.title,
    summary: input.summary ?? input.body,
    category: input.category,
    body: input.body,
    createdBy: "user",
    visibility: "active",
    state: input.state ?? "active",
    confidence,
    evidence,
    researchOrigin: input.researchOrigin,
    sourceObjectIds: [...input.sourceObjectIds],
    citationIds: [...(input.citationIds ?? [])],
    confirmedAt: now,
    note: input.note,
    createdAt: now,
    updatedAt: now
  };

  const relations = input.sourceObjectIds
    .filter((sourceObjectId) => Boolean(workspace.objects[sourceObjectId]))
    .map((sourceObjectId) => ({
      id: nextAvailableId(
        Object.fromEntries([...workspace.relations].map((relation) => [relation.id, relation])),
        `rel-${sourceObjectId}-${objectId}-conclusion`
      ),
      kind: "supportsConclusion" as const,
      fromObjectId: sourceObjectId,
      toObjectId: objectId,
      note: "该来源被用户保留为关键结论。"
    }));

  const nextWorkspace = reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: keyConclusion
    },
    relations: [...workspace.relations, ...relations],
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "createKeyConclusion", objectId),
        kind: "createKeyConclusion",
        effect: { kind: "createKeyConclusion", targetObjectId: objectId, targetIncarnationId: keyConclusion.incarnationId },
        createdAt: now,
        summary: `保留关键结论：${input.title}`,
        reason: input.note,
        objectSnapshot: snapshotObject(keyConclusion),
        relatedObjectIds: input.sourceObjectIds,
        comparison: input.comparison
      }
    ],
    canvas: {
      ...workspace.canvas,
      instances: [
        ...workspace.canvas.instances,
        {
          id: `canvas-${objectId}`,
          objectId,
          position: input.position,
          size: input.size ?? { w: 280, h: 120 }
        }
      ]
    },
    ui: {
      ...workspace.ui,
      lastSelectionIds: [objectId]
    }
  });

  return {
    workspace: applyProjectContinuityEvent(nextWorkspace, {
      type: "keyConclusionSaved",
      objectId,
      sourceObjectIds: input.sourceObjectIds,
      decisionId: nextWorkspace.decisionRecords.at(-1)?.id,
      createdAt: now
    }),
    keyConclusion
  };
}

export function buildKeyConclusionDraftFromResearchSource(
  workspace: MorphoWorkspace,
  researchObjectId: MorphoObjectId,
  source: ResearchKeyConclusionSource
): KeyConclusionDraftFromResearchResult {
  const research = workspace.objects[researchObjectId];
  if (!research || research.type !== "research") {
    return {
      status: "blocked",
      reason: "研究对象不存在。"
    };
  }

  const content = source.kind === "evidence" ? research.evidence?.[source.index]?.claim : getResearchListItem(research, source.kind, source.index);
  if (!content) return { status: "blocked", reason: "指定研究条目不存在。" };
  const item = source.kind === "evidence" ? undefined : { kind: source.kind, index: source.index, text: content };
  const inherited = source.kind === "evidence"
    ? [research.evidence![source.index]!]
    : (research.evidence ?? []).filter((entry) => item && entry.item && entry.item.kind === item.kind && entry.item.index === item.index && entry.item.text === content);
  const qualifications = inherited.map((entry) => qualifyEvidence(workspace, entry));
  const confidence = source.kind === "openQuestion" || qualifications.length === 0 || qualifications.some((entry) => entry.confidence === "needsVerification")
    ? "needsVerification" : qualifications.every((entry) => entry.confidence === "supported") ? "supported" : "partial";
  return {
    status: "ready",
    draft: {
      title: truncateForTitle(content, "关键结论"), summary: content, body: content,
      category: source.kind === "evidence" ? source.category : source.kind,
      sourceObjectIds: [...new Set([research.id, ...inherited.flatMap((entry) => entry.sourceObjectIds)])],
      citationIds: [...new Set(inherited.flatMap((entry) => entry.citationIds))],
      confidence, state: confidence === "needsVerification" ? "needsVerification" : "active",
      evidence: inherited.map((entry) => ({ ...entry })),
      ...(item ? { researchOrigin: { researchObjectId: research.id, item } } : {}),
      note: `用户从研究对象“${research.title}”的第 ${source.index + 1} 条候选中保留关键结论。`
    }
  };
}

export function setKeyConclusionCategory(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  nextCategory: AssignableKeyConclusionCategory,
  options: { reason?: string } = {}
): SetKeyConclusionCategoryResult {
  const target = workspace.objects[objectId];
  if (!target || target.type !== "keyConclusion") {
    return {
      status: "blocked",
      workspace,
      reason: "目标关键结论不存在。"
    };
  }

  if (!isAssignableKeyConclusionCategory(nextCategory)) {
    return {
      status: "blocked",
      workspace,
      reason: "关键结论只能改为四个可分配类别之一。"
    };
  }

  if (target.category === nextCategory) {
    return {
      status: "updated",
      workspace,
      keyConclusion: target
    };
  }

  const now = new Date().toISOString();
  const updatedConclusion: KeyConclusionObject = {
    ...target,
    category: nextCategory,
    updatedAt: now
  };
  const nextWorkspace = reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [target.id]: updatedConclusion
    },
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setKeyConclusionCategory", target.id),
        kind: "setKeyConclusionCategory",
        effect: { kind: "setKeyConclusionCategory", targetObjectId: target.id, targetIncarnationId: target.incarnationId, category: nextCategory },
        createdAt: now,
        summary: `更新关键结论类别：${target.title} → ${nextCategory}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(updatedConclusion),
        relatedObjectIds: [target.id]
      }
    ]
  });

  return {
    status: "updated",
    workspace: nextWorkspace,
    keyConclusion: nextWorkspace.objects[target.id] as KeyConclusionObject
  };
}

export function setKeyConclusionState(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  nextState: KeyConclusionObject["state"],
  options: {
    reason?: string;
    supersededById?: MorphoObjectId;
  } = {}
): SetKeyConclusionStateResult {
  const target = workspace.objects[objectId];
  if (!target || target.type !== "keyConclusion") {
    return {
      status: "blocked",
      workspace,
      reason: "目标关键结论不存在。"
    };
  }

  if (nextState === "superseded") {
    if (!options.supersededById) {
      return {
        status: "blocked",
        workspace,
        reason: "将关键结论标记为已替代时，必须提供 supersededById。"
      };
    }

    const replacement = workspace.objects[options.supersededById];
    if (!replacement || replacement.type !== "keyConclusion" || replacement.id === target.id) {
      return {
        status: "blocked",
        workspace,
        reason: "supersededById 必须指向另一个关键结论对象。"
      };
    }
  }

  const now = new Date().toISOString();
  const updatedConclusion: KeyConclusionObject = {
    ...target,
    state: nextState,
    supersededById: nextState === "superseded" ? options.supersededById : undefined,
    updatedAt: now
  };

  const nextWorkspace = reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [target.id]: updatedConclusion
    },
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setKeyConclusionState", target.id),
        kind: "setKeyConclusionState",
        effect: { kind: "setKeyConclusionState", targetObjectId: target.id, targetIncarnationId: target.incarnationId, state: nextState, supersededById: nextState === "superseded" ? options.supersededById : undefined },
        createdAt: now,
        summary: `更新关键结论状态：${target.title} → ${nextState}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(updatedConclusion),
        relatedObjectIds:
          nextState === "superseded" && options.supersededById
            ? [target.id, options.supersededById]
            : [target.id]
      }
    ]
  });

  return {
    status: "updated",
    workspace: nextWorkspace,
    keyConclusion: nextWorkspace.objects[target.id] as KeyConclusionObject
  };
}

function getResearchListItem(
  research: Extract<MorphoObject, { type: "research" }>,
  kind: Exclude<ResearchKeyConclusionSource["kind"], "evidence">,
  index: number
): string | undefined {
  switch (kind) {
    case "finding":
      return research.findings[index];
    case "opportunity":
      return research.opportunities[index];
    case "constraint":
      return research.constraints[index];
    case "openQuestion":
      return research.openQuestions[index];
  }
}

function truncateForTitle(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}...` : trimmed;
}

export function createDeliveryReference(
  workspace: MorphoWorkspace,
  input: {
    deliveryObjectId: MorphoObjectId;
    sourceObjectId: MorphoObjectId;
    caption: string;
  }
): CreateDeliveryReferenceResult {
  const deliveryObject = workspace.objects[input.deliveryObjectId];
  const sourceObject = workspace.objects[input.sourceObjectId];

  if (!deliveryObject || deliveryObject.type !== "delivery") {
    return {
      status: "blocked",
      workspace,
      reason: "交付模块不存在。"
    };
  }

  if (!sourceObject) {
    return {
      status: "blocked",
      workspace,
      reason: "来源对象不存在。"
    };
  }
  const section = deliveryObject.sections[0];
  if (!section) {
    return {
      status: "blocked",
      workspace,
      reason: "交付准备包需要至少一个章节。"
    };
  }

  const deliveryReferenceId = getAvailableDeliveryReferenceId(
    workspace,
    makeDeliveryReferenceId(deliveryObject.id, sourceObject.id)
  );
  const deliveryReference: DeliveryReference = {
    id: deliveryReferenceId,
    deliveryObjectId: deliveryObject.id,
    sectionId: section.id,
    order: section.referenceIds.length,
    sourceObjectId: sourceObject.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    snapshot: createStableDeliveryReferenceSnapshot(workspace, sourceObject),
    sourceFingerprint: createDeliverySourceFingerprint(workspace, sourceObject),
    editorial: {
      caption: input.caption
    }
  };
  const updatedDeliveryObject: DeliveryObject = {
    ...deliveryObject,
    references: [...deliveryObject.references, deliveryReferenceId],
    sections: deliveryObject.sections.map((candidate) =>
      candidate.id === section.id
        ? {
            ...candidate,
            referenceIds: [...candidate.referenceIds, deliveryReferenceId],
            updatedAt: deliveryReference.updatedAt ?? deliveryReference.createdAt
          }
        : candidate
    )
  };

  return {
    status: "updated",
    deliveryReferenceId,
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [deliveryObject.id]: updatedDeliveryObject
      },
      deliveryReferences: {
        ...workspace.deliveryReferences,
        [deliveryReferenceId]: deliveryReference
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: makeDecisionId(workspace, "createDeliveryReference", deliveryReferenceId),
          kind: "createDeliveryReference",
          createdAt: new Date().toISOString(),
          summary: `创建交付引用：${sourceObject.title}`,
          objectSnapshot: snapshotObject(sourceObject),
          relatedObjectIds: [sourceObject.id, deliveryObject.id]
        }
      ]
    })
  };
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function getDeleteConfirmationReasons(workspace: MorphoWorkspace, object: MorphoObject): string[] {
  const reasons: string[] = [];

  if (object.type === "image" && object.isDefaultReference) {
    reasons.push("对象是当前后续默认参考。");
  }

  const hasActiveRelation = workspace.relations.some((relation) => {
    if (relation.fromObjectId !== object.id && relation.toObjectId !== object.id) {
      return false;
    }

    const otherObjectId = relation.fromObjectId === object.id ? relation.toObjectId : relation.fromObjectId;
    return workspace.objects[otherObjectId]?.visibility === "active";
  });

  if (hasActiveRelation) {
    reasons.push("对象仍被活动关系引用。");
  }

  return reasons;
}

function snapshotObject(object: MorphoObject): ObjectSnapshot {
  return {
    id: object.id,
    type: object.type,
    title: object.title
  };
}

function getAvailableDeliveryReferenceId(
  workspace: MorphoWorkspace,
  preferredId: DeliveryReferenceId
): DeliveryReferenceId {
  if (!workspace.deliveryReferences[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (workspace.deliveryReferences[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredId}-${suffix}`;
}

function makeDecisionId(workspace: MorphoWorkspace, kind: string, objectId: string): string {
  return `decision-${kind}-${objectId}-${workspace.decisionRecords.length + 1}`;
}

function ensureBelongsToDirectionRelation(
  workspace: MorphoWorkspace,
  imageId: MorphoObjectId,
  directionId: MorphoObjectId
): MorphoRelation[] {
  if (
    workspace.relations.some(
      (relation) =>
        relation.kind === "belongsToDirection" &&
        relation.fromObjectId === imageId &&
        relation.toObjectId === directionId
    )
  ) {
    return workspace.relations;
  }

  return [
    ...workspace.relations,
    {
      id: nextAvailableId(
        Object.fromEntries(workspace.relations.map((relation) => [relation.id, relation])),
        `rel-${imageId}-${directionId}-direction`
      ),
      kind: "belongsToDirection",
      fromObjectId: imageId,
      toObjectId: directionId,
      note: "图片被明确加入该方向的视觉分支。"
    }
  ];
}

function nextAvailableId(record: Record<string, unknown>, preferredId: string): string {
  if (!record[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (record[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredId}-${suffix}`;
}

function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "branch";
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

function uniqueObjectIds(objectIds: MorphoObjectId[]): MorphoObjectId[] {
  return [...new Set(objectIds.filter(Boolean))];
}

/** Edit an ordinary note, preserving identity and refusing a changed source. */
export function updateTextObject(workspace: MorphoWorkspace, input: { objectId: string; incarnationId?: string; expectedBody: string; body: string }):
  { status: "updated"; workspace: MorphoWorkspace } | { status: "blocked"; reason: string } {
  const object = workspace.objects[input.objectId];
  if (!object || object.type !== "text" || object.visibility !== "active" || object.incarnationId !== input.incarnationId || object.body !== input.expectedBody) return { status: "blocked", reason: "文本已变化或不可用，请重新打开编辑。" };
  const body = input.body.trim();
  if (!body) return { status: "blocked", reason: "文本内容不能为空。" };
  if (body === object.body) return { status: "updated", workspace };
  return { status: "updated", workspace: reconcileWorkspaceDerivedState({ ...workspace, objects: { ...workspace.objects, [object.id]: { ...object, body, summary: body, title: body.length > 28 ? `${body.slice(0, 28)}...` : body } } }) };
}
