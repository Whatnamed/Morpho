import type { APlusExternalRequestIdentity } from "./agentToolBatchAPlus";
import type { MorphoWorkspace } from "@/domain/morpho/types";

export type APlusExternalActionKind = "webSearch" | "image" | "compaction";

export type APlusExternalActionStatus =
  | "acquired"
  | "running"
  | "completedWithPayload"
  | "completedPayloadUnavailable"
  | "cancelled"
  | "failed"
  | "conflict";

export type APlusImageResponseKind = "running" | "payload" | "jsonError";

export function classifyAPlusImageResponse(
  status: number,
  contentType: string | null
): APlusImageResponseKind {
  if (status === 202) return "running";
  if ((contentType ?? "").toLowerCase().includes("application/json")) return "jsonError";
  return "payload";
}

export type APlusExternalActionDescriptor = Readonly<{
  actionId: string;
  actionKind: APlusExternalActionKind;
  requestBody: string;
  requestHash: string;
}>;

export class APlusExternalActionRunningError extends Error {
  readonly code = "external_action_running" as const;
  readonly status = "running" as const;

  constructor(readonly action: APlusExternalActionDescriptor, message: string) {
    super(message);
    this.name = "APlusExternalActionRunningError";
  }
}

export function isAPlusExternalActionRunningError(
  error: unknown
): error is APlusExternalActionRunningError {
  return error instanceof APlusExternalActionRunningError || (
    isRecord(error) &&
    error.code === "external_action_running" &&
    isRecord(error.action) &&
    typeof error.action.actionId === "string" &&
    typeof error.action.actionKind === "string" &&
    typeof error.action.requestBody === "string" &&
    typeof error.action.requestHash === "string"
  );
}

export async function createAPlusExternalActionRunningError(input: Readonly<{
  actionId: string;
  actionKind: APlusExternalActionKind;
  requestBody: string;
  message: string;
}>): Promise<APlusExternalActionRunningError> {
  return new APlusExternalActionRunningError(
    {
      actionId: input.actionId,
      actionKind: input.actionKind,
      requestBody: input.requestBody,
      requestHash: await hashAPlusExternalActionBody(input.requestBody)
    },
    input.message
  );
}

export async function hashAPlusExternalActionBody(value: string): Promise<string> {
  return sha256Hex(value);
}

/**
 * POST an A+ External Action while preserving the ambiguity boundary. Once a
 * request has been handed to fetch, a non-abort rejection cannot prove that
 * the server did not acquire the Action. Surface it as a query-only running
 * result so the caller can replay the exact same identity and body.
 */
export async function postAPlusExternalAction(input: Readonly<{
  fetch: typeof fetch;
  url: string;
  actionId: string;
  actionKind: APlusExternalActionKind;
  requestBody: string;
  signal: AbortSignal;
  message: string;
}>): Promise<Response> {
  try {
    return await input.fetch(input.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: input.requestBody,
      signal: input.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw await createAPlusExternalActionRunningError({
      actionId: input.actionId,
      actionKind: input.actionKind,
      requestBody: input.requestBody,
      message: input.message
    });
  }
}

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
    const response = await postAPlusExternalAction({
      fetch: input.fetch,
      url,
      actionId: input.actionId,
      actionKind: "webSearch",
      requestBody: bodyText,
      signal: input.signal,
      message: "Search 请求响应丢失，服务器状态未知；本地只进行同身份查询，不重复调用外部 Search。"
    });
    const body = await readJson(response);
    if (response.status === 202 && attempt < replayDelays.length) {
      await (input.waitForReplay ?? waitForReplay)(replayDelays[attempt]!, input.signal);
      continue;
    }
    if (response.status === 202) {
      throw await createAPlusExternalActionRunningError({
        actionId: input.actionId,
        actionKind: "webSearch",
        requestBody: bodyText,
        message: "Search 仍在服务器执行；本地只进行过同身份查询，未重复调用外部 Search。"
      });
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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
