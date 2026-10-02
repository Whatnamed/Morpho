import { classifyImageResultDeliveryError } from "./imageResultDeliveryError";
import "server-only";
import { createHash } from "node:crypto";
import { createPrivilegedServerSupabaseClient } from "@/infrastructure/supabase/privilegedServer";
import { digest, type EffectIdentity } from "./externalEffectJournal";
import {
  EXTERNAL_RESULT_CHUNK_BYTES, EXTERNAL_IMAGE_RESULT_MAX_BYTES, EXTERNAL_JSON_RESULT_MAX_BYTES,
  EXTERNAL_ESCROW_WRITE_BUDGET_MS,
  isExternalResultManifest, type ExternalResultManifest
} from "@/shared/externalResultProtocol";

export type ResultBinding = Readonly<{
  serverTurnId: string;
  localProjectId: string;
  requestId: string;
  stepSequence: number;
  actionId?: string;
  actionHash?: string;
  status?: "awaitingNextRequest" | "externallyCompleted";
  claims?: readonly { toolCallId: string; actionKind: string; claimHash: string; maxActionCount: number }[];
}>;
export type ExternalResultPort = Readonly<{
  call(operation: "probe" | "prepare" | "write" | "publish" | "read" | "chunk" | "ack",
    identity: EffectIdentity, payload?: Record<string, unknown>): Promise<Record<string, unknown>>;
}>;
export class ExternalResultError extends Error {
  constructor(readonly code: string) {
    super("外部结果暂不可交付；只能取回同一结果，不会重新执行。");
    this.name = "ExternalResultError";
  }
}
export const externalResultStore: ExternalResultPort = {
  async call(operation, identity, payload = {}) {
    const created = createPrivilegedServerSupabaseClient();
    if (created.status === "failed") throw new ExternalResultError("result_store_unavailable");
    const result = await created.client.rpc("operate_external_result", {
      p_actor_user_id: identity.actorUserId, p_effect_id: identity.effectId,
      p_kind: identity.kind, p_operation: operation, p_payload: payload
    }).abortSignal(AbortSignal.timeout(10_000));
    if (result.error || !result.data || typeof result.data !== "object") {
      throw new ExternalResultError("result_store_unavailable");
    }
    const row = result.data as Record<string, unknown>;
    if (typeof row.error === "string") throw new ExternalResultError(row.error);
    return row;
  }
};

/** Persist before final delivery; repeated writes/publish must bind the identical bytes. */
export async function saveExternalResult(
  store: ExternalResultPort, identity: EffectIdentity, blob: Blob, binding?: ResultBinding, resume?: ExternalResultManifest
): Promise<ExternalResultManifest> {
  const maximum = identity.kind === "image" ? EXTERNAL_IMAGE_RESULT_MAX_BYTES : EXTERNAL_JSON_RESULT_MAX_BYTES;
  if (blob.size < 1 || blob.size > maximum) throw new ExternalResultError("result_payload_too_large");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const resultId = `result:${digest(JSON.stringify([identity.actorUserId, identity.effectId, 1, sha256]))}`;
  const deadline = Date.now() + EXTERNAL_ESCROW_WRITE_BUDGET_MS;
  const call = async (operation: Parameters<ExternalResultPort["call"]>[0], payload: Record<string, unknown>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ExternalResultError("result_store_deadline_exceeded");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const row = await Promise.race([store.call(operation, identity, payload), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExternalResultError("result_store_deadline_exceeded")), remaining);
      })]);
      if (resume && row.state === "expired") throw new ExternalResultError("external_result_expired");
      if (resume && row.state === "absent") throw new ExternalResultError("external_result_unavailable");
      return row;
    } finally { if (timer) clearTimeout(timer); }
  };
  const manifest = {
    effectId: identity.effectId, resultId, version: 1, kind: identity.kind, sha256,
    byteLength: bytes.length, mimeType: blob.type,
    chunkCount: Math.ceil(bytes.length / EXTERNAL_RESULT_CHUNK_BYTES)
  };
  if (resume) {
    // Never prepare/rebind during recovery; publish uses the original stored Journal binding.
    if (identity.kind !== "image" || Object.entries(manifest).some(([key, value]) =>
      resume[key as keyof ExternalResultManifest] !== value)) throw new ExternalResultError("result_identity_conflict");
  } else await call("prepare", { manifest, binding: binding ?? null });
  for (let index = 0; index < manifest.chunkCount; index++) {
    await call("write", { resultId, index,
      base64: bytes.subarray(index * EXTERNAL_RESULT_CHUNK_BYTES, (index + 1) * EXTERNAL_RESULT_CHUNK_BYTES).toString("base64") });
  }
  const published = await call("publish", { resultId });
  if (!isExternalResultManifest(published.manifest)) throw new ExternalResultError("result_contract_invalid");
  return published.manifest;
}

export function jsonResult(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: "application/json" });
}

/** Read-only delivery never acquires a Provider execution. Expired identities are tombstones. */
export async function externalResultResponse(
  identity: EffectIdentity, store: ExternalResultPort = externalResultStore,
  retrieveImage?: () => Promise<Blob | undefined>
): Promise<Response | undefined> {
  let row = await store.call("read", identity);
  if (row.state === "absent") return undefined;
  if (row.state === "unavailable" && isExternalResultManifest(row.manifest)) {
    // Complete chunks survive a lost publish/Journal response. Resume only stored publication.
    try { row = await store.call("publish", identity, { resultId: row.manifest.resultId }); }
    catch (error) {
      // Image errors must retain their exact classification; Text/Compaction stay unchanged.
      if (identity.kind === "image" && (!(error instanceof ExternalResultError) || error.code !== "result_incomplete")) throw error;
      // Only incomplete Image staging may retrieve the trusted same Provider task.
      if (identity.kind === "image" && error instanceof ExternalResultError && error.code === "result_incomplete" && retrieveImage) {
        const image = await retrieveImage().catch(() => undefined);
        if (image) {
          try {
            const manifest = await saveExternalResult(store, identity, image, undefined, row.manifest as ExternalResultManifest);
            row = { ...row, state: "available", manifest };
          } catch (writeError) {
            if (writeError instanceof ExternalResultError && writeError.code === "external_result_expired") row = { state: "expired" };
            else if (!(writeError instanceof ExternalResultError) ||
              !classifyImageResultDeliveryError(writeError.code).pending) throw writeError;
            // Temporary storage failure retains the same pending manifest, never a generation failure.
          }
        }
      }
    }
  }
  if (row.state !== "available" || !isExternalResultManifest(row.manifest)) {
    return Response.json({ code: row.state === "expired" ? "external_result_expired" : "external_result_unavailable",
      error: row.state === "expired" ? "原执行结果已超过保留期，无法重新交付。" : "已执行结果尚不可交付；不会重新生成。",
      recoverable: false, ...(identity.kind === "image" && row.state === "unavailable" ? { deliveryPending: true } : {}) }, { status: row.state === "expired" ? 410 : 503,
      headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ result: row.manifest }, { headers: { "Cache-Control": "no-store",
    ...(typeof row.providerTaskId === "string" ? { "X-Morpho-Provider-Task-Id": row.providerTaskId } : {}) } });
}
