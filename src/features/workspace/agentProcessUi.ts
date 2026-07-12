import type { AgentTrace } from "@/domain/morpho/types";

export type AgentTraceRunningMode = "thinking" | "processing";

export function getAgentTraceRunningMode(trace: AgentTrace): AgentTraceRunningMode {
  return trace.parts.some((part) => part.type === "toolActivity" && part.state === "running")
    ? "processing"
    : "thinking";
}

export function getAgentTraceTitle(trace: AgentTrace): string {
  if (trace.status === "streaming") {
    return getAgentTraceRunningMode(trace) === "processing" ? "处理中…" : "思考中…";
  }

  const hasThought = trace.parts.some(
    (part) => (part.type === "reasoning" || part.type === "commentary") && part.text.trim().length > 0
  );
  const duration = getAgentTraceDuration(trace);
  return `${hasThought ? "思考了" : "处理了"} ${duration}`;
}

export function hasVisibleAgentTraceParts(trace: AgentTrace): boolean {
  return trace.parts.some((part) => part.type === "toolActivity" || part.text.trim().length > 0);
}

export function getAgentTraceDuration(trace: AgentTrace): string {
  if (!trace.completedAt) {
    return "片刻";
  }
  const startedAt = Date.parse(trace.startedAt);
  const completedAt = Date.parse(trace.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return "片刻";
  }
  return formatAgentTraceDuration(Math.max(1, Math.round((completedAt - startedAt) / 1000)));
}

export function formatAgentTraceDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
