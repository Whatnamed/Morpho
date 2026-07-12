import { describe, expect, it } from "vitest";

import type { AgentTrace } from "@/domain/morpho/types";
import { getAgentTraceRunningMode, getAgentTraceTitle } from "./agentProcessUi";

describe("Agent process title", () => {
  it("uses only currently active parts to distinguish thinking from processing", () => {
    const trace = makeTrace();
    trace.parts.push({
      id: "tool-done",
      type: "toolActivity",
      toolCallId: "tool-done",
      toolName: "search_web_evidence",
      activityKind: "webSearch",
      label: "搜索资料",
      state: "done",
      startedAt: trace.startedAt,
      completedAt: trace.startedAt
    });
    trace.parts.push({
      id: "reasoning-active",
      type: "reasoning",
      text: "继续核对。",
      state: "streaming",
      createdAt: trace.startedAt
    });
    expect(getAgentTraceRunningMode(trace)).toBe("thinking");
    expect(getAgentTraceTitle(trace)).toBe("思考中…");

    trace.parts.push({
      id: "tool-active",
      type: "toolActivity",
      toolCallId: "tool-active",
      toolName: "generate_visuals",
      activityKind: "imageGeneration",
      label: "生成 2 张视觉方向",
      state: "running",
      startedAt: trace.startedAt
    });
    expect(getAgentTraceRunningMode(trace)).toBe("processing");
    expect(getAgentTraceTitle(trace)).toBe("处理中…");
  });

  it("uses thought/tool history and robust durations after completion", () => {
    const thought = makeTrace();
    thought.status = "done";
    thought.completedAt = "2026-07-13T00:01:24.000Z";
    thought.parts.push({
      id: "reasoning",
      type: "reasoning",
      text: "摘要",
      state: "done",
      createdAt: thought.startedAt
    });
    expect(getAgentTraceTitle(thought)).toBe("思考了 1m 24s");

    const toolsOnly = makeTrace();
    toolsOnly.status = "cancelled";
    expect(getAgentTraceTitle(toolsOnly)).toBe("处理了 片刻");
    toolsOnly.completedAt = "2026-07-12T23:59:59.000Z";
    expect(getAgentTraceTitle(toolsOnly)).toBe("处理了 片刻");
  });
});

function makeTrace(): AgentTrace {
  return {
    startedAt: "2026-07-13T00:00:00.000Z",
    status: "streaming",
    parts: []
  };
}
