import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffectJournalFake } from "@/test/externalEffectJournalFake";
import { resolveGrsImageResult, type GrsImageConfig } from "@/server/image/grsProvider";
import {
  callEffectJournal, createEffectExecution, digest, externalEffectId, providerNamespace,
  type EffectIdentity
} from "./externalEffectJournal";
import { observeExternalEffect } from "./externalEffectObservation";
import { executeOpenAiCompatibleResponse, streamOpenAiCompatibleResponse } from "./openaiCompatibleProvider";

const config: GrsImageConfig = { baseUrl: "https://provider.test", apiKey: "private-test-key",
  model: "nano-banana-fast", imageHostAllowlist: ["cdn.example.test"] };
const input = { modelId: config.model, prompt: "frozen prompt", images: [], aspectRatio: "1:1" as const, referenceObjectIds: [] };
const json = (value: unknown) => Response.json(value);
const image = () => new Response(new Blob(["png"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } });
const options = (journal: ReturnType<typeof createEffectJournalFake>, fetchImpl: typeof fetch) => ({
  journal: journal.port, loadConfig: () => ({ status: "ok" as const, config }),
  query: (c: GrsImageConfig, i: Parameters<typeof resolveGrsImageResult>[1], o: Parameters<typeof resolveGrsImageResult>[2]) =>
    resolveGrsImageResult(c, i, { ...o, fetchImpl })
});

afterEach(() => vi.unstubAllGlobals());

describe("P3A effect identity and cross-instance observation", () => {
  it("registers before POST; accepted response loss with no identity remains unknown and cannot resubmit", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      expect(journal.calls.map((call) => call.operation)).toEqual(["register", "observe"]);
      throw new TypeError("accepted upstream; response lost");
    });
    const first = await resolveGrsImageResult(config, input, { effect: createEffectExecution(identity, journal.port), fetchImpl });
    expect(first).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
    const replacement = await resolveGrsImageResult(config, input, { effect: createEffectExecution(identity, journal.port), fetchImpl });
    expect(replacement).toMatchObject({ failureCode: "external_execution_state_unknown" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const result = await observeExternalEffect(identity, options(journal, fetchImpl));
    expect(result.effect).toMatchObject({ executionState: "unknown", taskId: null });
  });

  it("records task before polling; refresh/replacement queries only that execution until later success", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") return json({ id: "same-task", status: "running" });
      expect((await journal.port.call("read", identity)).snapshot?.taskId).toBe("same-task");
      if (String(url).includes("/result")) return json({ id: "same-task", status: "running" });
      return image();
    });
    await resolveGrsImageResult(config, input, { effect: createEffectExecution(identity, journal.port), fetchImpl, maxPolls: 1 });
    const refreshed = await observeExternalEffect(identity, options(journal, fetchImpl));
    expect(refreshed.effect?.executionState).toBe("running");
    const later = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).not.toBe("POST");
      return String(url).includes("/v1/api/result") ? json({ id: "same-task", status: "succeeded", results: [{ url: "https://cdn.example.test/result.png" }] }) : image();
    });
    const replaced = await observeExternalEffect(identity, { ...options(journal, later), retrieveImage: true });
    expect(replaced.effect).toMatchObject({ executionState: "succeeded", taskId: "same-task" });
    expect(await replaced.image?.text()).toBe("png");
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(later.mock.calls[0][0]).toBe("https://provider.test/v1/api/result?id=same-task");
  });

  it("cancel intent/local abort persists across observers and does not suppress real late success", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const execution = createEffectExecution(identity, journal.port);
    await execution.beforeSubmit({ model: "test" }, providerNamespace("grsai", config));
    await execution.observe({ kind: "running", taskId: "task-cancel" });
    await execution.cancel();
    await execution.observe({ kind: "localAbort" });
    expect((await journal.port.call("read", identity)).snapshot?.executionState).toBe("running");
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ id: "task-cancel", status: "succeeded", url: "https://cdn.example.test/result.png" }));
    const result = await observeExternalEffect(identity, options(journal, fetchImpl));
    expect(result.effect).toMatchObject({ executionState: "succeeded", taskId: "task-cancel",
      cancelRequestedAt: expect.any(String), localAbortObservedAt: expect.any(String) });
    expect(fetchImpl).toHaveBeenCalledOnce(); // status observation never downloads or generates
  });

  it("duplicate observations do not create another attempt or local payload/effect", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const execution = createEffectExecution(identity, journal.port);
    await execution.beforeSubmit(input, providerNamespace("grsai", config));
    await execution.observe({ kind: "succeeded", taskId: "one-task" });
    const before = journal.observations.size;
    await execution.observe({ kind: "succeeded", taskId: "one-task" });
    expect(journal.observations.size).toBe(before);
    expect(journal.requests.size).toBe(1);
    expect(journal.records.size).toBe(1);
  });

  it("legacy missing identity is query-only compatible and never creates an effect", async () => {
    const journal = createEffectJournalFake();
    const query = vi.fn();
    const result = await observeExternalEffect(journal.identity(), { journal: journal.port, query });
    expect(result).toEqual({ effect: null, limit: "legacy_identity_unavailable" });
    expect(journal.records.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("changed credentials or endpoint do not invent cross-node task visibility", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const execution = createEffectExecution(identity, journal.port);
    await execution.beforeSubmit(input, providerNamespace("grsai", config));
    await execution.observe({ kind: "running", taskId: "scoped-task" });
    const query = vi.fn();
    for (const changed of [{ ...config, apiKey: "rotated" }, { ...config, baseUrl: "https://different-node.test" }]) {
      const result = await observeExternalEffect(identity, { journal: journal.port, query, loadConfig: () => ({ status: "ok", config: changed }) });
      expect(result.limit).toBe("provider_namespace_unavailable");
      expect(result.effect?.executionState).toBe("running");
    }
    expect(query).not.toHaveBeenCalled();
    expect(JSON.stringify(providerNamespace("grsai", config))).not.toContain(config.apiKey);
  });

  it("Provider success survives result-download failure", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const fetchImpl = vi.fn<typeof fetch>(async (_, init) => init?.method === "POST"
      ? json({ id: "successful-task", status: "succeeded", url: "https://cdn.example.test/result.png" })
      : new Response("unavailable", { status: 503 }));
    expect((await resolveGrsImageResult(config, input, { effect: createEffectExecution(identity, journal.port), fetchImpl })).status).toBe("failed");
    expect((await journal.port.call("read", identity)).snapshot?.executionState).toBe("succeeded");
  });

  it("pre-registration cancel prevents every paid POST", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const execution = createEffectExecution(identity, journal.port);
    await execution.cancel();
    const fetchImpl = vi.fn();
    await resolveGrsImageResult(config, input, { effect: execution, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("known-task GET failure preserves running; a mismatched query identity cannot record success", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const execution = createEffectExecution(identity, journal.port);
    await execution.beforeSubmit(input, providerNamespace("grsai", config));
    await execution.observe({ kind: "running", taskId: "owned-task" });
    for (const response of [new Response(null, { status: 404 }), json({ id: "foreign-task", status: "succeeded" })]) {
      const result = await observeExternalEffect(identity, options(journal, async () => response));
      expect(result.effect).toMatchObject({ executionState: "running", taskId: "owned-task" });
    }
  });

  it("task identity alone and a resumed observer never fabricate Provider running evidence", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity();
    const fetchImpl = vi.fn<typeof fetch>(async (_, init) => init?.method === "POST"
      ? json({ id: "identity-only" }) : new Response(null, { status: 404 }));
    await resolveGrsImageResult(config, input, { effect: createEffectExecution(identity, journal.port), fetchImpl, maxPolls: 1 });
    const result = await observeExternalEffect(identity, options(journal, fetchImpl));
    expect(result.effect).toMatchObject({ executionState: "unknown", taskId: "identity-only" });
    expect([...journal.observations.values()].some((observation) => observation.kind === "running")).toBe(false);
  });

  it("buffered response identity is retained even when the output envelope is unusable", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity("compaction");
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "response-without-output" })));
    await expect(executeOpenAiCompatibleResponse({ ...config, reasoningEffort: undefined, webSearchEnabled: false }, { input: [] }, undefined,
      createEffectExecution(identity, journal.port))).rejects.toMatchObject({ executionStateUnknown: true });
    expect((await journal.port.call("read", identity)).snapshot).toMatchObject({ executionState: "unknown", responseId: "response-without-output" });
  });

  it("text response.created is durable before stream loss, without another POST or unverified retrieve", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity("text");
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"resp-known"}}\n\n'));
      controller.close();
    } });
    const fetchImpl = vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchImpl);
    await expect(streamOpenAiCompatibleResponse({ ...config, reasoningEffort: undefined, webSearchEnabled: false }, { input: [] }, {}, undefined,
      createEffectExecution(identity, journal.port))).rejects.toMatchObject({ executionStateUnknown: true });
    const result = await observeExternalEffect(identity, { journal: journal.port });
    expect(result.effect).toMatchObject({ responseId: "resp-known", executionState: "running" });
    expect(result.limit).toBe("provider_lookup_not_guaranteed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("text and compaction freeze requests and observe response success independently of local validation", async () => {
    const journal = createEffectJournalFake();
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "response-success", output: [] })));
    for (const kind of ["text", "compaction"] as const) {
      const identity = journal.identity(kind);
      await executeOpenAiCompatibleResponse({ ...config, reasoningEffort: undefined, webSearchEnabled: false }, { input: [] }, undefined,
        createEffectExecution(identity, journal.port));
      expect((await journal.port.call("read", identity)).snapshot).toMatchObject({ executionState: "succeeded", responseId: "response-success" });
    }
    expect(journal.requests.size).toBe(2);
  });

  it("effect RPC is fail-closed on missing migration/invalid DTO and carries authenticated owner", async () => {
    const identity: EffectIdentity = { actorUserId: "owner", effectId: externalEffectId("request"), kind: "image" };
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202" } }));
    await expect(callEffectJournal({ rpc }, "register", identity)).rejects.toMatchObject({ code: "effect_journal_unavailable" });
    expect(rpc.mock.calls[0]).toEqual(["operate_external_effect", expect.objectContaining({ p_actor_user_id: "owner", p_effect_id: identity.effectId })]);
    expect(externalEffectId("a", 1)).not.toBe(externalEffectId("a1"));
    expect(digest("request")).toHaveLength(64);
  });

  it("sends the exact registered bytes even if input changes while registration awaits", async () => {
    const journal = createEffectJournalFake();
    const identity = journal.identity("text");
    const request = { input: [{ role: "user" as const, content: [{ type: "input_text" as const, text: "original" }] }] };
    const execution = createEffectExecution(identity, { call: async (operation, key, payload) => {
      const result = await journal.port.call(operation, key, payload);
      if (operation === "register") request.input[0].content[0].text = "mutated during await";
      return result;
    } });
    const fetchImpl = vi.fn<typeof fetch>(async (_, init) => {
      expect(init?.body).toBe([...journal.requests.values()][0]);
      expect(String(init?.body)).toContain("original");
      expect(String(init?.body)).not.toContain("mutated");
      return json({ id: "frozen-response", output: [] });
    });
    vi.stubGlobal("fetch", fetchImpl);
    await executeOpenAiCompatibleResponse({ ...config, reasoningEffort: undefined, webSearchEnabled: false }, request, undefined, execution);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
