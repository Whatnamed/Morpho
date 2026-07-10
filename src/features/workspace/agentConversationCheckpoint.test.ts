import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { applyAgentConversationCheckpointFromReply } from "./agentConversationCheckpoint";

describe("agent conversation checkpoint", () => {
  it("stores a requested checkpoint for the current agent lane and hides its JSON from visible text", () => {
    const laneKey = "conversation|focus=directionAndVisual|task=general|objects=direction-a";
    const workspace = createInitialWorkspace();
    workspace.ai.messages = [
      {
        id: "user-1",
        role: "user",
        body: "继续发展这个浮标方向",
        status: "done",
        taskMode: "chatAnalysis",
        workIntent: "discussion",
        conversationLaneKey: laneKey
      },
      {
        id: "assistant-1",
        role: "assistant",
        body: "可以先稳定轮廓和维护方式。",
        status: "done",
        taskMode: "chatAnalysis",
        workIntent: "discussion",
        conversationLaneKey: laneKey
      }
    ];
    const replyText = [
      "已经整理了下一步。",
      "```json",
      JSON.stringify({
        morphoConversationCheckpoint: {
          threadGoal: "继续收敛高可见浮标的产品方向",
          progress: ["已经确认需要稳定轮廓和高可见性"],
          openThreads: ["仍需确认维护和部署方式"],
          nextTurnAnchor: "下一轮根据新预览图继续调整"
        }
      }),
      "```"
    ].join("\n");

    const result = applyAgentConversationCheckpointFromReply(workspace, {
      laneKey,
      currentFocus: workspace.projectContinuity.currentFocus,
      taskKind: "general",
      anchorObjectIds: ["direction-a"],
      targetDirectionIds: ["direction-a"],
      assistantMessageId: "assistant-1",
      replyText,
      requested: true,
      hasPendingProposal: false,
      now: "2026-07-10T14:00:00.000Z"
    });

    expect(result.status).toBe("applied");
    expect(result.visibleText).toBe("已经整理了下一步。");
    expect(result.workspace.ai.conversationCheckpoints).toHaveLength(1);
    expect(result.workspace.ai.messages.find((message) => message.id === "assistant-1")?.conversationCheckpointId).toBe(
      result.workspace.ai.conversationCheckpoints[0]?.id
    );
  });

  it("does not write an unrequested checkpoint", () => {
    const workspace = createInitialWorkspace();
    const result = applyAgentConversationCheckpointFromReply(workspace, {
      laneKey: "lane-1",
      currentFocus: workspace.projectContinuity.currentFocus,
      taskKind: "general",
      anchorObjectIds: [],
      targetDirectionIds: [],
      assistantMessageId: "missing",
      replyText: "普通回答",
      requested: false,
      hasPendingProposal: false
    });

    expect(result.status).toBe("notRequested");
    expect(result.workspace).toBe(workspace);
    expect(result.visibleText).toBe("普通回答");
  });

  it("advances an existing checkpoint through the final manual assistant message without counting earlier lane history", () => {
    const laneKey = "conversation|focus=directionAndVisual|task=general|objects=direction-a";
    const workspace = createInitialWorkspace();
    workspace.ai.messages = [
      makeMessage("older-0", "user", "比当前 checkpoint 更早的同 lane 历史", laneKey),
      makeMessage("message-1", "user", "开始当前已压缩范围", laneKey),
      makeMessage("message-2", "assistant", "已有 checkpoint 的结束消息", laneKey),
      makeMessage("message-3", "user", "/compact", laneKey),
      makeMessage("message-4", "assistant", "上下文压缩完成。", laneKey)
    ];
    workspace.ai.conversationCheckpoints = [
      {
        id: "checkpoint-existing",
        laneKey,
        focusArea: workspace.projectContinuity.currentFocus.area,
        focusUpdatedAt: workspace.projectContinuity.currentFocus.updatedAt,
        taskKind: "general",
        anchorObjectIds: ["direction-a"],
        targetDirectionIds: ["direction-a"],
        sourceStartMessageId: "message-1",
        sourceEndMessageId: "message-2",
        sourceMessageCount: 2,
        createdAt: "2026-07-10T14:00:00.000Z",
        updatedAt: "2026-07-10T14:00:00.000Z",
        threadGoal: "继续收敛当前概念方向并保持讨论连续",
        progress: ["已经完成此前讨论的整理"],
        openThreads: ["继续吸收后续新增的讨论"]
      }
    ];
    const replyText = [
      "```json",
      JSON.stringify({
        morphoConversationCheckpoint: {
          threadGoal: "继续收敛当前概念方向并保留新增讨论",
          progress: ["此前讨论和手动压缩前的新内容均已整理"],
          openThreads: ["下一轮继续处理尚未解决的问题"]
        }
      }),
      "```"
    ].join("\n");

    const result = applyAgentConversationCheckpointFromReply(workspace, {
      laneKey,
      currentFocus: workspace.projectContinuity.currentFocus,
      taskKind: "general",
      anchorObjectIds: ["direction-a"],
      targetDirectionIds: ["direction-a"],
      assistantMessageId: "message-4",
      replyText,
      requested: true,
      hasPendingProposal: false,
      now: "2026-07-10T15:00:00.000Z"
    });

    expect(result.status).toBe("applied");
    expect(result.workspace.ai.conversationCheckpoints[0]).toMatchObject({
      sourceStartMessageId: "message-1",
      sourceEndMessageId: "message-4",
      sourceMessageCount: 4
    });
  });
});

function makeMessage(
  id: string,
  role: "user" | "assistant",
  body: string,
  laneKey: string
) {
  return {
    id,
    role,
    body,
    status: "done" as const,
    taskMode: "chatAnalysis" as const,
    workIntent: "discussion" as const,
    conversationLaneKey: laneKey
  };
}
