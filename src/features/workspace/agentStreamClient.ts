import {
  readAgentRouteSse,
  type AgentRouteStreamEvent,
  type AgentStreamResult
} from "@/shared/agentStreamProtocol";

export class AgentTurnStreamError extends Error {
  constructor(
    message: string,
    readonly code?: "context_limit" | "interrupted"
  ) {
    super(message);
    this.name = "AgentTurnStreamError";
  }
}

export async function consumeAgentTurnStream(
  response: Response,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: AgentRouteStreamEvent) => void;
  } = {}
): Promise<AgentStreamResult> {
  if (!response.ok || !response.body) {
    throw new AgentTurnStreamError(await readAgentStreamError(response));
  }

  let completeResult: AgentStreamResult | undefined;
  let streamError: Extract<AgentRouteStreamEvent, { type: "turn-error" }> | undefined;
  let terminal = false;
  const attemptGuard = createAgentAttemptGuard();

  await readAgentRouteSse(response.body, {
    signal: options.signal,
    onEvent: (event) => {
      if (terminal || !attemptGuard.accept(event)) {
        return;
      }
      options.onEvent?.(event);
      if (event.type === "turn-error") {
        streamError = event;
        terminal = true;
      } else if (event.type === "turn-complete") {
        completeResult = event.result;
        terminal = true;
      }
    }
  });

  if (streamError) {
    if (streamError.code === "interrupted") {
      throw new DOMException(streamError.error, "AbortError");
    }
    throw new AgentTurnStreamError(streamError.error, streamError.code);
  }
  if (!completeResult) {
    throw new AgentTurnStreamError("与 AI 的流式连接意外中断，请重试。", "interrupted");
  }
  return completeResult;
}

export type AgentStreamEventBatcher = {
  push(event: AgentRouteStreamEvent): void;
  flush(): void;
  cancel(): void;
};

export function createAgentStreamEventBatcher(options: {
  onFlush: (events: AgentRouteStreamEvent[]) => void;
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}): AgentStreamEventBatcher {
  const delayMs = options.delayMs ?? 48;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle));
  let pending: AgentRouteStreamEvent[] = [];
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const clearScheduled = () => {
    if (scheduled !== undefined) {
      cancelSchedule(scheduled);
      scheduled = undefined;
    }
  };
  const flush = () => {
    clearScheduled();
    if (cancelled || pending.length === 0) {
      pending = [];
      return;
    }
    const events = pending;
    pending = [];
    options.onFlush(events);
  };

  return {
    push(event) {
      if (cancelled) {
        return;
      }
      if (!isBatchableDelta(event)) {
        flush();
        options.onFlush([event]);
        return;
      }

      const previous = pending.at(-1);
      if (previous && isSameDeltaPart(previous, event)) {
        pending[pending.length - 1] = { ...event, delta: `${previous.delta}${event.delta}` };
      } else {
        pending.push(event);
      }
      if (scheduled === undefined) {
        scheduled = schedule(flush, delayMs);
      }
    },
    flush,
    cancel() {
      cancelled = true;
      clearScheduled();
      pending = [];
    }
  };
}

export type AgentAttemptGuard = {
  accept(event: AgentRouteStreamEvent): boolean;
  getActiveAttemptId(): string | undefined;
};

export function createAgentAttemptGuard(): AgentAttemptGuard {
  let activeAttemptId: string | undefined;
  return {
    accept(event) {
      if (event.type === "turn-start") {
        activeAttemptId = event.attemptId ?? activeAttemptId;
        return true;
      }
      if (event.type === "turn-attempt-reset") {
        if (activeAttemptId && event.attemptId !== activeAttemptId) {
          return false;
        }
        activeAttemptId = event.nextAttemptId;
        return true;
      }

      const attemptId = "attemptId" in event ? event.attemptId : undefined;
      return !attemptId || !activeAttemptId || attemptId === activeAttemptId;
    },
    getActiveAttemptId() {
      return activeAttemptId;
    }
  };
}

async function readAgentStreamError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return `请求失败（${response.status}）。`;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error;
      }
    } catch {
      // A non-JSON diagnostic is handled as bounded plain text below.
    }
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return `请求失败（${response.status}）。`;
  }
}

function isBatchableDelta(
  event: AgentRouteStreamEvent
): event is Extract<AgentRouteStreamEvent, { type: "reasoning-delta" | "commentary-delta" | "final-delta" }> {
  return event.type === "reasoning-delta" || event.type === "commentary-delta" || event.type === "final-delta";
}

function isSameDeltaPart(
  first: AgentRouteStreamEvent,
  second: Extract<AgentRouteStreamEvent, { type: "reasoning-delta" | "commentary-delta" | "final-delta" }>
): first is Extract<AgentRouteStreamEvent, { type: "reasoning-delta" | "commentary-delta" | "final-delta" }> {
  return (
    isBatchableDelta(first) &&
    first.type === second.type &&
    first.partId === second.partId &&
    first.attemptId === second.attemptId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
