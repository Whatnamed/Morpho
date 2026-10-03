import type { DeliveryGenerationBaseline } from "@/domain/morpho/types";
import { isDeliveryGenerationBaseline } from "@/domain/morpho/deliveryInspection";
import type { AgentReadReceipt } from "@/shared/agentReadCoverage";
import { requirementCovered } from "./agentSourceReads";

/** Local dependency evidence associated with existing P2B receipts, not a second read ledger. */
export type DeliveryGenerationEvidence = { receiptId: string; contentHash: string; baseline: DeliveryGenerationBaseline };

export function isDeliveryGenerationEvidence(value: unknown): value is DeliveryGenerationEvidence {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.receiptId === "string" && typeof v.contentHash === "string" && isDeliveryGenerationBaseline(v.baseline);
}

export function resolveDeliveryGenerationEvidence(evidence: readonly DeliveryGenerationEvidence[], reads: readonly AgentReadReceipt[], target: { deliveryObjectId: string; sectionId: string }): DeliveryGenerationBaseline | undefined {
  for (const entry of [...evidence].reverse()) {
    if (entry.baseline.deliveryObjectId !== target.deliveryObjectId || entry.baseline.sectionId !== target.sectionId) continue;
    const matchingIds = new Set(evidence.filter((item) => item.contentHash === entry.contentHash).map((item) => item.receiptId));
    const matching = reads.filter((receipt) => matchingIds.has(receipt.id) && receipt.contentHash === entry.contentHash);
    if (!matching.some((receipt) => receipt.delivered)) continue;
    if (requirementCovered({ tool: "read_workspace_source", kind: "delivery", objectId: target.deliveryObjectId, sectionId: target.sectionId }, matching)) return structuredClone(entry.baseline);
    // A later delivered partial version cannot inherit an earlier version's
    // full-read claim. The model may have seen mixed dependencies; stay unknown.
    return undefined;
  }
  return undefined;
}
