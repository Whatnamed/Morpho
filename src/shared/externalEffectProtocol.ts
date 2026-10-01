/** Provider facts are independent of Turn/Action administrative closure and local outcome. */
export type ExternalExecutionState = "unknown" | "running" | "succeeded" | "failed" | "cancelled";

export type ProviderNamespace = Readonly<{
  provider: "grsai" | "openai-compatible";
  baseUrl: string;
  /** Opaque credential configuration scope; no claim about Provider account/node equivalence. */
  credentialScope: string;
}>;

export type ExternalObservation = Readonly<{
  kind: "submitted" | "unknown" | "running" | "succeeded" | "failed" | "cancelled" |
    "rejected" | "localAbort";
  taskId?: string;
  responseId?: string;
}>;

export type ExternalEffectSnapshot = Readonly<{
  version: 1;
  effectId: string;
  kind: "image" | "text" | "compaction";
  requestDigest: string | null;
  namespace: ProviderNamespace | null;
  executionState: ExternalExecutionState;
  cancelRequestedAt: string | null;
  localAbortObservedAt: string | null;
  attemptId: string | null;
  taskId: string | null;
  responseId: string | null;
}>;

export function isExternalEffectSnapshot(value: unknown): value is ExternalEffectSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (candidate: unknown) => candidate === null || typeof candidate === "string";
  const ns = row.namespace as Record<string, unknown> | null;
  return row.version === 1 && typeof row.effectId === "string" &&
    ["image", "text", "compaction"].includes(String(row.kind)) &&
    ["unknown", "running", "succeeded", "failed", "cancelled"].includes(String(row.executionState)) &&
    nullableString(row.requestDigest) && nullableString(row.cancelRequestedAt) &&
    nullableString(row.localAbortObservedAt) && nullableString(row.attemptId) &&
    nullableString(row.taskId) && nullableString(row.responseId) &&
    (ns === null || (typeof ns === "object" &&
      ["grsai", "openai-compatible"].includes(String(ns.provider)) &&
      typeof ns.baseUrl === "string" && typeof ns.credentialScope === "string"));
}

/** Unknown/local abort never prove Provider failure. Late success survives cancellation. */
export function advanceExternalExecutionState(
  current: ExternalExecutionState,
  observation: ExternalObservation["kind"]
): ExternalExecutionState {
  if (observation === "succeeded" || current === "succeeded") return "succeeded";
  if (current === "failed" || current === "cancelled") return current;
  if (observation === "failed" || observation === "rejected") return "failed";
  if (observation === "cancelled") return "cancelled";
  if (observation === "running" && current === "unknown") return "running";
  return current;
}
