import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { appendAgentTurnMessages } from "./agentTurnMessages";

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
        conversationLaneKey: "conversation|focus=directionAndVisual|task=general"
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
        agentTrace: {
          startedAt: "2026-07-05T00:00:00.000Z",
          status: "streaming",
          parts: []
        }
      }
    ]);
  });
});
