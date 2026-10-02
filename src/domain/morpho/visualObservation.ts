import type { AgentReadReceipt } from "@/shared/agentReadCoverage";
import type { ImageGenerationMetadata, ImageObject, MorphoWorkspace } from "./types";

export function hasDeliveredVisualObservation(image: ImageObject): boolean {
  return Boolean(image.incarnationId && image.assetId && image.generation?.observations?.some((entry) =>
    entry.objectId === image.id && entry.incarnationId === image.incarnationId && entry.assetId === image.assetId));
}

/** Persist only P2B receipts delivered by the exact observed request. No quality verdict. */
export function recordDeliveredVisualObservations(workspace: MorphoWorkspace, receipts: readonly AgentReadReceipt[], requestId: string, stepSequence: number): MorphoWorkspace {
  let objects = workspace.objects;
  for (const receipt of receipts) {
    const image = objects[receipt.objectId];
    if (image?.type !== "image" || !image.generation || !receipt.delivered || receipt.kind !== "image" || receipt.status !== "full" ||
      !["pixels", "contactSheet"].includes(receipt.representation ?? "") || !receipt.contentHash || !receipt.assetId ||
      receipt.assetId !== image.assetId || !receipt.incarnationId || receipt.incarnationId !== image.incarnationId ||
      receipt.requestImageStatus === "omitted" || (receipt.source === "tool" && receipt.requestImageStatus !== "materialized") ||
      (receipt.requestStepSequence !== undefined && receipt.requestStepSequence !== stepSequence)) continue;
    const observations = image.generation.observations ?? [];
    if (observations.some((entry) => entry.receiptId === receipt.id && entry.requestId === requestId)) continue;
    const observation: NonNullable<ImageGenerationMetadata["observations"]>[number] = {
      receiptId: receipt.id, objectId: image.id, incarnationId: image.incarnationId, assetId: receipt.assetId,
      contentHash: receipt.contentHash, representation: receipt.representation as "pixels" | "contactSheet", requestId, stepSequence
    };
    objects = { ...objects, [image.id]: { ...image, generation: { ...image.generation, observations: [...observations, observation] } } };
  }
  return objects === workspace.objects ? workspace : { ...workspace, objects };
}
