import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { acknowledgePersistedExternalResult, downloadExternalResult, flushPendingExternalResultAcks, materializeExternalResultResponse } from "./externalResultClient";
import type { ExternalResultManifest } from "@/shared/externalResultProtocol";
const manifest: ExternalResultManifest = { effectId: `effect:${"a".repeat(64)}`, resultId: `result:${"b".repeat(64)}`, version: 1,
  kind: "image", sha256: createHash("sha256").update("original").digest("hex"), byteLength: 8,
  mimeType: "image/png", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z" };
function storage(): Storage {
  const data = new Map<string,string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k,v) => { data.set(k,v); }, removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(), key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; } };
}
describe("verified local delivery and ACK outbox", () => {
  it("reading/displaying a result never ACKs it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("original"));
    const result = await materializeExternalResultResponse(Response.json({ result: manifest }), fetch);
    expect(await result.response.text()).toBe("original");
    expect(result.delivery).toEqual(manifest);
    expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it("lost ACK response and reload resend only the exact ACK; duplicate ACK dedupes", async () => {
    const local = storage(), fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new TypeError("lost ACK"); });
    expect(await acknowledgePersistedExternalResult("project", manifest, fetch, local)).toBe(false);
    expect(local.length).toBe(1);
    fetch.mockImplementation(async () => Response.json({ acknowledged: true }));
    expect(await flushPendingExternalResultAcks("project", fetch, local)).toBe(true);
    expect(local.length).toBe(0);
    await acknowledgePersistedExternalResult("project", manifest, fetch, local);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual(Array(3).fill({ resultId: manifest.resultId, version: 1, sha256: manifest.sha256 }));
    expect(fetch.mock.calls.every(([url]) => String(url).includes("/result?kind=image"))).toBe(true);
  });
  it("ACK intent save failure prevents even an HTTP ACK", async () => {
    const local = storage(); local.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(acknowledgePersistedExternalResult("project", manifest, fetch, local)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("corrupt, oversized and expired chunks never produce a saved-result receipt", async () => {
    await expect(downloadExternalResult(manifest, async () => new Response("corrupt!"))).rejects.toThrow("hash");
    await expect(downloadExternalResult(manifest, async () => new Response(new Uint8Array(524289)))).rejects.toThrow("large");
    await expect(downloadExternalResult(manifest, async () => Response.json({ code: "external_result_expired" }, { status: 410 }))).rejects.toMatchObject({ code: "external_result_expired" });
  });
  it("records the immutable manifest before a failed chunk download for exact recovery", async () => {
    let pending: ExternalResultManifest | undefined;
    await expect(materializeExternalResultResponse(Response.json({ result: manifest }), async () => new Response(null, { status: 503 }),
      (value) => { pending = value; })).rejects.toMatchObject({ code: "external_result_unavailable" });
    expect(pending).toEqual(manifest);
  });
});
