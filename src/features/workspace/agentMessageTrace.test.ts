import { describe, expect, it } from "vitest";

import {
  AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS,
  AGENT_TRACE_MAX_PARTS,
  AGENT_TRACE_MAX_TEXT_PART_CHARS,
  applyAgentStreamEventToTrace,
  completeAgentTrace,
  createAgentTrace,
  finishLocalAgentToolActivity,
  startLocalAgentToolActivity
} from "./agentMessageTrace";

describe("agent message trace", () => {
  it("preserves provider reasoning, commentary, and local tool activities in received order", () => {
    let trace = createAgentTrace("2026-07-13T00:00:00.000Z");
    trace = applyAgentStreamEventToTrace(trace, { type: "reasoning-start", partId: "reasoning-1" }, trace.startedAt);
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-delta", partId: "reasoning-1", delta: "检查资料。" },
      trace.startedAt
    );
    trace = applyAgentStreamEventToTrace(trace, { type: "reasoning-end", partId: "reasoning-1" }, trace.startedAt);
    trace = startLocalAgentToolActivity(
      trace,
      {
        toolCallId: "call-1",
        toolName: "read_selected_context",
        activityKind: "contextRead",
        label: "读取当前选择的对象"
      },
      trace.startedAt
    );
    trace = finishLocalAgentToolActivity(trace, "call-1", { state: "done" }, "2026-07-13T00:00:01.000Z");
    trace = applyAgentStreamEventToTrace(trace, { type: "commentary-start", partId: "commentary-1" }, trace.startedAt);
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "commentary-delta", partId: "commentary-1", delta: "资料足以继续。" },
      trace.startedAt
    );

    expect(trace.parts).toEqual([
      expect.objectContaining({ id: "reasoning-1", type: "reasoning", text: "检查资料。", state: "done" }),
      expect.objectContaining({ toolCallId: "call-1", type: "toolActivity", state: "done" }),
      expect.objectContaining({ id: "commentary-1", type: "commentary", text: "资料足以继续。" })
    ]);
  });

  it("finishes only active parts while retaining failed and completed activity history", () => {
    let trace = createAgentTrace("2026-07-13T00:00:00.000Z");
    trace = startLocalAgentToolActivity(
      trace,
      {
        toolCallId: "call-running",
        toolName: "generate_visuals",
        activityKind: "imageGeneration",
        label: "生成视觉方向"
      },
      trace.startedAt
    );
    const completed = completeAgentTrace(trace, "cancelled", "2026-07-13T00:00:04.000Z");

    expect(completed).toMatchObject({
      status: "cancelled",
      completedAt: "2026-07-13T00:00:04.000Z"
    });
    expect(completed.parts[0]).toMatchObject({ state: "done", completedAt: "2026-07-13T00:00:04.000Z" });
  });

  it("resets only failed-attempt provider increments while preserving completed Morpho work", () => {
    const now = "2026-07-13T00:00:00.000Z";
    let trace = createAgentTrace(now);
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-start", partId: "reasoning-old", attemptId: "attempt-a" },
      now
    );
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-delta", partId: "reasoning-old", delta: "半截推理", attemptId: "attempt-a" },
      now
    );
    trace = applyAgentStreamEventToTrace(
      trace,
      {
        type: "provider-tool-start",
        toolCallId: "provider-running",
        toolName: "web_search",
        activityKind: "webSearch",
        label: "搜索真实查询",
        attemptId: "attempt-a"
      },
      now
    );
    trace = startLocalAgentToolActivity(
      trace,
      {
        toolCallId: "local-complete",
        toolName: "create_research_analysis",
        activityKind: "analysis",
        label: "整理研究与分析"
      },
      now
    );
    trace = finishLocalAgentToolActivity(trace, "local-complete", { state: "done" }, now);
    trace = applyAgentStreamEventToTrace(
      trace,
      {
        type: "turn-attempt-reset",
        attemptId: "attempt-a",
        nextAttemptId: "attempt-b",
        message: "正在重新整理当前语境"
      },
      now
    );
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-start", partId: "reasoning-new", attemptId: "attempt-b" },
      now
    );
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-delta", partId: "reasoning-new", delta: "正确推理", attemptId: "attempt-b" },
      now
    );

    expect(trace.parts).toEqual([
      expect.objectContaining({ id: "local-complete", source: "local", state: "done" }),
      expect.objectContaining({ id: "reasoning-new", attemptId: "attempt-b", text: "正确推理" })
    ]);
  });

  it("bounds persisted trace text, activity detail, and part count without touching the final message body", () => {
    const now = "2026-07-13T00:00:00.000Z";
    let trace = createAgentTrace(now);
    trace = applyAgentStreamEventToTrace(trace, { type: "reasoning-start", partId: "long" }, now);
    trace = applyAgentStreamEventToTrace(
      trace,
      { type: "reasoning-delta", partId: "long", delta: "x".repeat(AGENT_TRACE_MAX_TEXT_PART_CHARS + 500) },
      now
    );
    trace = startLocalAgentToolActivity(
      trace,
      {
        toolCallId: "detail",
        toolName: "read_project_memory",
        activityKind: "contextRead",
        label: "读取项目记忆",
        detail: "d".repeat(AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS + 500)
      },
      now
    );
    for (let index = 0; index < AGENT_TRACE_MAX_PARTS + 20; index += 1) {
      trace = applyAgentStreamEventToTrace(
        trace,
        { type: "commentary-start", partId: `part-${index}` },
        now
      );
    }

    const reasoning = trace.parts.find((part) => part.id === "long");
    const activity = trace.parts.find((part) => part.id === "detail");
    expect(reasoning?.type === "reasoning" ? reasoning.text.length : 0)
      .toBeLessThanOrEqual(AGENT_TRACE_MAX_TEXT_PART_CHARS);
    expect(reasoning?.type === "reasoning" ? reasoning.text : "").toContain("[过程文本已截断]");
    expect(activity?.type === "toolActivity" ? activity.detail?.length : 0)
      .toBeLessThanOrEqual(AGENT_TRACE_MAX_ACTIVITY_DETAIL_CHARS);
    expect(trace.parts).toHaveLength(AGENT_TRACE_MAX_PARTS);
    expect(trace.parts.at(-1)).toMatchObject({ id: "trace-truncation", type: "commentary" });
  });

  it("merges repeated activity events for the same provider call", () => {
    const now = "2026-07-13T00:00:00.000Z";
    let trace = createAgentTrace(now);
    const start = {
      type: "provider-tool-start" as const,
      toolCallId: "same-call",
      toolName: "web_search",
      activityKind: "webSearch" as const,
      label: "检索资料"
    };
    trace = applyAgentStreamEventToTrace(trace, start, now);
    trace = applyAgentStreamEventToTrace(trace, { ...start, detail: "重复开始事件" }, now);

    expect(trace.parts).toHaveLength(1);
    expect(trace.parts[0]).toMatchObject({ toolCallId: "same-call", detail: "重复开始事件" });
  });
});
