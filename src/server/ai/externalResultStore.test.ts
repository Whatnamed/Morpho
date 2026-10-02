import { describe, expect, it } from "vitest";
import { createExternalResultFake } from "@/test/externalResultFake";
import { ExternalResultError, externalResultResponse, saveExternalResult } from "./externalResultStore";
import { downloadExternalResult } from "@/features/workspace/externalResultClient";
import type { EffectIdentity } from "./externalEffectJournal";
const id: EffectIdentity = { actorUserId: "actor", effectId: `effect:${"a".repeat(64)}`, kind: "image" };
describe("bounded external result delivery", () => {
  it.each(["image", "text", "compaction"] as const)("redelivers identical %s after transport loss without execution", async (kind) => {
    const fake = createExternalResultFake();
    const identity = { ...id, kind };
    const bytes = new Blob([new Uint8Array(600_000).fill(123)], { type: kind === "image" ? "image/png" : "application/json" });
    const m = await saveExternalResult(fake.port, identity, bytes);
    const replay = await externalResultResponse(identity, fake.port);
    expect(await replay!.json()).toEqual({ result: m });
    const fetchChunks: typeof fetch = async (url) => {
      const index = Number(new URL(String(url), "http://test").searchParams.get("chunk"));
      const row = await fake.port.call("chunk", identity, { resultId: m.resultId, index });
      return new Response(Buffer.from(String(row.base64), "base64"));
    };
    expect(await (await downloadExternalResult(m, fetchChunks)).arrayBuffer()).toEqual(await bytes.arrayBuffer());
    expect(fake.calls.some((c) => ["register", "generate"].includes(c.operation))).toBe(false);
  });
  it("republishes completed chunks after Journal publication response loss", async () => {
    const fake = createExternalResultFake(); fake.failNext("publish");
    await expect(saveExternalResult(fake.port, id, new Blob(["original"], { type: "image/png" }))).rejects.toMatchObject({ code: "result_store_unavailable" });
    expect((await externalResultResponse(id, fake.port))!.status).toBe(200);
    expect(fake.calls.filter((c) => c.operation === "write")).toHaveLength(1);
  });
  it("partial write is unavailable, expiry stays expired and result cannot be replaced", async () => {
    const fake = createExternalResultFake(); fake.failNext("write");
    await expect(saveExternalResult(fake.port, id, new Blob(["old"], { type: "image/png" }))).rejects.toThrow();
    expect((await externalResultResponse(id, fake.port))!.status).toBe(503);
    await expect(saveExternalResult(fake.port, id, new Blob(["new"], { type: "image/png" }))).rejects.toMatchObject({ code: "result_identity_conflict" });
    fake.records.values().next().value!.manifest = { ...fake.records.values().next().value!.manifest, expiresAt: "2000-01-01T00:00:00Z" };
    expect((await externalResultResponse(id, fake.port))!.status).toBe(410);
  });
  it("rejects oversized output before any storage operation", async () => {
    const fake = createExternalResultFake();
    await expect(saveExternalResult(fake.port, id, new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: "image/png" }))).rejects.toMatchObject({ code: "result_payload_too_large" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("Image partial staging recovery", () => {
  it.each(["result_identity_conflict", "result_chunk_conflict", "external_result_expired", "result_payload_too_large", "result_store_unavailable", "result_store_deadline_exceeded"])("Image publish preserves %s rather than swallowing it as incomplete", async (code) => {
    const f = createExternalResultFake(); f.failNext("write");
    await expect(saveExternalResult(f.port, id, new Blob(["original"], { type: "image/png" }))).rejects.toThrow();
    const query = async () => { throw new Error("must not retrieve for non-incomplete publication"); };
    const port = { call: async (...args: Parameters<typeof f.port.call>) => {
      if (args[0] === "publish") throw new ExternalResultError(code);
      return f.port.call(...args);
    } };
    await expect(externalResultResponse(id, port, query)).rejects.toMatchObject({ code });
  });
  const blob = () => new Blob([new Uint8Array(600_000).fill(123)], { type: "image/png" });
  async function partial() {
    const f = createExternalResultFake(); f.failNext("publish");
    const binding = { serverTurnId: "turn", localProjectId: "project", requestId: "request", stepSequence: 1, actionId: "original-action" };
    await expect(saveExternalResult(f.port, id, blob(), binding)).rejects.toThrow();
    const r = [...f.records.values()][0]; r.chunks.delete(1);
    return { f, r, binding };
  }
  it("fills identical bytes without prepare, new identity or replacing original A+ binding", async () => {
    const { f, r, binding } = await partial(); const original = { ...r.manifest };
    const response = await externalResultResponse(id, f.port, async () => blob());
    expect(response?.status).toBe(200); expect(r.manifest).toEqual(original);
    expect(r.binding).toEqual(binding); expect(r.published).toBe(true);
    expect(f.calls.filter(c => c.operation === "prepare")).toHaveLength(1);
    expect((await externalResultResponse(id, f.port, async () => { throw new Error("no query after publication"); }))?.status).toBe(200);
  });
  it.each(["bytes", "chunk"])("fails closed on conflicting %s", async (fault) => {
    const { f, r } = await partial();
    if (fault === "chunk") r.chunks.set(0, Buffer.alloc(524288, 9));
    const retrieved = fault === "bytes" ? new Blob(["changed"], { type: "image/png" }) : blob();
    await expect(externalResultResponse(id, f.port, async () => retrieved)).rejects.toMatchObject({
      code: fault === "bytes" ? "result_identity_conflict" : "result_chunk_conflict" });
    expect(r.published).toBe(false); expect(f.records.size).toBe(1);
  });
  it("a second temporary write failure remains pending for the next same-result recovery", async () => {
    const { f, r } = await partial();
    const response = await externalResultResponse(id, f.port, async () => { f.failNext("write"); return blob(); });
    expect(response?.status).toBe(503); expect(await response!.json()).toMatchObject({ deliveryPending: true });
    expect(r.published).toBe(false);
    expect((await externalResultResponse(id, f.port, async () => blob()))?.status).toBe(200);
  });
  it("expiry during GET fails with 410 and cannot publish or refresh retention", async () => {
    const { f, r } = await partial();
    const response = await externalResultResponse(id, f.port, async () => {
      r.manifest = { ...r.manifest, expiresAt: "2000-01-01T00:00:00Z" }; return blob();
    });
    expect(response?.status).toBe(410); expect(r.published).toBe(false);
  });
  it("expired identities never query or resurrect; unavailable retrieval remains pending", async () => {
    const { f, r } = await partial();
    expect((await externalResultResponse(id, f.port, async () => undefined))?.status).toBe(503);
    expect(await (await externalResultResponse(id, f.port, async () => { throw new Error("GET unavailable"); }))!.json()).toMatchObject({ deliveryPending: true });
    r.manifest = { ...r.manifest, expiresAt: "2000-01-01T00:00:00Z" };
    expect((await externalResultResponse(id, f.port, async () => { throw new ExternalResultError("must not query"); }))?.status).toBe(410);
    expect(r.published).toBe(false);
  });
});
