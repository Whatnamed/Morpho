import {
  isAgentTurnJournalSnapshot,
  isServerExternalExecutionStatus,
  type AgentTurnJournalSnapshot,
  type AgentTurnRequestStreamEvent
} from "@/shared/agentTurnJournalProtocol";
import type {
  AgentTurnCoordinatorExecutionHandshake,
  AgentTurnCoordinatorHost,
  AgentTurnCoordinatorTransportResult
} from "./agentTurnCoordinator";

export function createAgentTurnCoordinatorHttpHost(
  options: Readonly<{
    fetch?: typeof fetch;
    baseUrl?: string;
  }> = {}
): AgentTurnCoordinatorHost {
  const fetchRequest = options.fetch ?? fetch;
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
  const activeRequests = new Map<string, AbortController>();

  return {
    async createServerTurn(input) {
      const response = await fetchRequest(`${baseUrl}/api/ai/agent/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const body = await readJson(response);
      const replayed = isRecord(body) && body.replayed === true;
      if (!response.ok || !isRecord(body) || !isAgentTurnJournalSnapshot(body)) {
        throw routeError(response.status, body, "Server Turn 创建失败。");
      }
      return {
        snapshot: body,
        replayed
      };
    },

    async executeExternalRequest(input, observer): Promise<AgentTurnCoordinatorExecutionHandshake> {
      let response: Response;
      const requestKey = externalRequestKey(input);
      const abortController = new AbortController();
      activeRequests.set(requestKey, abortController);
      try {
        response = await fetchRequest(
          `${baseUrl}/api/ai/agent/turns/${encodeURIComponent(input.serverTurnId)}/requests`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
              localProjectId: input.localProjectId,
              requestId: input.requestId,
              stepSequence: input.stepSequence,
              providerRequest: input.providerRequest
            })
          }
        );
      } catch {
        activeRequests.delete(requestKey);
        throw new Error("A+ Request transport failed before response headers.");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok) {
        activeRequests.delete(requestKey);
        const body = await readJson(response);
        const error = routeError(response.status, body, "A+ Provider Request 被拒绝。");
        return {
          status: "denied",
          code: error.code,
          error: error.message,
          recoverable: isRetryableHttpFailure(response.status, error.code)
        };
      }
      if (contentType.includes("application/json")) {
        activeRequests.delete(requestKey);
        const body = await readJson(response);
        if (isRecord(body) && body.replayed === true && isAgentTurnJournalSnapshot(body)) {
          return { status: "replayed" };
        }
        return {
          status: "denied",
          code: "invalid_replay_response",
          error: "A+ Request replay 响应格式无效。",
          recoverable: false
        };
      }
      if (!response.body || !contentType.includes("text/event-stream")) {
        activeRequests.delete(requestKey);
        return {
          status: "denied",
          code: "invalid_stream_response",
          error: "A+ Provider Request 未返回事件流。",
          recoverable: false
        };
      }
      return {
        status: "started",
        complete: async () => {
          try {
            return await consumeAgentTurnStream(response.body!, observer);
          } finally {
            activeRequests.delete(requestKey);
          }
        }
      };
    },

    async queryServerTurn(input): Promise<AgentTurnJournalSnapshot> {
      const query = new URLSearchParams({ localProjectId: input.localProjectId });
      const response = await fetchRequest(
        `${baseUrl}/api/ai/agent/turns/${encodeURIComponent(input.serverTurnId)}?${query}`
      );
      const body = await readJson(response);
      if (!response.ok || !isAgentTurnJournalSnapshot(body)) {
        throw routeError(response.status, body, "Server Turn Journal 查询失败。");
      }
      return body;
    },

    async cancelExternalRequest(input): Promise<void> {
      try {
        await fetchRequest(
          `${baseUrl}/api/ai/agent/turns/${encodeURIComponent(input.serverTurnId)}/requests/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              localProjectId: input.localProjectId,
              requestId: input.requestId,
              stepSequence: input.stepSequence
            })
          }
        );
      } finally {
        // Explicit cancellation was sent first. Aborting this Fetch only stops
        // local display consumption and does not itself settle server status.
        activeRequests.get(externalRequestKey(input))?.abort(
          new DOMException("A+ local display detached after cancellation request.", "AbortError")
        );
      }
    }
  };
}

function externalRequestKey(input: {
  serverTurnId: string;
  requestId: string;
  stepSequence: number;
}): string {
  return `${input.serverTurnId}:${input.requestId}:${input.stepSequence}`;
}

async function consumeAgentTurnStream(
  stream: ReadableStream<Uint8Array>,
  observer: (event: AgentTurnRequestStreamEvent) => void
): Promise<AgentTurnCoordinatorTransportResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalFrameReceived = false;
  try {
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      const consumed = consumeFrames(buffer);
      buffer = consumed.remainder;
      for (const event of consumed.events) {
        observer(event);
        if (event.type === "serverStatus" && event.status !== "providerRunning") {
          finalFrameReceived = true;
        }
      }
      if (next.done) break;
    }
    if (buffer.trim()) {
      const consumed = consumeFrames(`${buffer}\n\n`);
      for (const event of consumed.events) {
        observer(event);
        if (event.type === "serverStatus" && event.status !== "providerRunning") {
          finalFrameReceived = true;
        }
      }
    }
    return { status: "ended", finalFrameReceived };
  } catch {
    return { status: "interrupted", code: "stream_reader_failed" };
  } finally {
    reader.releaseLock();
  }
}

function consumeFrames(value: string): {
  events: AgentTurnRequestStreamEvent[];
  remainder: string;
} {
  const events: AgentTurnRequestStreamEvent[] = [];
  let cursor = 0;
  while (true) {
    const delimiter = value.indexOf("\n\n", cursor);
    if (delimiter < 0) break;
    const frame = value.slice(cursor, delimiter);
    cursor = delimiter + 2;
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (isAgentTurnRequestStreamEvent(parsed)) events.push(parsed);
    } catch {
      // A malformed display frame is ignored; missing final state is recovered from Journal.
    }
  }
  return { events, remainder: value.slice(cursor) };
}

function isAgentTurnRequestStreamEvent(value: unknown): value is AgentTurnRequestStreamEvent {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.requestId !== "string" ||
    !Number.isSafeInteger(value.stepSequence)
  ) return false;
  if (value.type === "streamActivity") {
    return Number.isSafeInteger(value.sequence) && "event" in value;
  }
  if (value.type === "providerOutput") {
    if (!Array.isArray(value.toolCallIds) || !Array.isArray(value.toolCalls)) return false;
    const toolCallIds = value.toolCallIds;
    const toolCalls = value.toolCalls;
    return typeof value.outputText === "string" &&
      typeof value.producedUserVisibleEffect === "boolean" &&
      toolCallIds.every((callId) => typeof callId === "string") &&
      toolCalls.every(isAPlusToolCall) &&
      toolCalls.length === toolCallIds.length &&
      toolCalls.every((call, index) => isRecord(call) && call.callId === toolCallIds[index]);
  }
  if (value.type === "serverStatus") {
    return isServerExternalExecutionStatus(value.status) && value.status !== "created";
  }
  if (value.type === "externalError") {
    return typeof value.code === "string" && value.code.length <= 100 &&
      typeof value.message === "string" && value.message.length <= 500 &&
      typeof value.recoverable === "boolean";
  }
  return false;
}

function isAPlusToolCall(value: unknown): boolean {
  return isRecord(value) &&
    Object.keys(value).every((key) => ["callId", "name", "argumentsText"].includes(key)) &&
    typeof value.callId === "string" &&
    typeof value.name === "string" &&
    typeof value.argumentsText === "string";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function routeError(status: number, body: unknown, fallback: string): Error & { code: string } {
  const code = isRecord(body) && typeof body.code === "string" ? body.code : `http_${status}`;
  const message = isRecord(body) && typeof body.error === "string" ? body.error : fallback;
  return Object.assign(new Error(message), { code });
}

function isRetryableHttpFailure(status: number, code: string): boolean {
  return (
    status === 500 || status === 502 || status === 503 || status === 504
  ) && code !== "provider_unavailable" && code !== "journal_contract_missing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
