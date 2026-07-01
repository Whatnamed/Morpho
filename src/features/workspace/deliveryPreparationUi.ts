import type { DeliveryObject, DeliveryReference, DeliverySection, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import { resolveDeliveryReferenceState } from "@/domain/morpho/deliveryPreparation";

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
