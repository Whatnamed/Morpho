import { ExternalResultError, type ExternalResultPort } from "./externalResultStore";
import { createMorphoAgentContextPolicy } from "@/domain/morpho/agentContextPolicy";
import { describe, expect, it, vi } from "vitest";
import { createExternalResultFake } from "@/test/externalResultFake";
import { createAgentTurnRequestPostHandler } from "@/app/api/ai/agent/turns/[turnId]/requests/handler";
import { createAgentTurnImageActionPostHandler } from "@/app/api/ai/agent/turns/[turnId]/actions/image/handler";
import { createAgentTurnCompactionActionPostHandler } from "@/app/api/ai/agent/turns/[turnId]/actions/compaction/handler";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import type { AgentTurnExternalActionSnapshot } from "@/shared/agentTurnExternalActionProtocol";
const turnId = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const summary = { threadGoal: "goal", establishedContext: [], decisionsAndReasons: [], activeWork: [], unresolvedQuestions: [], referencedObjects: [] };
function fixture(kind: "image" | "text" | "compaction", retrieveImage?: () => Promise<Blob | undefined>, fault?: { operation: string; code: string }) {
  const fake = createExternalResultFake();
  const results: ExternalResultPort = { call: async (operation, identity, payload) => {
    if (fault?.operation === operation) throw new ExternalResultError(fault.code);
    return fake.port.call(operation, identity, payload);
  } };
  const observeExisting = vi.fn(async (): Promise<Response | undefined> => undefined);
  const journal: AgentTurnJournalSnapshot = { serverTurnId: turnId, localProjectId: "project", status: "created",
    latestRequestId: null, latestStepSequence: 0, counters: { provider: 0, webSearch: 0, image: 0 },
    createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", terminalAt: null };
  const action: AgentTurnExternalActionSnapshot = { serverTurnId: turnId, requestId: "request", stepSequence: 1, actionId: "action",
    actionKind: kind === "text" ? "image" : kind, status: "running", createdAt: journal.createdAt, updatedAt: journal.updatedAt, terminalAt: null };
  const auth = async () => ({ status: "allowed" as const, userId: "actor" });
  const acquire = vi.fn(async () => ({ status: "ok" as const, executionGranted: true, replayed: false, snapshot: action }));
  const settle = vi.fn(async () => ({ status: "ok" as const, replayed: false, snapshot: { ...action, status: "externallyCompleted" as const } }));
  const textConfig = vi.fn(() => ({ status: "ok" as const, config: { apiKey: "fake", baseUrl: "https://fake.test", model: "fake", webSearchEnabled: false, contextPolicy: createMorphoAgentContextPolicy() } }));
  const result = { responseId: "response", outputText: "original text", functionCalls: [], citations: [], outputItems: [], webSearchCallCount: 0 };
  const provider = vi.fn(async () => result);
  const imageProvider = vi.fn(async () => ({ status: "ok" as const, blob: new Blob(["original image"], { type: "image/png" }), mimeType: "image/png" }));
  const compactionProvider = vi.fn(async () => ({ ...result, outputText: `\`\`\`json\n${JSON.stringify({ morphoConversationSummary: summary })}\n\`\`\`` }));
  const commonBody = { localProjectId: "project", requestId: "request", stepSequence: 1, actionId: "action" };
  const acquireRequest = vi.fn(async () => ({ status: "ok" as const, executionGranted: true, replayed: false, snapshot: journal }));
  const settleRequest = vi.fn(async () => ({ status: "ok" as const, replayed: false, snapshot: { ...journal, status: "externallyCompleted" as const } }));
  const handler = kind === "text" ? createAgentTurnRequestPostHandler({ authenticate: auth, loadConfig: textConfig,
    checkPrivilegedSettlement: () => ({ status: "ok" }), results: fake.port,
    acquireRequest, settleRequest, streamProvider: provider })
    : kind === "image" ? createAgentTurnImageActionPostHandler({ authenticate: auth, acquire, settle, results, retrieveImage, observeExisting,
      loadConfig: () => ({ status: "ok", config: { apiKey: "fake", baseUrl: "https://fake.test", model: "gpt-image-2" } }), generate: imageProvider })
      : createAgentTurnCompactionActionPostHandler({ authenticate: auth, acquire, settle, results: fake.port,
        loadConfig: textConfig, execute: compactionProvider });
  const body = kind === "text" ? { localProjectId: "project", requestId: "request", stepSequence: 1, providerRequest: {
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], mode: "auto", capabilityIntent: { comparisonAnalysis: false },
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION } } : kind === "image" ? { ...commonBody, claimCallId: "claim", input: { prompt: "image", images: [] } }
      : { ...commonBody, mode: "manual", sourceStartMessageId: "user", sourceEndMessageId: "assistant",
        messages: [{ id: "user", role: "user", body: "hello" }, { id: "assistant", role: "assistant", body: "world" }] };
  const call = (requestBody: unknown = body) => handler(new Request("http://test", { method: "POST", body: JSON.stringify(requestBody) }), { params: Promise.resolve({ turnId }) });
  return { fake, call, body, provider, imageProvider, compactionProvider, textConfig, acquire, acquireRequest, settleRequest, observeExisting, settle };
}
describe("P3B consumed handler contracts", () => {
  it.each(["unchanged", "unavailable", "changed"])("completed Text exact replay with %s config uses durable content proof", async (configState) => {
    const f = fixture("text"); await (await f.call()).text();
    const before = structuredClone([...f.fake.records.values()]);
    const calls = f.fake.calls.length;
    if (configState === "unavailable") f.textConfig.mockImplementation(() => { throw new Error("unavailable"); });
    if (configState === "changed") f.textConfig.mockReturnValue({ status: "ok", config: {
      apiKey: "different", baseUrl: "https://different.test", model: "different", webSearchEnabled: true,
      contextPolicy: createMorphoAgentContextPolicy()
    } });
    const response = await f.call(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: before[0].manifest });
    expect(structuredClone([...f.fake.records.values()])).toEqual(before);
    expect(f.fake.calls.slice(calls).map(c => c.operation)).toEqual(["read"]);
    expect(f.textConfig).toHaveBeenCalledOnce(); expect(f.provider).toHaveBeenCalledOnce();
    expect(f.acquireRequest).toHaveBeenCalledOnce(); expect(f.settleRequest).toHaveBeenCalledOnce();
    expect(before[0].binding).toMatchObject({ requestContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it.each([
    { input: [{ role: "user", content: [{ type: "input_text", text: "changed" }] }] },
    { input: [] }, { input: null }, { mode: "invalid" }, { unexpected: true },
    { capabilityIntent: { comparisonAnalysis: true } }, { continuationItems: [] }
  ])("completed Text changed/malformed content rejects without returning or modifying escrow: %j", async (change) => {
    const f = fixture("text"); await (await f.call()).text();
    const before = structuredClone([...f.fake.records.values()]); const calls = f.fake.calls.length;
    const response = await f.call({ ...f.body, providerRequest: { ...f.body.providerRequest, ...change } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "request_id_conflict", recoverable: false });
    expect(structuredClone([...f.fake.records.values()])).toEqual(before);
    expect(f.fake.calls.slice(calls).map(c => c.operation)).toEqual(["read"]);
    expect(f.acquireRequest).toHaveBeenCalledOnce(); expect(f.settleRequest).toHaveBeenCalledOnce();
    expect(f.provider).toHaveBeenCalledOnce(); expect(f.textConfig).toHaveBeenCalledOnce();
  });
  it.each(["missing", "missing-digest", "invalid-digest", "storage-failure"])("completed Text %s proof fails closed; GET remains independent", async (proof) => {
    const f = fixture("text"); await (await f.call()).text();
    const saved = [...f.fake.records.values()][0];
    if (proof === "missing") saved.binding = null;
    if (proof === "missing-digest") saved.binding = { serverTurnId: turnId, requestId: "request" };
    if (proof === "invalid-digest") saved.binding = { requestContentSha256: "invalid" };
    if (proof === "storage-failure") f.fake.failNext("readBinding");
    const before = structuredClone([...f.fake.records.values()]);
    const response = await f.call(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: proof === "storage-failure" ? "result_store_unavailable" : "request_content_identity_unavailable", recoverable: false });
    expect(structuredClone([...f.fake.records.values()])).toEqual(before); expect(f.acquireRequest).toHaveBeenCalledOnce();
    expect(f.provider).toHaveBeenCalledOnce();
    const { externalResultResponse } = await import("./externalResultStore");
    const effectId = saved.manifest.effectId;
    expect(await (await externalResultResponse({ actorUserId: "actor", effectId, kind: "text" }, f.fake.port))!.json())
      .toEqual({ result: saved.manifest });
  });
  it("changed Text content cannot resume staged publication", async () => {
    const f = fixture("text"); f.fake.failNext("publish"); await (await f.call()).text();
    const before = structuredClone([...f.fake.records.values()]);
    const calls = f.fake.calls.length;
    const rejected = await f.call({ ...f.body, providerRequest: null });
    expect(rejected.status).toBe(409); expect(structuredClone([...f.fake.records.values()])).toEqual(before);
    expect(f.fake.calls.slice(calls).map(c => c.operation)).toEqual(["read"]);
    expect((await f.call()).status).toBe(200); expect(f.provider).toHaveBeenCalledOnce();
  });
  it.each(["read", "publish"])("Image %s transient reconciliation twice preserves same result/action then resumes", async (operation) => {
    const fault = { operation: "", code: "result_store_unavailable" };
    const retrieve = vi.fn(async () => new Blob(["original image"], { type: "image/png" }));
    const f = fixture("image", retrieve, fault); f.fake.failNext("write"); await f.call();
    const record = [...f.fake.records.values()][0], manifest = { ...record.manifest }, binding = record.binding;
    fault.operation = operation;
    for (let i = 0; i < 2; i++) {
      const response = await f.call(); expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: fault.code, deliveryPending: true, recoverable: false });
    }
    expect(f.acquire).toHaveBeenCalledOnce(); expect(f.imageProvider).toHaveBeenCalledOnce(); expect(f.settle).not.toHaveBeenCalled();
    fault.operation = ""; expect((await f.call()).status).toBe(200);
    expect(record.manifest).toEqual(manifest); expect(record.binding).toEqual(binding); expect(f.fake.records.size).toBe(1);
    expect(f.imageProvider).toHaveBeenCalledOnce();
  });
  it.each(["probe", "observation"])("pre-admission %s deadline keeps pending without acquiring execution", async (operation) => {
    const fault = { operation, code: "result_store_deadline_exceeded" }, f = fixture("image", undefined, fault);
    if (operation === "observation") f.observeExisting.mockRejectedValue(new ExternalResultError(fault.code));
    for (let i = 0; i < 2; i++) expect(await (await f.call()).json()).toMatchObject({ code: fault.code, deliveryPending: true });
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.imageProvider).not.toHaveBeenCalled();
  });
  it.each([["result_identity_conflict",409], ["result_chunk_conflict",409], ["external_result_expired",410],
    ["result_payload_too_large",413], ["result_contract_invalid",502]] as const)("%s is permanent before admission and after Provider success", async (code, status) => {
    const fault = { operation: "read", code }, f = fixture("image", undefined, fault);
    let response = await f.call(); expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    response = await f.call(); expect(await response.json()).not.toHaveProperty("deliveryPending");
    expect(f.imageProvider).not.toHaveBeenCalled();
    fault.operation = "prepare";
    response = await f.call(); expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty("deliveryPending"); expect(f.imageProvider).toHaveBeenCalledOnce();
    // Recovery observes the same execution; a permanent error cannot re-admit generation.
    fault.operation = "read"; response = await f.call(); expect(response.status).toBe(status);
    expect(f.imageProvider).toHaveBeenCalledOnce(); expect(f.acquire).toHaveBeenCalledOnce();
  });
  it("expired staged Image never retrieves or resurrects", async () => {
    const retrieve = vi.fn(async () => new Blob(["original image"], { type: "image/png" }));
    const f = fixture("image", retrieve); f.fake.failNext("write"); await f.call();
    const staged = [...f.fake.records.values()][0];
    staged.manifest = { ...staged.manifest, expiresAt: "2000-01-01T00:00:00Z" };
    const response = await f.call(); expect(response.status).toBe(410);
    expect(await response.json()).not.toHaveProperty("deliveryPending"); expect(retrieve).not.toHaveBeenCalled(); expect(f.imageProvider).toHaveBeenCalledOnce();
  });
  it("actual oversized Image output fails with 413 rather than indefinite pending", async () => {
    const f = fixture("image"); f.imageProvider.mockResolvedValue({ status: "ok", blob: new Blob([new Uint8Array(16*1024*1024+1)], { type: "image/png" }), mimeType: "image/png" });
    const first = await f.call(); expect(first.status).toBe(413); expect(await first.json()).not.toHaveProperty("deliveryPending");
    f.observeExisting.mockRejectedValue(new ExternalResultError("result_payload_too_large"));
    const replay = await f.call(); expect(replay.status).toBe(413); expect(await replay.json()).not.toHaveProperty("deliveryPending");
    expect(f.imageProvider).toHaveBeenCalledOnce(); expect(f.acquire).toHaveBeenCalledOnce();
  });
  it("A+ partial Image staging resumes original bound result without acquisition or generate", async () => {
    const retrieve = vi.fn(async () => new Blob(["original image"], { type: "image/png" }));
    const f = fixture("image", retrieve); f.fake.failNext("write");
    expect(await (await f.call()).json()).toMatchObject({ deliveryPending: true });
    const record = [...f.fake.records.values()][0], binding = record.binding, manifest = record.manifest;
    expect((await f.call()).status).toBe(200);
    expect(record.manifest).toEqual(manifest); expect(record.binding).toEqual(binding);
    expect(binding).toMatchObject({ actionId: "action", actionHash: expect.any(String) });
    expect(retrieve).toHaveBeenCalledOnce(); expect(f.acquire).toHaveBeenCalledOnce(); expect(f.imageProvider).toHaveBeenCalledOnce();
  });
  it.each(["image", "text", "compaction"] as const)("%s survives response loss and config changes with one immutable result", async (kind) => {
    const f = fixture(kind);
    const first = await f.call();
    if (kind === "text") expect(await first.text()).toContain('"type":"resultAvailable"');
    else expect(await first.json()).toHaveProperty("result.sha256");
    f.textConfig.mockImplementation(() => { throw new Error("current config unavailable"); });
    const saved = [...f.fake.records.values()][0];
    expect(saved.published).toBe(true);
    const replay = await f.call();
    expect(await replay.json()).toEqual({ result: saved.manifest });
    expect(f.fake.records.size).toBe(1);
    expect(f.provider.mock.calls.length + f.imageProvider.mock.calls.length + f.compactionProvider.mock.calls.length).toBe(1);
    if (kind === "compaction") expect(saved.binding).toMatchObject({ actionId: "action" });
  });
  it.each(["image", "text", "compaction"] as const)("%s store failure retains unavailable identity and never repeats execution", async (kind) => {
    const f = fixture(kind); f.fake.failNext("write");
    const response = await f.call(); await response.text();
    const calls = f.provider.mock.calls.length + f.imageProvider.mock.calls.length + f.compactionProvider.mock.calls.length;
    const replay = await f.call();
    expect(replay.status).toBe(503);
    expect(f.provider.mock.calls.length + f.imageProvider.mock.calls.length + f.compactionProvider.mock.calls.length).toBe(calls);
    expect([...f.fake.records.values()][0].published).toBe(false);
  });
  it.each(["image", "text", "compaction"] as const)("%s missing store contract blocks acquisition", async (kind) => {
    const f = fixture(kind); f.fake.failNext("probe");
    expect((await f.call()).status).toBe(503);
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled(); expect(f.imageProvider).not.toHaveBeenCalled(); expect(f.compactionProvider).not.toHaveBeenCalled();
  });
});
