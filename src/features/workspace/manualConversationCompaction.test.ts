import { describe, expect, it } from "vitest";

import {
  buildManualConversationCompactionPlan,
  executeManualConversationCompactionPlan,
  getManualCompactionStatusText,
  parseManualCompactCommand
} from "./manualConversationCompaction";
import type { AiMessage, ConversationCheckpoint } from "@/domain/morpho/types";

describe("manual conversation compaction", () => {
  it("recognizes the Codex-style /compact command without treating ordinary text as a command", () => {
    expect(parseManualCompactCommand("/compact")).toEqual({ matched: true });
    expect(parseManualCompactCommand("  /COMPACT  ")).toEqual({ matched: true });
    expect(parseManualCompactCommand("/compact please")).toEqual({ matched: false });
    expect(parseManualCompactCommand("请帮我 compact 一下")).toEqual({ matched: false });
  });

  it("uses explicit visible progress text for manual compaction", () => {
    expect(getManualCompactionStatusText("running")).toBe("正在压缩当前上下文…");
    expect(getManualCompactionStatusText("completed")).toContain("上下文压缩完成");
    expect(getManualCompactionStatusText("notNeeded")).toContain("无需压缩");
    expect(getManualCompactionStatusText("failed")).toContain("上下文压缩未完成");
  });

  it("plans every eligible message in the current lane after the existing checkpoint", () => {
    const laneKey = "lane-current";
    const messages: AiMessage[] = [
      ...Array.from({ length: 10 }, (_, index): AiMessage => ({
        id: `current-${index + 1}`,
        role: index % 2 === 0 ? "user" : "assistant",
        body: `当前讨论第 ${index + 1} 条：${"内容".repeat(20)}`,
        status: "done",
        taskMode: "chatAnalysis",
        conversationLaneKey: laneKey
      })),
      {
        id: "other-1",
        role: "user",
        body: "另一个 lane 的内容不应参与压缩",
        status: "done",
        taskMode: "chatAnalysis",
        conversationLaneKey: "lane-other"
      }
    ];
    const checkpoint = makeCheckpoint({
      laneKey,
      sourceStartMessageId: "current-1",
      sourceEndMessageId: "current-4",
      sourceMessageCount: 4
    });

    const plan = buildManualConversationCompactionPlan({
      messages,
      laneKey,
      checkpoint,
      maxChunkTokens: 80
    });

    expect(plan.sourceMessageIds).toEqual([
      "current-5",
      "current-6",
      "current-7",
      "current-8",
      "current-9",
      "current-10"
    ]);
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.flatMap((chunk) => chunk.messages).map((message) => message.body).join("")).toContain(
      "当前讨论第 5 条"
    );
    expect(JSON.stringify(plan)).not.toContain("另一个 lane");
  });

  it("uses legacy unkeyed chat history only when the current lane has no keyed history", () => {
    const legacyMessages: AiMessage[] = [
      {
        id: "legacy-user",
        role: "user",
        body: "升级前留下的用户讨论",
        status: "done",
        taskMode: "chatAnalysis"
      },
      {
        id: "legacy-assistant",
        role: "assistant",
        body: "升级前留下的助手回复",
        status: "done",
        taskMode: "chatAnalysis"
      }
    ];

    const fallbackPlan = buildManualConversationCompactionPlan({
      messages: legacyMessages,
      laneKey: "lane-current"
    });
    const keyedPlan = buildManualConversationCompactionPlan({
      messages: [
        ...legacyMessages,
        {
          id: "current-user",
          role: "user",
          body: "当前 lane 的新讨论",
          status: "done",
          taskMode: "chatAnalysis",
          conversationLaneKey: "lane-current"
        }
      ],
      laneKey: "lane-current"
    });

    expect(fallbackPlan.sourceMessageIds).toEqual(["legacy-user", "legacy-assistant"]);
    expect(keyedPlan.sourceMessageIds).toEqual(["current-user"]);
  });

  it("rolls the generated checkpoint through every chunk before reporting completion", async () => {
    const initialCheckpoint = makeCheckpoint({
      laneKey: "lane-current",
      sourceStartMessageId: "message-1",
      sourceEndMessageId: "message-2",
      sourceMessageCount: 2
    });
    const plan = buildManualConversationCompactionPlan({
      messages: Array.from({ length: 8 }, (_, index): AiMessage => ({
        id: `message-${index + 3}`,
        role: index % 2 === 0 ? "user" : "assistant",
        body: `需要滚动压缩的第 ${index + 1} 段 ${"长内容".repeat(30)}`,
        status: "done",
        taskMode: "chatAnalysis",
        conversationLaneKey: "lane-current"
      })),
      laneKey: "lane-current",
      checkpoint: initialCheckpoint,
      maxChunkTokens: 70
    });
    const checkpointsSeen: Array<string | undefined> = [];

    const result = await executeManualConversationCompactionPlan(plan, {
      initialCheckpoint,
      compactChunk: async ({ checkpoint, chunkIndex }) => {
        checkpointsSeen.push(checkpoint?.threadGoal);
        return {
          rawReply: `chunk-${chunkIndex}`,
          checkpoint: {
            threadGoal: `滚动压缩后的讨论目标 ${chunkIndex + 1}`,
            progress: [`已经覆盖第 ${chunkIndex + 1} 个上下文分块`],
            openThreads: ["继续处理尚未覆盖的后续讨论"]
          }
        };
      }
    });

    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(result.status).toBe("completed");
    expect(result.processedChunkCount).toBe(plan.chunks.length);
    expect(checkpointsSeen[0]).toBe(initialCheckpoint.threadGoal);
    expect(checkpointsSeen[1]).toBe("滚动压缩后的讨论目标 1");
    if (result.status === "completed") {
      expect(result.rawReply).toBe(`chunk-${plan.chunks.length - 1}`);
      expect(result.checkpoint.threadGoal).toBe(`滚动压缩后的讨论目标 ${plan.chunks.length}`);
    }
  });

  it("does not expose a partial checkpoint when a later chunk fails", async () => {
    const initialCheckpoint = makeCheckpoint({
      laneKey: "lane-current",
      sourceStartMessageId: "message-1",
      sourceEndMessageId: "message-2",
      sourceMessageCount: 2
    });
    const plan = buildManualConversationCompactionPlan({
      messages: Array.from({ length: 6 }, (_, index): AiMessage => ({
        id: `message-${index + 3}`,
        role: index % 2 === 0 ? "user" : "assistant",
        body: `失败测试内容 ${index + 1} ${"文本".repeat(35)}`,
        status: "done",
        taskMode: "chatAnalysis",
        conversationLaneKey: "lane-current"
      })),
      laneKey: "lane-current",
      checkpoint: initialCheckpoint,
      maxChunkTokens: 70
    });

    const result = await executeManualConversationCompactionPlan(plan, {
      initialCheckpoint,
      compactChunk: async ({ chunkIndex }) => {
        if (chunkIndex === 1) {
          throw new Error("第二块失败");
        }
        return {
          rawReply: "chunk-0",
          checkpoint: {
            threadGoal: "不应写入的部分压缩结果",
            progress: ["只处理了第一个上下文分块"],
            openThreads: ["后续分块尚未完成处理"]
          }
        };
      }
    });

    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(result).toMatchObject({
      status: "failed",
      processedChunkCount: 1,
      retainedCheckpoint: initialCheckpoint
    });
  });
});

function makeCheckpoint(
  overrides: Partial<ConversationCheckpoint> & Pick<ConversationCheckpoint, "laneKey">
): ConversationCheckpoint {
  return {
    id: "checkpoint-current",
    focusArea: "directionAndVisual",
    focusUpdatedAt: "2026-07-10T00:00:00.000Z",
    taskKind: "general",
    anchorObjectIds: [],
    targetDirectionIds: [],
    sourceStartMessageId: "message-1",
    sourceEndMessageId: "message-2",
    sourceMessageCount: 2,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    threadGoal: "继续当前讨论并保留已有结论",
    progress: ["已经形成可继续推进的局部结论"],
    openThreads: ["仍需处理后续尚未完成的讨论"],
    ...overrides
  };
}
