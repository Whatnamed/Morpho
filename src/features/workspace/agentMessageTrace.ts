import type { AgentMessagePart, AgentTrace, AiMessage, MorphoWorkspace } from "@/domain/morpho/types";
import type {
  AgentProviderDiagnostics,
  AgentRouteStreamEvent
} from "@/shared/agentStreamProtocol";
import { updateAiMessage } from "./aiConversationMessages";

export const AGENT_TRACE_MAX_PARTS = 96;
export const AGENT_TRACE_MAX_TEXT_PART_CHARS = 24_000;
export const AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS = 2_000;

const TRACE_TRUNCATION_PART_ID = "trace-truncation";
const TEXT_TRUNCATION_MARKER = "\n[过程文本已截断]";
const DETAIL_TRUNCATION_MARKER = "\n[活动详情已截断]";
const PARTS_TRUNCATION_MARKER = "部分过程因持久化体积限制已截断。";

export function createAgentTrace(startedAt: string): AgentTrace {
  return {
    startedAt,
    parts: [],
    status: "streaming"
  };
}

export function applyAgentStreamEventToTrace(
  trace: AgentTrace,
  event: AgentRouteStreamEvent,
  now: string
): AgentTrace {
  switch (event.type) {
    case "turn-attempt-reset":
      return resetAgentTraceAttempt(trace, event.attemptId);
    case "reasoning-start":
      return appendTextPart(trace, {
        id: event.partId,
        type: "reasoning",
        text: "",
        state: "streaming",
        createdAt: now,
        attemptId: event.attemptId
      });
    case "reasoning-delta":
      return appendTextDelta(trace, event.partId, "reasoning", event.delta);
    case "reasoning-end":
      return completeTextPart(trace, event.partId, "reasoning");
    case "commentary-start":
      return appendTextPart(trace, {
        id: event.partId,
        type: "commentary",
        text: "",
        state: "streaming",
        createdAt: now,
        attemptId: event.attemptId
      });
    case "commentary-delta":
      return appendTextDelta(trace, event.partId, "commentary", event.delta);
    case "commentary-end":
      return completeTextPart(trace, event.partId, "commentary");
    case "provider-tool-start":
      return upsertToolActivity(trace, {
        id: event.toolCallId,
        type: "toolActivity",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        activityKind: event.activityKind,
        label: event.label,
        detail: event.detail,
        state: "running",
        startedAt: now,
        source: "provider",
        attemptId: event.attemptId
      });
    case "provider-tool-update":
      return updateToolActivity(trace, event.toolCallId, {
        label: event.label,
        detail: event.detail
      });
    case "provider-tool-end":
      return updateToolActivity(trace, event.toolCallId, {
        label: event.label,
        detail: event.detail,
        state: event.state ?? "done",
        completedAt: now
      });
    default:
      return trace;
  }
}

export function startLocalAgentToolActivity(
  trace: AgentTrace,
  input: {
    toolCallId: string;
    toolName: string;
    activityKind: Extract<AgentMessagePart, { type: "toolActivity" }>["activityKind"];
    label: string;
    detail?: string;
  },
  now: string
): AgentTrace {
  return upsertToolActivity(trace, {
    id: input.toolCallId,
    type: "toolActivity",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    activityKind: input.activityKind,
    label: input.label,
    detail: input.detail,
    state: "running",
    startedAt: now,
    source: "local"
  });
}

export function applyAgentStreamEventsToTrace(
  trace: AgentTrace,
  events: AgentRouteStreamEvent[],
  now: string
): AgentTrace {
  return events.reduce((current, event) => applyAgentStreamEventToTrace(current, event, now), trace);
}

export function resetAgentTraceAttempt(trace: AgentTrace, attemptId: string): AgentTrace {
  return {
    ...trace,
    parts: trace.parts.filter((part) => {
      if (part.attemptId !== attemptId) {
        return true;
      }
      if (part.type === "reasoning" || part.type === "commentary") {
        return false;
      }
      return part.source !== "provider" || part.state !== "running";
    })
  };
}

export function finishLocalAgentToolActivity(
  trace: AgentTrace,
  toolCallId: string,
  input: {
    label?: string;
    detail?: string;
    state?: "done" | "failed";
  },
  now: string
): AgentTrace {
  return updateToolActivity(trace, toolCallId, {
    ...input,
    state: input.state ?? "done",
    completedAt: now
  });
}

export function finishAgentToolActivityInWorkspace(
  workspace: MorphoWorkspace,
  messageId: string,
  toolCallId: string,
  state: "done" | "failed",
  detail?: string
): MorphoWorkspace {
  const message = workspace.ai.messages.find((candidate) => candidate.id === messageId);
  if (!message?.agentTrace) {
    return workspace;
  }
  return updateAiMessage(workspace, messageId, message.body, "streaming", {
    agentTrace: finishLocalAgentToolActivity(
      message.agentTrace,
      toolCallId,
      { state, detail },
      new Date().toISOString()
    )
  });
}

export function updateLocalAgentToolActivity(
  trace: AgentTrace,
  toolCallId: string,
  input: { label?: string; detail?: string }
): AgentTrace {
  return updateToolActivity(trace, toolCallId, input);
}

export function completeAgentTrace(
  trace: AgentTrace,
  status: AgentTrace["status"],
  completedAt: string
): AgentTrace {
  return {
    ...trace,
    completedAt,
    status,
    parts: trace.parts.map((part) => {
      if (part.type === "toolActivity" && part.state === "running") {
        return {
          ...part,
          state: status === "failed" ? "failed" : "done",
          ...(status === "cancelled" ? { detail: part.detail ?? "已取消" } : {}),
          completedAt
        };
      }
      if ((part.type === "reasoning" || part.type === "commentary") && part.state === "streaming") {
        return { ...part, state: "done" };
      }
      return part;
    })
  };
}

export function updateMessageAgentTrace(
  message: AiMessage,
  update: (trace: AgentTrace) => AgentTrace
): AiMessage {
  if (!message.agentTrace) {
    return message;
  }
  return {
    ...message,
    agentTrace: update(message.agentTrace)
  };
}

function appendTextPart(
  trace: AgentTrace,
  part: Extract<AgentMessagePart, { type: "reasoning" | "commentary" }>
): AgentTrace {
  if (trace.parts.some((candidate) => candidate.id === part.id)) {
    return trace;
  }
  return appendBoundedPart(trace, {
    ...part,
    text: truncateText(part.text, AGENT_TRACE_MAX_TEXT_PART_CHARS, TEXT_TRUNCATION_MARKER)
  });
}

function appendTextDelta(
  trace: AgentTrace,
  partId: string,
  type: "reasoning" | "commentary",
  delta: string
): AgentTrace {
  return {
    ...trace,
    parts: trace.parts.map((part) =>
      part.id === partId && part.type === type
        ? {
            ...part,
            text: truncateText(
              `${part.text}${delta}`,
              AGENT_TRACE_MAX_TEXT_PART_CHARS,
              TEXT_TRUNCATION_MARKER
            )
          }
        : part
    )
  };
}

function completeTextPart(trace: AgentTrace, partId: string, type: "reasoning" | "commentary"): AgentTrace {
  return {
    ...trace,
    parts: trace.parts.map((part) =>
      part.id === partId && part.type === type ? { ...part, state: "done" } : part
    )
  };
}

function upsertToolActivity(
  trace: AgentTrace,
  next: Extract<AgentMessagePart, { type: "toolActivity" }>
): AgentTrace {
  const boundedNext = {
    ...next,
    ...(next.detail !== undefined
      ? {
          detail: truncateText(
            next.detail,
            AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS,
            DETAIL_TRUNCATION_MARKER
          )
        }
      : {})
  };
  const existing = trace.parts.find((part) => part.type === "toolActivity" && part.toolCallId === next.toolCallId);
  if (!existing) {
    return appendBoundedPart(trace, boundedNext);
  }
  return updateToolActivity(trace, next.toolCallId, boundedNext);
}

function updateToolActivity(
  trace: AgentTrace,
  toolCallId: string,
  patch: Partial<Extract<AgentMessagePart, { type: "toolActivity" }>>
): AgentTrace {
  const boundedPatch = patch.detail === undefined
    ? patch
    : {
        ...patch,
        detail: truncateText(
          patch.detail,
          AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS,
          DETAIL_TRUNCATION_MARKER
        )
      };
  return {
    ...trace,
    parts: trace.parts.map((part) =>
      part.type === "toolActivity" && part.toolCallId === toolCallId ? { ...part, ...boundedPatch } : part
    )
  };
}

function appendBoundedPart(trace: AgentTrace, part: AgentMessagePart): AgentTrace {
  if (trace.parts.length < AGENT_TRACE_MAX_PARTS - 1) {
    return { ...trace, parts: [...trace.parts, part] };
  }
  if (trace.parts.some((candidate) => candidate.id === TRACE_TRUNCATION_PART_ID)) {
    return trace;
  }
  const marker: AgentMessagePart = {
    id: TRACE_TRUNCATION_PART_ID,
    type: "commentary",
    text: PARTS_TRUNCATION_MARKER,
    state: "done",
    createdAt: part.type === "toolActivity" ? part.startedAt : part.createdAt
  };
  return {
    ...trace,
    parts: [...trace.parts.slice(0, AGENT_TRACE_MAX_PARTS - 1), marker]
  };
}

function truncateText(value: string, maxChars: number, marker: string): string {
  if (value.length <= maxChars || value.endsWith(marker)) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}
