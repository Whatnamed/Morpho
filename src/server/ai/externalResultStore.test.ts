import { describe, expect, it } from "vitest";
import { createExternalResultFake } from "@/test/externalResultFake";
import { externalResultResponse, saveExternalResult } from "./externalResultStore";
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
