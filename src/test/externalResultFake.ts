import { createHash } from "node:crypto";
import { ExternalResultError, type ExternalResultPort } from "@/server/ai/externalResultStore";
import type { ExternalResultManifest } from "@/shared/externalResultProtocol";

export function createExternalResultFake() {
  const records = new Map<string, { manifest: ExternalResultManifest; binding: unknown; chunks: Map<number, Buffer>; published: boolean; ack: boolean }>();
  const calls: Array<{ operation: string; payload: Record<string, unknown> }> = [];
  let fault: string | undefined;
  const port: ExternalResultPort = {
    async readBinding(identity) {
      if (fault === "readBinding") { fault = undefined; throw new ExternalResultError("result_store_unavailable"); }
      return structuredClone(records.get(`${identity.actorUserId}:${identity.effectId}`)?.binding);
    },
    async call(operation, identity, payload = {}) {
    calls.push({ operation, payload });
    if (fault === operation) { fault = undefined; throw new ExternalResultError("result_store_unavailable"); }
    if (operation === "probe") return { ready: true };
    const key = `${identity.actorUserId}:${identity.effectId}`;
    let r = records.get(key);
    if (operation === "prepare") {
      const m = payload.manifest as ExternalResultManifest;
      if (!r) { r = { manifest: { ...m, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
        binding: payload.binding, chunks: new Map(), published: false, ack: false }; records.set(key, r); }
      else if (r.manifest.sha256 !== m.sha256 || JSON.stringify(r.binding) !== JSON.stringify(payload.binding)) {
        throw new ExternalResultError("result_identity_conflict");
      }
    }
    if (!r) return { state: "absent" };
    if (Date.parse(r.manifest.expiresAt) <= Date.now()) return { state: "expired" };
    if (operation === "write") {
      const index = Number(payload.index), bytes = Buffer.from(String(payload.base64), "base64");
      if (r.chunks.has(index) && !r.chunks.get(index)!.equals(bytes)) throw new ExternalResultError("result_chunk_conflict");
      r.chunks.set(index, bytes);
    }
    if (operation === "publish") {
      const bytes = Buffer.concat([...r.chunks.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v));
      if (bytes.length !== r.manifest.byteLength || createHash("sha256").update(bytes).digest("hex") !== r.manifest.sha256) throw new ExternalResultError("result_incomplete");
      r.published = true;
    }
    if (operation === "ack") {
      if (!r.published || payload.sha256 !== r.manifest.sha256 || payload.resultId !== r.manifest.resultId || payload.version !== 1) throw new ExternalResultError("result_ack_conflict");
      r.ack = true; return { acknowledged: true };
    }
    if (operation === "chunk") return { base64: r.chunks.get(Number(payload.index))?.toString("base64") };
    return { state: r.published ? "available" : "unavailable", manifest: r.manifest };
  } };
  return { port, records, calls, failNext: (operation: string) => { fault = operation; } };
}
