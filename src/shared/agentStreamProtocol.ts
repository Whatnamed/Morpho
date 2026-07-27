import type { AgentToolProfile } from "./agentRuntimeItem";
import type { AgentCompactionReceipt } from "./agentCompactionProtocol";

export type AgentStreamCitation = {
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
};

export type AgentServerDirective =
  | { kind: "requiredRead"; tools: Array<"read_project_memory" | "read_stage_record" | "search_project_conversation"> }
  | { kind: "requiredReadFailed"; tools: Array<"read_project_memory" | "read_stage_record" | "search_project_conversation"> }
  | { kind: "memoryUpdate"; memoryKinds: Array<"preference" | "avoidance" | "constraint" | "openQuestion"> }
  | { kind: "toolArgumentRepair"; callIds: string[] }
  | { kind: "conversationSummary" }
  | { kind: "finalize" };

export type AgentStreamFunctionCall = {
  id: string;
  callId: string;
  name: string;
  argumentsText: string;
};

export type AgentStreamOutputItem = {
  type: string;
  [key: string]: unknown;
};

export type AgentStreamUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  cacheHitRatio?: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type AgentCacheItemManifest = {
  type: string;
  role?: "system" | "user" | "assistant";
  semanticKind: string;
  contentHash: string;
  estimatedTokens: number;
};

export type AgentStreamContext = {
  estimatedInputTokens: number;
  estimatedOccupancyTokens: number;
  finalEstimatedInputTokens: number;
  compressibleTokens: number;
  pressure: "normal" | "prepare" | "compact";
  compacted: boolean;
  checkpointRequested: boolean;
  budgetGeneration: number;
  retried?: boolean;
};

export type AgentProviderRequestState = {
  promptContractVersion: string;
  toolProfile?: AgentToolProfile;
  summaryRevisionId?: string;
  latestUserMessageId?: string;
  providerInputPrefixHash?: string;
  attachmentBoundary?: string;
  runtimeItem?: import("./agentRuntimeItem").AgentCanonicalRuntimeItem;
  cacheItemManifest?: AgentCacheItemManifest[];
  toolsHash?: string;
  budgetGeneration?: number;
  transcriptManifestHash?: string;
  transcriptSnapshotToken?: string;
};

export type AgentProviderDiagnostics = {
  promptContractVersion?: string;
  toolProfile?: AgentToolProfile;
  stablePrefixHash?: string;
  previousStablePrefixHash?: string;
  contextFrameCount?: number;
  appendedContextFrameCount?: number;
  conversationSummaryRevisionId?: string;
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  cacheHitRatio?: number;
  providerCacheKeyEnabled?: boolean;
  providerCacheRetention?: "24h";
  cacheStatus?: "unavailable" | "miss" | "partialHit" | "fullHit";
  providerInputBoundaryReasons?: string[];
  previousRequestState?: AgentProviderRequestState;
  requestState?: AgentProviderRequestState;
  compactedThisTurn?: boolean;
  commonPrefixItemCount?: number;
  commonPrefixEstimatedTokens?: number;
  firstMismatchKind?: string;
  previousToolsHash?: string;
  currentToolsHash?: string;
  previousSummaryRevisionId?: string;
  currentSummaryRevisionId?: string;
  budgetGeneration?: number;
  runtimeItemHash?: string;
};

export type AgentStreamResult = {
  responseId: string;
  outputText: string;
  functionCalls: AgentStreamFunctionCall[];
  citations: AgentStreamCitation[];
  webSearchCallCount: number;
  outputItems: AgentStreamOutputItem[];
  usage?: AgentStreamUsage;
  context?: AgentStreamContext;
  providerDiagnostics?: AgentProviderDiagnostics;
};

export type AgentStreamActivityKind =
  | "webSearch"
  | "fileRead"
  | "contextRead"
  | "analysis"
  | "proposal"
  | "imageGeneration"
  | "comparison"
  | "workspaceWrite"
  | "confirmation"
  | "other";

export type AgentRouteStreamEvent =
  | {
      type: "turn-start";
      agentTurnId?: string;
      attemptId?: string;
      startedAt: string;
      effectiveToolProfile?: AgentToolProfile;
      runtimeItem?: import("./agentRuntimeItem").AgentCanonicalRuntimeItem;
      leaseId?: string;
      leaseExpiresAt?: string;
      providerCallCount?: number;
      webSearchCallCount?: number;
      nextProviderSequence?: number;
    }
  | {
      type: "turn-attempt-reset";
      attemptId: string;
      nextAttemptId: string;
      message: string;
    }
  | {
      type: "reasoning-start" | "reasoning-end";
      partId: string;
      attemptId?: string;
    }
  | {
      type: "reasoning-delta";
      partId: string;
      delta: string;
      attemptId?: string;
    }
  | {
      type: "commentary-start" | "commentary-end" | "final-start" | "final-end";
      partId: string;
      attemptId?: string;
    }
  | {
      type: "commentary-delta" | "final-delta";
      partId: string;
      delta: string;
      attemptId?: string;
    }
  | {
      type: "provider-tool-start" | "provider-tool-update" | "provider-tool-end";
      toolCallId: string;
      toolName: string;
      activityKind: AgentStreamActivityKind;
      label: string;
      detail?: string;
      state?: "done" | "failed";
      attemptId?: string;
    }
  | {
      type: "function-call-ready";
      functionCall: AgentStreamFunctionCall;
      attemptId?: string;
    }
  | {
      type: "citation";
      citation: AgentStreamCitation;
      attemptId?: string;
    }
  | {
      type: "usage";
      usage: AgentStreamUsage;
      attemptId?: string;
    }
  | {
      type: "context";
      context: AgentStreamContext;
    }
  | {
      type: "heartbeat";
    }
  | {
      type: "turn-complete";
      result: AgentStreamResult;
      attemptId?: string;
      /**
       * Signed proof of what this response actually was. The next Provider request
       * in the same turn must return it; it is never persisted with the workspace.
       */
      continuationToken?: string;
      /** Manifest hash from the signed continuation claim, kept transiently for compaction. */
      transcriptManifestHash?: string;
      compactionReceipt?: AgentCompactionReceipt;
    }
  | {
      type: "turn-error";
      error: string;
      code?: "context_limit" | "function_call_limit" | "interrupted";
      attemptId?: string;
    };

export function encodeAgentRouteSse(event: AgentRouteStreamEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function readAgentRouteSse(
  stream: ReadableStream<Uint8Array>,
  options: {
    signal?: AbortSignal;
    onEvent: (event: AgentRouteStreamEvent) => void;
  }
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = options.signal?.aborted === true;
  const abortReader = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  if (aborted) {
    abortReader();
  } else {
    options.signal?.addEventListener("abort", abortReader, { once: true });
  }

  try {
    while (true) {
      if (aborted) {
        throw createAbortError();
      }

      const next = await reader.read();
      if (aborted) {
        throw createAbortError();
      }
      if (next.value) {
        buffer += decoder.decode(next.value, { stream: !next.done });
        const parsed = consumeSseFrames(buffer);
        buffer = parsed.remainder;
        parsed.events.forEach((event) => {
          const decoded = decodeAgentRouteEvent(event.data);
          if (decoded) {
            options.onEvent(decoded);
          }
        });
      }

      if (next.done) {
        const parsed = consumeSseFrames(`${buffer}\n\n`);
        parsed.events.forEach((event) => {
          const decoded = decodeAgentRouteEvent(event.data);
          if (decoded) {
            options.onEvent(decoded);
          }
        });
        return;
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}

type ParsedSseFrame = {
  event?: string;
  data: string;
};

function consumeSseFrames(value: string): { events: ParsedSseFrame[]; remainder: string } {
  const events: ParsedSseFrame[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const delimiter = findSseFrameDelimiter(value, cursor);
    if (!delimiter) {
      break;
    }

    const parsed = parseSseFrame(value.slice(cursor, delimiter.start));
    if (parsed) {
      events.push(parsed);
    }
    cursor = delimiter.end;
  }

  return { events, remainder: value.slice(cursor) };
}

function findSseFrameDelimiter(value: string, fromIndex: number): { start: number; end: number } | undefined {
  const crlfIndex = value.indexOf("\r\n\r\n", fromIndex);
  const lfIndex = value.indexOf("\n\n", fromIndex);
  if (crlfIndex < 0 && lfIndex < 0) {
    return undefined;
  }
  if (lfIndex < 0 || (crlfIndex >= 0 && crlfIndex < lfIndex)) {
    return { start: crlfIndex, end: crlfIndex + 4 };
  }
  return { start: lfIndex, end: lfIndex + 2 };
}

function parseSseFrame(frame: string): ParsedSseFrame | undefined {
  const data: string[] = [];
  let event: string | undefined;

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).trimStart() : "";
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  const joined = data.join("\n");
  return joined ? { ...(event ? { event } : {}), data: joined } : undefined;
}

function decodeAgentRouteEvent(value: string): AgentRouteStreamEvent | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isAgentRouteStreamEvent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isAgentRouteStreamEvent(value: unknown): value is AgentRouteStreamEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    AGENT_ROUTE_EVENT_TYPES.has(value.type)
  );
}

const AGENT_ROUTE_EVENT_TYPES = new Set<string>([
  "turn-start",
  "turn-attempt-reset",
  "reasoning-start",
  "reasoning-end",
  "reasoning-delta",
  "commentary-start",
  "commentary-end",
  "final-start",
  "final-end",
  "commentary-delta",
  "final-delta",
  "provider-tool-start",
  "provider-tool-update",
  "provider-tool-end",
  "function-call-ready",
  "citation",
  "usage",
  "context",
  "heartbeat",
  "turn-complete",
  "turn-error"
]);

function createAbortError(): DOMException {
  return new DOMException("The stream was aborted.", "AbortError");
}
