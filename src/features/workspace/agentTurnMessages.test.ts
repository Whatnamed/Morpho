import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { getUsableConversationMessages } from "@/domain/morpho/conversationCompaction";
import {
  appendAgentTurnMessages,
  finalizeAgentTurn,
  finalizeAgentTurnOutcome
} from "./agentTurnMessages";

describe("agent turn messages", () => {
  it("keeps the user draft and assistant placeholder in the workspace used for later agent writeback", () => {
    const workspace = createInitialWorkspace();
    const next = appendAgentTurnMessages(workspace, {
      userMessageId: "user-agent-turn",
      assistantMessageId: "assistant-agent-turn",
      userBody: "继续分析这个方向",
      assistantBody: "",
      createdAt: "2026-07-05T00:00:00.000Z",
      contextObjectIds: ["direction-soft-rail"],
      conversationLaneKey: "conversation|focus=directionAndVisual|task=general",
      workIntent: "discussion",
      agentTurnId: "agent-turn-a",
      agentTrace: {
        startedAt: "2026-07-05T00:00:00.000Z",
        status: "streaming",
        parts: []
      }
    });

    expect(workspace.ai.messages.some((message) => message.id === "user-agent-turn")).toBe(false);
    expect(next.ai.messages.slice(-2)).toMatchObject([
      {
        id: "user-agent-turn",
        role: "user",
        body: "继续分析这个方向",
        contextObjectIds: ["direction-soft-rail"],
        taskMode: "chatAnalysis",
        workIntent: "discussion",
        conversationLaneKey: "conversation|focus=directionAndVisual|task=general",
        agentTurnId: "agent-turn-a",
        pairedMessageId: "assistant-agent-turn"
      },
      {
        id: "assistant-agent-turn",
        role: "assistant",
        body: "",
        status: "streaming",
        contextObjectIds: ["direction-soft-rail"],
        taskMode: "chatAnalysis",
        workIntent: "discussion",
        conversationLaneKey: "conversation|focus=directionAndVisual|task=general",
        agentTurnId: "agent-turn-a",
        pairedMessageId: "user-agent-turn",
        agentTrace: {
          startedAt: "2026-07-05T00:00:00.000Z",
          status: "streaming",
          parts: []
        }
      }
    ]);

    const finalized = finalizeAgentTurnOutcome(next, {
      agentTurnId: "agent-turn-a",
      userMessageId: "user-agent-turn",
      assistantMessageId: "assistant-agent-turn",
      outcome: "failedBeforeExecution",
      summary: "Provider 请求未执行。"
    });
    expect(finalized.ai.messages.slice(-2)).toMatchObject([
      { agentTurnOutcome: "failedBeforeExecution", pairedMessageId: "assistant-agent-turn" },
      { agentTurnOutcome: "failedBeforeExecution", pairedMessageId: "user-agent-turn" }
    ]);
  });

  it.each([
    ["failedBeforeExecution", "failed"],
    ["cancelledBeforeExecution", "cancelled"]
  ] as const)("finalizes %s once and removes the whole pair from usable context", (outcome, status) => {
    const workspace = appendAgentTurnMessages(createInitialWorkspace(), {
      userMessageId: `user-${outcome}`,
      assistantMessageId: `assistant-${outcome}`,
      userBody: "继续海洋浮标",
      assistantBody: "",
      createdAt: "2026-07-25T00:00:00.000Z",
      contextObjectIds: [],
      conversationLaneKey: "conversation|project=ocean-buoy",
      workIntent: "discussion",
      agentTurnId: `turn-${outcome}`,
      agentTrace: {
        startedAt: "2026-07-25T00:00:00.000Z",
        status: "streaming",
        parts: []
      }
    });
    const finalized = finalizeAgentTurn(workspace, {
      agentTurnId: `turn-${outcome}`,
      userMessageId: `user-${outcome}`,
      assistantMessageId: `assistant-${outcome}`,
      outcome,
      assistantBody: "本轮没有完成。",
      assistantStatus: status,
      traceStatus: status,
      summary: "本轮没有形成有效完成上下文。",
      completedAt: "2026-07-25T00:01:00.000Z"
    });
    const finalizedAgain = finalizeAgentTurn(finalized, {
      agentTurnId: `turn-${outcome}`,
      userMessageId: `user-${outcome}`,
      assistantMessageId: `assistant-${outcome}`,
      outcome,
      assistantBody: "不应覆盖第一次终态",
      assistantStatus: status,
      traceStatus: status,
      summary: "不应覆盖第一次终态",
      completedAt: "2026-07-25T00:02:00.000Z"
    });

    expect(finalizedAgain).toEqual(finalized);
    expect(getUsableConversationMessages(finalized.ai.messages).filter(
      (message) => message.agentTurnId === `turn-${outcome}`
    )).toEqual([]);
    expect(finalized.ai.messages.at(-1)).toMatchObject({
      body: "本轮没有完成。",
      status,
      agentTurnOutcome: outcome,
      agentTrace: {
        status,
        completedAt: "2026-07-25T00:01:00.000Z"
      }
    });
  });

  it.each([
    ["partialSuccess", "已完成读取，但写入失败。"],
    ["pendingConfirmation", "已准备确认，尚未执行。"]
  ] as const)("keeps only a bounded %s outcome summary in usable context", (outcome, summary) => {
    const workspace = appendAgentTurnMessages(createInitialWorkspace(), {
      userMessageId: `user-${outcome}`,
      assistantMessageId: `assistant-${outcome}`,
      userBody: "处理海洋浮标资料",
      assistantBody: "",
      createdAt: "2026-07-25T00:00:00.000Z",
      contextObjectIds: [],
      conversationLaneKey: "conversation|project=ocean-buoy",
      workIntent: "discussion",
      agentTurnId: `turn-${outcome}`
    });
    const finalized = finalizeAgentTurn(workspace, {
      agentTurnId: `turn-${outcome}`,
      userMessageId: `user-${outcome}`,
      assistantMessageId: `assistant-${outcome}`,
      outcome,
      assistantBody: "很长的过程正文不应在后续上下文中替代终态摘要。",
      assistantStatus: "done",
      traceStatus: "done",
      summary,
      completedAt: "2026-07-25T00:01:00.000Z"
    });

    expect(getUsableConversationMessages(finalized.ai.messages)
      .filter((message) => message.agentTurnId === `turn-${outcome}`)
      .map((message) => message.body)).toEqual([
      "处理海洋浮标资料",
      summary
    ]);
  });
});
