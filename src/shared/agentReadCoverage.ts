/** Material actually serialized for this turn. No historical coverage is reconstructed. */
export type AgentReadReceipt = {
  id: string;
  source: "request" | "tool";
  kind: "object" | "document" | "image" | "delivery" | "memory" | "stage" | "conversation";
  objectId: string;
  incarnationId?: string;
  revisionId?: string;
  fingerprint?: string;
  contentHash?: string;
  assetId?: string;
  sectionId?: string;
  keys?: string[];
  query?: { mode: string; keyword?: string };
  status: "full" | "summary" | "partial" | "missing" | "unavailable" | "stale";
  range?: { start: number; end: number; total: number; nextStart?: number };
  representation?: "text" | "metadata" | "pixels" | "contactSheet";
  extractionTruncated?: boolean;
  /** Set only after an exact request carrying this material is observed by the Runner. */
  delivered: boolean;
  /** Historical delivery is separate from pixels present in the latest fresh request. */
  requestImageStatus?: "materialized" | "omitted";
  requestStepSequence?: number;
  imageOmissionReason?: "scope" | "imageCount" | "imageBytes" | "unavailable";
};

export type AgentEffectReceipt = {
  callId: string;
  tool: string;
  resultStatus?: string;
  activityId?: string;
  status: "executed" | "failed" | "cancelled" | "pendingConfirmation";
  objectIds: string[];
  revisionIds?: string[];
  proposalId?: string;
  draftId?: string;
  analysisId?: string;
  deliveryObjectId?: string;
  sectionId?: string;
  persistence?: "notRequired" | "succeeded" | "failed";
};

export type AgentTaskFulfillment = {
  version: 1;
  status: "fulfilled" | "partial" | "blocked" | "awaitingUser" | "notPerformed" | "unknown";
  obligations: Array<{ id: string; status: "fulfilled" | "partial" | "blocked" | "awaitingUser" | "notPerformed"; reason?: string }>;
  reads: AgentReadReceipt[];
  effects: AgentEffectReceipt[];
};

export function isAgentReadReceipt(value: unknown): value is AgentReadReceipt {
  if (!record(value)) return false;
  const strings = ["incarnationId", "revisionId", "fingerprint", "contentHash", "assetId", "sectionId"];
  return text(value.id) && text(value.objectId) && strings.every((key) => value[key] === undefined || text(value[key])) &&
    ["request", "tool"].includes(String(value.source)) &&
    ["object", "document", "image", "delivery", "memory", "stage", "conversation"].includes(String(value.kind)) &&
    ["full", "summary", "partial", "missing", "unavailable", "stale"].includes(String(value.status)) &&
    typeof value.delivered === "boolean" &&
    (value.requestImageStatus === undefined || ["materialized", "omitted"].includes(String(value.requestImageStatus))) &&
    (value.requestStepSequence === undefined || integer(value.requestStepSequence)) &&
    (value.imageOmissionReason === undefined || ["scope", "imageCount", "imageBytes", "unavailable"].includes(String(value.imageOmissionReason))) &&
    (value.representation === undefined || ["text", "metadata", "pixels", "contactSheet"].includes(String(value.representation))) &&
    (value.extractionTruncated === undefined || typeof value.extractionTruncated === "boolean") &&
    (value.keys === undefined || Array.isArray(value.keys) && value.keys.length <= 64 && value.keys.every(text)) &&
    (value.query === undefined || record(value.query) && text(value.query.mode) && (value.query.keyword === undefined || text(value.query.keyword))) &&
    (value.range === undefined || record(value.range) && ["start", "end", "total"].every((key) => integer(value.range && (value.range as Record<string, unknown>)[key])) &&
      Number(value.range.start) <= Number(value.range.end) && Number(value.range.end) <= Number(value.range.total) &&
      (value.range.nextStart === undefined || integer(value.range.nextStart)));
}
export function isAgentEffectReceipt(value: unknown): value is AgentEffectReceipt {
  return record(value) && text(value.callId) && text(value.tool) &&
    ["executed", "failed", "cancelled", "pendingConfirmation"].includes(String(value.status)) &&
    Array.isArray(value.objectIds) && value.objectIds.length <= 4096 && value.objectIds.every(text) &&
    ["resultStatus", "activityId", "proposalId", "draftId", "analysisId", "deliveryObjectId", "sectionId"].every((key) => value[key] === undefined || text(value[key])) &&
    (value.revisionIds === undefined || Array.isArray(value.revisionIds) && value.revisionIds.every(text)) &&
    (value.persistence === undefined || ["notRequired", "succeeded", "failed"].includes(String(value.persistence)));
}
export function normalizeAgentTaskFulfillment(value: unknown): AgentTaskFulfillment | undefined {
  if (!record(value) || value.version !== 1 || !["fulfilled", "partial", "blocked", "awaitingUser", "notPerformed", "unknown"].includes(String(value.status)) ||
    !Array.isArray(value.obligations) || value.obligations.length > 1024 || !value.obligations.every((item) => record(item) && text(item.id) &&
      ["fulfilled", "partial", "blocked", "awaitingUser", "notPerformed"].includes(String(item.status)) && (item.reason === undefined || text(item.reason))) ||
    !Array.isArray(value.reads) || value.reads.length > 4096 || !value.reads.every(isAgentReadReceipt) ||
    !Array.isArray(value.effects) || value.effects.length > 1024 || !value.effects.every(isAgentEffectReceipt)) return undefined;
  return structuredClone(value) as AgentTaskFulfillment;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length <= 2000; }
function integer(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
