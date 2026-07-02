import type { DeliveryObject, DeliveryReference, DeliverySection, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import { createDeliveryReferenceSnapshot, resolveDeliveryReferenceState } from "@/domain/morpho/deliveryPreparation";

export type DeliveryReferenceUiState = ReturnType<typeof resolveDeliveryReferenceState>;

export type DeliverySectionAiContext = {
  deliveryObjectId: string;
  sectionId: string;
  sectionTitle: string;
  sectionPurpose?: string;
  existingNarrative?: string;
  openGaps: Array<{ id: string; label: string }>;
  references: Array<{
    referenceId: string;
    snapshot: {
      sourceType: string;
      title: string;
      summary?: string;
      body?: string;
      bodyKind?: "complete" | "excerpt";
      sourceFile?: {
        fileObjectId: string;
        title: string;
        fileName?: string;
        startOffset?: number;
        endOffset?: number;
      };
      previewAsset?: {
        assetId?: string;
        alt: string;
      };
    };
    editorialCaption?: string;
    editorialNote?: string;
    sourceState: DeliveryReferenceUiState["status"];
  }>;
  truncated: boolean;
};

export type DeliveryReferenceRefreshPreview = {
  status: "ready";
  currentSnapshot: DeliveryReference["snapshot"];
  changeLabels: string[];
} | {
  status: "blocked";
  reason: string;
};

export function getDeliveryObjects(workspace: MorphoWorkspace): DeliveryObject[] {
  return Object.values(workspace.objects)
    .filter((object): object is DeliveryObject => object.type === "delivery" && object.visibility === "active")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function getDeliverySectionReferences(
  workspace: MorphoWorkspace,
  section: DeliverySection
): DeliveryReference[] {
  return section.referenceIds
    .map((referenceId) => workspace.deliveryReferences[referenceId])
    .filter((reference): reference is DeliveryReference => Boolean(reference))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function canAddObjectToDelivery(object: MorphoObject): boolean {
  return object.visibility === "active" && object.type !== "delivery";
}

export function buildDeliverySectionContext(
  workspace: MorphoWorkspace,
  delivery: DeliveryObject,
  sectionId: string
): DeliverySectionAiContext | undefined {
  const section = delivery.sections.find((candidate) => candidate.id === sectionId);
  if (!section || section.referenceIds.length === 0) {
    return undefined;
  }

  return {
    deliveryObjectId: delivery.id,
    sectionId: section.id,
    sectionTitle: section.title,
    sectionPurpose: section.purpose,
    existingNarrative: section.narrative,
    openGaps: delivery.gaps
      .filter((gap) => gap.status === "open" && (!gap.sectionId || gap.sectionId === section.id))
      .map((gap) => ({ id: gap.id, label: gap.label })),
    references: getDeliverySectionReferences(workspace, section).map((reference) => ({
      referenceId: reference.id,
      snapshot: {
        sourceType: reference.snapshot.sourceType,
        title: reference.snapshot.title,
        summary: reference.snapshot.summary,
        body: reference.snapshot.body,
        bodyKind: reference.snapshot.bodyKind,
        sourceFile: reference.snapshot.sourceFile
          ? {
              fileObjectId: reference.snapshot.sourceFile.fileObjectId,
              title: reference.snapshot.sourceFile.title,
              fileName: reference.snapshot.sourceFile.fileName,
              startOffset: reference.snapshot.sourceFile.startOffset,
              endOffset: reference.snapshot.sourceFile.endOffset
            }
          : undefined,
        previewAsset: reference.snapshot.previewAsset
          ? {
              assetId: reference.snapshot.previewAsset.assetId,
              alt: reference.snapshot.previewAsset.alt
            }
          : undefined
      },
      editorialCaption: reference.editorial?.caption,
      editorialNote: reference.editorial?.note,
      sourceState: resolveDeliveryReferenceState(workspace, reference.id).status
    })),
    truncated: false
  };
}

export function deliveryFormatLabel(format: DeliveryObject["format"]): string {
  return format === "board" ? "展板" : "演示文稿";
}

export function deliverySourceStateLabel(state: DeliveryReferenceUiState["status"]): string {
  switch (state) {
    case "current":
      return "当前快照";
    case "sourceHidden":
      return "来源已隐藏";
    case "sourceMissing":
      return "来源不可用";
    case "assetMissing":
      return "原始资产不可用";
    case "sourceUpdated":
      return "当前版本已有更新";
  }
}

export function getDeliveryReferenceLocationTarget(
  workspace: MorphoWorkspace,
  reference: DeliveryReference
): { objectId: string; label: string } | undefined {
  if (!reference.sourceObjectId) {
    return undefined;
  }
  const source = workspace.objects[reference.sourceObjectId];
  if (!source || source.visibility !== "active") {
    return undefined;
  }
  if (source.type !== "documentFragment") {
    return { objectId: source.id, label: "定位来源" };
  }
  const file = workspace.objects[source.source.fileObjectId];
  if (!file || file.type !== "file" || file.visibility !== "active") {
    return undefined;
  }
  if (file.extractedAssetId !== source.source.sourceExtractAssetId || !workspace.assets[source.source.sourceExtractAssetId]) {
    return undefined;
  }
  return { objectId: file.id, label: "查看原文定位" };
}

export function canRefreshDeliveryReference(workspace: MorphoWorkspace, reference: DeliveryReference): boolean {
  const state = resolveDeliveryReferenceState(workspace, reference.id);
  if (state.status !== "sourceUpdated" || !reference.sourceObjectId) {
    return false;
  }
  const source = workspace.objects[reference.sourceObjectId];
  if (!source || source.visibility !== "active") {
    return false;
  }
  if (source.type !== "documentFragment") {
    return true;
  }
  const file = workspace.objects[source.source.fileObjectId];
  return Boolean(
    file &&
      file.type === "file" &&
      file.visibility === "active" &&
      file.extractedAssetId === source.source.sourceExtractAssetId &&
      workspace.assets[source.source.sourceExtractAssetId]
  );
}

export function buildDeliveryReferenceRefreshPreview(
  workspace: MorphoWorkspace,
  reference: DeliveryReference
): DeliveryReferenceRefreshPreview {
  if (!reference.sourceObjectId || !canRefreshDeliveryReference(workspace, reference)) {
    return { status: "blocked", reason: "当前来源不可刷新，请保留稳定快照或重新添加引用。" };
  }
  const source = workspace.objects[reference.sourceObjectId];
  if (!source) {
    return { status: "blocked", reason: "来源不可用，不能预览更新。" };
  }
  let currentSnapshot: DeliveryReference["snapshot"];
  try {
    currentSnapshot = createDeliveryReferenceSnapshot(workspace, source);
  } catch {
    return { status: "blocked", reason: "当前来源内容超过交付快照上限，不能刷新。" };
  }
  return {
    status: "ready",
    currentSnapshot,
    changeLabels: summarizeRefreshChanges(reference.snapshot, currentSnapshot, resolveDeliveryReferenceState(workspace, reference.id).status)
  };
}

function summarizeRefreshChanges(
  previous: DeliveryReference["snapshot"],
  current: DeliveryReference["snapshot"],
  sourceState: DeliveryReferenceUiState["status"]
): string[] {
  const changes: string[] = [];
  if (previous.title !== current.title) {
    changes.push("标题");
  }
  if (previous.summary !== current.summary || previous.body !== current.body || previous.bodyKind !== current.bodyKind) {
    changes.push("摘要 / 正文");
  }
  if (JSON.stringify(previous.sourceRevision) !== JSON.stringify(current.sourceRevision)) {
    changes.push("revision");
  }
  if (previous.previewAsset?.assetId !== current.previewAsset?.assetId) {
    changes.push("asset");
  }
  if (
    previous.sourceFile?.fileObjectId !== current.sourceFile?.fileObjectId ||
    previous.sourceFile?.sourceExtractAssetId !== current.sourceFile?.sourceExtractAssetId ||
    previous.sourceFile?.startOffset !== current.sourceFile?.startOffset ||
    previous.sourceFile?.endOffset !== current.sourceFile?.endOffset
  ) {
    changes.push("source range");
  }
  if (sourceState !== "current") {
    changes.push("source state");
  }
  return changes.length > 0 ? changes : ["快照内容"];
}
