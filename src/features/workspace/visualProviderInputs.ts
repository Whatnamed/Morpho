import { GRS_REFERENCE_IMAGE_LIMIT } from "@/domain/morpho/imageLimits";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { compileImagePrompt } from "@/domain/operations/imagePromptCompiler";
import { snapshotVisualObject } from "@/domain/operations/visualLineage";
import type { VisualGenerationPlanItem, VisualProviderInputManifest, VisualReferenceResolution } from "@/domain/operations/types";
import { EXTERNAL_INPUT_IMAGE_MAX_BYTES, EXTERNAL_INPUT_IMAGES_MAX_BYTES } from "@/shared/externalResultProtocol";

/** Reuses the image execution's asset-reader boundary; this is not a second read/coverage system. */
export async function materializeVisualProviderInputs(input: {
  workspace: MorphoWorkspace;
  item: VisualGenerationPlanItem;
  modelId: string;
  userInput: string;
  signal: AbortSignal;
  readAsset: (storageKey: string) => Promise<Blob | null>;
}): Promise<{ item: VisualGenerationPlanItem; images: string[]; sourceObjectIds: string[]; failure?: string }> {
  const manifest: VisualProviderInputManifest = { version: 1, references: [] };
  const images: string[] = [];
  const sentIds: string[] = [];
  let totalBytes = 0;
  const plannedCandidates: VisualReferenceResolution["candidates"] = input.item.referenceResolution?.candidates ?? input.item.referenceObjectIds.map((objectId, priority) => ({
    objectId, priority, reason: "userExplicit" as const, included: true
  }));
  const parent = input.item.lineage?.identityParent;
  const candidates = parent && !plannedCandidates.some((candidate) => candidate.objectId === parent.objectId)
    ? [{ objectId: parent.objectId, priority: 0, reason: "identityParent" as const, role: "identity" as const, required: true, included: true }, ...plannedCandidates]
    : plannedCandidates;
  for (const candidate of candidates) {
    if (manifest.references.some((entry) => entry.source.objectId === candidate.objectId)) continue;
    input.signal.throwIfAborted();
    const source = snapshotVisualObject(input.workspace, candidate.objectId);
    const role = parent?.objectId === candidate.objectId ? "identity" : candidate.role ?? "unspecified";
    const required = role === "identity" || Boolean(candidate.required);
    const entry: VisualProviderInputManifest["references"][number] = {
      source, role, required, status: "omitted", omissionReason: candidate.omissionReason ?? "missingPixels"
    };
    if (candidate.included) {
      const object = input.workspace.objects[candidate.objectId];
      const asset = object?.type === "image" && object.visibility === "active" && object.assetId
        ? input.workspace.assets[object.assetId] : undefined;
      let dataUrl: string | undefined;
      const identityChanged = role === "identity" && parent && (parent.assetId !== source.assetId || parent.incarnationId !== source.incarnationId);
      if (identityChanged) entry.omissionReason = "unavailable";
      else if (images.length >= GRS_REFERENCE_IMAGE_LIMIT) entry.omissionReason = "providerLimit";
      else if (asset) {
        try {
          const blob = await input.readAsset(asset.storageKey);
          input.signal.throwIfAborted();
          if (blob && (blob.size > EXTERNAL_INPUT_IMAGE_MAX_BYTES || totalBytes + blob.size > EXTERNAL_INPUT_IMAGES_MAX_BYTES)) entry.omissionReason = "providerBytes";
          else if (blob && blob.size > 0 && /^image\/(png|jpeg|webp)$/i.test(blob.type)) {
            dataUrl = await blobToDataUrl(blob);
            totalBytes += blob.size;
          }
          else if (blob) entry.omissionReason = "invalidPixels";
        } catch (error) {
          input.signal.throwIfAborted();
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          entry.omissionReason = "missingPixels";
        }
      }
      if (dataUrl) {
        entry.status = "sent";
        delete entry.omissionReason;
        entry.payloadIndex = images.length;
        entry.pixelHash = hashProviderImageDataUrl(dataUrl);
        images.push(dataUrl);
        sentIds.push(candidate.objectId);
      }
    }
    manifest.references.push(entry);
  }
  input.signal.throwIfAborted();
  const actualResolution: VisualReferenceResolution = {
    resolvedObjectIds: sentIds,
    candidates: candidates.map((candidate) => {
      const actual = manifest.references.find((entry) => entry.source.objectId === candidate.objectId)!;
      return { ...candidate, role: actual.role, required: actual.required,
        included: candidate.included && actual.status === "sent" };
    }),
    providerLimit: input.item.referenceResolution?.providerLimit ?? GRS_REFERENCE_IMAGE_LIMIT,
    defaultReferenceExcluded: input.item.referenceResolution?.defaultReferenceExcluded ?? false
  };
  const compiled = input.item.visualIntent ? compileImagePrompt({
    workspace: input.workspace, intent: input.item.visualIntent, referenceResolution: actualResolution,
    modelId: input.modelId, currentUserInput: input.item.userInstruction ?? input.userInput
  }) : undefined;
  const missingRequired = manifest.references.filter((entry) => entry.required && entry.status !== "sent");
  return {
    images, sourceObjectIds: sentIds,
    item: { ...input.item, providerInputs: manifest, referenceObjectIds: sentIds,
      prompt: compiled?.prompt ?? input.item.prompt,
      editMode: compiled?.editMode ?? (images.length ? input.item.editMode === "directedEdit" ? "directedEdit" : "imageToImage" : "textToImage") },
    ...(missingRequired.length ? { failure: `必要参考像素不可用：${missingRequired.map((entry) => `${entry.source.title} (${entry.omissionReason})`).join("；")}。未提交生成。` } : {})
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片参考转换失败。"));
    reader.onerror = () => reject(reader.error ?? new Error("图片参考读取失败。"));
    reader.readAsDataURL(blob);
  });
}
