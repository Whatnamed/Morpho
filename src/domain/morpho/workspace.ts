import { nightrailWorkspace } from "./seed";
import type {
  AiDraftResult,
  AiSuggestionInput,
  AssembleAiContextInput,
  AssembledAiContext,
  AssetRecord,
  CanvasInstance,
  CanvasInstanceId,
  CanvasPoint,
  ConceptDirectionObject,
  DeliveryObject,
  DeliveryReference,
  DeliveryReferenceId,
  ImageObject,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoRelation,
  MorphoWorkspace,
  ObjectSnapshot,
  WorkspaceMigrationResult
} from "./types";

const DEFAULT_REFERENCE_HIDDEN_MESSAGE = "当前后续默认参考已隐藏，请先恢复或替换后再用于相关生成。";
const CURRENT_SCHEMA_VERSION = 4;

type LegacyWorkspaceV2 = Omit<MorphoWorkspace, "schemaVersion" | "assets" | "ui" | "operations" | "artifactProposals" | "citationSnapshots"> & {
  schemaVersion: 2;
};

type LegacyWorkspaceV3 = Omit<MorphoWorkspace, "schemaVersion" | "operations" | "artifactProposals" | "citationSnapshots"> & {
  schemaVersion: 3;
};

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

export function createInitialWorkspace(): MorphoWorkspace {
  return structuredClone(nightrailWorkspace);
}

export function createBlankWorkspace(projectId: string): MorphoWorkspace {
  const now = new Date().toISOString();

  return {
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
  };
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

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "hidden"
      }
    }
  };
}

export function restoreObject(workspace: MorphoWorkspace, objectId: MorphoObjectId): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.visibility === "active") {
    return workspace;
  }

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        visibility: "active"
      }
    }
  };
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

  const defaultReference = findDefaultReference(workspace);

  if (input.task === "visualDevelopment") {
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
    workspace: {
      ...workspace,
      objects,
      relations,
      decisionRecords,
      canvas: {
        ...workspace.canvas,
        instances: canvasInstances
      }
    }
  };
}

export function eliminateDirection(
  workspace: MorphoWorkspace,
  objectId: MorphoObjectId,
  options: { reason: string }
): MorphoWorkspace {
  const object = workspace.objects[objectId];

  if (!object || object.type !== "conceptDirection") {
    return workspace;
  }

  const updatedDirection: ConceptDirectionObject = {
    ...object,
    status: "eliminated"
  };

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: updatedDirection
    },
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setDirectionStatus", objectId),
        kind: "setDirectionStatus",
        createdAt: new Date().toISOString(),
        summary: `淘汰方向：${object.title}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId]
      }
    ]
  };
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

  const objects = Object.fromEntries(
    Object.entries(workspace.objects).map(([entryId, entry]) => {
      if (entry.type !== "image") {
        return [entryId, entry];
      }

      return [
        entryId,
        {
          ...entry,
          isDefaultReference: entry.id === objectId
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

  return {
    ...workspace,
    objects,
    relations: defaultReferenceRelation ? [...relationsWithoutDefault, defaultReferenceRelation] : relationsWithoutDefault,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: makeDecisionId(workspace, "setDefaultReference", objectId),
        kind: "setDefaultReference",
        createdAt: new Date().toISOString(),
        summary: `设为后续默认参考：${object.title}`,
        reason: options.reason,
        objectSnapshot: snapshotObject(object),
        relatedObjectIds: [objectId]
      }
    ]
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
    workspace: {
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
    }
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
      workspace: normalizeV3Workspace(value),
      didMigrate: false
    };
  }

  if (value.schemaVersion === 3) {
    return {
      status: "ok",
      workspace: migrateV3Workspace(value as LegacyWorkspaceV3),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 2) {
    return {
      status: "ok",
      workspace: migrateV2Workspace(value as LegacyWorkspaceV2),
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
    workspace: migrateV2Workspace(migrated),
    didMigrate: true
  };
}

function migrateV1Workspace(value: Record<string, unknown>): LegacyWorkspaceV2 | null {
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
        ...rawObject,
        visibility,
        references
      } as DeliveryObject;
      continue;
    }

    migratedObjects[objectId] = {
      ...rawObject,
      visibility
    } as MorphoObject;
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
    ...(structuredClone(value) as Omit<MorphoWorkspace, "schemaVersion" | "objects" | "deliveryReferences" | "decisionRecords">),
    schemaVersion: 2,
    objects: migratedObjects,
    deliveryReferences,
    decisionRecords: []
  };
}

function migrateV2Workspace(value: LegacyWorkspaceV2 | Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as LegacyWorkspaceV2;
  const canvasView = cloned.canvas?.view ?? { x: 0, y: 0, zoom: 1 };

  return {
    ...cloned,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      ...cloned.project,
      createdAt: cloned.project.createdAt ?? "2026-06-23T00:00:00.000Z",
      updatedAt: cloned.project.updatedAt ?? "2026-06-23T00:00:00.000Z",
      lastOpenedAt: cloned.project.lastOpenedAt ?? cloned.project.updatedAt ?? "2026-06-23T00:00:00.000Z"
    },
    objects: cloned.objects,
    assets: createLegacyAssetRecords(cloned.objects),
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

function migrateV3Workspace(value: LegacyWorkspaceV3 | Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as LegacyWorkspaceV3;
  return normalizeV4Workspace({
    ...cloned,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    operations: {},
    artifactProposals: {},
    citationSnapshots: {}
  });
}

function normalizeV3Workspace(value: Record<string, unknown>): MorphoWorkspace {
  return normalizeV4Workspace(value);
}

function normalizeV4Workspace(value: Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as MorphoWorkspace;
  const canvasView = cloned.ui?.canvasView ?? cloned.canvas.view;

  return {
    ...cloned,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    assets: cloned.assets ?? {},
    operations: cloned.operations ?? {},
    artifactProposals: cloned.artifactProposals ?? {},
    citationSnapshots: cloned.citationSnapshots ?? {},
    ui: {
      activeDrawer: cloned.ui?.activeDrawer ?? null,
      aiOpen: cloned.ui?.aiOpen ?? true,
      lastSelectionIds: cloned.ui?.lastSelectionIds ?? [],
      canvasView
    }
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
      mimeType: object.type === "image" ? "image/*" : object.type === "file" ? object.mimeType ?? "application/octet-stream" : "text/uri-list",
      size: object.type === "file" ? object.size ?? 0 : 0,
      createdAt: object.createdBy === "ai" ? "2026-06-23T00:00:00.000Z" : "2026-06-23T00:00:00.000Z",
      storageKey: `legacy:${assetId}`,
      sourceType: object.type === "image" && object.createdBy === "ai" ? "aiGeneratedImage" : object.type === "link" ? "originalLink" : object.type === "image" ? "originalImage" : "originalFile",
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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
