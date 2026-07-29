import type { ConversationSummary } from "@/domain/morpho/types";
import { sha256Hex } from "./agentProtocolHash";

const PRODUCT_VALUE_DOMAIN = "morpho-product-value-v1";
const CONVERSATION_SUMMARY_DOMAIN = "morpho-agent-summary-v1";
const SOURCE_MESSAGE_IDS_DOMAIN = "morpho-agent-source-message-ids-v1";
const SUMMARY_REVISION_DOMAIN = "morpho-agent-summary-revision-v3";

/** Deterministic browser-safe hashing for persisted Morpho product values. */
export function hashProductValue(value: unknown, domain = PRODUCT_VALUE_DOMAIN): string {
  return sha256Hex(`${domain}\u0000${stableJson(value)}`);
}

export function hashConversationSummary(summary: ConversationSummary): string {
  return hashProductValue(summary, CONVERSATION_SUMMARY_DOMAIN);
}

export function hashSourceMessageIds(ids: readonly string[]): string {
  return hashProductValue(ids, SOURCE_MESSAGE_IDS_DOMAIN);
}

export function buildConversationSummaryRevisionId(input: {
  previousSummaryRevisionId?: string;
  sourceMessageIdsHash: string;
  summaryHash: string;
}): string {
  return `conversation-summary-v3-${hashProductValue({
    previousSummaryRevisionId: input.previousSummaryRevisionId ?? "root",
    sourceMessageIdsHash: input.sourceMessageIdsHash,
    summaryHash: input.summaryHash
  }, SUMMARY_REVISION_DOMAIN)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
