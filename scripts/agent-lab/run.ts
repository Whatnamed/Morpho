import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import { createAgentTurnCoordinatorHttpHost } from "@/features/workspace/agentTurnCoordinatorHttpHost";
import type { AgentTurnHost } from "@/features/workspace/agentTurnHost";
import { createAgentTurnHostFake } from "@/test/agentTurnHostFake";
import { createAgentTurnRecoveryStore, type APlusTurnRecoveryRecord } from "@/features/workspace/agentTurnRecoveryStore";
import { prepareAgentTurnProductAPlus } from "@/features/workspace/agentTurnProductPreparationAPlus";
import { detachMorphoAgentTurnForPageUnload, runMorphoAgentTurn } from "@/features/workspace/agentTurnRunner";
import {
  AGENT_LAB_HEADER, AGENT_LAB_REQUEST_EVENT, agentLabProfileId,
  captureAgentLabProviderBody, isAgentLabLoopback, loadAgentLabProfile
} from "@/server/ai/agentLabProfile";
import { prepareAPlusAgentProviderSubmission, parseAPlusAgentProviderRequest } from "@/server/ai/agentTurnProviderRequest";
import type { AgentTurnRequestStreamEvent } from "@/shared/agentTurnJournalProtocol";
import { serializeOpenAiCompatibleStreamBody } from "@/server/ai/openaiCompatibleProvider";

import { loadAgentLabTask, readJsonFile } from "./task";
import { createScriptedTransport, loadScriptedConfig, scriptedOrigin, scriptedUserId } from "./scripted";

export type AgentLabRunOptions = {
  mode: "preview" | "scripted" | "live";
  profile: string;
  task: string;
  server?: string;
  "storage-state"?: string;
  outputRoot?: string;
};

export async function runAgentLab(options: AgentLabRunOptions) {
  const profilePath = resolve(options.profile);
  const profile = await loadAgentLabProfile(profilePath);
  const profileId = agentLabProfileId(profile);
  const { workspace, input, task, assets, responses, initialWorkspaceSha256 } = loadAgentLabTask(options.task);
  if (options.mode === "scripted" && !responses) throw new Error("Scripted mode requires task.responses.");
  const live = options.mode === "live" ? readLiveTransport(options) : undefined;

  const root = resolve(options.outputRoot ?? "temp/agent-lab");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, `${options.mode}-`));
  const recordPath = join(directory, "run.json");
  const workspacePath = join(directory, "workspace.after.json");
  const fake = createAgentTurnHostFake({ workspace });
  const started = performance.now();
  let scripted: ReturnType<typeof createScriptedTransport> | undefined;
  if (options.mode === "scripted") scripted = createScriptedTransport(profilePath, workspace.project.id, responses ?? []);
  const baseUrl = live?.origin ?? scriptedOrigin;
  const fetchRequest: typeof fetch = (target, init) => {
    const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url, baseUrl);
    if (url.origin !== baseUrl || !url.pathname.startsWith("/api/ai/")) throw new Error("Outside Agent Lab transport.");
    const request = new Request(url, target instanceof Request ? target : init);
    request.headers.set(AGENT_LAB_HEADER, profileId);
    if (live) {
      request.headers.set("Cookie", live.cookie);
      return fetch(request, { redirect: "error" });
    }
    if (!scripted) throw new Error("Preview cannot use the network.");
    return scripted.fetch(request);
  };
  const host: AgentTurnHost = {
    ...fake,
    fetch: fetchRequest,
    sourceAssets: assets.port,
    now: Date.now,
    persistWorkspace: () => {
      try {
        atomicWrite(workspacePath, JSON.stringify(fake.getWorkspace(), null, 2));
        return { phase: "saved", isDirty: false, lastSavedAt: new Date().toISOString() };
      } catch (error) {
        fake.recordUiCall("persistenceFailure", error instanceof Error ? error.message : String(error));
        return { phase: "error", isDirty: true };
      }
    },
    ui: {
      setContextWarning: fake.createUiRecorder("contextWarning"),
      clearPendingDeliveryDraftTarget: fake.createUiRecorder("clearDelivery"),
      setStreaming: fake.createUiRecorder("streaming"),
      setDraft: fake.createUiRecorder("draft"),
      setTaskMode: fake.createUiRecorder("taskMode"),
      openConversation: fake.createUiRecorder("openConversation"),
      showFailure: fake.createUiRecorder("failure"),
      showRecoveryPending: fake.createUiRecorder("recoveryPending"),
      requestPendingConfirmation: (value) => {
        fake.recordUiCall("pendingConfirmation", value);
        return { status: "accepted", origin: "agent" };
      },
      selectObjects: fake.createUiRecorder("selection"),
      focusObject: fake.createUiRecorder("focus"),
      openProposal: fake.createUiRecorder("openProposal")
    },
    executeVisualGenerationPlan: async () => { throw new Error("Agent Lab does not execute image actions."); }
  };
  const http = createAgentTurnCoordinatorHttpHost({ baseUrl, fetch: fetchRequest });
  const steps: Array<{
    requestId: string;
    stepSequence: number;
    elapsedMs: number | null;
    transport?: unknown;
    events: Array<{ elapsedMs: number; value: AgentTurnRequestStreamEvent }>;
  }> = [];
  const toolResults = new Map<string, unknown>();
  let lastRecovery: APlusTurnRecoveryRecord | undefined;
  let preview: ReturnType<typeof previewProvider> | undefined;
  let failure: string | undefined;
  try {
    if (options.mode === "preview") {
      const prepared = await prepareAgentTurnProductAPlus(input, host);
      preview = previewProvider(prepared.providerRequest, workspace.project.id, profile);
    } else {
      const store = directoryRecoveryStore(directory);
      await runMorphoAgentTurn(input, host, {
        recoveryStore: {
          ...store,
          async save(recovery) {
            await store.save(recovery);
            lastRecovery = recovery;
            const lifecycle = recovery.coordinator.lifecycle;
            if (lifecycle.phase === "executingTools") {
              for (const terminal of lifecycle.activeToolBatch.results) {
                const output = recovery.metadata.runtime.continuationItems.find((item) =>
                  item.type === "function_call_output" && item.callId === terminal.callId);
                toolResults.set(terminal.callId, { terminal, output });
              }
            }
          }
        },
        coordinatorHost: {
          ...http,
          async executeExternalRequest(request, observer) {
            const step: (typeof steps)[number] = {
              requestId: request.requestId, stepSequence: request.stepSequence, elapsedMs: null, events: []
            };
            steps.push(step);
            const began = performance.now();
            const observe = (value: AgentTurnRequestStreamEvent) => {
              step.events.push({ elapsedMs: Math.round(performance.now() - began), value });
              if (!isLabRequestEvent(value)) observer(value);
            };
            let handshake;
            try {
              handshake = await http.executeExternalRequest(request, observe);
            } catch (error) {
              step.elapsedMs = Math.round(performance.now() - began);
              step.transport = { error: error instanceof Error ? error.message : String(error) };
              throw error;
            }
            if (handshake.status !== "started") {
              step.elapsedMs = Math.round(performance.now() - began);
              step.transport = handshake;
              return handshake;
            }
            return { ...handshake, complete: async () => {
              try {
                const result = await handshake.complete();
                step.transport = result;
                return result;
              } finally {
                step.elapsedMs = Math.round(performance.now() - began);
              }
            } };
          }
        }
      });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    detachMorphoAgentTurnForPageUnload(workspace.project.id);
    scripted?.dispose();
  }

  const after = fake.getWorkspace();
  const newMessages = after.ai.messages.slice(workspace.ai.messages.length);
  const assistant = options.mode === "preview" ? undefined : newMessages.filter((message) => message.role === "assistant").at(-1);
  const providerInputs = newMessages.filter((message) => message.providerInputSnapshot)
    .map(({ id, providerInputSnapshot }) => ({ id, snapshot: providerInputSnapshot }));
  const providerEvents = steps.flatMap((step) => step.events.map(({ value }) => value));
  const activities = providerEvents.flatMap((value) => value.type === "streamActivity" && isEvent(value.event) ? [value.event] : []);
  const toolCallIds = new Set(providerEvents.flatMap((value) => value.type === "providerOutput" ? value.toolCallIds : []));
  for (const event of activities) {
    if (event.type === "function-call-ready" && isEventRecord(event.functionCall) &&
      typeof event.functionCall.callId === "string") toolCallIds.add(event.functionCall.callId);
  }
  const record = {
    mode: options.mode,
    profile, profileId, task, initialWorkspaceSha256, fixtureAssets: assets.fingerprints,
    localProjectId: workspace.project.id,
    elapsedMs: Math.round(performance.now() - started),
    providerRequests: steps.length,
    providerAttempts: providerEvents.filter(isLabRequestEvent).length,
    toolCalls: toolCallIds.size,
    usageByStep: steps.map(({ stepSequence, events }) => ({
      stepSequence, usage: events.flatMap(({ value }) => value.type === "streamActivity" &&
        isEvent(value.event) && value.event.type === "usage" ? [value.event.usage] : []).at(-1) ?? null
    })),
    cost: null,
    preview,
    steps,
    toolResults: [...toolResults.values()],
    providerInputs,
    contextFrames: (after.ai.providerContextFrames ?? []).slice(workspace.ai.providerContextFrames?.length ?? 0),
    serverStatus: lastRecovery?.coordinator.serverSnapshot.status ?? null,
    localLifecycle: lastRecovery?.coordinator.lifecycle ?? null,
    final: assistant ? { text: assistant.body, status: assistant.status, outcome: assistant.agentTurnOutcome, trace: assistant.agentTrace } : null,
    ui: fake.getEvents().filter(({ kind }) => kind === "ui"),
    error: failure ?? null
  };
  atomicWrite(recordPath, JSON.stringify(record, null, 2));
  return { recordPath, workspacePath, record };
}

function previewProvider(raw: unknown, localProjectId: string, profile: Awaited<ReturnType<typeof loadAgentLabProfile>>) {
  const parsed = parseAPlusAgentProviderRequest(raw);
  if (parsed.status === "failed") throw new Error(parsed.reason);
  const { config, request, methodPackIds } = prepareAPlusAgentProviderSubmission({
    localProjectId, userId: scriptedUserId, request: parsed.value, config: loadScriptedConfig(), labProfile: profile
  });
  return { methodPackIds, body: captureAgentLabProviderBody(serializeOpenAiCompatibleStreamBody(config, request)) };
}

function readLiveTransport(options: AgentLabRunOptions) {
  if (!options.server || !options["storage-state"]) throw new Error("Live mode requires --server and --storage-state.");
  const url = new URL(options.server);
  if (!isAgentLabLoopback(url) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Live Agent Lab requires a loopback origin.");
  }
  const { cookies } = z.object({ cookies: z.array(z.object({
    name: z.string(), value: z.string(), domain: z.string(), path: z.string(), expires: z.number(), secure: z.boolean()
  })) }).parse(readJsonFile(options["storage-state"]));
  const cookie = cookies.filter(({ name, domain, path, expires, secure }) => /^sb-[\w-]+-auth-token(?:\.\d+)?$/.test(name) &&
    domain.replace(/^\./, "") === url.hostname && path === "/" &&
    (!secure || url.protocol === "https:") && (expires < 0 || expires > Date.now() / 1000))
    .map(({ name, value }) => `${name}=${value}`).join("; ");
  if (!cookie) throw new Error("No current Supabase auth cookie for the loopback origin in the storage state.");
  return { origin: url.origin, cookie };
}

function directoryRecoveryStore(directory: string) {
  const path = (key: string) => join(directory, `recovery-${createHash("sha256").update(key).digest("hex")}`);
  const read = (key: string) => {
    try { return readFileSync(path(key), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const write = (key: string, value: string) => atomicWrite(path(key), value);
  const remove = (key: string) => rmSync(path(key), { force: true });
  return createAgentTurnRecoveryStore({
    storage: { getItem: read, setItem: write, removeItem: remove },
    payloadStore: { put: async (key, value) => write(key, value), get: async (key) => read(key), delete: async (key) => remove(key) }
  });
}

function atomicWrite(path: string, value: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, value, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEvent(value: unknown): value is Record<string, unknown> & { type: string } {
  return isEventRecord(value) && typeof value.type === "string";
}

function isLabRequestEvent(value: AgentTurnRequestStreamEvent): boolean {
  return value.type === "streamActivity" && isEvent(value.event) && value.event.type === AGENT_LAB_REQUEST_EVENT;
}
