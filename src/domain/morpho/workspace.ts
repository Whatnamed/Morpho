import { reconcileWorkspaceDerivedState, createEmptyProjectWorkingState } from "./derivedState";
import {
  createDeliveryReferenceSnapshot as createStableDeliveryReferenceSnapshot,
  createDeliverySourceFingerprint
} from "./deliveryPreparation";
import {
  applyProjectContinuityEvent,
  createInitialProjectContinuity,
  normalizeProjectContinuityWithMessageReferences,
  resolveContinuityValidity,
  type LegacyProjectFocus
} from "./projectContinuity";
import {
  createEmptyProjectMemoryState,
  normalizeProjectMemoryState,
  reconcileProjectMemory
} from "./projectMemory";
import {
  createEmptyConversationCompactionState,
  migrateLegacyCheckpointToConversationCompaction,
  normalizeConversationCompactionState,
  normalizeConversationSummaryRevisions
} from "./conversationCompaction";
import {
  normalizeProviderInputSnapshot,
  normalizeProviderOutputSnapshot
} from "./providerInputSnapshot";
import { isValidCanonicalAgentRuntimeItem } from "@/shared/agentRuntimeItem";
import type { AgentCacheItemManifest } from "@/shared/agentStreamProtocol";
import initialCaseStudyWorkspaceFixture from "./caseStudy/currentCaseWorkspace.generated.json";
import legacyNightrailTestFixture from "./caseStudy/legacyNightrailPristine.fixture.json";
import type { ArtifactProposal, SourceSemanticSnapshot } from "../operations/types";
import type {
  AiDraftResult,
  AiMessage,
  AiSuggestionInput,
  AgentTrace,
  AssembleAiContextInput,
  AssembledAiContext,
  AssetId,
  AssetRecord,
  CanvasInstance,
  CanvasInstanceId,
  CanvasPoint,
  CanvasSize,
  ConceptDirectionObject,
  ConceptDirectionStatus,
  DeliveryObject,
  DeliveryGap,
  DeliveryReference,
  DeliveryReferenceId,
  DeliverySection,
  DesignDefinitionObject,
  DesignDefinitionRevision,
  DirectionRevisionId,
  FileObject,
  FileParseStatus,
  ImageObject,
  ImageRole,
  KeyConclusionObject,
  ComparisonDecisionMetadata,
  ConversationSummaryRevision,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoRelation,
  MorphoWorkspace,
  ObjectSnapshot,
  ProviderContextFrame,
  ProviderInputCacheBoundaryReason,
  RelationKind,
  VisualBranchId,
  VisualReviewMark,
  WorkspaceMigrationResult
} from "./types";

const DEFAULT_REFERENCE_HIDDEN_MESSAGE = "当前后续默认参考已隐藏，请先恢复或替换后再用于相关生成。";
const CURRENT_SCHEMA_VERSION = 15;

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
        confidence: KeyConclusionObject["confidence"];
        state?: "active" | "needsVerification";
        note: string;
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

export function createInitialWorkspace(): MorphoWorkspace {
  if (process.env.NODE_ENV === "test") {
    return createTestWorkspace();
  }

  return createCurrentCaseStudyWorkspace();
}

export function createCurrentCaseStudyWorkspace(): MorphoWorkspace {
  const parsed = parseWorkspace(JSON.stringify(initialCaseStudyWorkspaceFixture));
  if (parsed.status === "failed") {
    throw new Error(`Current case study workspace is invalid: ${parsed.reason}`);
  }
  return reconcileWorkspaceDerivedState(structuredClone(parsed.workspace));
}

// Test-only fixture kept separate from the deployable case study so domain tests remain focused.
export function createTestWorkspace(): MorphoWorkspace {
  const parsed = parseWorkspace(JSON.stringify(legacyNightrailTestFixture));
  if (parsed.status === "failed") {
    throw new Error(`Legacy test workspace is invalid: ${parsed.reason}`);
  }
  return reconcileWorkspaceDerivedState(structuredClone(parsed.workspace));
}

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
      conversationCheckpoints: [],
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
    summary: `${object.mimeType || "未知类型"} · ${formatFileSize(object.size ?? 0)} · 已解析 ${input.extractedCharCount} 字符${
      input.extractedPageCount ? ` · ${input.extractedPageCount} 页/张` : ""
    }`,
    parseStatus: "parsed",
    extractedAssetId: input.extractAsset.id,
    extractedCharCount: input.extractedCharCount,
    extractedPageCount: input.extractedPageCount,
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

export function assembleAiContext(workspace: MorphoWorkspace, input: AssembleAiContextInput): AssembledAiContext {
  const objectIds = new Set<MorphoObjectId>();

  for (const objectId of [...input.selectedObjectIds, ...input.explicitObjectIds]) {
    if (workspace.objects[objectId]?.visibility === "active") {
      objectIds.add(objectId);
    }
  }

  if (input.task === "designDefinition") {
    addWorkingStateObjects(workspace, objectIds, [
      workspace.workingState.currentDesignDefinitionId,
      ...workspace.workingState.activeKeyConclusionIds,
      ...workspace.workingState.recentResearchObjectIds
    ]);
  }

  if (input.task === "conceptDirection" || input.task === "comparison") {
    addWorkingStateObjects(workspace, objectIds, [
      workspace.workingState.currentDesignDefinitionId,
      ...workspace.workingState.activeKeyConclusionIds
    ]);
  }

  if (input.task === "deliveryPreparation") {
    addWorkingStateObjects(workspace, objectIds, [
      workspace.workingState.currentDesignDefinitionId,
      workspace.workingState.primaryDirectionId
    ]);
  }

  const defaultReference = findDefaultReference(workspace);

  if (input.task === "visualDevelopment") {
    addWorkingStateObjects(workspace, objectIds, [
      workspace.workingState.currentDesignDefinitionId,
      input.visualTargetDirectionId
    ]);

    if (!defaultReference) {
      return {
        draft: input.draft,
        objectIds: [...objectIds],
        defaultReferenceStatus: {
          status: "missing",
          message: "当前没有后续默认参考；本次只使用当前选择和输入。"
        }
      };
    }

    if (defaultReference.visibility === "hidden") {
      return {
        draft: input.draft,
        objectIds: [...objectIds],
        defaultReferenceStatus: {
          status: "hidden",
          objectId: defaultReference.id,
          message: DEFAULT_REFERENCE_HIDDEN_MESSAGE
        }
      };
    }

    if (!input.visualTargetDirectionId || defaultReference.directionId !== input.visualTargetDirectionId) {
      return {
        draft: input.draft,
        objectIds: [...objectIds],
        defaultReferenceStatus: {
          status: "missing",
          message: "当前默认参考不属于本次明确目标方向；本次只使用当前选择和输入。"
        }
      };
    }

    objectIds.add(defaultReference.id);
    return {
      draft: input.draft,
      objectIds: [...objectIds],
      defaultReferenceStatus: {
        status: "available",
        objectId: defaultReference.id
      }
    };
  }

  return {
    draft: input.draft,
    objectIds: [...objectIds],
    defaultReferenceStatus: {
      status: "notRelevant"
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
      decisionRecords,
      canvas: {
        ...workspace.canvas,
        instances: canvasInstances
      }
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
    objects: normalizeObjectsForSchemaV13(objects),
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: decisionId,
        kind: "setDirectionStatus",
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

    const linkedByGeneration = object.generation?.referenceObjectIds?.includes(previousReferenceId) ?? false;
    const linkedByRelation = workspace.relations.some(
      (relation) =>
        DERIVATIVE_LINK_RELATION_KINDS.has(relation.kind) &&
        relation.fromObjectId === previousReferenceId &&
        relation.toObjectId === object.id
    );
    if (linkedByGeneration || linkedByRelation) {
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
    confidence: KeyConclusionObject["confidence"];
    state?: KeyConclusionObject["state"];
    note?: string;
    position: CanvasPoint;
    size?: CanvasSize;
    comparison?: ComparisonDecisionMetadata;
  }
): CreateKeyConclusionResult {
  const now = new Date().toISOString();
  const objectId = nextAvailableId(workspace.objects, "key-conclusion");
  const keyConclusion: KeyConclusionObject = {
    id: objectId,
    type: "keyConclusion",
    title: input.title,
    summary: input.summary ?? input.body,
    body: input.body,
    createdBy: "user",
    visibility: "active",
    state: input.state ?? "active",
    confidence: input.confidence,
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

  if (source.kind === "evidence") {
    const evidence = research.evidence?.[source.index];
    if (!evidence) {
      return {
        status: "blocked",
        reason: "指定证据不存在。"
      };
    }

    return {
      status: "ready",
      draft: {
        title: truncateForTitle(evidence.claim, "关键结论"),
        summary: evidence.claim,
        body: evidence.claim,
        sourceObjectIds: evidence.sourceObjectIds.filter((sourceObjectId) => Boolean(workspace.objects[sourceObjectId])),
        citationIds: [...evidence.citationIds],
        confidence: evidence.confidence,
        state: evidence.confidence === "needsVerification" ? "needsVerification" : "active",
        note: `用户从研究对象“${research.title}”的第 ${source.index + 1} 条证据中保留关键结论。`
      }
    };
  }

  const content = getResearchListItem(research, source.kind, source.index);
  if (!content) {
    return {
      status: "blocked",
      reason: "指定研究条目不存在。"
    };
  }

  const confidence = source.kind === "openQuestion" ? "needsVerification" : "partial";

  return {
    status: "ready",
    draft: {
      title: truncateForTitle(content, "关键结论"),
      summary: content,
      body: content,
      sourceObjectIds: [research.id],
      citationIds: [...(research.provenance?.citationIds ?? [])],
      confidence,
      state: confidence === "needsVerification" ? "needsVerification" : "active",
      note: `用户从研究对象“${research.title}”的${formatResearchSourceKind(source.kind)}第 ${
        source.index + 1
      }条中保留关键结论。`
    }
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

function formatResearchSourceKind(kind: Exclude<ResearchKeyConclusionSource["kind"], "evidence">): string {
  switch (kind) {
    case "finding":
      return "发现";
    case "opportunity":
      return "机会点";
    case "constraint":
      return "约束";
    case "openQuestion":
      return "待验证问题";
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

export function serializeWorkspace(workspace: MorphoWorkspace): string {
  return JSON.stringify(workspace);
}

export function parseWorkspace(raw: string): WorkspaceMigrationResult {
  try {
    return migrateWorkspaceToCurrentSchema(JSON.parse(raw) as unknown);
  } catch {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is not valid JSON."
    };
  }
}

export function migrateWorkspaceToCurrentSchema(value: unknown): WorkspaceMigrationResult {
  if (!isRecord(value)) {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is not an object."
    };
  }

  if (value.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace(value),
      didMigrate: false
    };
  }

  if (value.schemaVersion === 14) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 13) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 12) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 11) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 10) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 9) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 8) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 7) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 6) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 5) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace({
        ...(structuredClone(value) as Record<string, unknown>),
        schemaVersion: CURRENT_SCHEMA_VERSION
      }),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 4) {
    return {
      status: "ok",
      workspace: migrateV4Workspace(value),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 3) {
    return {
      status: "ok",
      workspace: migrateV4Workspace(migrateV3WorkspaceToV4(value)),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 2) {
    return {
      status: "ok",
      workspace: migrateV4Workspace(migrateV2WorkspaceToV4(value)),
      didMigrate: true
    };
  }

  if (value.schemaVersion !== 1) {
    return {
      status: "failed",
      reason: "Unsupported Morpho workspace schema version."
    };
  }

  const migrated = migrateV1Workspace(value);

  if (!migrated) {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is missing required v1 fields."
    };
  }

  return {
    status: "ok",
    workspace: migrateV4Workspace(migrateV2WorkspaceToV4(migrated)),
    didMigrate: true
  };
}

function migrateV1Workspace(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(value.project) || !isRecord(value.objects) || !Array.isArray(value.relations) || !isRecord(value.canvas)) {
    return null;
  }

  const sourceObjects = value.objects;
  const migratedObjects: Record<MorphoObjectId, MorphoObject> = {};
  const deliveryReferences: Record<DeliveryReferenceId, DeliveryReference> = {};

  for (const [objectId, rawObject] of Object.entries(sourceObjects)) {
    if (!isRecord(rawObject) || typeof rawObject.type !== "string") {
      return null;
    }

    const visibility = rawObject.visibility === "hidden" ? "hidden" : "active";

    if (rawObject.type === "delivery") {
      const sourceIds = getStringArray(rawObject.references);
      const references = sourceIds.map((sourceObjectId) => makeDeliveryReferenceId(objectId, sourceObjectId));
      migratedObjects[objectId] = {
        ...(rawObject as unknown as DeliveryObject),
        visibility,
        references,
        sections: createMigratedDeliverySections(objectId, references, "2026-06-23T00:00:00.000Z"),
        gaps: normalizeDeliveryGaps((rawObject as Partial<DeliveryObject>).gaps, "2026-06-23T00:00:00.000Z")
      };
      continue;
    }

    migratedObjects[objectId] = {
      ...(rawObject as unknown as MorphoObject),
      visibility
    };
  }

  for (const [objectId, rawObject] of Object.entries(sourceObjects)) {
    if (!isRecord(rawObject) || rawObject.type !== "delivery") {
      continue;
    }

    for (const sourceObjectId of getStringArray(rawObject.references)) {
      const sourceObject = migratedObjects[sourceObjectId];
      if (!sourceObject) {
        continue;
      }

      const deliveryReferenceId = makeDeliveryReferenceId(objectId, sourceObjectId);
      deliveryReferences[deliveryReferenceId] = {
        id: deliveryReferenceId,
        deliveryObjectId: objectId,
        sectionId: `section-${objectId}-migrated-content`,
        order: getStringArray(rawObject.references).indexOf(sourceObjectId),
        sourceObjectId,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
        snapshot: createStableDeliveryReferenceSnapshot(
          {
            objects: migratedObjects,
            assets: {},
            designDefinitionRevisions: {},
            directionRevisions: {}
          } as MorphoWorkspace,
          sourceObject
        ),
        sourceFingerprint: createDeliverySourceFingerprint(
          {
            objects: migratedObjects,
            assets: {},
            designDefinitionRevisions: {},
            directionRevisions: {}
          } as MorphoWorkspace,
          sourceObject
        )
      };
    }
  }

  return {
    ...(structuredClone(value) as Record<string, unknown>),
    schemaVersion: 2,
    objects: migratedObjects,
    deliveryReferences,
    deliverySectionDrafts: {},
    decisionRecords: []
  };
}

function migrateV2WorkspaceToV4(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value) as Record<string, unknown>;
  const project = isRecord(cloned.project) ? cloned.project : {};
  const canvas = isRecord(cloned.canvas) ? cloned.canvas : {};
  const canvasView = isRecord(canvas.view) ? canvas.view : { x: 0, y: 0, zoom: 1 };

  return {
    ...cloned,
    schemaVersion: 4,
    project: {
      ...project,
      createdAt: typeof project.createdAt === "string" ? project.createdAt : "2026-06-23T00:00:00.000Z",
      updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "2026-06-23T00:00:00.000Z",
      lastOpenedAt:
        typeof project.lastOpenedAt === "string"
          ? project.lastOpenedAt
          : typeof project.updatedAt === "string"
            ? project.updatedAt
            : "2026-06-23T00:00:00.000Z"
    },
    assets: createLegacyAssetRecords(cloned.objects as Record<MorphoObjectId, MorphoObject>),
    operations: {},
    artifactProposals: {},
    citationSnapshots: {},
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView,
      workIntent: "discussion"
    }
  };
}

function migrateV3WorkspaceToV4(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value) as Record<string, unknown>;
  return {
    ...cloned,
    schemaVersion: 4,
    operations: {},
    artifactProposals: {},
    citationSnapshots: {}
  };
}

function migrateV4Workspace(value: Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as Record<string, unknown>;
  const now = new Date().toISOString();
  const rawObjects = isRecord(cloned.objects) ? cloned.objects : {};
  const rawRelations = Array.isArray(cloned.relations) ? (cloned.relations as MorphoRelation[]) : [];
  const objects: Record<MorphoObjectId, MorphoObject> = {};
  const designDefinitionRevisions: Record<string, DesignDefinitionRevision> = {};
  const directionRevisions: Record<string, MorphoWorkspace["directionRevisions"][string]> = {};

  for (const [objectId, rawObject] of Object.entries(rawObjects)) {
    if (!isRecord(rawObject) || typeof rawObject.type !== "string") {
      continue;
    }

    const createdAt = typeof rawObject.createdAt === "string" ? rawObject.createdAt : now;
    const updatedAt = typeof rawObject.updatedAt === "string" ? rawObject.updatedAt : createdAt;

    if (rawObject.type === "insight" || rawObject.type === "keyConclusion") {
      const state = rawObject.insightState === "needsValidation"
        ? "needsVerification"
        : rawObject.insightState === "superseded"
          ? "superseded"
          : rawObject.state === "needsVerification" || rawObject.state === "superseded" || rawObject.state === "archived"
            ? rawObject.state
            : "active";
      objects[objectId] = {
        id: objectId,
        type: "keyConclusion",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        body: stringValue(rawObject.body, stringValue(rawObject.summary)),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        state,
        confidence: rawObject.confidence === "supported" || rawObject.confidence === "partial" ? rawObject.confidence : "supported",
        sourceObjectIds: [],
        citationIds: [],
        confirmedAt: createdAt,
        note: typeof rawObject.note === "string" ? rawObject.note : undefined,
        createdAt,
        updatedAt
      };
      continue;
    }

    if (rawObject.type === "designDefinition") {
      const revisionId = `definition-revision-${objectId}-1`;
      objects[objectId] = {
        id: objectId,
        type: "designDefinition",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        problem: stringValue(rawObject.problem),
        principles: getStringArray(rawObject.principles),
        avoid: getStringArray(rawObject.avoid),
        currentRevisionId: revisionId,
        revisionIds: [revisionId],
        isCurrentEffective: true,
        createdAt,
        updatedAt
      };
      designDefinitionRevisions[revisionId] = {
        id: revisionId,
        designDefinitionId: objectId,
        revisionNumber: 1,
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        projectGoal: stringValue(rawObject.summary),
        targetUsers: [],
        primaryScenarios: [],
        coreProblem: stringValue(rawObject.problem),
        designPrinciples: getStringArray(rawObject.principles),
        constraints: [],
        avoidDirections: getStringArray(rawObject.avoid),
        opportunities: [],
        openQuestions: [],
        sourceObjectIds: rawRelations
          .filter((relation) => relation.kind === "supports" && relation.toObjectId === objectId)
          .map((relation) => relation.fromObjectId),
        citationIds: [],
        createdAt,
        isCurrent: true
      };
      continue;
    }

    if (rawObject.type === "conceptDirection") {
      const revisionId = `direction-revision-${objectId}-1` as DirectionRevisionId;
      const currentDefinition = Object.values(designDefinitionRevisions).find((revision) => revision.isCurrent);
      objects[objectId] = {
        id: objectId,
        type: "conceptDirection",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        status: isDirectionStatus(rawObject.status) ? rawObject.status : "pendingPreview",
        keywords: getStringArray(rawObject.keywords),
        currentRevisionId: revisionId,
        revisionIds: [revisionId],
        lineageRootId: objectId,
        createdAt,
        updatedAt
      };
      directionRevisions[revisionId] = {
        id: revisionId,
        directionId: objectId,
        revisionNumber: 1,
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        conceptStatement: stringValue(rawObject.summary),
        keywords: getStringArray(rawObject.keywords),
        strategy: stringValue(rawObject.summary),
        differentiators: [],
        visualSignals: [],
        risks: [],
        openQuestions: [],
        sourceObjectIds: rawRelations
          .filter((relation) => relation.kind === "supports" && relation.toObjectId === objectId)
          .map((relation) => relation.fromObjectId),
        citationIds: [],
        basedOnDefinitionRevisionId: currentDefinition?.id,
        createdAt,
        isCurrent: true
      };
      continue;
    }

    objects[objectId] = {
      ...(rawObject as unknown as MorphoObject),
      visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
      createdAt,
      updatedAt
    };
  }

  const normalized: MorphoWorkspace = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: stringValue((cloned.project as Record<string, unknown>)?.id, "project-nightrail"),
      title: stringValue((cloned.project as Record<string, unknown>)?.title, "未命名项目"),
      subtitle: stringValue((cloned.project as Record<string, unknown>)?.subtitle),
      createdAt: stringValue((cloned.project as Record<string, unknown>)?.createdAt, now),
      updatedAt: stringValue((cloned.project as Record<string, unknown>)?.updatedAt, now),
      lastOpenedAt: stringValue((cloned.project as Record<string, unknown>)?.lastOpenedAt, now),
      coverAssetId:
        typeof (cloned.project as Record<string, unknown>)?.coverAssetId === "string"
          ? ((cloned.project as Record<string, unknown>).coverAssetId as string)
          : undefined
    },
    objects,
    assets: isRecord(cloned.assets) ? (cloned.assets as Record<AssetId, AssetRecord>) : {},
    relations: rawRelations,
    deliveryReferences: isRecord(cloned.deliveryReferences)
      ? normalizeDeliveryReferences(
          cloned.deliveryReferences as Record<DeliveryReferenceId, DeliveryReference>,
          normalizeObjectsForSchemaV13(objects),
          isRecord(cloned.assets) ? (cloned.assets as Record<AssetId, AssetRecord>) : {}
        )
      : {},
    deliverySectionDrafts: isRecord(cloned.deliverySectionDrafts)
      ? (cloned.deliverySectionDrafts as MorphoWorkspace["deliverySectionDrafts"])
      : {},
    decisionRecords: Array.isArray(cloned.decisionRecords) ? (cloned.decisionRecords as MorphoWorkspace["decisionRecords"]) : [],
    operations: isRecord(cloned.operations) ? (cloned.operations as MorphoWorkspace["operations"]) : {},
    artifactProposals: isRecord(cloned.artifactProposals)
      ? (cloned.artifactProposals as MorphoWorkspace["artifactProposals"])
      : {},
    citationSnapshots: isRecord(cloned.citationSnapshots)
      ? (cloned.citationSnapshots as MorphoWorkspace["citationSnapshots"])
      : {},
    designDefinitionRevisions,
    directionRevisions,
    directionLineage: [],
    visualBranches: {},
    workingState: createEmptyProjectWorkingState(now),
    projectContinuity: createInitialProjectContinuity({
      workspace: {
        project: {
          id: stringValue((cloned.project as Record<string, unknown>)?.id, "project-nightrail"),
          title: stringValue((cloned.project as Record<string, unknown>)?.title, "未命名项目"),
          subtitle: stringValue((cloned.project as Record<string, unknown>)?.subtitle),
          createdAt: stringValue((cloned.project as Record<string, unknown>)?.createdAt, now),
          updatedAt: stringValue((cloned.project as Record<string, unknown>)?.updatedAt, now),
          lastOpenedAt: stringValue((cloned.project as Record<string, unknown>)?.lastOpenedAt, now)
        },
        objects,
        designDefinitionRevisions,
        directionRevisions
      },
      now,
      legacyFocus: legacyProjectFocus((cloned.project as Record<string, unknown>)?.currentFocus)
    }),
    projectMemory: createEmptyProjectMemoryState(now),
    canvas: (cloned.canvas as MorphoWorkspace["canvas"]) ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: normalizeAiState(cloned.ai),
    ui: (cloned.ui as MorphoWorkspace["ui"]) ?? {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: { x: 0, y: 0, zoom: 1 },
      workIntent: "discussion"
    }
  };

  return reconcileWorkspaceDerivedState(normalizeCurrentWorkspace(normalized), now);
}

function normalizeAiState(value: unknown): MorphoWorkspace["ai"] {
  if (!isRecord(value)) {
    return {
      messages: [],
      conversationCheckpoints: [],
      conversationCompaction: createEmptyConversationCompactionState(),
      conversationSummaryRevisions: {},
      providerContextFrames: [],
      comparisonAnalyses: {}
    };
  }

  const messages = Array.isArray(value.messages)
    ? (value.messages as AiMessage[]).map(normalizeAiMessage)
    : [];
  const conversationCheckpoints = Array.isArray(value.conversationCheckpoints)
      ? value.conversationCheckpoints.filter(isConversationCheckpoint)
      : [];
  const migrated = migrateLegacyCheckpointToConversationCompaction({
    messages,
    checkpoints: conversationCheckpoints,
    state: normalizeConversationCompactionState(value.conversationCompaction),
    revisions: normalizeConversationSummaryRevisions(value.conversationSummaryRevisions)
  });

  return {
    messages,
    conversationCheckpoints,
    conversationCompaction: migrated.state,
    conversationSummaryRevisions: migrated.revisions,
    providerContextFrames: normalizeProviderContextFrames(
      value.providerContextFrames,
      migrated.revisions,
      messages
    ),
    ...(normalizeLatestProviderRequestState(value.latestProviderRequestState)
      ? { latestProviderRequestState: normalizeLatestProviderRequestState(value.latestProviderRequestState) }
      : {}),
    comparisonAnalyses: isRecord(value.comparisonAnalyses)
      ? (value.comparisonAnalyses as MorphoWorkspace["ai"]["comparisonAnalyses"])
      : {}
  };
}

function normalizeProviderContextFrames(
  value: unknown,
  summaryRevisions: Record<string, ConversationSummaryRevision>,
  messages: readonly AiMessage[]
): ProviderContextFrame[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const usedSequences = new Set<number>();
  const summaryKeys = new Set<string>();
  const frames = value.flatMap((candidate, index) => {
    if (!isRecord(candidate) || candidate.contextVisibility !== "providerOnly") {
      return [];
    }
    const kind = candidate.kind as ProviderContextFrame["kind"];
    if (
      (kind !== "projectState" &&
        kind !== "turnContext" &&
        kind !== "runtimeConfiguration" &&
        kind !== "conversationSummary") ||
      typeof candidate.id !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.promptContractVersion !== "string" ||
      typeof candidate.renderedText !== "string" ||
      typeof candidate.contentHash !== "string" ||
      typeof candidate.reason !== "string"
    ) {
      return [];
    }
    const sourceRefs = Array.isArray(candidate.sourceRefs)
      ? candidate.sourceRefs.flatMap((source) => {
          if (!isRecord(source) || typeof source.kind !== "string" || typeof source.id !== "string") {
            return [];
          }
          return [{
            kind: source.kind,
            id: source.id,
            ...(typeof source.title === "string" ? { title: source.title } : {})
          }];
        })
      : [];
    const sequence = normalizeFrameSequence(candidate.sequence, index + 1, usedSequences);
    const placement = kind === "conversationSummary"
      ? "conversationBaseline"
      : normalizeFramePlacement(candidate.placement, candidate.anchorMessageId);
    const summaryRevisionId = kind === "conversationSummary"
      ? inferSummaryRevisionId(candidate, summaryRevisions, messages)
      : placement === "conversationBaseline" &&
          typeof candidate.summaryRevisionId === "string" &&
          summaryRevisions[candidate.summaryRevisionId]
        ? candidate.summaryRevisionId
        : undefined;
    const summaryKey = kind === "conversationSummary"
      ? summaryRevisionId ?? `legacy:${candidate.contentHash}`
      : undefined;
    if (summaryKey && summaryKeys.has(summaryKey)) {
      return [];
    }
    if (summaryKey) {
      summaryKeys.add(summaryKey);
    }
    return [{
      id: kind === "conversationSummary" && summaryRevisionId
        ? `provider-frame-conversation-summary:${summaryRevisionId}`
        : candidate.id,
      kind,
      createdAt: candidate.createdAt,
      sequence,
      placement,
      promptContractVersion: candidate.promptContractVersion,
      ...(typeof candidate.taskStrategy === "string" ? { taskStrategy: candidate.taskStrategy as ProviderContextFrame["taskStrategy"] } : {}),
      projectMemoryRevisionIds: stringArray(candidate.projectMemoryRevisionIds),
      stageRecordRevisionIds: stringArray(candidate.stageRecordRevisionIds),
      ...(typeof candidate.designDefinitionRevisionId === "string"
        ? { designDefinitionRevisionId: candidate.designDefinitionRevisionId }
        : {}),
      directionRevisionIds: stringArray(candidate.directionRevisionIds),
      ...(typeof candidate.defaultReferenceObjectId === "string"
        ? { defaultReferenceObjectId: candidate.defaultReferenceObjectId }
        : {}),
      selectedObjectIds: stringArray(candidate.selectedObjectIds),
      relatedObjectIds: stringArray(candidate.relatedObjectIds),
      renderedText: candidate.renderedText,
      contentHash: candidate.contentHash,
      ...(typeof candidate.supersedesFrameId === "string" ? { supersedesFrameId: candidate.supersedesFrameId } : {}),
      contextVisibility: "providerOnly" as const,
      sourceRefs,
      reason: candidate.reason,
      ...(typeof candidate.anchorMessageId === "string" ? { anchorMessageId: candidate.anchorMessageId } : {}),
      ...(summaryRevisionId ? { summaryRevisionId } : {}),
      ...(isValidCanonicalAgentRuntimeItem(candidate.runtimeItem)
        ? { runtimeItem: candidate.runtimeItem }
        : {})
    }];
  });
  return frames.sort((left, right) => left.sequence - right.sequence);
}

function normalizeFrameSequence(value: unknown, fallback: number, used: Set<number>): number {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let next = Math.max(fallback, ...used) + 1;
  while (used.has(next)) {
    next += 1;
  }
  used.add(next);
  return next;
}

function normalizeFramePlacement(value: unknown, anchorMessageId: unknown): ProviderContextFrame["placement"] {
  if (
    value === "conversationBaseline" ||
    value === "beforeUser" ||
    value === "afterUser" ||
    value === "beforeAssistant" ||
    value === "afterAssistant"
  ) {
    return value;
  }
  return typeof anchorMessageId === "string" ? "beforeUser" : "conversationBaseline";
}

function inferSummaryRevisionId(
  candidate: Record<string, unknown>,
  summaryRevisions: Record<string, ConversationSummaryRevision>,
  messages: readonly AiMessage[]
): string | undefined {
  if (typeof candidate.summaryRevisionId === "string") {
    if (summaryRevisions[candidate.summaryRevisionId]) {
      return candidate.summaryRevisionId;
    }
  }
  if (typeof candidate.anchorMessageId === "string") {
    const messageRevisionId = messages.find(
      (message) => message.id === candidate.anchorMessageId && message.conversationSummaryRevisionId
    )?.conversationSummaryRevisionId;
    if (messageRevisionId && summaryRevisions[messageRevisionId]) {
      return messageRevisionId;
    }
    const sourceEndRevision = Object.values(summaryRevisions).find(
      (revision) => revision.sourceEndMessageId === candidate.anchorMessageId
    );
    if (sourceEndRevision) {
      return sourceEndRevision.id;
    }
  }
  if (typeof candidate.renderedText === "string") {
    const matchingRevisions = Object.values(summaryRevisions).filter(
      (revision) => renderConversationSummaryFrameText(revision) === candidate.renderedText
    );
    if (matchingRevisions.length === 1) {
      return matchingRevisions[0]?.id;
    }
  }
  return undefined;
}

function renderConversationSummaryFrameText(revision: ConversationSummaryRevision): string {
  const summary = revision.summary;
  return [
    `项目聊天摘要目标：${summary.threadGoal}`,
    `已建立上下文：${summary.establishedContext.join("；") || "无"}`,
    `决定及原因：${summary.decisionsAndReasons.join("；") || "无"}`,
    `当前工作：${summary.activeWork.join("；") || "无"}`,
    `未解决问题：${summary.unresolvedQuestions.join("；") || "无"}`,
    `下一轮锚点：${summary.nextTurnAnchor ?? "无"}`
  ].join("\n");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAiMessageContextVisibility(message: AiMessage): AiMessage {
  if (message.contextVisibility === "model" || message.contextVisibility === "uiOnly") {
    return message;
  }

  return isLegacyUiOnlyAiMessage(message) ? { ...message, contextVisibility: "uiOnly" } : message;
}

function normalizeAiMessage(message: AiMessage): AiMessage {
  const normalized = normalizeAiMessageContextVisibility(message);
  const providerInputSnapshot = normalizeProviderInputSnapshot(message.providerInputSnapshot);
  const providerOutputSnapshot = normalizeProviderOutputSnapshot(message.providerOutputSnapshot);
  const snapshotNormalized = {
    ...normalized,
    ...(providerInputSnapshot ? { providerInputSnapshot } : {}),
    ...(providerOutputSnapshot ? { providerOutputSnapshot } : {})
  };
  if (!snapshotNormalized.agentTrace) {
    return snapshotNormalized;
  }
  const providerRequestState = snapshotNormalized.agentTrace.providerRequestState
    ? stripHistoricalProviderRequestManifest(snapshotNormalized.agentTrace.providerRequestState)
    : undefined;
  const providerDiagnostics = snapshotNormalized.agentTrace.providerDiagnostics
    ? stripHistoricalProviderDiagnosticStates(snapshotNormalized.agentTrace.providerDiagnostics)
    : undefined;
  return {
    ...snapshotNormalized,
    agentTrace: {
      ...snapshotNormalized.agentTrace,
      ...(providerRequestState ? { providerRequestState } : {}),
      ...(providerDiagnostics ? { providerDiagnostics } : {})
    }
  };
}

function stripHistoricalProviderRequestManifest(
  state: NonNullable<AgentTrace["providerRequestState"]>
): NonNullable<AgentTrace["providerRequestState"]> {
  const {
    cacheItemManifest: _legacyManifest,
    transcriptManifestHash: _transcriptManifestHash,
    transcriptSnapshotToken: _transcriptSnapshotToken,
    ...providerRequestState
  } = state as typeof state & {
    cacheItemManifest?: unknown;
    transcriptManifestHash?: unknown;
    transcriptSnapshotToken?: unknown;
  };
  return providerRequestState;
}

function stripHistoricalProviderDiagnosticStates(
  diagnostics: NonNullable<AgentTrace["providerDiagnostics"]>
): NonNullable<AgentTrace["providerDiagnostics"]> {
  const {
    previousRequestState: _previousRequestState,
    requestState: _requestState,
    ...compact
  } = diagnostics as typeof diagnostics & {
    previousRequestState?: unknown;
    requestState?: unknown;
  };
  return compact;
}

function normalizeLatestProviderRequestState(
  value: unknown
): MorphoWorkspace["ai"]["latestProviderRequestState"] {
  if (!isRecord(value) || typeof value.promptContractVersion !== "string") {
    return undefined;
  }
  const cacheItemManifest = Array.isArray(value.cacheItemManifest)
    ? value.cacheItemManifest.flatMap((item) => {
        if (
          !isRecord(item) ||
          typeof item.type !== "string" ||
          typeof item.semanticKind !== "string" ||
          typeof item.contentHash !== "string" ||
          typeof item.estimatedTokens !== "number"
        ) {
          return [];
        }
        const role: AgentCacheItemManifest["role"] =
          item.role === "system" || item.role === "user" || item.role === "assistant"
          ? item.role
          : undefined;
        return [{
          type: item.type,
          ...(role ? { role } : {}),
          semanticKind: item.semanticKind,
          contentHash: item.contentHash,
          estimatedTokens: item.estimatedTokens
        }];
      })
    : undefined;
  return {
    promptContractVersion: value.promptContractVersion,
    ...(value.toolProfile === "standard" ||
      value.toolProfile === "standardWithWebSearch" ||
      value.toolProfile === "conversationSummary"
      ? { toolProfile: value.toolProfile }
      : {}),
    ...(typeof value.summaryRevisionId === "string" ? { summaryRevisionId: value.summaryRevisionId } : {}),
    ...(typeof value.latestUserMessageId === "string" ? { latestUserMessageId: value.latestUserMessageId } : {}),
    ...(typeof value.providerInputPrefixHash === "string" ? { providerInputPrefixHash: value.providerInputPrefixHash } : {}),
    ...(isProviderInputCacheBoundaryReason(value.attachmentBoundary)
      ? { attachmentBoundary: value.attachmentBoundary }
      : {}),
    ...(cacheItemManifest ? { cacheItemManifest } : {}),
    ...(typeof value.toolsHash === "string" ? { toolsHash: value.toolsHash } : {}),
    ...(typeof value.budgetGeneration === "number" ? { budgetGeneration: value.budgetGeneration } : {}),
    ...(typeof value.transcriptManifestHash === "string" && /^[0-9a-f]{64}$/.test(value.transcriptManifestHash)
      ? { transcriptManifestHash: value.transcriptManifestHash }
      : {}),
    ...(typeof value.transcriptSnapshotToken === "string" &&
      value.transcriptSnapshotToken.length >= 16 && value.transcriptSnapshotToken.length <= 512_000
      ? { transcriptSnapshotToken: value.transcriptSnapshotToken }
      : {})
  };
}

function isProviderInputCacheBoundaryReason(value: unknown): value is ProviderInputCacheBoundaryReason {
  return value === "imageInput" ||
    value === "legacyProviderInput" ||
    value === "documentSnapshotUnavailable" ||
    value === "toolProfileChanged" ||
    value === "promptContractChanged" ||
    value === "compaction";
}

function isLegacyUiOnlyAiMessage(message: AiMessage): boolean {
  if (message.role === "user") {
    return message.body.trim().toLocaleLowerCase() === "/compact";
  }

  return [
    "正在压缩当前上下文…",
    "上下文压缩完成。已保留当前项目状态、选中对象、待继续问题和最近讨论。",
    "当前讨论还很短，无需压缩。",
    "上下文压缩未完成：模型没有返回可用的讨论摘要，请稍后重试。",
    "上下文压缩已取消。"
  ].includes(message.body.trim());
}

function isConversationCheckpoint(value: unknown): value is MorphoWorkspace["ai"]["conversationCheckpoints"][number] {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !hasOnlyAllowedKeys(value, [
      "id",
      "laneKey",
      "focusArea",
      "focusUpdatedAt",
      "taskKind",
      "anchorObjectIds",
      "targetDirectionIds",
      "visualBranchId",
      "sourceStartMessageId",
      "sourceEndMessageId",
      "sourceMessageCount",
      "createdAt",
      "updatedAt",
      "threadGoal",
      "progress",
      "openThreads",
      "nextTurnAnchor"
    ])
  ) {
    return false;
  }

  return (
    stringFieldsPresent(value, [
      "id",
      "laneKey",
      "focusUpdatedAt",
      "sourceStartMessageId",
      "sourceEndMessageId",
      "createdAt",
      "updatedAt",
      "threadGoal"
    ]) &&
    isProjectFocusArea(value.focusArea) &&
    isConversationCheckpointTaskKind(value.taskKind) &&
    Array.isArray(value.anchorObjectIds) &&
    value.anchorObjectIds.every((item) => typeof item === "string") &&
    Array.isArray(value.targetDirectionIds) &&
    value.targetDirectionIds.every((item) => typeof item === "string") &&
    (value.visualBranchId === undefined || typeof value.visualBranchId === "string") &&
    typeof value.sourceMessageCount === "number" &&
    Number.isFinite(value.sourceMessageCount) &&
    value.sourceMessageCount >= 0 &&
    Array.isArray(value.progress) &&
    value.progress.every((item) => typeof item === "string") &&
    Array.isArray(value.openThreads) &&
    value.openThreads.every((item) => typeof item === "string") &&
    (value.nextTurnAnchor === undefined || typeof value.nextTurnAnchor === "string")
  );
}

function normalizeCurrentWorkspace(value: Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as Partial<MorphoWorkspace>;
  const sourceProject = isRecord(value.project) ? value.project : {};
  const now =
    typeof sourceProject.updatedAt === "string"
      ? sourceProject.updatedAt
      : typeof sourceProject.createdAt === "string"
        ? sourceProject.createdAt
        : new Date().toISOString();
  const canvasView = cloned.ui?.canvasView ?? cloned.canvas?.view ?? { x: 0, y: 0, zoom: 1 };
  const objects = normalizeObjectsForSchemaV13(normalizeObjectsForSchemaV7(cloned.objects ?? {}));
  const rawProject = sourceProject;
  const project = {
    id: typeof rawProject.id === "string" ? rawProject.id : "project-nightrail",
    title: typeof rawProject.title === "string" ? rawProject.title : "未命名项目",
    subtitle: typeof rawProject.subtitle === "string" ? rawProject.subtitle : "",
    createdAt: typeof rawProject.createdAt === "string" ? rawProject.createdAt : now,
    updatedAt: typeof rawProject.updatedAt === "string" ? rawProject.updatedAt : now,
    lastOpenedAt: typeof rawProject.lastOpenedAt === "string" ? rawProject.lastOpenedAt : now,
    coverAssetId: typeof rawProject.coverAssetId === "string" ? rawProject.coverAssetId : undefined
  };
  const designDefinitionRevisions = cloned.designDefinitionRevisions ?? {};
  const directionRevisions = cloned.directionRevisions ?? {};
  const ai = normalizeAiState(cloned.ai);
  const normalizedContinuity = normalizeProjectContinuityWithMessageReferences(
    {
      project,
      objects,
      designDefinitionRevisions,
      directionRevisions
    },
    cloned.projectContinuity,
    ai.messages,
    legacyProjectFocus(rawProject.currentFocus)
  );

  const normalized = reconcileWorkspaceDerivedState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project,
    objects,
    assets: cloned.assets ?? {},
    relations: cloned.relations ?? [],
    deliveryReferences: normalizeDeliveryReferences(cloned.deliveryReferences ?? {}, objects, cloned.assets ?? {}),
    deliverySectionDrafts: cloned.deliverySectionDrafts ?? {},
    decisionRecords: cloned.decisionRecords ?? [],
    operations: cloned.operations ?? {},
    artifactProposals: normalizeArtifactProposals(cloned.artifactProposals ?? {}, objects),
    citationSnapshots: cloned.citationSnapshots ?? {},
    designDefinitionRevisions,
    directionRevisions,
    directionLineage: cloned.directionLineage ?? [],
    visualBranches: cloned.visualBranches ?? {},
    workingState: cloned.workingState ?? createEmptyProjectWorkingState(now),
    projectContinuity: normalizedContinuity.state,
    projectMemory: createEmptyProjectMemoryState(now),
    canvas: cloned.canvas ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: {
      ...ai,
      messages: normalizedContinuity.messages
    },
    ui: {
      activeDrawer: cloned.ui?.activeDrawer ?? null,
      aiOpen: cloned.ui?.aiOpen ?? true,
      lastSelectionIds: cloned.ui?.lastSelectionIds ?? [],
      canvasView,
      workIntent: cloned.ui?.workIntent ?? "discussion"
    }
  }, now);

  return {
    ...normalized,
    projectMemory: normalizeProjectMemoryState(normalized, cloned.projectMemory, now)
  };
}

function createLegacyAssetRecords(objects: Record<MorphoObjectId, MorphoObject>): Record<string, AssetRecord> {
  const assets: Record<string, AssetRecord> = {};

  for (const object of Object.values(objects)) {
    if (object.type !== "image" && object.type !== "file" && object.type !== "link") {
      continue;
    }

    const assetId = "assetId" in object ? object.assetId : undefined;
    if (!assetId) {
      continue;
    }

    assets[assetId] = {
      id: assetId,
      fileName: object.type === "file" ? object.fileName ?? object.title : object.title,
      mimeType:
        object.type === "image"
          ? "image/*"
          : object.type === "file"
            ? object.mimeType ?? "application/octet-stream"
            : "text/uri-list",
      size: object.type === "file" ? object.size ?? 0 : 0,
      createdAt: object.createdAt ?? "2026-06-23T00:00:00.000Z",
      storageKey: `legacy:${assetId}`,
      sourceType:
        object.type === "image" && object.createdBy === "ai"
          ? "aiGeneratedImage"
          : object.type === "link"
            ? "originalLink"
            : object.type === "image"
              ? "originalImage"
              : "originalFile",
      url: object.type === "link" ? object.url : undefined,
      domain: object.type === "link" ? object.domain : undefined
    };
  }

  return assets;
}

function normalizeObjectsForSchemaV7(objects: Record<MorphoObjectId, MorphoObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([objectId, object]) => {
      if (object.type === "file") {
        return [
          objectId,
          {
            ...object,
            parseStatus: normalizeFileParseStatus(object.parseStatus),
            parseError: object.parseStatus === "failed" ? object.parseError : undefined
          }
        ];
      }

      if (object.type !== "image") {
        return [objectId, object];
      }

      return [
        objectId,
        {
          ...object,
          role: normalizeImageRole(object.role)
        }
      ];
    })
  );
}

function normalizeFileParseStatus(value: unknown): FileParseStatus {
  switch (value) {
    case "parsing":
    case "parsed":
    case "failed":
    case "unparsed":
      return value;
    default:
      return "unparsed";
  }
}

function normalizeImageRole(value: unknown): ImageRole {
  switch (value) {
    case "main":
      return "primaryVisual";
    case "scenario":
      return "sceneVisual";
    case "cmf":
      return "cmfStudy";
    case "detail":
      return "detailStudy";
    case "diagram":
      return "structureDiagram";
    case "reference":
    case "preview":
    case "conceptImage":
    case "primaryVisual":
    case "sceneVisual":
    case "cmfStudy":
    case "detailStudy":
    case "structureDiagram":
    case "interactionDiagram":
    case "deliveryAsset":
      return value;
    default:
      return "reference";
  }
}

function normalizeArtifactProposals(
  proposals: Record<string, ArtifactProposal>,
  objects: Record<MorphoObjectId, MorphoObject>
): Record<string, ArtifactProposal> {
  return Object.fromEntries(
    Object.entries(proposals).map(([proposalId, proposal]) => {
      const sourceSnapshots =
        Array.isArray(proposal.sourceSnapshots) && proposal.sourceSnapshots.length > 0
          ? proposal.sourceSnapshots
          : proposal.sourceObjectIds.map((objectId) => createSourceSemanticSnapshot(objects, objectId)).filter(Boolean);

      if (proposal.type !== "conceptDirection") {
        return [
          proposalId,
          {
            ...proposal,
            sourceSnapshots
          }
        ];
      }

      const parentDirectionIds = proposal.parentDirectionIds ?? inferParentDirectionIds(proposal);
      const applicationMode = proposal.applicationMode ?? inferConceptDirectionApplicationMode(proposal, parentDirectionIds);

      return [
        proposalId,
        {
          ...proposal,
          applicationMode,
          targetDirectionId:
            proposal.targetDirectionId ??
            (applicationMode === "revise" ? proposal.directions[0]?.basedOnDirectionId : undefined),
          parentDirectionIds,
          sourceSnapshots
        }
      ];
    })
  );
}

function inferParentDirectionIds(proposal: Extract<ArtifactProposal, { type: "conceptDirection" }>): MorphoObjectId[] {
  return [
    ...new Set(
      proposal.directions.map((direction) => direction.basedOnDirectionId).filter((id): id is string => Boolean(id))
    )
  ];
}

function inferConceptDirectionApplicationMode(
  proposal: Extract<ArtifactProposal, { type: "conceptDirection" }>,
  parentDirectionIds: MorphoObjectId[]
): Extract<ArtifactProposal, { type: "conceptDirection" }>["applicationMode"] {
  if (proposal.workIntent === "reviseConceptDirection") {
    return "revise";
  }
  if (proposal.workIntent === "splitConceptDirection") {
    return "split";
  }
  if (proposal.workIntent === "mergeConceptDirections") {
    return "merge";
  }
  return parentDirectionIds.length > 0 ? "split" : "create";
}

function createSourceSemanticSnapshot(
  objects: Record<MorphoObjectId, MorphoObject>,
  objectId: MorphoObjectId
): SourceSemanticSnapshot | undefined {
  const object = objects[objectId];
  if (!object) {
    return undefined;
  }

  return {
    objectId,
    objectType: object.type,
    visibility: object.visibility,
    semanticFingerprint: buildSemanticFingerprint(object)
  };
}

function buildSemanticFingerprint(object: MorphoObject): string {
  switch (object.type) {
    case "text":
      return stableStringify({ body: object.body });
    case "research":
      return stableStringify({
        findings: object.findings,
        opportunities: object.opportunities,
        constraints: object.constraints,
        openQuestions: object.openQuestions,
        evidence: object.evidence ?? [],
        provenanceCitationIds: object.provenance?.citationIds ?? []
      });
    case "keyConclusion":
      return stableStringify({
        body: object.body,
        state: object.state,
        supersededById: object.supersededById,
        confidence: object.confidence
      });
    case "designDefinition":
      return stableStringify({
        currentRevisionId: object.currentRevisionId,
        isCurrentEffective: object.isCurrentEffective
      });
    case "conceptDirection":
      return stableStringify({
        currentRevisionId: object.currentRevisionId,
        status: object.status
      });
    case "image":
      return stableStringify({ assetId: object.assetId });
    default:
      return stableStringify({ type: object.type });
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
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

function findDefaultReference(workspace: MorphoWorkspace): ImageObject | null {
  for (const object of Object.values(workspace.objects)) {
    if (object.type === "image" && object.isDefaultReference) {
      return object;
    }
  }

  return null;
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

function addWorkingStateObjects(
  workspace: MorphoWorkspace,
  target: Set<MorphoObjectId>,
  objectIds: Array<MorphoObjectId | undefined>
): void {
  for (const objectId of objectIds) {
    if (objectId && workspace.objects[objectId]?.visibility === "active") {
      target.add(objectId);
    }
  }
}

function snapshotObject(object: MorphoObject): ObjectSnapshot {
  return {
    id: object.id,
    type: object.type,
    title: object.title
  };
}

function createDeliveryReferenceSnapshot(object: MorphoObject, caption: string) {
  return {
    sourceType: object.type,
    title: object.title,
    summary: object.summary,
    caption,
    previewAsset:
      object.type === "image"
        ? {
            alt: `${object.title} 的交付引用快照`
          }
        : undefined
  };
}

function makeDeliveryReferenceId(deliveryObjectId: MorphoObjectId, sourceObjectId: MorphoObjectId): DeliveryReferenceId {
  return `delivery-ref-${deliveryObjectId}-${sourceObjectId}`;
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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeObjectsForSchemaV13(objects: Record<MorphoObjectId, MorphoObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([objectId, object]) => {
      if (object.type !== "delivery") {
        return [objectId, object];
      }
      const now = object.updatedAt ?? object.createdAt ?? "2026-07-02T00:00:00.000Z";
      const references = Array.isArray(object.references) ? object.references : [];
      const sections =
        Array.isArray(object.sections) && object.sections.length > 0
          ? normalizeDeliverySections(object.sections, references, object.id, now)
          : createMigratedDeliverySections(object.id, references, now);
      return [
        objectId,
        {
          ...object,
          sections,
          gaps: normalizeDeliveryGaps(object.gaps, now),
          references
        }
      ];
    })
  );
}

function normalizeDeliverySections(
  sections: DeliverySection[],
  references: DeliveryReferenceId[],
  deliveryObjectId: MorphoObjectId,
  now: string
): DeliverySection[] {
  const remaining = new Set(references);
  const normalized = sections.map((section, index) => {
    const referenceIds = Array.isArray(section.referenceIds)
      ? section.referenceIds.filter((referenceId) => {
          if (!remaining.has(referenceId)) {
            return false;
          }
          remaining.delete(referenceId);
          return true;
        })
      : [];
    return {
      id: typeof section.id === "string" && section.id ? section.id : `section-${deliveryObjectId}-${index + 1}`,
      title: typeof section.title === "string" && section.title.trim() ? section.title : "交付内容",
      purpose: typeof section.purpose === "string" && section.purpose.trim() ? section.purpose : undefined,
      order: index,
      referenceIds,
      narrative: typeof section.narrative === "string" && section.narrative.trim() ? section.narrative : undefined,
      createdAt: typeof section.createdAt === "string" ? section.createdAt : now,
      updatedAt: typeof section.updatedAt === "string" ? section.updatedAt : now
    };
  });

  if (remaining.size > 0) {
    normalized.push({
      id: `section-${deliveryObjectId}-migrated-content`,
      title: "交付内容",
      purpose: "结构迁移保留的既有交付引用。",
      order: normalized.length,
      referenceIds: [...remaining],
      narrative: undefined,
      createdAt: now,
      updatedAt: now
    });
  }

  return normalized.map((section, order) => ({ ...section, order }));
}

function createMigratedDeliverySections(
  deliveryObjectId: MorphoObjectId,
  references: DeliveryReferenceId[],
  now: string
): DeliverySection[] {
  if (references.length === 0) {
    return [];
  }
  return [
    {
      id: `section-${deliveryObjectId}-migrated-content`,
      title: "交付内容",
      purpose: "结构迁移保留的既有交付引用。",
      order: 0,
      referenceIds: [...references],
      createdAt: now,
      updatedAt: now
    }
  ];
}

function normalizeDeliveryGaps(value: unknown, now: string): DeliveryGap[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((gap, index) => ({
      id: typeof gap.id === "string" && gap.id ? gap.id : `gap-migrated-${index + 1}`,
      label: typeof gap.label === "string" ? gap.label : "待补内容",
      sectionId: typeof gap.sectionId === "string" ? gap.sectionId : undefined,
      status: gap.status === "resolved" ? "resolved" as const : "open" as const,
      origin: gap.origin === "deliveryDraft" ? "deliveryDraft" as const : "manual" as const,
      createdAt: typeof gap.createdAt === "string" ? gap.createdAt : now,
      updatedAt: typeof gap.updatedAt === "string" ? gap.updatedAt : now,
      resolvedAt: typeof gap.resolvedAt === "string" ? gap.resolvedAt : undefined
    }));
}

function normalizeDeliveryReferences(
  references: Record<DeliveryReferenceId, DeliveryReference>,
  objects: Record<MorphoObjectId, MorphoObject>,
  assets: Record<AssetId, AssetRecord>
): Record<DeliveryReferenceId, DeliveryReference> {
  const workspaceForSnapshots = {
    objects,
    assets,
    designDefinitionRevisions: {},
    directionRevisions: {}
  } as MorphoWorkspace;
  const deliveryMembership = new Map<DeliveryReferenceId, { deliveryObjectId: MorphoObjectId; sectionId: string; order: number }>();
  for (const object of Object.values(objects)) {
    if (object.type !== "delivery") {
      continue;
    }
    for (const section of object.sections) {
      section.referenceIds.forEach((referenceId, order) => {
        deliveryMembership.set(referenceId, { deliveryObjectId: object.id, sectionId: section.id, order });
      });
    }
  }

  return Object.fromEntries(
    Object.entries(references).map(([referenceId, reference]) => {
      const membership = deliveryMembership.get(referenceId);
      const source = reference.sourceObjectId ? objects[reference.sourceObjectId] : undefined;
      const snapshot = reference.snapshot ?? (source ? createStableDeliveryReferenceSnapshot(workspaceForSnapshots, source) : {
        sourceType: "text" as const,
        title: "旧交付引用",
        summary: "迁移保留的旧交付引用快照。"
      });
      return [
        referenceId,
        {
          ...reference,
          deliveryObjectId: reference.deliveryObjectId ?? membership?.deliveryObjectId,
          sectionId: reference.sectionId ?? membership?.sectionId,
          order: reference.order ?? membership?.order,
          snapshot,
          updatedAt: reference.updatedAt ?? reference.createdAt,
          sourceFingerprint: reference.sourceFingerprint ?? (source ? createDeliverySourceFingerprint(workspaceForSnapshots, source) : undefined),
          sourceAssetId: reference.sourceAssetId ?? (source ? getDeliveryReferenceAssetId(source) : undefined)
        }
      ];
    })
  );
}

function getDeliveryReferenceAssetId(source: MorphoObject): AssetId | undefined {
  switch (source.type) {
    case "image":
    case "file":
    case "link":
      return source.assetId;
    case "documentFragment":
      return source.source.sourceExtractAssetId;
    default:
      return undefined;
  }
}

function stringFieldsPresent(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string" && value[key].trim().length > 0);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectFocusArea(value: unknown): value is MorphoWorkspace["projectContinuity"]["currentFocus"]["area"] {
  return (
    value === "startAndInput" ||
    value === "exploration" ||
    value === "research" ||
    value === "designDefinition" ||
    value === "directionAndVisual" ||
    value === "deliveryPreparation"
  );
}

function isConversationCheckpointTaskKind(value: unknown): value is MorphoWorkspace["ai"]["conversationCheckpoints"][number]["taskKind"] {
  return (
    value === "research" ||
    value === "general" ||
    value === "directionPreview" ||
    value === "visualDevelopment" ||
    value === "designDefinition" ||
    value === "conceptDirection" ||
    value === "comparison"
  );
}

function isDirectionStatus(value: unknown): value is ConceptDirectionStatus {
  return (
    value === "pendingPreview" ||
    value === "primary" ||
    value === "alternative" ||
    value === "eliminated" ||
    value === "needsReview"
  );
}

function legacyProjectFocus(value: unknown): LegacyProjectFocus | undefined {
  switch (value) {
    case "direction_visual_development":
    case "research":
    case "design_definition":
    case "delivery_preparation":
      return value;
    default:
      return undefined;
  }
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

function uniqueObjectIds(objectIds: MorphoObjectId[]): MorphoObjectId[] {
  return [...new Set(objectIds.filter(Boolean))];
}
