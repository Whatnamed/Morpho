import { hashProductValue } from "@/shared/agentProductHash";
import { resolveSource } from "./sourceResolution";
import { qualifyEvidence } from "./evidenceAuthority";
import { hasDeliveredVisualObservation } from "./visualObservation";
import { createDeliverySourceFingerprint } from "./deliveryPreparation";
import type { DeliveryGenerationBaseline, DeliveryObject, DeliveryReference, DeliveryReferenceSnapshot, DeliverySection, DeliverySectionDraft, MorphoObject, MorphoWorkspace } from "./types";

export type DeliveryReferenceInspection = {
  sourceFreshness: "current" | "sourceUpdated" | "unknown";
  sourceExistence: "present" | "sourceMissing";
  sourceVisibility: "active" | "sourceHidden" | "unknown";
  assetAvailability: "metadataAvailable" | "assetMissing" | "noBinaryExpected" | "referenceOnly";
  binaryAvailability: "notChecked";
  copyReview: "reviewed" | "needsReview" | "unknown" | "noCopy";
  provenance: NonNullable<DeliveryReferenceSnapshot["provenance"]>;
};
export type DeliveryDraftApplicability = {
  status: "current" | "review-required" | "stale" | "blocked";
  reasons: string[];
};

/** Section.referenceIds is the sole ordering authority. Reference.order is compatibility metadata. */
export function getOrderedDeliverySectionReferences(workspace: MorphoWorkspace, section: DeliverySection): DeliveryReference[] {
  return section.referenceIds.map((id) => workspace.deliveryReferences[id]).filter((ref): ref is DeliveryReference => Boolean(ref));
}

export function captureDeliveryProvenance(workspace: MorphoWorkspace, source: MorphoObject): NonNullable<DeliveryReferenceSnapshot["provenance"]> {
  if (source.type === "keyConclusion" || source.type === "research") {
    const qualifications = (source.evidence ?? []).map((item) => qualifyEvidence(workspace, item));
    const evidenceIssues = qualifications.flatMap((item) => item.issues);
    const confidence = !qualifications.length || qualifications.some((item) => item.confidence === "needsVerification")
      ? "needsVerification" : qualifications.every((item) => item.confidence === "supported") ? "supported" : "partial";
    return { status: confidence === "supported" && (source.type !== "keyConclusion" || source.state === "active") ? "recorded" : "unverified", confidence, evidenceIssues,
      ...(source.type === "keyConclusion" ? { conclusionState: source.state } : { researchItems: { findings: [...source.findings], opportunities: [...source.opportunities], constraints: [...source.constraints], openQuestions: [...source.openQuestions] } }) };
  }
  if (source.type === "image") return { status: source.generation ? "unverified" : "unknown", visualObservation: hasDeliveredVisualObservation(source) ? "observed" : "notObserved", reviewStatus: source.pendingReview?.reason,
    visualLineage: source.generation?.lineage ? structuredClone(source.generation.lineage) : undefined,
    visualInputs: source.generation?.providerInputs ? structuredClone(source.generation.providerInputs) : undefined };
  return { status: "unknown" };
}

export function inspectDeliveryReference(workspace: MorphoWorkspace, reference: DeliveryReference): DeliveryReferenceInspection {
  const source = reference.sourceObjectId ? workspace.objects[reference.sourceObjectId] : undefined;
  const resolved = source ? resolveSource(workspace, source.id, reference.sourceBaseline) : undefined;
  const file = source?.type === "documentFragment" ? workspace.objects[source.source.fileObjectId] : undefined;
  const missing = !source || (source.type === "documentFragment" && file?.type !== "file");
  const hidden = source?.visibility === "hidden" || (source?.type === "documentFragment" && file?.visibility === "hidden");
  const updated = Boolean(source && (resolved?.identity === "different" || resolved?.freshness === "changed" ||
    (reference.sourceFingerprint && reference.sourceFingerprint !== createDeliverySourceFingerprint(workspace, source)) ||
    (source.type === "documentFragment" && file?.type === "file" && file.extractedAssetId !== source.source.sourceExtractAssetId)));
  const assetId = reference.sourceAssetId ?? reference.snapshot.previewAsset?.assetId ?? reference.snapshot.sourceFile?.sourceExtractAssetId;
  const needsBinary = Boolean(assetId) || ["image", "file"].includes(reference.snapshot.sourceType);
  const hasCopy = Boolean(reference.editorial?.caption || reference.editorial?.note);
  return {
    sourceFreshness: updated ? "sourceUpdated" : source && reference.sourceFingerprint && resolved?.identity === "same" ? "current" : "unknown",
    sourceExistence: missing ? "sourceMissing" : "present",
    sourceVisibility: missing ? "unknown" : hidden ? "sourceHidden" : "active",
    assetAvailability: reference.snapshot.sourceType === "link" ? "referenceOnly" : needsBinary ? assetId && workspace.assets[assetId] ? "metadataAvailable" : "assetMissing" : "noBinaryExpected",
    binaryAvailability: "notChecked",
    copyReview: reference.copyReview === "needsReview" ? "needsReview" : !hasCopy ? "noCopy" : reference.copyReview ?? "unknown",
    provenance: reference.snapshot.provenance ?? { status: "unknown" }
  };
}

export function captureDeliveryGenerationBaseline(workspace: MorphoWorkspace, deliveryObjectId: string, sectionId: string): DeliveryGenerationBaseline | undefined {
  const delivery = workspace.objects[deliveryObjectId];
  const section = delivery?.type === "delivery" ? delivery.sections.find((item) => item.id === sectionId) : undefined;
  if (delivery?.type !== "delivery" || !section) return undefined;
  return { version: 1, deliveryObjectId, deliveryIncarnationId: delivery.incarnationId, sectionId,
    sectionFingerprint: hashProductValue({ format: delivery.format, title: section.title, purpose: section.purpose, narrative: section.narrative, order: section.order,
      copyReviewReferenceIds: section.copyReviewReferenceIds, gaps: delivery.gaps.filter((gap) => !gap.sectionId || gap.sectionId === sectionId).map(({ id, label, status, origin }) => ({ id, label, status, origin })) }),
    referenceIds: [...section.referenceIds],
    referenceFingerprints: Object.fromEntries(section.referenceIds.map((id) => {
      const ref = workspace.deliveryReferences[id];
      return [id, hashProductValue(ref ? { sourceObjectId: ref.sourceObjectId, sourceAssetId: ref.sourceAssetId, sourceRevisionId: ref.sourceRevisionId, sourceRevisionNumber: ref.sourceRevisionNumber, snapshot: ref.snapshot, sourceFingerprint: ref.sourceFingerprint, sourceBaseline: ref.sourceBaseline, editorial: ref.editorial, copyReview: ref.copyReview } : { missing: id })];
    })),
    sourceFingerprints: Object.fromEntries(section.referenceIds.map((id) => [id, workspace.deliveryReferences[id]?.sourceFingerprint])) };
}

export function inspectDeliveryDraft(workspace: MorphoWorkspace, draft: DeliverySectionDraft): DeliveryDraftApplicability {
  const target = workspace.objects[draft.deliveryObjectId];
  const section = target?.type === "delivery" ? target.sections.find((item) => item.id === draft.sectionId) : undefined;
  if (draft.status !== "pending" || target?.type !== "delivery" || target.visibility !== "active" || !section ||
    draft.captions.some((item) => !section.referenceIds.includes(item.referenceId))) return { status: "blocked", reasons: ["草稿目标或图注引用不可用，不能应用。"] };
  const baseline = draft.generationBaseline;
  const current = captureDeliveryGenerationBaseline(workspace, target.id, section.id)!;
  if (baseline && (baseline.deliveryObjectId !== target.id || baseline.sectionId !== section.id ||
    !baseline.deliveryIncarnationId || baseline.deliveryIncarnationId !== target.incarnationId)) return { status: "blocked", reasons: ["草稿目标身份不匹配或无法验证。"] };
  if (baseline && (baseline.sectionFingerprint !== current.sectionFingerprint ||
    hashProductValue(baseline.referenceIds) !== hashProductValue(current.referenceIds) ||
    hashProductValue(baseline.referenceFingerprints) !== hashProductValue(current.referenceFingerprints))) return { status: "stale", reasons: ["生成后章节、文案、引用顺序、快照或待补内容已变化，请重新生成草稿。"] };
  const reasons: string[] = baseline ? [] : ["旧草稿缺少生成时依赖基线，无法验证适用性。"];
  for (const ref of getOrderedDeliverySectionReferences(workspace, section)) {
    const facts = inspectDeliveryReference(workspace, ref);
    if (facts.sourceFreshness !== "current" || facts.sourceExistence !== "present" || facts.sourceVisibility !== "active") reasons.push(`${ref.snapshot.title}：来源有变化或无法验证，仍沿用冻结快照。`);
    if (facts.copyReview === "needsReview" || facts.copyReview === "unknown") reasons.push(`${ref.snapshot.title}：现有文案需要复核。`);
  }
  return { status: reasons.length ? "review-required" : "current", reasons };
}

export function inspectDelivery(workspace: MorphoWorkspace, delivery: DeliveryObject) {
  return {
    references: Object.fromEntries(delivery.references.flatMap((id) => workspace.deliveryReferences[id] ? [[id, inspectDeliveryReference(workspace, workspace.deliveryReferences[id])]] : [])),
    sections: Object.fromEntries(delivery.sections.map((section) => [section.id, { copyReview: (section.copyReviewReferenceIds?.length ?? 0) > 0 ? "needsReview" as const : "notRequired" as const }])),
    drafts: Object.fromEntries(Object.values(workspace.deliverySectionDrafts).filter((draft) => draft.deliveryObjectId === delivery.id && draft.status === "pending").map((draft) => [draft.id, inspectDeliveryDraft(workspace, draft)])),
    openGapIds: delivery.gaps.filter((gap) => gap.status === "open").map((gap) => gap.id)
  };
}

export function isDeliveryGenerationBaseline(value: unknown): value is DeliveryGenerationBaseline {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const record = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
  const hash = (item: unknown) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item);
  return v.version === 1 && typeof v.deliveryObjectId === "string" && typeof v.sectionId === "string" &&
    (v.deliveryIncarnationId === undefined || typeof v.deliveryIncarnationId === "string") && hash(v.sectionFingerprint) &&
    Array.isArray(v.referenceIds) && v.referenceIds.every((id) => typeof id === "string") && new Set(v.referenceIds).size === v.referenceIds.length &&
    record(v.referenceFingerprints) && record(v.sourceFingerprints) && Object.values(v.referenceFingerprints).every(hash) &&
    hashProductValue(Object.keys(v.referenceFingerprints).sort()) === hashProductValue([...v.referenceIds].sort()) &&
    Object.keys(v.sourceFingerprints).every((id) => (v.referenceIds as string[]).includes(id)) &&
    Object.values(v.sourceFingerprints).every((item) => item === undefined || typeof item === "string");
}

export function isDeliveryReferenceInspection(value: unknown): value is DeliveryReferenceInspection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>, provenance = v.provenance as Record<string, unknown> | undefined;
  return ["current", "sourceUpdated", "unknown"].includes(String(v.sourceFreshness)) &&
    ["present", "sourceMissing"].includes(String(v.sourceExistence)) && ["active", "sourceHidden", "unknown"].includes(String(v.sourceVisibility)) &&
    ["metadataAvailable", "assetMissing", "noBinaryExpected", "referenceOnly"].includes(String(v.assetAvailability)) && v.binaryAvailability === "notChecked" &&
    ["reviewed", "needsReview", "unknown", "noCopy"].includes(String(v.copyReview)) && Boolean(provenance) && ["recorded", "unknown", "unverified"].includes(String(provenance?.status));
}

export function isDeliveryDraftApplicability(value: unknown): value is DeliveryDraftApplicability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return ["current", "review-required", "stale", "blocked"].includes(String(v.status)) && Array.isArray(v.reasons) && v.reasons.every((reason) => typeof reason === "string");
}
