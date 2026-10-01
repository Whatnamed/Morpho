import { randomUUID } from "node:crypto";
import {
  advanceExternalExecutionState,
  type ExternalEffectSnapshot,
  type ExternalObservation
} from "@/shared/externalEffectProtocol";
import { ExternalEffectJournalError, type EffectIdentity, type EffectJournalPort } from "@/server/ai/externalEffectJournal";

/** Durable fake across executor instances. SQL behavior is independently exercised by the SQL harness. */
export function createEffectJournalFake() {
  const records = new Map<string, ExternalEffectSnapshot>();
  const requests = new Map<string, unknown>();
  const observations = new Map<string, ExternalObservation>();
  const calls: Array<{ operation: string; identity: EffectIdentity; payload: Record<string, unknown> }> = [];
  const port: EffectJournalPort = {
    async call(operation, identity, payload = {}) {
      calls.push({ operation, identity, payload });
      const key = `${identity.actorUserId}:${identity.effectId}`;
      let snapshot = records.get(key);
      let executionGranted = false;
      if (!snapshot && (operation === "register" || operation === "cancel")) {
        snapshot = { version: 1, effectId: identity.effectId, kind: identity.kind, requestDigest: null,
          namespace: null, executionState: "unknown", cancelRequestedAt: null, localAbortObservedAt: null,
          attemptId: null, taskId: null, responseId: null };
      }
      if (snapshot && snapshot.kind !== identity.kind) throw new ExternalEffectJournalError("effect_identity_conflict");
      if (snapshot && (operation === "register" || operation === "correction")) {
        executionGranted = operation === "register" && !records.has(key);
        if (operation === "correction") executionGranted = snapshot.executionState === "failed" &&
          [...observations.values()].at(-1)?.kind === "rejected" && !snapshot.taskId && !snapshot.responseId;
        if (snapshot.cancelRequestedAt) executionGranted = false;
        if (operation === "register" && snapshot.requestDigest && snapshot.requestDigest !== payload.requestDigest) {
          throw new ExternalEffectJournalError("effect_request_conflict");
        }
        if (!snapshot.requestDigest) {
          requests.set(key, payload.frozenRequest);
          snapshot = { ...snapshot, requestDigest: String(payload.requestDigest),
            namespace: payload.namespace as ExternalEffectSnapshot["namespace"] };
        }
        if (executionGranted) snapshot = { ...snapshot, attemptId: String(payload.attemptId), executionState: "unknown" };
      }
      if (snapshot && operation === "cancel") snapshot = { ...snapshot, cancelRequestedAt: snapshot.cancelRequestedAt ?? "2026-10-01T00:00:00Z" };
      if (snapshot && operation === "observe") {
        if (snapshot.attemptId !== payload.attemptId) throw new ExternalEffectJournalError("effect_attempt_conflict");
        const observation = payload.observation as ExternalObservation;
        if ((observation.taskId && snapshot.taskId && observation.taskId !== snapshot.taskId) ||
          (observation.responseId && snapshot.responseId && observation.responseId !== snapshot.responseId)) {
          throw new ExternalEffectJournalError("provider_identity_conflict");
        }
        const id = `${key}:${String(payload.observationId)}`;
        if (!observations.has(id)) {
          observations.set(id, observation);
          snapshot = { ...snapshot,
            executionState: advanceExternalExecutionState(snapshot.executionState, observation.kind),
            taskId: snapshot.taskId ?? observation.taskId ?? null,
            responseId: snapshot.responseId ?? observation.responseId ?? null,
            localAbortObservedAt: observation.kind === "localAbort" ? "2026-10-01T00:00:00Z" : snapshot.localAbortObservedAt };
        }
      }
      if (snapshot) records.set(key, snapshot);
      return { snapshot: snapshot ? structuredClone(snapshot) : null, executionGranted };
    }
  };
  return { port, records, requests, observations, calls,
    identity: (kind: EffectIdentity["kind"] = "image"): EffectIdentity => ({
      actorUserId: "019fa9c0-7b9d-7a20-8f31-2c676296c9d1", effectId: `effect:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`, kind
    }) };
}
