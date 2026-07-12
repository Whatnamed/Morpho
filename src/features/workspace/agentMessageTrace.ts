import type { AgentMessagePart, AgentTrace, AiMessage } from "@/domain/morpho/types";
import type { AgentRouteStreamEvent } from "@/shared/agentStreamProtocol";

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
    case "reasoning-start":
      return appendTextPart(trace, {
        id: event.partId,
        type: "reasoning",
        text: "",
        state: "streaming",
        createdAt: now
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
        createdAt: now
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
        startedAt: now
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
    startedAt: now
  });
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
  return { ...trace, parts: [...trace.parts, part] };
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
      part.id === partId && part.type === type ? { ...part, text: `${part.text}${delta}` } : part
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
  const existing = trace.parts.find((part) => part.type === "toolActivity" && part.toolCallId === next.toolCallId);
  if (!existing) {
    return { ...trace, parts: [...trace.parts, next] };
  }
  return updateToolActivity(trace, next.toolCallId, next);
}

function updateToolActivity(
  trace: AgentTrace,
  toolCallId: string,
  patch: Partial<Extract<AgentMessagePart, { type: "toolActivity" }>>
): AgentTrace {
  return {
    ...trace,
    parts: trace.parts.map((part) =>
      part.type === "toolActivity" && part.toolCallId === toolCallId ? { ...part, ...patch } : part
    )
  };
}
