import { describe, expect, it } from "vitest";

import {
  resolveRequiredAgentMemoryUpdates,
  shouldPromptForMemoryUpdate,
  validateAgentMemoryUpdateItems
} from "./agentMemoryUpdateGuard";

describe("Agent memory update guard", () => {
  const draft = "以后统一低饱和，不要高反光，高度必须小于 1.2 米，跌倒求助方式还需确认";

  it("classifies all memory kinds independently in priority order", () => {
    const candidates = resolveRequiredAgentMemoryUpdates(draft);

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "preference",
      "avoidance",
      "constraint",
      "openQuestion"
    ]);
    expect(candidates.map((candidate) => candidate.evidenceQuote)).toEqual([
      "以后统一低饱和",
      "不要高反光",
      "高度必须小于 1.2 米",
      "跌倒求助方式还需确认"
    ]);
  });

  it("accepts valid candidates while keeping an invalid quote retryable", () => {
    const candidates = resolveRequiredAgentMemoryUpdates(draft);
    const result = validateAgentMemoryUpdateItems({
      candidates,
      draft,
      items: [
        { kind: "preference", evidenceQuote: "以后统一低饱和" },
        { kind: "avoidance", evidenceQuote: "不要高反光" },
        { kind: "constraint", evidenceQuote: "高度必须小于 1.2 米" },
        { kind: "openQuestion", evidenceQuote: "不存在的开放问题" }
      ]
    });

    expect(result.accepted).toHaveLength(3);
    expect(result.handledCandidateIndexes).toEqual([0, 1, 2]);
    expect(result.rejected).toEqual([
      { itemIndex: 3, reason: "evidenceQuote 不是当前用户消息中的逐字原文。" }
    ]);
    expect(shouldPromptForMemoryUpdate({
      candidates,
      reminderInserted: false,
      handledCandidateIndexes: new Set(result.handledCandidateIndexes)
    })).toBe(true);
  });

  it("does not require a memory tool call for one-off wording", () => {
    expect(resolveRequiredAgentMemoryUpdates("这次先把浮标外壳改成橙色，先试一下。")).toEqual([]);
    const candidates = resolveRequiredAgentMemoryUpdates(
      "请读取当前项目记忆和阶段信息，再说明海洋浮标项目进展；不要修改项目。"
    );
    expect(candidates).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates(
      "这是一次性执行命令，不要写入长期偏好，也不要修改其他项目对象。"
    )).toEqual([]);
    expect(shouldPromptForMemoryUpdate({
      candidates,
      reminderInserted: false,
      handledCandidateIndexes: new Set()
    })).toBe(false);
  });

  it("keeps stable memory clauses when the same request also has a one-off operation boundary", () => {
    expect(resolveRequiredAgentMemoryUpdates(
      "以后统一低饱和，不要修改其他项目对象。"
    ).map((candidate) => [candidate.kind, candidate.evidenceQuote])).toEqual([
      ["preference", "以后统一低饱和"]
    ]);
  });
});
