import { reconcileWorkspaceDerivedState, createDefaultStageRecords, createEmptyProjectWorkingState } from "./derivedState";
import { nightrailWorkspace } from "./seed";
import type {
  AiDraftResult,
  AiSuggestionInput,
  AssembleAiContextInput,
  AssembledAiContext,
  AssetId,
  AssetRecord,
  CanvasInstance,
  CanvasInstanceId,
  CanvasPoint,
  ConceptDirectionObject,
  ConceptDirectionStatus,
  DeliveryObject,
  DeliveryReference,
  DeliveryReferenceId,
  DesignDefinitionObject,
  DesignDefinitionRevision,
  DirectionRevisionId,
  ImageObject,
  ImageRole,
  KeyConclusionObject,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoRelation,
  MorphoWorkspace,
  ObjectSnapshot,
  WorkspaceMigrationResult
} from "./types";

const DEFAULT_REFERENCE_HIDDEN_MESSAGE = "当前后续默认参考已隐藏，请先恢复或替换后再用于相关生成。";
const CURRENT_SCHEMA_VERSION = 5;

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

export function createInitialWorkspace(): MorphoWorkspace {
  return reconcileWorkspaceDerivedState(structuredClone(nightrailWorkspace));
}

export function createBlankWorkspace(projectId: string): MorphoWorkspace {
  const now = new Date().toISOString();

  return reconcileWorkspaceDerivedState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: projectId,
      title: "未命名项目",
      subtitle: "从一句话、图片、文件或链接开始。",
      currentFocus: "research",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    },
    objects: {},
    assets: {},
    relations: [],
    deliveryReferences: {},
    decisionRecords: [],
    operations: {},
    artifactProposals: {},
    citationSnapshots: {},
    designDefinitionRevisions: {},
    directionRevisions: {},
    directionLineage: [],
    visualBranches: {},
    workingState: createEmptyProjectWorkingState(now),
    stageRecords: createDefaultStageRecords(now),
    canvas: {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: {
      messages: []
    },
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: { x: 0, y: 0, zoom: 1 }
    }
  });
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

  return reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "hidden",
        updatedAt: new Date().toISOString()
      }
    }
  });
}

export function restoreObject(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.visibility === "active") {
    return workspace;
  }

  return reconcileWorkspaceDerivedState({
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "active",
        updatedAt: new Date().toISOString()
      }
    }
  });
}

export function getRenderableCanvasInstances(workspace: MorphoWorkspace): CanvasInstance[] {
  return workspace.canvas.instances.filter((instance) => workspace.objects[instance.objectId]?.visibility === "active");
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
      workspace.workingState.primaryDirectionId
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
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects,
      relations,
      decisionRecords,
      canvas: {
        ...workspace.canvas,
        instances: canvasInstances
      }
    })
  };
}

export function eliminateDirection(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { reason: string }
): MorphoWorkspace {
  return setConceptDirectionStatus(workspace, objectId, "eliminated", options.reason);
}

export function setConceptDirectionStatus(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  status: ConceptDirectionStatus,
  reason: string
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

  return reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setDirectionStatus", objectId),
        kind: "setDirectionStatus",
        createdAt: now,
        summary: `${object.title} -> ${status}`,
        reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId]
      }
    ]
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

export function setDefaultReference(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { reason: string }
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "image" || object.visibility !== "active") {
    return workspace;
  }

  const now = new Date().toISOString();
  const objects = Object.fromEntries(
    Object.entries(workspace.objects).map(([entryId, entry]) => {
      if (entry.type !== "image") {
        return [entryId, entry];
      }

      return [
        entryId,
        {
          ...entry,
          isDefaultReference: entry.id === objectId,
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

  return reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    relations: defaultReferenceRelation ? [...relationsWithoutDefault, defaultReferenceRelation] : relationsWithoutDefault,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setDefaultReference", objectId),
        kind: "setDefaultReference",
        createdAt: now,
        summary: `设为后续默认参考：${object.title}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId]
      }
    ]
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
        relatedObjectIds: input.sourceObjectIds
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
          size: { w: 280, h: 120 }
        }
      ]
    },
    ui: {
      ...workspace.ui,
      lastSelectionIds: [objectId]
    }
  });

  return {
    workspace: nextWorkspace,
    keyConclusion
  };
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

  const deliveryReferenceId = getAvailableDeliveryReferenceId(
    workspace,
    makeDeliveryReferenceId(deliveryObject.id, sourceObject.id)
  );
  const deliveryReference: DeliveryReference = {
    id: deliveryReferenceId,
    sourceObjectId: sourceObject.id,
    createdAt: new Date().toISOString(),
    snapshot: createDeliveryReferenceSnapshot(sourceObject, input.caption)
  };
  const updatedDeliveryObject: DeliveryObject = {
    ...deliveryObject,
    references: [...deliveryObject.references, deliveryReferenceId]
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
      workspace: normalizeV5Workspace(value),
      didMigrate: false
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
        references
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
        sourceObjectId,
        createdAt: "2026-06-23T00:00:00.000Z",
        snapshot: createDeliveryReferenceSnapshot(sourceObject, sourceObject.summary)
      };
    }
  }

  return {
    ...(structuredClone(value) as Record<string, unknown>),
    schemaVersion: 2,
    objects: migratedObjects,
    deliveryReferences,
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
      canvasView
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
      ...(cloned.project as MorphoWorkspace["project"]),
      createdAt: stringValue((cloned.project as Record<string, unknown>)?.createdAt, now),
      updatedAt: stringValue((cloned.project as Record<string, unknown>)?.updatedAt, now),
      lastOpenedAt: stringValue((cloned.project as Record<string, unknown>)?.lastOpenedAt, now)
    },
    objects,
    assets: isRecord(cloned.assets) ? (cloned.assets as Record<AssetId, AssetRecord>) : {},
    relations: rawRelations,
    deliveryReferences: isRecord(cloned.deliveryReferences)
      ? (cloned.deliveryReferences as Record<DeliveryReferenceId, DeliveryReference>)
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
    stageRecords: createDefaultStageRecords(now),
    canvas: (cloned.canvas as MorphoWorkspace["canvas"]) ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: (cloned.ai as MorphoWorkspace["ai"]) ?? { messages: [] },
    ui: (cloned.ui as MorphoWorkspace["ui"]) ?? {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: { x: 0, y: 0, zoom: 1 }
    }
  };

  return reconcileWorkspaceDerivedState(normalizeV5Workspace(normalized));
}

function normalizeV5Workspace(value: Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as Partial<MorphoWorkspace>;
  const now = new Date().toISOString();
  const canvasView = cloned.ui?.canvasView ?? cloned.canvas?.view ?? { x: 0, y: 0, zoom: 1 };

  return reconcileWorkspaceDerivedState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: cloned.project?.id ?? "project-nightrail",
      title: cloned.project?.title ?? "未命名项目",
      subtitle: cloned.project?.subtitle ?? "",
      currentFocus: cloned.project?.currentFocus ?? "research",
      createdAt: cloned.project?.createdAt ?? now,
      updatedAt: cloned.project?.updatedAt ?? now,
      lastOpenedAt: cloned.project?.lastOpenedAt ?? now,
      coverAssetId: cloned.project?.coverAssetId
    },
    objects: cloned.objects ?? {},
    assets: cloned.assets ?? {},
    relations: cloned.relations ?? [],
    deliveryReferences: cloned.deliveryReferences ?? {},
    decisionRecords: cloned.decisionRecords ?? [],
    operations: cloned.operations ?? {},
    artifactProposals: cloned.artifactProposals ?? {},
    citationSnapshots: cloned.citationSnapshots ?? {},
    designDefinitionRevisions: cloned.designDefinitionRevisions ?? {},
    directionRevisions: cloned.directionRevisions ?? {},
    directionLineage: cloned.directionLineage ?? [],
    visualBranches: cloned.visualBranches ?? {},
    workingState: cloned.workingState ?? createEmptyProjectWorkingState(now),
    stageRecords: cloned.stageRecords ?? createDefaultStageRecords(now),
    canvas: cloned.canvas ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: cloned.ai ?? { messages: [] },
    ui: {
      activeDrawer: cloned.ui?.activeDrawer ?? null,
      aiOpen: cloned.ui?.aiOpen ?? true,
      lastSelectionIds: cloned.ui?.lastSelectionIds ?? [],
      canvasView
    }
  });
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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
