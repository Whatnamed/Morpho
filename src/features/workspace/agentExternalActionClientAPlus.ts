import type { APlusExternalRequestIdentity } from "./agentToolBatchAPlus";
import type { MorphoWorkspace } from "@/domain/morpho/types";

export async function requestAgentWebSearchAPlus(input: Readonly<{
  fetch: typeof fetch;
  identity: APlusExternalRequestIdentity;
  actionId: string;
  queries: string[];
  signal: AbortSignal;
  waitForReplay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>): Promise<{
  sources: Array<{ title: string; url: string; domain?: string; snippet?: string; excerpt?: string }>;
  failedSourceCount?: number;
  timedOutSourceCount?: number;
}> {
  const url = `/api/ai/agent/turns/${encodeURIComponent(input.identity.serverTurnId)}/actions/web-search`;
  const bodyText = JSON.stringify({
    localProjectId: input.identity.localProjectId,
    requestId: input.identity.requestId,
    stepSequence: input.identity.stepSequence,
    actionId: input.actionId,
    queries: input.queries,
    maxSources: 5
  });
  const replayDelays = [100, 300, 900] as const;
  for (let attempt = 0; ; attempt += 1) {
    const response = await input.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
      signal: input.signal
    });
    const body = await readJson(response);
    if (response.status === 202 && attempt < replayDelays.length) {
      await (input.waitForReplay ?? waitForReplay)(replayDelays[attempt]!, input.signal);
      continue;
    }
    if (response.status === 202) {
      throw externalActionError(
        "external_action_running",
        "Search 仍在服务器执行；本地只进行过同身份查询，未重复调用外部 Search。"
      );
    }
    if (!response.ok || !isSearchResponse(body)) {
      throw externalActionError(
        isRecord(body) && typeof body.code === "string" ? body.code : `http_${response.status}`,
        isRecord(body) && typeof body.error === "string" ? body.error : "A+ Search Action 失败。"
      );
    }
    return body;
  }
}

export async function buildAPlusImageChildActionId(
  parentActionId: string,
  stableItemId: string
): Promise<string> {
  return `img:${await sha256Hex(`${parentActionId}\0${stableItemId}`)}`;
}

export async function buildAPlusImageBatchIdentity(
  serverTurnId: string,
  parentActionId: string
): Promise<Readonly<{ operationId: string; clientRequestId: string }>> {
  const digest = await sha256Hex(`${serverTurnId}\0${parentActionId}\0image-batch`);
  return {
    operationId: `operation-image-a-plus-${digest}`,
    clientRequestId: `client-image-a-plus-${digest}`
  };
}

export function findAPlusImageResultObjectId(
  workspace: Pick<MorphoWorkspace, "objects">,
  clientRequestId: string
): string | undefined {
  return Object.values(workspace.objects)
    .filter((object) =>
      object.type === "image" && object.generation?.clientRequestId === clientRequestId
    )
    .map((object) => object.id)
    .sort()[0];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isSearchResponse(value: unknown): value is {
  sources: Array<{ title: string; url: string; domain?: string; snippet?: string; excerpt?: string }>;
  failedSourceCount?: number;
  timedOutSourceCount?: number;
} {
  return isRecord(value) && Array.isArray(value.sources) && value.sources.every((source) =>
    isRecord(source) && typeof source.title === "string" && typeof source.url === "string"
  );
}

function externalActionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function waitForReplay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
