import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createPrivilegedServerSupabaseClient } from "@/infrastructure/supabase/privilegedServer";
import {
  isExternalEffectSnapshot,
  type ExternalEffectSnapshot,
  type ExternalObservation,
  type ProviderNamespace
} from "@/shared/externalEffectProtocol";

export type EffectIdentity = Readonly<{
  actorUserId: string;
  effectId: string;
  kind: ExternalEffectSnapshot["kind"];
}>;

export type EffectJournalPort = Readonly<{
  call: (operation: "register" | "correction" | "observe" | "read" | "cancel",
    identity: EffectIdentity, payload?: Record<string, unknown>) => Promise<{
      snapshot: ExternalEffectSnapshot | null;
      executionGranted: boolean;
    }>;
}>;

export class ExternalEffectJournalError extends Error {
  readonly executionStateUnknown = true;
  constructor(readonly code: string) {
    super("外部执行记录暂不可用或身份冲突；未授权重新提交。");
    this.name = "ExternalEffectJournalError";
  }
}

export const externalEffectJournal: EffectJournalPort = {
  async call(operation, identity, payload = {}) {
    const created = createPrivilegedServerSupabaseClient();
    if (created.status === "failed") throw new ExternalEffectJournalError("effect_journal_unavailable");
    return callEffectJournal(created.client, operation, identity, payload);
  }
};

export async function callEffectJournal(
  client: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> },
  operation: Parameters<EffectJournalPort["call"]>[0],
  identity: EffectIdentity,
  payload: Record<string, unknown> = {}
): ReturnType<EffectJournalPort["call"]> {
  const result = await client.rpc("operate_external_effect", {
    p_actor_user_id: identity.actorUserId,
    p_effect_id: identity.effectId,
    p_kind: identity.kind,
    p_operation: operation,
    p_payload: payload
  });
  if (result.error || !result.data || typeof result.data !== "object") {
    throw new ExternalEffectJournalError("effect_journal_unavailable");
  }
  const row = result.data as Record<string, unknown>;
  if (typeof row.error === "string") throw new ExternalEffectJournalError(row.error);
  if (row.snapshot !== null && !isExternalEffectSnapshot(row.snapshot)) {
    throw new ExternalEffectJournalError("effect_journal_contract_invalid");
  }
  return { snapshot: row.snapshot as ExternalEffectSnapshot | null, executionGranted: row.executionGranted === true };
}

/** Independent of current model/prompt/config; old executions are never reconstructed. */
export function externalEffectId(...parts: readonly (string | number)[]): string {
  return `effect:${digest(JSON.stringify(parts))}`;
}

export function providerNamespace(
  provider: ProviderNamespace["provider"], config: { baseUrl: string; apiKey: string }
): ProviderNamespace {
  return {
    provider,
    baseUrl: config.baseUrl.replace(/\/$/, ""),
    credentialScope: digest(`morpho-provider-credential-scope-v1\0${config.apiKey}`)
  };
}

export function sameProviderNamespace(left: ProviderNamespace, right: ProviderNamespace): boolean {
  return left.provider === right.provider && left.baseUrl === right.baseUrl &&
    left.credentialScope === right.credentialScope;
}

export type EffectExecution = Readonly<{
  beforeSubmit: (body: unknown, namespace: ProviderNamespace, correction?: "cacheCompatibility" | "imageCompatibility") => Promise<void>;
  observe: (observation: ExternalObservation) => Promise<void>;
  cancel: () => Promise<void>;
}>;

/** Created once per logical operation. A replay can observe, but can never obtain a new POST grant. */
export function createEffectExecution(identity: EffectIdentity, journal: EffectJournalPort = externalEffectJournal): EffectExecution {
  let attemptId: string | undefined;
  return {
    async beforeSubmit(body, namespace, correction) {
      const frozenRequest = typeof body === "string" ? body : JSON.stringify(body);
      const nextAttemptId = randomUUID();
      const result = await journal.call(correction ? "correction" : "register", identity, {
        frozenRequest,
        requestDigest: digest(frozenRequest),
        namespace,
        attemptId: nextAttemptId,
        ...(correction ? { correction } : {})
      });
      if (!result.executionGranted) throw new ExternalEffectJournalError("external_execution_state_unknown");
      attemptId = nextAttemptId;
      const submitted = await journal.call("observe", identity, {
        attemptId,
        observationId: digest(`${attemptId}:submitted`),
        observation: { kind: "submitted" }
      });
      if (submitted.snapshot?.cancelRequestedAt) throw new ExternalEffectJournalError("cancel_requested_before_submit");
    },
    async observe(observation) {
      if (!attemptId) return;
      await journal.call("observe", identity, {
        attemptId,
        observationId: digest(JSON.stringify([attemptId, observation])),
        observation
      });
    },
    async cancel() { await journal.call("cancel", identity); }
  };
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
