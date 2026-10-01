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
function fixture(kind: "image" | "text" | "compaction", retrieveImage?: () => Promise<Blob | undefined>) {
  const fake = createExternalResultFake();
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
  const handler = kind === "text" ? createAgentTurnRequestPostHandler({ authenticate: auth, loadConfig: textConfig,
    checkPrivilegedSettlement: () => ({ status: "ok" }), results: fake.port,
    acquireRequest: vi.fn(async () => ({ status: "ok" as const, executionGranted: true, replayed: false, snapshot: journal })),
    settleRequest: vi.fn(async () => ({ status: "ok" as const, replayed: false, snapshot: { ...journal, status: "externallyCompleted" as const } })), streamProvider: provider })
    : kind === "image" ? createAgentTurnImageActionPostHandler({ authenticate: auth, acquire, settle, results: fake.port, retrieveImage,
      loadConfig: () => ({ status: "ok", config: { apiKey: "fake", baseUrl: "https://fake.test", model: "gpt-image-2" } }), generate: imageProvider })
      : createAgentTurnCompactionActionPostHandler({ authenticate: auth, acquire, settle, results: fake.port,
        loadConfig: textConfig, execute: compactionProvider });
  const body = kind === "text" ? { localProjectId: "project", requestId: "request", stepSequence: 1, providerRequest: {
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], mode: "auto", capabilityIntent: { comparisonAnalysis: false },
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION } } : kind === "image" ? { ...commonBody, claimCallId: "claim", input: { prompt: "image", images: [] } }
      : { ...commonBody, mode: "manual", sourceStartMessageId: "user", sourceEndMessageId: "assistant",
        messages: [{ id: "user", role: "user", body: "hello" }, { id: "assistant", role: "assistant", body: "world" }] };
  const call = () => handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ turnId }) });
  return { fake, call, provider, imageProvider, compactionProvider, textConfig, acquire };
}
describe("P3B consumed handler contracts", () => {
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
