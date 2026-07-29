import { applyProjectContinuityEvent } from "./projectContinuity";
import { reconcileWorkspaceDerivedState } from "./derivedState";
import type {
  AssetId,
  CanvasPoint,
  DeliveryGap,
  DeliveryObject,
  DeliveryReference,
  DeliveryReferenceId,
  DeliveryReferenceSnapshot,
  DeliverySection,
  DeliverySectionDraft,
  MorphoObject,
  MorphoObjectId,
  MorphoRelation,
  MorphoWorkspace
} from "./types";

type DeliveryOperationResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

type CreateDeliveryPreparationResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      deliveryObjectId: MorphoObjectId;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

type AddObjectsToDeliverySectionResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      createdReferenceIds: DeliveryReferenceId[];
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

type GapOperationResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      gapId: string;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

type DraftOperationResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      draftId: string;
      recovered?: boolean;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type DeliveryReferenceState =
  | { status: "current"; label: "当前快照" }
  | { status: "sourceHidden"; label: "来源已隐藏" }
  | { status: "sourceMissing"; label: "来源不可用" }
  | { status: "assetMissing"; label: "原始资产不可用" }
  | { status: "sourceUpdated"; label: "当前版本已有更新" };

export type DeliveryPreparationSignals = {
  emptySectionIds: string[];
  sourceHiddenReferenceIds: DeliveryReferenceId[];
  sourceMissingReferenceIds: DeliveryReferenceId[];
  assetMissingReferenceIds: DeliveryReferenceId[];
  sourceUpdatedReferenceIds: DeliveryReferenceId[];
};

const BOARD_DEFAULT_SECTIONS = [
  "项目背景与问题",
  "调研与关键洞察",
  "设计定义",
  "方向发展",
  "方案展示",
  "关键细节与说明",
  "待补内容"
] as const;

const PRESENTATION_DEFAULT_SECTIONS = [
  "项目起点",
  "调研与洞察",
  "设计定义",
  "方向发展",
  "方案展示",
  "结论与下一步"
] as const;

const ALLOWED_REFERENCE_SOURCE_TYPES = new Set<MorphoObject["type"]>([
  "image",
  "file",
  "text",
  "link",
  "imageCollection",
  "research",
  "keyConclusion",
  "documentFragment",
  "designDefinition",
  "conceptDirection"
]);

const MAX_SNAPSHOT_TEXT_CHARS = 4_000;
const MAX_DRAFT_NARRATIVE_CHARS = 2_400;
const MAX_DRAFT_GAPS = 8;

class DeliverySnapshotLimitError extends Error {
  constructor() {
    super("Delivery reference snapshot text exceeds the bounded text limit.");
  }
}

export function createDeliveryPreparation(
  workspace: MorphoWorkspace,
  input: {
    title: string;
    format: DeliveryObject["format"];
    position: CanvasPoint;
    now?: string;
  }
): CreateDeliveryPreparationResult {
  const title = input.title.trim();
  if (!title) {
    return { status: "blocked", workspace, reason: "交付准备包需要标题。" };
  }

  const now = input.now ?? new Date().toISOString();
  const deliveryObjectId = nextAvailableId(workspace.objects, `delivery-${slugify(title)}`);
  const sections = defaultSections(input.format, deliveryObjectId, now);
  const deliveryObject: DeliveryObject = {
    id: deliveryObjectId,
    type: "delivery",
    title,
    summary: "交付准备包用于组织章节、稳定引用、说明文字和待补内容，不是最终排版文件。",
    createdBy: "user",
    visibility: "active",
    format: input.format,
    sections,
    gaps: [],
    references: [],
    createdAt: now,
    updatedAt: now
  };
  const decisionId = makeDecisionId(workspace, "createDeliveryPreparation", deliveryObjectId);
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [deliveryObjectId]: deliveryObject
      },
      canvas: {
        ...workspace.canvas,
        instances: [
          ...workspace.canvas.instances,
          {
            id: nextAvailableId(
              Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
              `canvas-${deliveryObjectId}`
            ),
            objectId: deliveryObjectId,
            position: input.position,
            size: { w: 360, h: 260 }
          }
        ]
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: decisionId,
          kind: "createDeliveryPreparation",
          createdAt: now,
          summary: `创建交付准备包：${title}`,
          objectSnapshot: snapshotObject(deliveryObject),
          relatedObjectIds: [deliveryObjectId]
        }
      ]
    }),
    {
      type: "deliveryPreparationChanged",
      action: "created",
      deliveryObjectId,
      decisionId,
      createdAt: now
    }
  );

  return { status: "updated", workspace: nextWorkspace, deliveryObjectId };
}

export function updateDeliveryPreparationMeta(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; title?: string; format?: DeliveryObject["format"]; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }

  const title = input.title?.trim();
  if (input.title !== undefined && !title) {
    return blocked(workspace, "交付准备包需要标题。");
  }

  const now = input.now ?? new Date().toISOString();
  return updatedWithDelivery(workspace, {
    ...target,
    title: title ?? target.title,
    format: input.format ?? target.format,
    updatedAt: now
  });
}

export function createDeliverySection(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; title: string; purpose?: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const title = input.title.trim();
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  if (!title) {
    return blocked(workspace, "章节需要标题。");
  }

  const now = input.now ?? new Date().toISOString();
  const section: DeliverySection = {
    id: nextAvailableSectionId(target, `section-${target.id}-${slugify(title)}`),
    title,
    purpose: normalizedOptional(input.purpose),
    order: target.sections.length,
    referenceIds: [],
    createdAt: now,
    updatedAt: now
  };

  return updatedWithDeliveryEvent(workspace, {
    ...target,
    sections: normalizeSectionOrder([...target.sections, section]),
    updatedAt: now
  }, "sectionChanged", { sectionId: section.id, now });
}

export function updateDeliverySection(
  workspace: MorphoWorkspace,
  input: {
    deliveryObjectId: MorphoObjectId;
    sectionId: string;
    title?: string;
    purpose?: string;
    narrative?: string;
    now?: string;
  }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  const section = target.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) {
    return blocked(workspace, "章节不存在。");
  }
  const title = input.title?.trim();
  if (input.title !== undefined && !title) {
    return blocked(workspace, "章节需要标题。");
  }

  const now = input.now ?? new Date().toISOString();
  const sections = target.sections.map((candidate) =>
    candidate.id === section.id
      ? {
          ...candidate,
          title: title ?? candidate.title,
          purpose: input.purpose !== undefined ? normalizedOptional(input.purpose) : candidate.purpose,
          narrative: input.narrative !== undefined ? normalizedOptional(input.narrative) : candidate.narrative,
          updatedAt: now
        }
      : candidate
  );
  return updatedWithDeliveryEvent(workspace, { ...target, sections, updatedAt: now }, "sectionChanged", {
    sectionId: section.id,
    now
  });
}

export function moveDeliverySection(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; sectionId: string; toIndex: number; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  const index = target.sections.findIndex((section) => section.id === input.sectionId);
  if (index < 0) {
    return blocked(workspace, "章节不存在。");
  }
  const sections = [...target.sections];
  const [section] = sections.splice(index, 1);
  if (!section) {
    return blocked(workspace, "章节不存在。");
  }
  sections.splice(Math.max(0, Math.min(input.toIndex, sections.length)), 0, section);
  const now = input.now ?? new Date().toISOString();
  return updatedWithDeliveryEvent(workspace, { ...target, sections: normalizeSectionOrder(sections), updatedAt: now }, "sectionChanged", {
    sectionId: section.id,
    now
  });
}

export function removeDeliverySection(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; sectionId: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  const section = target.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) {
    return blocked(workspace, "章节不存在。");
  }
  if (section.referenceIds.length > 0) {
    return blocked(workspace, "章节中仍有交付引用，不能直接删除。");
  }
  if (target.gaps.some((gap) => gap.sectionId === section.id && gap.status === "open")) {
    return blocked(workspace, "章节中仍有开放待补内容，不能直接删除。");
  }
  const now = input.now ?? new Date().toISOString();
  return updatedWithDeliveryEvent(
    workspace,
    {
      ...target,
      sections: normalizeSectionOrder(target.sections.filter((candidate) => candidate.id !== section.id)),
      updatedAt: now
    },
    "sectionChanged",
    { sectionId: section.id, now }
  );
}

export function addObjectsToDeliverySection(
  workspace: MorphoWorkspace,
  input: {
    deliveryObjectId: MorphoObjectId;
    sectionId: string;
    sourceObjectIds: MorphoObjectId[];
    now?: string;
  }
): AddObjectsToDeliverySectionResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return { status: "blocked", workspace, reason: "交付准备包不存在。" };
  }
  const section = target.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) {
    return { status: "blocked", workspace, reason: "章节不存在。" };
  }

  const now = input.now ?? new Date().toISOString();
  const createdReferenceIds: DeliveryReferenceId[] = [];
  const nextReferences: Record<DeliveryReferenceId, DeliveryReference> = { ...workspace.deliveryReferences };
  let nextRelations = workspace.relations;

  for (const sourceObjectId of uniqueStrings(input.sourceObjectIds)) {
    const source = workspace.objects[sourceObjectId];
    const sourceValidation = validateReferenceSource(source);
    if (sourceValidation) {
      return { status: "blocked", workspace, reason: sourceValidation };
    }
    if (!source) {
      return { status: "blocked", workspace, reason: "来源对象不存在。" };
    }
    if (section.referenceIds.some((referenceId) => workspace.deliveryReferences[referenceId]?.sourceObjectId === source.id)) {
      return { status: "blocked", workspace, reason: "该对象已在本章节中。" };
    }

    const referenceId = nextAvailableId(
      nextReferences,
      `delivery-ref-${target.id}-${section.id}-${source.id}`
    );
    const snapshotResult = createBoundedDeliveryReferenceSnapshot(workspace, source);
    if (snapshotResult.status === "blocked") {
      return { status: "blocked", workspace, reason: snapshotResult.reason };
    }
    const snapshot = snapshotResult.snapshot;
    const fingerprint = createDeliverySourceFingerprint(workspace, source);
    const revision = getSourceRevision(workspace, source);
    const assetId = getSourceAssetId(source);
    nextReferences[referenceId] = {
      id: referenceId,
      deliveryObjectId: target.id,
      sectionId: section.id,
      order: section.referenceIds.length + createdReferenceIds.length,
      sourceObjectId: source.id,
      createdAt: now,
      updatedAt: now,
      snapshot,
      sourceFingerprint: fingerprint,
      sourceRevisionId: revision?.revisionId,
      sourceRevisionNumber: revision?.revisionNumber,
      sourceAssetId: assetId
    };
    nextRelations = ensureDeliveryReferenceRelation(nextRelations, source.id, target.id);
    createdReferenceIds.push(referenceId);
  }

  if (createdReferenceIds.length === 0) {
    return { status: "blocked", workspace, reason: "没有可加入的对象。" };
  }

  const decisionId = makeDecisionId(workspace, "createDeliveryReference", createdReferenceIds.join("-"));
  const updatedDelivery: DeliveryObject = {
    ...target,
    references: [...target.references, ...createdReferenceIds],
    sections: target.sections.map((candidate) =>
      candidate.id === section.id
        ? {
            ...candidate,
            referenceIds: [...candidate.referenceIds, ...createdReferenceIds],
            updatedAt: now
          }
        : candidate
    ),
    updatedAt: now
  };
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({
      ...workspace,
      objects: { ...workspace.objects, [target.id]: updatedDelivery },
      relations: nextRelations,
      deliveryReferences: nextReferences,
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: decisionId,
          kind: "createDeliveryReference",
          createdAt: now,
          summary: `加入 ${createdReferenceIds.length} 项交付引用。`,
          objectSnapshot: snapshotObject(updatedDelivery),
          relatedObjectIds: [target.id, ...input.sourceObjectIds]
        }
      ]
    }),
    {
      type: "deliveryPreparationChanged",
      action: "referenceAdded",
      deliveryObjectId: target.id,
      sectionId: section.id,
      referenceIds: createdReferenceIds,
      decisionId,
      createdAt: now
    }
  );

  return { status: "updated", workspace: nextWorkspace, createdReferenceIds };
}

export function removeDeliveryReference(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; referenceId: DeliveryReferenceId; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const reference = workspace.deliveryReferences[input.referenceId];
  if (!target || !reference || reference.deliveryObjectId !== target.id) {
    return blocked(workspace, "交付引用不存在。");
  }

  const now = input.now ?? new Date().toISOString();
  const deliveryReferences = omitRecordKey(workspace.deliveryReferences, input.referenceId);
  const updatedDelivery: DeliveryObject = {
    ...target,
    references: target.references.filter((referenceId) => referenceId !== input.referenceId),
    sections: target.sections.map((section) => ({
      ...section,
      referenceIds: section.referenceIds.filter((referenceId) => referenceId !== input.referenceId),
      updatedAt: section.referenceIds.includes(input.referenceId) ? now : section.updatedAt
    })),
    updatedAt: now
  };
  const decisionId = makeDecisionId(workspace, "removeDeliveryReference", input.referenceId);
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({
      ...workspace,
      objects: { ...workspace.objects, [target.id]: updatedDelivery },
      deliveryReferences,
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: decisionId,
          kind: "removeDeliveryReference",
          createdAt: now,
          summary: `移除交付引用：${reference.snapshot.title}`,
          relatedObjectIds: [target.id, reference.sourceObjectId].filter((id): id is string => Boolean(id))
        }
      ]
    }),
    {
      type: "deliveryPreparationChanged",
      action: "referenceRemoved",
      deliveryObjectId: target.id,
      referenceIds: [input.referenceId],
      decisionId,
      createdAt: now
    }
  );
  return { status: "updated", workspace: nextWorkspace };
}

export function moveDeliveryReference(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; referenceId: DeliveryReferenceId; toSectionId: string; toIndex: number; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const reference = workspace.deliveryReferences[input.referenceId];
  if (!target || !reference || reference.deliveryObjectId !== target.id) {
    return blocked(workspace, "交付引用不存在。");
  }
  if (!target.sections.some((section) => section.id === input.toSectionId)) {
    return blocked(workspace, "目标章节不存在。");
  }
  const now = input.now ?? new Date().toISOString();
  const sections = target.sections.map((section) => {
    const ids = section.referenceIds.filter((referenceId) => referenceId !== input.referenceId);
    if (section.id === input.toSectionId) {
      ids.splice(Math.max(0, Math.min(input.toIndex, ids.length)), 0, input.referenceId);
    }
    return { ...section, referenceIds: ids, updatedAt: now };
  });
  const sectionIds = new Map(sections.flatMap((section) => section.referenceIds.map((referenceId, order) => [referenceId, { sectionId: section.id, order }])));
  const targetPosition = sectionIds.get(input.referenceId);
  if (!targetPosition) {
    return blocked(workspace, "目标章节不存在。");
  }
  return updatedWithDelivery(workspace, {
    ...target,
    sections,
    updatedAt: now
  }, {
    ...workspace.deliveryReferences,
    [input.referenceId]: {
      ...reference,
      sectionId: targetPosition.sectionId,
      order: targetPosition.order,
      updatedAt: now
    }
  });
}

export function updateDeliveryReferenceEditorial(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; referenceId: DeliveryReferenceId; caption?: string; note?: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const reference = workspace.deliveryReferences[input.referenceId];
  if (!target || !reference || reference.deliveryObjectId !== target.id) {
    return blocked(workspace, "交付引用不存在。");
  }
  const now = input.now ?? new Date().toISOString();
  return {
    status: "updated",
    workspace: {
      ...workspace,
      deliveryReferences: {
        ...workspace.deliveryReferences,
        [reference.id]: {
          ...reference,
          editorial: {
            caption: input.caption !== undefined ? normalizedOptional(input.caption) : reference.editorial?.caption,
            note: input.note !== undefined ? normalizedOptional(input.note) : reference.editorial?.note
          },
          updatedAt: now
        }
      }
    }
  };
}

export function resolveDeliveryReferenceState(workspace: MorphoWorkspace, referenceId: DeliveryReferenceId): DeliveryReferenceState {
  const reference = workspace.deliveryReferences[referenceId];
  if (!reference || !reference.sourceObjectId) {
    return { status: "sourceMissing", label: "来源不可用" };
  }
  if (reference.snapshot.previewAsset?.assetId && !workspace.assets[reference.snapshot.previewAsset.assetId]) {
    return { status: "assetMissing", label: "原始资产不可用" };
  }
  const source = workspace.objects[reference.sourceObjectId];
  if (!source) {
    return { status: "sourceMissing", label: "来源不可用" };
  }
  if (source.type === "documentFragment") {
    if (!workspace.assets[source.source.sourceExtractAssetId]) {
      return { status: "assetMissing", label: "原始资产不可用" };
    }
    const file = workspace.objects[source.source.fileObjectId];
    if (!file || file.type !== "file") {
      return { status: "sourceMissing", label: "来源不可用" };
    }
    if (file.visibility === "hidden") {
      return { status: "sourceHidden", label: "来源已隐藏" };
    }
    if (file.extractedAssetId !== source.source.sourceExtractAssetId) {
      return { status: "sourceUpdated", label: "当前版本已有更新" };
    }
    if (reference.sourceFingerprint && reference.sourceFingerprint !== createDeliverySourceFingerprint(workspace, source)) {
      return { status: "sourceUpdated", label: "当前版本已有更新" };
    }
    return { status: "current", label: "当前快照" };
  }
  const sourceForAvailability = source;
  if (sourceForAvailability.visibility === "hidden") {
    return { status: "sourceHidden", label: "来源已隐藏" };
  }
  const currentAssetId = getSourceAssetId(source);
  if (currentAssetId && !workspace.assets[currentAssetId]) {
    return { status: "assetMissing", label: "原始资产不可用" };
  }
  if (reference.sourceFingerprint && reference.sourceFingerprint !== createDeliverySourceFingerprint(workspace, source)) {
    return { status: "sourceUpdated", label: "当前版本已有更新" };
  }
  return { status: "current", label: "当前快照" };
}

export function refreshDeliveryReferenceSnapshot(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; referenceId: DeliveryReferenceId; reason: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const reference = workspace.deliveryReferences[input.referenceId];
  if (!target || !reference || reference.deliveryObjectId !== target.id || !reference.sourceObjectId) {
    return blocked(workspace, "交付引用不存在。");
  }
  const source = workspace.objects[reference.sourceObjectId];
  if (!source || source.visibility !== "active") {
    return blocked(workspace, "来源不可用，不能更新引用。");
  }
  if (source.type === "documentFragment") {
    const file = workspace.objects[source.source.fileObjectId];
    if (!file || file.visibility !== "active") {
      return blocked(workspace, "来源不可用，不能更新引用。");
    }
  }
  if (source.type === "documentFragment") {
    const fileForRefresh = workspace.objects[source.source.fileObjectId];
    if (!fileForRefresh || fileForRefresh.type !== "file" || fileForRefresh.visibility !== "active") {
      return blocked(workspace, "来源不可用，不能更新引用。");
    }
    if (!workspace.assets[source.source.sourceExtractAssetId]) {
      return blocked(workspace, "原始资产不可用，不能更新引用。");
    }
    if (fileForRefresh.extractedAssetId !== source.source.sourceExtractAssetId) {
      return blocked(workspace, "来源文本已有更新，当前原文定位不可用，不能刷新该引用。");
    }
  }
  const assetId = getSourceAssetId(source);
  if (assetId && !workspace.assets[assetId]) {
    return blocked(workspace, "原始资产不可用，不能更新引用。");
  }

  const now = input.now ?? new Date().toISOString();
  const revision = getSourceRevision(workspace, source);
  const snapshotResult = createBoundedDeliveryReferenceSnapshot(workspace, source);
  if (snapshotResult.status === "blocked") {
    return blocked(workspace, snapshotResult.reason);
  }
  const refreshed: DeliveryReference = {
    ...reference,
    snapshot: snapshotResult.snapshot,
    sourceFingerprint: createDeliverySourceFingerprint(workspace, source),
    sourceRevisionId: revision?.revisionId,
    sourceRevisionNumber: revision?.revisionNumber,
    sourceAssetId: assetId,
    updatedAt: now
  };
  const decisionId = makeDecisionId(workspace, "refreshDeliveryReference", reference.id);
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({
      ...workspace,
      deliveryReferences: {
        ...workspace.deliveryReferences,
        [reference.id]: refreshed
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: decisionId,
          kind: "refreshDeliveryReference",
          createdAt: now,
          summary: `更新交付引用为当前版本：${refreshed.snapshot.title}`,
          reason: input.reason,
          objectSnapshot: snapshotObject(source),
          relatedObjectIds: [target.id, source.id]
        }
      ]
    }),
    {
      type: "deliveryPreparationChanged",
      action: "referenceRefreshed",
      deliveryObjectId: target.id,
      referenceIds: [reference.id],
      decisionId,
      createdAt: now
    }
  );
  return { status: "updated", workspace: nextWorkspace };
}

export function addDeliveryGap(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; sectionId?: string; label: string; origin: DeliveryGap["origin"]; now?: string }
): GapOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const label = input.label.trim();
  if (!target) {
    return { status: "blocked", workspace, reason: "交付准备包不存在。" };
  }
  if (!label) {
    return { status: "blocked", workspace, reason: "待补内容需要说明。" };
  }
  if (input.sectionId && !target.sections.some((section) => section.id === input.sectionId)) {
    return { status: "blocked", workspace, reason: "章节不存在。" };
  }
  const now = input.now ?? new Date().toISOString();
  const gapId = nextAvailableId(Object.fromEntries(target.gaps.map((gap) => [gap.id, gap])), `gap-${slugify(label)}`);
  const gap: DeliveryGap = {
    id: gapId,
    label,
    sectionId: input.sectionId,
    status: "open",
    origin: input.origin,
    createdAt: now,
    updatedAt: now
  };
  const updated = updatedWithDeliveryEvent(workspace, { ...target, gaps: [...target.gaps, gap], updatedAt: now }, "gapChanged", {
    sectionId: input.sectionId,
    gapId,
    now
  });
  return updated.status === "updated"
    ? { status: "updated", workspace: updated.workspace, gapId }
    : { status: "blocked", workspace, reason: updated.reason };
}

export function setDeliveryGapStatus(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; gapId: string; status: DeliveryGap["status"]; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  const gap = target.gaps.find((candidate) => candidate.id === input.gapId);
  if (!gap) {
    return blocked(workspace, "待补内容不存在。");
  }
  const now = input.now ?? new Date().toISOString();
  return updatedWithDeliveryEvent(
    workspace,
    {
      ...target,
      gaps: target.gaps.map((candidate) =>
        candidate.id === gap.id
          ? {
              ...candidate,
              status: input.status,
              updatedAt: now,
              resolvedAt: input.status === "resolved" ? now : undefined
            }
          : candidate
      ),
      updatedAt: now
    },
    "gapChanged",
    { sectionId: gap.sectionId, gapId: gap.id, now }
  );
}

export function removeDeliveryGap(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; gapId: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return blocked(workspace, "交付准备包不存在。");
  }
  const gap = target.gaps.find((candidate) => candidate.id === input.gapId);
  if (!gap) {
    return blocked(workspace, "待补内容不存在。");
  }
  const now = input.now ?? new Date().toISOString();
  return updatedWithDeliveryEvent(
    workspace,
    { ...target, gaps: target.gaps.filter((candidate) => candidate.id !== gap.id), updatedAt: now },
    "gapChanged",
    { sectionId: gap.sectionId, gapId: gap.id, now }
  );
}

export function createDeliverySectionDraft(
  workspace: MorphoWorkspace,
  input: {
    deliveryObjectId: MorphoObjectId;
    sectionId: string;
    userMessageId: string;
    assistantMessageId: string;
    title?: string;
    narrative: string;
    captions: Array<{ referenceId: DeliveryReferenceId; caption: string }>;
    suggestedGaps: Array<{ label: string }>;
    /** Stable replay identity supplied by A+ Tool execution. */
    draftId?: string;
    now?: string;
  }
): DraftOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  if (!target) {
    return { status: "blocked", workspace, reason: "交付准备包不存在。" };
  }
  const section = target.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) {
    return { status: "blocked", workspace, reason: "章节不存在。" };
  }
  if (section.referenceIds.length === 0) {
    return { status: "blocked", workspace, reason: "先加入至少一项交付内容，再生成章节说明草案。" };
  }
  const narrative = input.narrative.trim();
  if (!narrative || narrative.length > MAX_DRAFT_NARRATIVE_CHARS) {
    return { status: "blocked", workspace, reason: "交付说明草案正文为空或超过长度上限。" };
  }
  if (input.suggestedGaps.length > MAX_DRAFT_GAPS) {
    return { status: "blocked", workspace, reason: "建议待补内容数量超过上限。" };
  }
  const sectionReferenceIds = new Set(section.referenceIds);
  for (const caption of input.captions) {
    if (!sectionReferenceIds.has(caption.referenceId)) {
      return { status: "blocked", workspace, reason: "草案图注引用了不属于当前章节的交付引用。" };
    }
  }

  const now = input.now ?? new Date().toISOString();
  const draftId = input.draftId?.trim() || nextAvailableId(
    workspace.deliverySectionDrafts,
    `delivery-draft-${target.id}-${section.id}-${input.assistantMessageId}`
  );
  const existing = workspace.deliverySectionDrafts[draftId];
  if (existing) {
    if (
      existing.deliveryObjectId !== target.id ||
      existing.sectionId !== section.id ||
      existing.userMessageId !== input.userMessageId ||
      existing.assistantMessageId !== input.assistantMessageId
    ) {
      return { status: "blocked", workspace, reason: "交付章节草案的稳定操作身份已经被其他草案占用。" };
    }
    return { status: "updated", workspace, draftId, recovered: true };
  }
  const draft: DeliverySectionDraft = {
    id: draftId,
    deliveryObjectId: target.id,
    sectionId: section.id,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    referenceIds: [...section.referenceIds],
    sourceFingerprints: Object.fromEntries(section.referenceIds.map((referenceId) => [referenceId, workspace.deliveryReferences[referenceId]?.sourceFingerprint])),
    title: normalizedOptional(input.title),
    narrative,
    captions: input.captions.map((caption) => ({ referenceId: caption.referenceId, caption: caption.caption.trim() })),
    suggestedGaps: input.suggestedGaps.map((gap) => ({ label: gap.label.trim() })).filter((gap) => gap.label.length > 0),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  return {
    status: "updated",
    workspace: {
      ...workspace,
      deliverySectionDrafts: {
        ...workspace.deliverySectionDrafts,
        [draft.id]: draft
      }
    },
    draftId
  };
}

export function applyDeliverySectionDraft(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; draftId: string; now?: string }
): DeliveryOperationResult {
  const target = getDeliveryObject(workspace, input.deliveryObjectId);
  const draft = workspace.deliverySectionDrafts[input.draftId];
  if (!target || !draft || draft.deliveryObjectId !== input.deliveryObjectId) {
    return blocked(workspace, "交付说明草案不存在。");
  }
  if (draft.status !== "pending") {
    return blocked(workspace, "交付说明草案不能重复应用。");
  }
  const section = target.sections.find((candidate) => candidate.id === draft.sectionId);
  if (!section) {
    return blocked(workspace, "章节不存在。");
  }

  const now = input.now ?? new Date().toISOString();
  const deliveryReferences = { ...workspace.deliveryReferences };
  for (const caption of draft.captions) {
    const reference = deliveryReferences[caption.referenceId];
    if (!reference || reference.deliveryObjectId !== target.id || reference.sectionId !== section.id) {
      return blocked(workspace, "草案图注引用了不属于当前章节的交付引用。");
    }
    deliveryReferences[caption.referenceId] = {
      ...reference,
      editorial: {
        ...reference.editorial,
        caption: caption.caption
      },
      updatedAt: now
    };
  }

  const newGaps: DeliveryGap[] = draft.suggestedGaps.map((gap, index) => ({
    id: nextAvailableId(
      Object.fromEntries([...target.gaps, ...draft.suggestedGaps.slice(0, index).map((item) => ({ id: `gap-${slugify(item.label)}` }))].map((item) => [item.id, item])),
      `gap-${slugify(gap.label)}`
    ),
    label: gap.label,
    sectionId: section.id,
    status: "open",
    origin: "deliveryDraft",
    createdAt: now,
    updatedAt: now
  }));
  const updatedDelivery: DeliveryObject = {
    ...target,
    sections: target.sections.map((candidate) =>
      candidate.id === section.id
        ? {
            ...candidate,
            narrative: draft.narrative,
            title: draft.title ?? candidate.title,
            updatedAt: now
          }
        : candidate
    ),
    gaps: [...target.gaps, ...newGaps],
    updatedAt: now
  };
  const decisionId = makeDecisionId(workspace, "applyDeliverySectionDraft", draft.id);
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({
      ...workspace,
      objects: { ...workspace.objects, [target.id]: updatedDelivery },
      deliveryReferences,
      deliverySectionDrafts: {
        ...workspace.deliverySectionDrafts,
        [draft.id]: {
          ...draft,
          status: "applied",
          updatedAt: now
        }
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: decisionId,
          kind: "applyDeliverySectionDraft",
          createdAt: now,
          summary: `应用交付说明草案：${section.title}`,
          relatedObjectIds: [target.id]
        }
      ]
    }),
    {
      type: "deliveryPreparationChanged",
      action: "draftApplied",
      deliveryObjectId: target.id,
      sectionId: section.id,
      referenceIds: draft.referenceIds,
      decisionId,
      createdAt: now
    }
  );
  return { status: "updated", workspace: nextWorkspace };
}

export function discardDeliverySectionDraft(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; draftId: string; now?: string }
): DeliveryOperationResult {
  const draft = workspace.deliverySectionDrafts[input.draftId];
  if (!draft || draft.deliveryObjectId !== input.deliveryObjectId) {
    return blocked(workspace, "交付说明草案不存在。");
  }
  if (draft.status !== "pending") {
    return blocked(workspace, "只有待处理草案可以放弃。");
  }
  const now = input.now ?? new Date().toISOString();
  return {
    status: "updated",
    workspace: {
      ...workspace,
      deliverySectionDrafts: {
        ...workspace.deliverySectionDrafts,
        [draft.id]: {
          ...draft,
          status: "discarded",
          updatedAt: now
        }
      }
    }
  };
}

export function deriveDeliveryPreparationSignals(workspace: MorphoWorkspace, deliveryObjectId: MorphoObjectId): DeliveryPreparationSignals {
  const target = getDeliveryObject(workspace, deliveryObjectId);
  if (!target) {
    return {
      emptySectionIds: [],
      sourceHiddenReferenceIds: [],
      sourceMissingReferenceIds: [],
      assetMissingReferenceIds: [],
      sourceUpdatedReferenceIds: []
    };
  }

  const signals: DeliveryPreparationSignals = {
    emptySectionIds: target.sections.filter((section) => section.referenceIds.length === 0 && !section.narrative).map((section) => section.id),
    sourceHiddenReferenceIds: [],
    sourceMissingReferenceIds: [],
    assetMissingReferenceIds: [],
    sourceUpdatedReferenceIds: []
  };
  for (const referenceId of target.references) {
    const state = resolveDeliveryReferenceState(workspace, referenceId);
    if (state.status === "sourceHidden") {
      signals.sourceHiddenReferenceIds.push(referenceId);
    }
    if (state.status === "sourceMissing") {
      signals.sourceMissingReferenceIds.push(referenceId);
    }
    if (state.status === "assetMissing") {
      signals.assetMissingReferenceIds.push(referenceId);
    }
    if (state.status === "sourceUpdated") {
      signals.sourceUpdatedReferenceIds.push(referenceId);
    }
  }
  return signals;
}

function createBoundedDeliveryReferenceSnapshot(
  workspace: MorphoWorkspace,
  source: MorphoObject
): { status: "ok"; snapshot: DeliveryReferenceSnapshot } | { status: "blocked"; reason: string } {
  try {
    return { status: "ok", snapshot: createDeliveryReferenceSnapshot(workspace, source) };
  } catch (error) {
    if (error instanceof DeliverySnapshotLimitError) {
      return { status: "blocked", reason: "交付引用快照文字超过上限，请先缩短来源内容或创建更小的片段。" };
    }
    throw error;
  }
}

export function createDeliveryReferenceSnapshot(workspace: MorphoWorkspace, source: MorphoObject): DeliveryReferenceSnapshot {
  switch (source.type) {
    case "image":
      return {
        sourceType: source.type,
        title: source.title,
        summary: source.summary,
        previewAsset: {
          assetId: source.assetId,
          alt: `${source.title} 的交付引用快照`
        }
      };
    case "documentFragment":
      return {
        sourceType: source.type,
        title: source.title,
        summary: source.summary,
        body: boundedText(source.body),
        bodyKind: "complete",
        sourceFile: {
          fileObjectId: source.source.fileObjectId,
          title: source.source.fileTitle,
          fileName: source.source.fileName,
          sourceExtractAssetId: source.source.sourceExtractAssetId,
          startOffset: source.source.startOffset,
          endOffset: source.source.endOffset
        }
      };
    case "keyConclusion":
      return {
        sourceType: source.type,
        title: source.title,
        summary: source.summary,
        body: boundedText(source.body),
        bodyKind: "complete"
      };
    case "research":
      return {
        sourceType: source.type,
        title: source.title,
        summary: source.summary,
        body: boundedText([...source.findings, ...source.opportunities, ...source.constraints, ...source.openQuestions].join("\n")),
        bodyKind: "excerpt"
      };
    case "designDefinition": {
      const revision = workspace.designDefinitionRevisions[source.currentRevisionId];
      return {
        sourceType: source.type,
        title: revision?.title ?? source.title,
        summary: revision?.summary ?? source.summary,
        body: boundedText([revision?.coreProblem, ...(revision?.designPrinciples ?? [])].filter(Boolean).join("\n")),
        bodyKind: "excerpt",
        sourceRevision: revision ? { revisionId: revision.id, revisionNumber: revision.revisionNumber } : undefined
      };
    }
    case "conceptDirection": {
      const revision = workspace.directionRevisions[source.currentRevisionId];
      return {
        sourceType: source.type,
        title: revision?.title ?? source.title,
        summary: revision?.summary ?? source.summary,
        body: boundedText(revision?.conceptStatement ?? source.summary),
        bodyKind: "excerpt",
        sourceRevision: revision ? { revisionId: revision.id, revisionNumber: revision.revisionNumber } : undefined
      };
    }
    case "text":
      return { sourceType: source.type, title: source.title, summary: source.summary, body: boundedText(source.body), bodyKind: "complete" };
    case "file":
      return {
        sourceType: source.type,
        title: source.title,
        summary: source.summary,
        sourceFile: {
          fileObjectId: source.id,
          title: source.title,
          fileName: source.fileName,
          sourceExtractAssetId: source.extractedAssetId
        },
        previewAsset: source.assetId ? { assetId: source.assetId, alt: `${source.title} 的文件引用快照` } : undefined
      };
    case "link":
      return { sourceType: source.type, title: source.editableTitle ?? source.title, summary: source.description ?? source.summary };
    case "imageCollection":
      return { sourceType: source.type, title: source.title, summary: `${source.summary} · ${source.memberObjectIds.length} 项图片` };
    case "proposalDraft":
      throw new Error("Pending proposal drafts cannot be delivery reference sources.");
    case "delivery":
      throw new Error("Delivery objects cannot be delivery reference sources.");
  }
}

export function createDeliverySourceFingerprint(workspace: MorphoWorkspace, source: MorphoObject): string {
  switch (source.type) {
    case "image":
      return stableStringify({
        type: source.type,
        assetId: source.assetId,
        role: source.role,
        title: source.title,
        summary: source.summary,
        directionId: source.directionId,
        visualBranchId: source.visualBranchId
      });
    case "documentFragment":
      return stableStringify({
        type: source.type,
        title: source.title,
        summary: source.summary,
        body: source.body,
        sourceFileObjectId: source.source.fileObjectId,
        sourceExtractAssetId: source.source.sourceExtractAssetId,
        startOffset: source.source.startOffset,
        endOffset: source.source.endOffset
      });
    case "keyConclusion":
      return stableStringify({
        type: source.type,
        title: source.title,
        summary: source.summary,
        body: source.body,
        state: source.state,
        confidence: source.confidence
      });
    case "research":
      return stableStringify({
        type: source.type,
        summary: source.summary,
        findings: source.findings,
        opportunities: source.opportunities,
        constraints: source.constraints,
        openQuestions: source.openQuestions
      });
    case "designDefinition": {
      const revision = workspace.designDefinitionRevisions[source.currentRevisionId];
      return stableStringify({ type: source.type, revisionId: source.currentRevisionId, revisionNumber: revision?.revisionNumber, revision });
    }
    case "conceptDirection": {
      const revision = workspace.directionRevisions[source.currentRevisionId];
      return stableStringify({ type: source.type, revisionId: source.currentRevisionId, revisionNumber: revision?.revisionNumber, status: source.status, revision });
    }
    case "file":
      return stableStringify({ type: source.type, title: source.title, summary: source.summary, assetId: source.assetId, extractedAssetId: source.extractedAssetId, parseStatus: source.parseStatus });
    case "link":
      return stableStringify({ type: source.type, title: source.editableTitle ?? source.title, summary: source.summary, url: source.url, description: source.description, assetId: source.assetId });
    case "text":
      return stableStringify({ type: source.type, title: source.title, summary: source.summary, body: source.body });
    case "imageCollection":
      return stableStringify({ type: source.type, title: source.title, summary: source.summary, memberObjectIds: source.memberObjectIds });
    case "proposalDraft":
      return stableStringify({ type: source.type, title: source.title, summary: source.summary, proposalId: source.proposalId });
    case "delivery":
      return stableStringify({ type: source.type, title: source.title });
  }
}

function defaultSections(format: DeliveryObject["format"], deliveryObjectId: string, now: string): DeliverySection[] {
  const titles = format === "board" ? BOARD_DEFAULT_SECTIONS : PRESENTATION_DEFAULT_SECTIONS;
  return titles.map((title, index) => ({
    id: `section-${deliveryObjectId}-${index + 1}`,
    title,
    order: index,
    referenceIds: [],
    createdAt: now,
    updatedAt: now
  }));
}

function validateReferenceSource(source: MorphoObject | undefined): string | undefined {
  if (!source) {
    return "来源对象不存在。";
  }
  if (!ALLOWED_REFERENCE_SOURCE_TYPES.has(source.type)) {
    return "该对象类型不能加入交付准备。";
  }
  if (source.type === "delivery") {
    return "交付准备包不能引用另一个交付准备包。";
  }
  if (source.visibility !== "active") {
    return "已隐藏对象不能作为新的交付引用。";
  }
  return undefined;
}

function updatedWithDelivery(
  workspace: MorphoWorkspace,
  delivery: DeliveryObject,
  deliveryReferences: Record<DeliveryReferenceId, DeliveryReference> = workspace.deliveryReferences
): DeliveryOperationResult {
  return {
    status: "updated",
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: { ...workspace.objects, [delivery.id]: delivery },
      deliveryReferences
    })
  };
}

function updatedWithDeliveryEvent(
  workspace: MorphoWorkspace,
  delivery: DeliveryObject,
  action: Extract<Parameters<typeof applyProjectContinuityEvent>[1], { type: "deliveryPreparationChanged" }>["action"],
  options: { sectionId?: string; gapId?: string; now: string }
): DeliveryOperationResult {
  const nextWorkspace = applyProjectContinuityEvent(
    reconcileWorkspaceDerivedState({ ...workspace, objects: { ...workspace.objects, [delivery.id]: delivery } }),
    {
      type: "deliveryPreparationChanged",
      action,
      deliveryObjectId: delivery.id,
      sectionId: options.sectionId,
      gapId: options.gapId,
      createdAt: options.now
    }
  );
  return { status: "updated", workspace: nextWorkspace };
}

function getDeliveryObject(workspace: MorphoWorkspace, deliveryObjectId: MorphoObjectId): DeliveryObject | undefined {
  const object = workspace.objects[deliveryObjectId];
  return object?.type === "delivery" ? object : undefined;
}

function getSourceRevision(workspace: MorphoWorkspace, source: MorphoObject): { revisionId: string; revisionNumber: number } | undefined {
  if (source.type === "designDefinition") {
    const revision = workspace.designDefinitionRevisions[source.currentRevisionId];
    return revision ? { revisionId: revision.id, revisionNumber: revision.revisionNumber } : undefined;
  }
  if (source.type === "conceptDirection") {
    const revision = workspace.directionRevisions[source.currentRevisionId];
    return revision ? { revisionId: revision.id, revisionNumber: revision.revisionNumber } : undefined;
  }
  return undefined;
}

function getSourceAssetId(source: MorphoObject): AssetId | undefined {
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

function ensureDeliveryReferenceRelation(
  relations: MorphoRelation[],
  sourceObjectId: MorphoObjectId,
  deliveryObjectId: MorphoObjectId
): MorphoRelation[] {
  if (
    relations.some(
      (relation) =>
        relation.kind === "deliveryReference" &&
        relation.fromObjectId === sourceObjectId &&
        relation.toObjectId === deliveryObjectId
    )
  ) {
    return relations;
  }
  return [
    ...relations,
    {
      id: nextAvailableId(
        Object.fromEntries(relations.map((relation) => [relation.id, relation])),
        `rel-${sourceObjectId}-${deliveryObjectId}-delivery-reference`
      ),
      kind: "deliveryReference",
      fromObjectId: sourceObjectId,
      toObjectId: deliveryObjectId,
      note: "对象被明确加入交付准备包。"
    }
  ];
}

function normalizeSectionOrder(sections: DeliverySection[]): DeliverySection[] {
  return sections.map((section, order) => ({ ...section, order }));
}

function nextAvailableSectionId(delivery: DeliveryObject, preferredId: string): string {
  return nextAvailableId(Object.fromEntries(delivery.sections.map((section) => [section.id, section])), preferredId);
}

function boundedText(value: string): string {
  if (value.length > MAX_SNAPSHOT_TEXT_CHARS) {
    throw new DeliverySnapshotLimitError();
  }
  return value;
}

function blocked(workspace: MorphoWorkspace, reason: string): Extract<DeliveryOperationResult, { status: "blocked" }> {
  return { status: "blocked", workspace, reason };
}

function snapshotObject(object: MorphoObject) {
  return {
    id: object.id,
    type: object.type,
    title: object.title
  };
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

function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "delivery"
  );
}

function normalizedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
