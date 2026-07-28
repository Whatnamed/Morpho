import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "./workspace";
import { createProviderInputSnapshot } from "./providerInputSnapshot";
import { MORPHO_AGENT_CONTEXT_POLICY } from "./agentContextPolicy";
import { estimateProviderInputTimelineBudget } from "@/shared/providerInputBudget";
import { createAgentTurnOutcomeItem } from "@/shared/agentCompactionProtocol";
import {
  applyConversationSummaryRevision,
  buildConversationSummarySourceText,
  buildContinuousConversationContext,
  buildConversationCompactionPlan,
  classifyConversationPressure,
  estimateConversationMessageTokens,
  estimateConversationSummaryTokens,
  getUsableConversationMessages,
  hashMessageIds,
  migrateLegacyCheckpointToConversationCompaction,
  parseConversationSummaryPayload,
  type ConversationTokenLimits
} from "./conversationCompaction";
import type { AiMessage, ConversationSummary, MorphoWorkspace } from "./types";

const limits: ConversationTokenLimits = {
  windowTokens: 1_000,
  prepareTokens: 240,
  compactTokens: 420,
  targetUncompressedTokens: 90,
  responseReserveTokens: 0,
  prepareItemCount: 800,
  compactItemCount: 880
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
  it("excludes untouched failed turns and uses controlled summaries for partial outcomes", () => {
    const failedUser = {
      ...message("failed-u", "user", "未执行的请求"),
      agentTurnId: "turn-failed",
      pairedMessageId: "failed-a",
      agentTurnOutcome: "failedBeforeExecution" as const
    };
    const failedAssistant = {
      ...message("failed-a", "assistant", "原始错误详情"),
      status: "failed" as const,
      error: "原始错误详情",
      agentTurnId: "turn-failed",
      pairedMessageId: "failed-u",
      agentTurnOutcome: "failedBeforeExecution" as const
    };
    const partialUser = {
      ...message("partial-u", "user", "搜索并更新浮标约束"),
      agentTurnId: "turn-partial",
      pairedMessageId: "partial-a",
      agentTurnOutcome: "partialSuccess" as const
    };
    const partialAssistant = {
      ...message("partial-a", "assistant", "原始流式和工具细节不应重放"),
      agentTurnId: "turn-partial",
      pairedMessageId: "partial-u",
      agentTurnOutcome: "partialSuccess" as const,
      agentTurnOutcomeSummary: "已完成来源搜索；项目写入失败，仍需重试。",
      agentTurnOutcomeItem: createAgentTurnOutcomeItem({
        agentTurnId: "turn-partial",
        userMessageId: "partial-u",
        assistantMessageId: "partial-a",
        outcome: "partialSuccess"
      })
    };

    const usable = getUsableConversationMessages([
      failedUser,
      failedAssistant,
      partialUser,
      partialAssistant
    ]);

    expect(usable.map((entry) => entry.id)).toEqual(["partial-u", "partial-a"]);
    expect(usable[1]?.body).toBe(partialAssistant.agentTurnOutcomeItem.text);
  });

  it("estimates historical image snapshots from stable references rather than pixel reserves", () => {
    const snapshot = createProviderInputSnapshot({
      message: {
        content: [{ type: "input_text", text: "继续分析海洋浮标" }]
      },
      promptContractVersion: "morpho-agent-test",
      attachmentRefs: [
        { objectId: "image-buoy-a", assetId: "asset-a" },
        { objectId: "image-buoy-b", assetId: "asset-b" }
      ]
    });
    const estimated = estimateConversationMessageTokens([
      { role: "user", body: "继续分析海洋浮标", providerInputSnapshot: snapshot }
    ]);

    expect(estimated).toBeLessThan(1_000);
  });

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

  it("uses the real replayed document snapshot for the compact threshold", () => {
    const largeSnapshot = createProviderInputSnapshot({
      message: { content: [{ type: "input_text", text: "原始 Provider 文档" }] },
      promptContractVersion: "morpho-agent-test",
      textParts: [{ kind: "documentExtract", text: `材料资料：${"耐盐雾。".repeat(3_000)}` }]
    });
    const currentSnapshot = createProviderInputSnapshot({
      message: { content: [{ type: "input_text", text: "当前问题" }] },
      promptContractVersion: "morpho-agent-test"
    });
    const workspace = withMessages([
      { ...message("u-1", "user", "短 UI 草稿"), providerInputSnapshot: largeSnapshot },
      message("a-1", "assistant", "旧回答"),
      { ...message("u-2", "user", "当前 UI 草稿"), providerInputSnapshot: currentSnapshot },
      message("a-2", "assistant", "最近回答")
    ]);
    const budget = estimateProviderInputTimelineBudget({
      input: [
        { role: "system", content: [{ type: "input_text", text: "稳定规则" }] },
        { role: "user", content: [{ type: "input_text", text: largeSnapshot.textParts[0]!.text }] },
        { role: "assistant", content: [{ type: "output_text", text: "旧回答" }] },
        { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
      ],
      tools: [],
      responseReserveTokens: 0
    });

    const plan = buildConversationCompactionPlan({ workspace, limits, providerTimelineBudget: budget });
    expect(plan).toBeDefined();
    expect(plan?.estimatedInputTokens).toBe(budget.totalInputTokens);
    expect(plan?.sourceMessages.map((entry) => entry.id)).toEqual(["u-1", "a-1"]);

    const compressedBudget = estimateProviderInputTimelineBudget({
      input: [
        { role: "system", content: [{ type: "input_text", text: "稳定规则" }] },
        { role: "system", content: [{ type: "input_text", text: "Conversation Summary Frame: 耐盐雾约束已保留" }] },
        { role: "user", content: [{ type: "input_text", text: "当前问题" }] }
      ],
      tools: [],
      responseReserveTokens: 0
    });
    expect(compressedBudget.estimatedOccupancyTokens).toBeLessThan(limits.compactTokens);
  });

  it("compacts on projected item count even when the token estimate stays low", () => {
    // Production token thresholds, so the item ceiling is the only binding one.
    const itemLimits: ConversationTokenLimits = {
      ...limits,
      windowTokens: 256_000,
      prepareTokens: 204_800,
      compactTokens: 230_400
    };
    // 450 very short exchanges: far below the token thresholds, but the Provider
    // input item ceiling is the binding constraint.
    const workspace = withMessages(longConversation(225, 1));
    const shortItems = Array.from({ length: 906 }, (_value, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: index % 2 === 0 ? "input_text" : "output_text", text: "短" }]
    }));
    const itemHeavyBudget = estimateProviderInputTimelineBudget({
      input: shortItems,
      tools: [],
      responseReserveTokens: 0
    });

    expect(itemHeavyBudget.estimatedOccupancyTokens).toBeLessThan(itemLimits.compactTokens);
    expect(itemHeavyBudget.projectedInputItemCount).toBeGreaterThanOrEqual(itemLimits.compactItemCount);
    expect(classifyConversationPressure(
      itemHeavyBudget.estimatedOccupancyTokens,
      itemLimits,
      itemHeavyBudget.projectedInputItemCount
    )).toBe("compact");

    const plan = buildConversationCompactionPlan({
      workspace,
      limits: itemLimits,
      providerTimelineBudget: itemHeavyBudget
    });
    expect(plan).toBeDefined();
    expect(plan?.sourceMessages.length).toBeGreaterThan(0);
    // Compaction removes history items, so the next request projects fewer items.
    expect(plan!.remainingMessages.length).toBeLessThan(shortItems.length);
  });

  it("keeps item pressure below the thresholds for an ordinary transcript", () => {
    const ordinary = estimateProviderInputTimelineBudget({
      input: Array.from({ length: 20 }, () => ({
        role: "user",
        content: [{ type: "input_text", text: "短" }]
      })),
      tools: [],
      responseReserveTokens: 0
    });

    expect(classifyConversationPressure(
      ordinary.estimatedOccupancyTokens,
      MORPHO_AGENT_CONTEXT_POLICY,
      ordinary.projectedInputItemCount
    )).toBe("normal");
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

  it("does not count a summary twice when the provider fixed estimate already includes its frame", () => {
    const workspace = withMessages(longConversation(8, 90));
    const plan = buildConversationCompactionPlan({ workspace, limits });
    if (!plan) {
      throw new Error("Expected a compaction plan.");
    }
    const applied = applyConversationSummaryRevision(workspace, {
      summary,
      sourceMessageIds: plan.sourceMessages.map((entry) => entry.id),
      now: "2026-07-13T12:00:00.000Z"
    });
    if (applied.status !== "applied") {
      throw new Error(applied.reason);
    }

    const normal = buildContinuousConversationContext({
      workspace: applied.workspace,
      fixedContextTokenEstimate: 100,
      limits
    });
    const providerFramed = buildContinuousConversationContext({
      workspace: applied.workspace,
      fixedContextTokenEstimate: 100,
      summaryAlreadyIncludedInFixedContext: true,
      limits
    });

    expect(normal.estimatedInputTokens - providerFramed.estimatedInputTokens).toBe(
      estimateConversationSummaryTokens(summary)
    );
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

  it("builds summary source from immutable provider-visible snapshots with bounded documents", () => {
    const snapshot = createProviderInputSnapshot({
      message: {
        content: [{ type: "input_text", text: "发送时正文" }]
      },
      promptContractVersion: "morpho-agent-test",
      textParts: [
        { kind: "userDraft", text: "用户要求浮标外壳必须耐盐雾腐蚀。\n显式选择对象数：8" },
        { kind: "turnContract", text: "本轮界面数量选择：3 个方向。" },
        {
          kind: "documentExtract",
          text: `材料报告：\n${"耐盐雾约束。".repeat(1_000)}`
        },
        { kind: "other", text: "data:image/png;base64,very-secret-pixels" }
      ],
      attachmentRefs: [{ objectId: "image-ocean-buoy", assetId: "asset-buoy" }]
    });
    const source = buildConversationSummarySourceText({
      role: "user",
      body: "简短 UI 草稿，不含耐盐雾约束。",
      providerInputSnapshot: snapshot
    });

    expect(source).toContain("耐盐雾腐蚀");
    expect(source).toContain("这是当时随该回合提供的资料快照");
    expect(source).toContain("image-ocean-buoy");
    expect(source).not.toContain("very-secret-pixels");
    expect(source).not.toContain("显式选择对象数：8");
    expect(source).not.toContain("本轮界面数量选择");
    expect(source).toContain("资料快照按摘要预算截断");
    expect(buildConversationSummarySourceText({ role: "user", body: "没有快照时回退正文" })).toContain("没有快照时回退正文");
    expect(hashMessageIds(["u-1", "a-1"])).toBe(hashMessageIds(["u-1", "a-1"]));
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
