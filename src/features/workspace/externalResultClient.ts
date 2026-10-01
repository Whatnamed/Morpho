import {
  EXTERNAL_RESULT_CHUNK_BYTES, isExternalResultManifest, resultAckIdentity,
  type ExternalResultManifest
} from "@/shared/externalResultProtocol";

export function resultResource(m: Pick<ExternalResultManifest, "effectId" | "kind">): string {
  return `/api/ai/effects/${encodeURIComponent(m.effectId)}/result?kind=${m.kind}`;
}
export async function downloadExternalResult(m: ExternalResultManifest, fetchRequest: typeof fetch): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  for (let index = 0; index < m.chunkCount; index++) {
    const response = await fetchRequest(`${resultResource(m)}&chunk=${index}&resultId=${encodeURIComponent(m.resultId)}`);
    if (!response.ok) throw Object.assign(new Error(response.status === 410 ? "原执行结果已过期。" : "同一执行结果暂不可取回。"), {
      code: response.status === 410 ? "external_result_expired" : "external_result_unavailable"
    });
    // Never allocate an unbounded error/body while fetching a bounded chunk.
    if (!response.body) throw new Error("Result chunk body missing.");
    const reader = response.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > EXTERNAL_RESULT_CHUNK_BYTES) { await reader.cancel(); throw new Error("Result chunk too large."); }
        parts.push(new Uint8Array(next.value));
      }
    } finally { reader.releaseLock(); }
    const bytes = await new Blob(parts).arrayBuffer();
    const expected = Math.min(EXTERNAL_RESULT_CHUNK_BYTES, m.byteLength - index * EXTERNAL_RESULT_CHUNK_BYTES);
    if (bytes.byteLength !== expected) throw new Error("Result chunk length mismatch.");
    size += bytes.byteLength;
    chunks.push(bytes);
  }
  const blob = new Blob(chunks, { type: m.mimeType });
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (size !== m.byteLength || sha256 !== m.sha256) throw new Error("Result hash mismatch.");
  return blob;
}

/** Adapt the new manifest transport to existing image/summary consumers. No ACK at HTTP read. */
export async function materializeExternalResultResponse(response: Response, fetchRequest: typeof fetch,
  onManifest?: (manifest: ExternalResultManifest) => void | Promise<void>): Promise<{
  response: Response; delivery?: ExternalResultManifest;
}> {
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("application/json")) return { response };
  const value: unknown = await response.clone().json();
  if (!value || typeof value !== "object" || !("result" in value)) return { response };
  if (!isExternalResultManifest(value.result)) throw new Error("Invalid result manifest.");
  await onManifest?.(value.result);
  const blob = await downloadExternalResult(value.result, fetchRequest);
  const headers = new Headers(response.headers);
  headers.set("Content-Type", value.result.mimeType);
  headers.delete("Content-Length");
  return { response: new Response(blob, { headers }), delivery: value.result };
}

const OUTBOX_PREFIX = "morpho.result-ack.v1.";
/** Call only after the owning local persistence boundary succeeded. Write-ahead ACK outbox. */
export async function acknowledgePersistedExternalResult(
  projectId: string, manifest: ExternalResultManifest, fetchRequest: typeof fetch,
  storage: Storage = window.localStorage
): Promise<boolean> {
  const pending = readPending(projectId, storage);
  const key = `${manifest.resultId}:${manifest.sha256}`;
  if (!pending.some((m) => `${m.resultId}:${m.sha256}` === key)) pending.push(manifest);
  if (pending.length > 128) throw new Error("Result ACK outbox capacity exceeded.");
  storage.setItem(OUTBOX_PREFIX + projectId, JSON.stringify(pending));
  return flushPendingExternalResultAcks(projectId, fetchRequest, storage);
}

export async function flushPendingExternalResultAcks(
  projectId: string, fetchRequest: typeof fetch, storage: Storage = window.localStorage
): Promise<boolean> {
  for (const manifest of readPending(projectId, storage)) {
    if (Date.parse(manifest.expiresAt) <= Date.now()) { removePending(projectId, manifest, storage); continue; }
    try {
      const response = await fetchRequest(resultResource(manifest), { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(resultAckIdentity(manifest)) });
      const body: unknown = response.ok ? await response.json() : undefined;
      if (response.status === 410 || (body && typeof body === "object" && "acknowledged" in body && body.acknowledged === true)) {
        removePending(projectId, manifest, storage);
      }
    } catch { /* Durable local result and ACK remain; never POST a Provider request. */ }
  }
  return readPending(projectId, storage).length === 0;
}
function readPending(projectId: string, storage: Storage): ExternalResultManifest[] {
  const raw = storage.getItem(OUTBOX_PREFIX + projectId);
  if (!raw) return [];
  if (raw.length > 128 * 2048) throw new Error("Invalid result ACK outbox.");
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 128 || !value.every(isExternalResultManifest)) throw new Error("Invalid result ACK outbox.");
  return value;
}
function removePending(projectId: string, manifest: ExternalResultManifest, storage: Storage): void {
  // Re-read after awaiting Fetch so parallel image saves cannot overwrite each other's ACKs.
  const pending = readPending(projectId, storage).filter((m) => m.resultId !== manifest.resultId);
  if (pending.length) storage.setItem(OUTBOX_PREFIX + projectId, JSON.stringify(pending));
  else storage.removeItem(OUTBOX_PREFIX + projectId);
}
