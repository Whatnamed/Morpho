import { vi } from "vitest";

import { createAgentTurnPostHandler } from "@/app/api/ai/agent/turns/handler";
import { createAgentTurnGetHandler } from "@/app/api/ai/agent/turns/[turnId]/handler";
import { createAgentTurnRequestPostHandler } from "@/app/api/ai/agent/turns/[turnId]/requests/handler";
import { createEffectExecution } from "@/server/ai/externalEffectJournal";
import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import { streamOpenAiCompatibleResponse } from "@/server/ai/openaiCompatibleProvider";
import { FakeAgentTurnJournal } from "@/test/agentTurnJournalFake";
import { createEffectJournalFake } from "@/test/externalEffectJournalFake";

import type { ScriptedResponse } from "./task";

export const scriptedOrigin = "http://127.0.0.1";
const providerEndpoint = "https://provider.agent-lab.invalid/v1";
export const scriptedUserId = "scripted-lab-user";

export function loadScriptedConfig() {
  const result = loadOpenAiCompatibleConfig({
    ...process.env,
    MORPHO_AI_API_KEY: "scripted",
    MORPHO_AI_BASE_URL: providerEndpoint,
    MORPHO_AI_PROVIDER: "openai-compatible"
  });
  if (result.status === "failed") throw new Error(result.reason);
  return result.config;
}

export function createScriptedTransport(profilePath: string, projectId: string, responses: readonly ScriptedResponse[]) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("MORPHO_ALLOW_PAID_SMOKE_TESTS", "true");
  vi.stubEnv("MORPHO_AGENT_LAB_PROFILE", profilePath);
  const turnId = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
  const root = "/api/ai/agent/turns";
  const turn = `${root}/${turnId}`;
  const context = { params: Promise.resolve({ turnId }) };
  const journal = new FakeAgentTurnJournal(turnId, projectId);
  const effects = createEffectJournalFake();
  const authenticate = async () => ({ status: "allowed" as const, userId: scriptedUserId });
  const createTurn = createAgentTurnPostHandler({ authenticate, createJournal: async () => ({
    status: "ok", snapshot: journal.snapshot, replayed: false
  }) });
  const readTurn = createAgentTurnGetHandler({ authenticate, readJournal: journal.read });
  const requestStep = createAgentTurnRequestPostHandler({
    authenticate,
    loadConfig: () => ({ status: "ok", config: loadScriptedConfig() }),
    checkPrivilegedSettlement: () => ({ status: "ok" }),
    acquireRequest: journal.acquire,
    settleRequest: journal.settle,
    streamProvider: streamOpenAiCompatibleResponse,
    createEffect: (identity) => createEffectExecution(identity, effects.port)
  });

  let submitted = 0;
  vi.stubGlobal("fetch", (async (target, init) => {
    if (String(target) !== `${providerEndpoint}/responses` || init?.method !== "POST") {
      throw new Error("Scripted Agent Lab blocks network I/O.");
    }
    const response = responses[submitted++];
    if (!response) return new Response(null, { status: 400 });
    return providerSse(response, submitted);
  }) satisfies typeof fetch);

  const fetchRequest: typeof fetch = async (target, init) => {
    const request = new Request(target, init);
    const { pathname } = new URL(request.url);
    if (pathname === root && request.method === "POST") return createTurn(request);
    if (pathname === turn && request.method === "GET") return readTurn(request, context);
    if (pathname === `${turn}/requests` && request.method === "POST") return requestStep(request, context);
    return Response.json({ code: "agent_lab_action_unavailable", error: "This scripted fixture has no external actions." }, { status: 403 });
  };
  return {
    fetch: fetchRequest,
    dispose() {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  };
}

function providerSse(step: ScriptedResponse, sequence: number): Response {
  const id = `scripted-response-${sequence}`;
  const events: Array<Record<string, unknown>> = [{ type: "response.created", response: { id } }];
  if (step.reasoningSummary) {
    const item_id = `reasoning-${sequence}`;
    events.push(
      { type: "response.reasoning_summary_part.added", item_id, summary_index: 0 },
      { type: "response.reasoning_summary_text.delta", item_id, summary_index: 0, delta: step.reasoningSummary },
      { type: "response.reasoning_summary_part.done", item_id, summary_index: 0 }
    );
  }
  for (const [index, call] of (step.calls ?? []).entries()) {
    const call_id = `scripted-call-${sequence}-${index + 1}`;
    events.push({ type: "response.output_item.done", item: {
      type: "function_call", id: `item-${call_id}`, call_id, name: call.name, arguments: JSON.stringify(call.args)
    } });
  }
  if (step.text) events.push({ type: "response.output_item.done", item: {
    type: "message", role: "assistant", phase: "final_answer", id: `text-${sequence}`,
    content: [{ type: "output_text", text: step.text }]
  } });
  events.push({ type: "response.completed", response: { id, ...(step.usage ? { usage: step.usage } : {}) } });
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" }
  });
}
