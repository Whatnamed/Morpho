import { describe, expect, it } from "vitest";

import {
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
});
