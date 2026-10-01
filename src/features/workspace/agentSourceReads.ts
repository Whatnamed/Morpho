import { hashProductValue } from "@/shared/agentProductHash";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import { captureSourceSnapshot, resolveSource } from "@/domain/morpho/sourceResolution";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { ReadWorkspaceSourceArgs } from "@/shared/agentToolContract";
import type { AgentReadReceipt } from "@/shared/agentReadCoverage";
import type { RequiredAgentReadRequirement, TurnTaskContract } from "@/shared/turnTaskContract";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { collectAiProviderImageAttachments } from "./aiAttachments";
import type { APlusAgentProviderMessage } from "@/shared/agentTurnJournalProtocol";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { getCurrentProjectMemoryRevision, getCurrentStageRecordRevision, reconcileProjectMemory } from "@/domain/morpho/projectMemory";

export function sourceReceipt(workspace: MorphoWorkspace, objectId: string, kind: AgentReadReceipt["kind"], id: string, source: AgentReadReceipt["source"] = "tool"): AgentReadReceipt {
  const snapshot = captureSourceSnapshot(workspace, objectId);
  return { id, kind, source, objectId, incarnationId: snapshot.incarnationId, fingerprint: snapshot.semanticFingerprint,
    status: workspace.objects[objectId] ? "summary" : "missing", delivered: false };
}

export async function readAgentWorkspaceSource(input: {
  workspace: MorphoWorkspace; contract?: TurnTaskContract; args: ReadWorkspaceSourceArgs; callId: string;
  generatedObjectIds: readonly string[]; readableObjectIds?: readonly string[]; deliveryTarget?: { deliveryObjectId: string; sectionId: string };
  signal: AbortSignal; blobStore?: BlobStore;
}): Promise<{ receipt: AgentReadReceipt; text?: string; images?: APlusAgentProviderMessage[] }> {
  const { workspace, args } = input;
  const receipt = sourceReceipt(workspace, args.objectId, args.kind, input.callId);
  const scoped = input.contract?.activities.some((activity) => [...activity.sourceObjectIds, ...activity.targetObjectIds, ...activity.referenceObjectIds].includes(args.objectId));
  const generated = input.contract?.activities.some((activity) => activity.observeGeneratedImages) && input.generatedObjectIds.includes(args.objectId);
  const delivery = args.kind === "delivery" && input.deliveryTarget?.deliveryObjectId === args.objectId && input.deliveryTarget.sectionId === args.sectionId;
  if (!scoped && !generated && !delivery && !input.readableObjectIds?.includes(args.objectId)) return { receipt: { ...receipt, status: "unavailable" }, text: "目标不在本轮读取范围。" };
  const object = workspace.objects[args.objectId];
  if (!object) return { receipt: { ...receipt, status: "missing" } };
  if (object.visibility !== "active") return { receipt: { ...receipt, status: "unavailable" }, text: "目标已隐藏。" };
  if (args.revisionId && object.type !== "conceptDirection" && object.type !== "designDefinition") return { receipt: { ...receipt, status: "missing", revisionId: args.revisionId } };
  if (args.kind === "image") {
    if (object.type !== "image") return { receipt: { ...receipt, status: "unavailable" } };
    const packed = await collectAiProviderImageAttachments(workspace, [object.id], input.signal);
    const entry = packed.entries.find((item) => item.objectId === object.id && item.status === "ready");
    if (!entry) return { receipt: { ...receipt, status: "unavailable", representation: "metadata" } };
    return { receipt: { ...receipt, status: "full", contentHash: hashProviderImageDataUrl(packed.attachments[0]!.dataUrl), assetId: object.assetId, representation: entry.representation === "single" ? "pixels" : "contactSheet" },
      images: [{ role: "user", content: [{ type: "input_text", text: `只读观察 ${object.id}；像素只支持视觉判断，不构成工程验证或新生成授权。` },
        ...packed.attachments.map((attachment) => ({ type: "input_image" as const, image_url: attachment.dataUrl }))] }] };
  }
  let text: string;
  let extractionTruncated = false;
  if (args.kind === "document") {
    if (object.type !== "file" || object.parseStatus !== "parsed" || !object.extractedAssetId) return { receipt: { ...receipt, status: "unavailable" } };
    const asset = workspace.assets[object.extractedAssetId];
    const blob = asset?.sourceType === "documentExtract" ? await (input.blobStore ?? indexedDbBlobStore).get(asset.storageKey) : null;
    if (!blob) return { receipt: { ...receipt, status: "unavailable" } };
    text = await blob.text();
    receipt.assetId = object.extractedAssetId;
    extractionTruncated = Boolean(object.extractionTruncated) || (object.extractedCharCount ?? text.length) > text.length;
  } else if (args.kind === "delivery") {
    const section = object.type === "delivery" && args.sectionId ? buildDeliverySectionContext(workspace, object, args.sectionId) : undefined;
    if (!section || !delivery) return { receipt: { ...receipt, status: "missing" } };
    text = JSON.stringify(section);
    receipt.sectionId = args.sectionId;
  } else {
    if (object.type === "file" || object.type === "image") {
      const metadata = JSON.stringify(object);
      const start = Math.min(args.start ?? 0, metadata.length);
      const end = Math.min(metadata.length, start + (args.length ?? 8000));
      return { receipt: { ...receipt, status: "summary", representation: "metadata", contentHash: hashProductValue(metadata),
        range: { start, end, total: metadata.length, ...(end < metadata.length ? { nextStart: end } : {}) } }, text: metadata.slice(start, end) };
    }
    if (object.type === "documentFragment" && resolveSource(workspace, object.id).content !== "available") return { receipt: { ...receipt, status: "stale" } };
    const revisionId = args.revisionId ?? ("currentRevisionId" in object ? object.currentRevisionId : undefined);
    if (revisionId) {
      const revision: import("@/domain/morpho/types").ConceptDirectionRevision | import("@/domain/morpho/types").DesignDefinitionRevision | undefined = object.type === "conceptDirection" ? workspace.directionRevisions[revisionId] : object.type === "designDefinition" ? workspace.designDefinitionRevisions[revisionId] : undefined;
      if (!revision || !("directionId" in revision ? revision.directionId === object.id : revision.designDefinitionId === object.id)) return { receipt: { ...receipt, status: "missing", revisionId } };
      receipt.revisionId = revisionId;
      text = JSON.stringify(revision);
    } else {
      if (args.revisionId) return { receipt: { ...receipt, status: "missing", revisionId: args.revisionId } };
      text = JSON.stringify(object.type === "proposalDraft" ? workspace.artifactProposals[object.id] ?? object : object);
    }
  }
  receipt.contentHash = hashProductValue(text);
  const start = args.start ?? 0;
  if (start >= text.length && text.length > 0) return { receipt: { ...receipt, status: "missing", range: { start: text.length, end: text.length, total: text.length } } };
  const end = Math.min(text.length, start + (args.length ?? 8000));
  return { receipt: { ...receipt, status: start === 0 && end === text.length && !extractionTruncated ? "full" : "partial",
    representation: "text", extractionTruncated, range: { start, end, total: text.length, ...(end < text.length ? { nextStart: end } : {}) } }, text: text.slice(start, end) };
}

/** Coverage unions only identical source incarnations, revisions and content. */
export function requirementCovered(requirement: RequiredAgentReadRequirement, receipts: readonly AgentReadReceipt[], workspace?: MorphoWorkspace): boolean {
  const usable = receipts.filter((receipt) => receipt.delivered && (receipt.status === "full" || receipt.status === "partial") && (!workspace || receiptStillUsable(receipt, workspace, requirement)));
  if (requirement.tool === "read_project_memory" || requirement.tool === "read_stage_record") {
    const kind = requirement.tool === "read_project_memory" ? "memory" : "stage";
    const keys = requirement.tool === "read_project_memory" ? requirement.requiredKeys : requirement.requiredStages;
    const matching = usable.filter((receipt) => receipt.kind === kind && receipt.status === "full");
    return keys.length ? keys.every((key) => matching.some((receipt) => receipt.keys?.includes(key))) : matching.length > 0;
  }
  if (requirement.tool === "search_project_conversation") return usable.some((receipt) => receipt.kind === "conversation" && receipt.status === "full" &&
    receipt.query?.mode === requirement.requiredMode && (!requirement.keyword || receipt.query.keyword === requirement.keyword));
  const matching = usable.filter((receipt) => receipt.kind === requirement.kind && receipt.objectId === requirement.objectId &&
    (!requirement.revisionId || receipt.revisionId === requirement.revisionId) && (!requirement.sectionId || receipt.sectionId === requirement.sectionId));
  if (requirement.kind === "image") return matching.some((receipt) => receipt.status === "full" && receipt.requestImageStatus !== "omitted" && ["pixels", "contactSheet"].includes(receipt.representation ?? ""));
  if (matching.some((receipt) => receipt.status === "full" && requirement.start === undefined && requirement.end === undefined)) return true;
  for (const identity of matching) {
    const ranges = matching.filter((receipt) => (identity.incarnationId ? receipt.incarnationId === identity.incarnationId : receipt.id === identity.id) && receipt.revisionId === identity.revisionId && receipt.fingerprint === identity.fingerprint && receipt.contentHash === identity.contentHash && receipt.assetId === identity.assetId && receipt.range?.total === identity.range?.total).flatMap((receipt) => receipt.range ? [receipt.range] : []).sort((a, b) => a.start - b.start);
    let cursor = requirement.start ?? 0;
    const end = requirement.end ?? identity.range?.total;
    if (end === undefined || (requirement.end === undefined && identity.extractionTruncated)) continue;
    for (const range of ranges) if (range.start <= cursor) cursor = Math.max(cursor, range.end);
    if (cursor >= end) return true;
  }
  return false;
}

function receiptStillUsable(receipt: AgentReadReceipt, workspace: MorphoWorkspace, requirement: RequiredAgentReadRequirement): boolean {
  if (receipt.kind === "conversation") return true;
  if (receipt.kind === "memory" || receipt.kind === "stage") {
    const current = reconcileProjectMemory(workspace);
    return receipt.keys?.every((key) => {
      const revision = receipt.kind === "memory"
        ? getCurrentProjectMemoryRevision(current.projectMemory, key as import("@/domain/morpho/types").ProjectMemoryKey)
        : getCurrentStageRecordRevision(current.projectMemory, key as import("@/domain/morpho/types").StageRecordKey);
      return revision?.id === receipt.revisionId;
    }) ?? false;
  }
  const object = workspace.objects[receipt.objectId];
  if (!object || object.visibility !== "active" || (receipt.incarnationId && object.incarnationId !== receipt.incarnationId)) return false;
  // An explicitly named historical revision stays a legitimate source after a
  // same-turn revise. Current-object and document reads use P1B fingerprints.
  if (requirement.tool === "read_workspace_source" && requirement.revisionId && receipt.revisionId === requirement.revisionId) return Boolean(workspace.directionRevisions[receipt.revisionId] ?? workspace.designDefinitionRevisions[receipt.revisionId]);
  return receipt.fingerprint === captureSourceSnapshot(workspace, object.id).semanticFingerprint;
}
