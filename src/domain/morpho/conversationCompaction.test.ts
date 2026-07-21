import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "./workspace";
import {
  applyConversationSummaryRevision,
  buildContinuousConversationContext,
  buildConversationCompactionPlan,
  getUsableConversationMessages,
  migrateLegacyCheckpointToConversationCompaction,
  parseConversationSummaryPayload,
  type ConversationTokenLimits
} from "./conversationCompaction";
import type { AiMessage, ConversationSummary, MorphoWorkspace } from "./types";

const limits: ConversationTokenLimits = {
  windowTokens: 1_000,
  prepareTokens: 240,
  compactTokens: 420,
  targetUncompressedTokens: 90
};

const summary: ConversationSummary = {
  threadGoal: "收敛夜间辅助产品方向",
  establishedContext: ["用户要求保持低眩光和居家语气"],
  decisionsAndReasons: ["保留连续扶持，因为夜间转角不能中断"],
  activeWork: ["继续验证转角节点"],
  unresolvedQuestions: ["安装方式仍待确认"],
  referencedObjects: ["direction-soft-rail"],
  nextTurnAnchor: "从转角节点继续"
};

describe("continuous conversation compaction", () => {
  it("keeps every uncompressed message across lane labels below the prepare threshold", () => {
    const workspace = withMessages([
      message("m1", "user", "最早讨论", "lane-a"),
      message("m2", "assistant", "最早回答", "lane-a"),
      message("m3", "user", "切到另一对象后继续", "lane-b"),
      message("m4", "assistant", "仍属于同一项目会话", "lane-b")
    ]);
    const context = buildContinuousConversationContext({ workspace, limits });

    expect(context.pressure).toBe("normal");
    expect(context.messages.map((entry) => entry.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(context.messages.map((entry) => entry.laneKey)).toEqual(["lane-a", "lane-a", "lane-b", "lane-b"]);
  });

  it("keeps UI-only compaction notices visible but out of model context and summary ranges", () => {
    const workspace = withMessages([
      message("m1", "user", "/compact"),
      message("m2", "assistant", "正在整理上下文"),
      { ...message("m3", "user", "正式问题"), contextVisibility: "model" },
      { ...message("m4", "assistant", "正式回答"), contextVisibility: "model" }
    ]);
    const uiOnlyWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        messages: workspace.ai.messages.map((entry) =>
          entry.id === "m1" || entry.id === "m2" ? { ...entry, contextVisibility: "uiOnly" as const } : entry
        )
      }
    };

    expect(getUsableConversationMessages(uiOnlyWorkspace.ai.messages).map((entry) => entry.id)).toEqual(["m3", "m4"]);
    expect(buildContinuousConversationContext({ workspace: uiOnlyWorkspace, limits }).messages.map((entry) => entry.id)).toEqual([
      "m3",
      "m4"
    ]);
  });

  it("reports prepare pressure without dropping a single raw message", () => {
    const workspace = withMessages(longConversation(4, 20));
    const context = buildContinuousConversationContext({ workspace, limits });

    expect(context.pressure).toBe("prepare");
    expect(context.messages).toHaveLength(8);
    expect(buildConversationCompactionPlan({ workspace, limits })).toBeUndefined();
  });

  it("summarizes the oldest complete range atomically and retains raw history for search", () => {
    const workspace = withMessages(longConversation(8, 90));
    const plan = buildConversationCompactionPlan({ workspace, limits });
    expect(plan).toBeDefined();
    if (!plan) {
      throw new Error("Expected a compaction plan.");
    }
    expect(plan.sourceMessages[0]?.id).toBe("u-1");
    expect(plan.sourceMessages.at(-1)?.role).toBe("assistant");
    expect(plan.remainingMessages.length).toBeGreaterThan(0);

    const applied = applyConversationSummaryRevision(workspace, {
      summary,
      sourceMessageIds: plan.sourceMessages.map((entry) => entry.id),
      expectedPreviousRevisionId: plan.previousSummaryRevision?.id,
      estimatedInputTokens: plan.estimatedInputTokens,
      now: "2026-07-13T12:00:00.000Z"
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") {
      throw new Error(applied.reason);
    }

    expect(
      applied.workspace.ai.messages.map(({ id, role, body }) => ({ id, role, body }))
    ).toEqual(workspace.ai.messages.map(({ id, role, body }) => ({ id, role, body })));
    expect(applied.workspace.ai.messages).toHaveLength(workspace.ai.messages.length);
    expect(applied.workspace.ai.conversationCompaction.coveredThroughMessageId).toBe(plan.sourceEndMessageId);
    const context = buildContinuousConversationContext({ workspace: applied.workspace, limits });
    expect(context.summaryRevision?.summary).toEqual(summary);
    expect(context.messages.map((entry) => entry.id)).toEqual(plan.remainingMessages.map((entry) => entry.id));
  });

  it("chains revisions and rejects stale or non-contiguous writes without mutating state", () => {
    const workspace = withMessages(longConversation(10, 90));
    const firstPlan = buildConversationCompactionPlan({ workspace, limits });
    if (!firstPlan) {
      throw new Error("Expected first plan.");
    }
    const first = applyConversationSummaryRevision(workspace, {
      summary,
      sourceMessageIds: firstPlan.sourceMessages.map((entry) => entry.id),
      now: "2026-07-13T12:00:00.000Z"
    });
    if (first.status !== "applied") {
      throw new Error(first.reason);
    }
    const stale = applyConversationSummaryRevision(first.workspace, {
      summary,
      sourceMessageIds: firstPlan.sourceMessages.map((entry) => entry.id),
      expectedPreviousRevisionId: undefined
    });
    expect(stale).toMatchObject({ status: "skipped", workspace: first.workspace });

    const workspaceWithNewTurns = {
      ...first.workspace,
      ai: {
        ...first.workspace.ai,
        messages: [...first.workspace.ai.messages, ...longConversation(4, 90).map((entry) => ({
          ...entry,
          id: `new-${entry.id}`
        }))]
      }
    };
    const secondPlan = buildConversationCompactionPlan({ workspace: workspaceWithNewTurns, limits, force: "compact" });
    if (!secondPlan) {
      throw new Error("Expected second plan.");
    }
    const second = applyConversationSummaryRevision(workspaceWithNewTurns, {
      summary: { ...summary, activeWork: ["形成第二轮方向预览"] },
      sourceMessageIds: secondPlan.sourceMessages.map((entry) => entry.id),
      expectedPreviousRevisionId: first.revision.id,
      now: "2026-07-13T12:05:00.000Z"
    });
    expect(second.status).toBe("applied");
    if (second.status === "applied") {
      expect(second.revision.previousRevisionId).toBe(first.revision.id);
    }
  });

  it("migrates the newest usable legacy checkpoint once and idempotently", () => {
    const messages = [message("u1", "user", "旧问题"), message("a1", "assistant", "旧回答")];
    const checkpoint: MorphoWorkspace["ai"]["conversationCheckpoints"][number] = {
      id: "legacy-checkpoint",
      laneKey: "lane-old",
      focusArea: "directionAndVisual",
      focusUpdatedAt: "2026-07-10T00:00:00.000Z",
      taskKind: "general",
      anchorObjectIds: [],
      targetDirectionIds: [],
      sourceStartMessageId: "u1",
      sourceEndMessageId: "a1",
      sourceMessageCount: 2,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      threadGoal: "延续旧讨论",
      progress: ["已确认低眩光"],
      openThreads: ["安装方式"]
    };
    const migrated = migrateLegacyCheckpointToConversationCompaction({
      messages,
      checkpoints: [checkpoint],
      state: { coveredMessageCount: 0 },
      revisions: {}
    });
    expect(migrated.state.coveredThroughMessageId).toBe("a1");
    expect(Object.values(migrated.revisions)[0]?.summary.threadGoal).toBe("延续旧讨论");
    expect(
      migrateLegacyCheckpointToConversationCompaction({
        messages,
        checkpoints: [checkpoint],
        state: migrated.state,
        revisions: migrated.revisions
      })
    ).toEqual(migrated);
  });

  it("does not advance the compaction boundary when summary validation fails", () => {
    const workspace = withMessages(longConversation(6, 90));
    const plan = buildConversationCompactionPlan({ workspace, limits });
    if (!plan) {
      throw new Error("Expected a compaction plan.");
    }
    const failed = applyConversationSummaryRevision(workspace, {
      summary: { ...summary, threadGoal: "" },
      sourceMessageIds: plan.sourceMessages.map((entry) => entry.id),
      now: "2026-07-13T12:00:00.000Z"
    });

    expect(failed).toMatchObject({ status: "skipped", workspace });
    expect(failed.workspace.ai.conversationCompaction.coveredMessageCount).toBe(0);
    expect(failed.workspace.ai.conversationSummaryRevisions).toEqual({});
  });

  it("accepts only the bounded structured summary payload", () => {
    const valid = `\`\`\`json\n${JSON.stringify({ morphoConversationSummary: summary })}\n\`\`\``;
    expect(parseConversationSummaryPayload(valid)).toEqual({ status: "ok", summary });
    expect(parseConversationSummaryPayload("普通回答")).toMatchObject({ status: "empty" });
    expect(
      parseConversationSummaryPayload(`\`\`\`json\n${JSON.stringify({ morphoConversationSummary: { ...summary, extra: true } })}\n\`\`\``)
    ).toMatchObject({ status: "failed" });
  });
});

function withMessages(messages: AiMessage[]): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-conversation-test");
  return {
    ...workspace,
    ai: { ...workspace.ai, messages }
  };
}

function message(id: string, role: "user" | "assistant", body: string, laneKey = "lane-a"): AiMessage {
  return {
    id,
    role,
    body,
    createdAt: `2026-07-13T10:${id.replace(/\D/g, "").padStart(2, "0")}:00.000Z`,
    conversationLaneKey: laneKey,
    status: "done"
  };
}

function longConversation(exchangeCount: number, bodyLength: number): AiMessage[] {
  return Array.from({ length: exchangeCount }, (_, index) => [
    message(`u-${index + 1}`, "user", `用户第 ${index + 1} 轮 ${"要".repeat(bodyLength)}`, `lane-${index % 2}`),
    message(`a-${index + 1}`, "assistant", `助手第 ${index + 1} 轮 ${"答".repeat(bodyLength)}`, `lane-${index % 2}`)
  ]).flat();
}
