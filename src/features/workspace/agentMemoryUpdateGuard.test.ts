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

  it("extracts multiple memory kinds from one punctuation-free clause", () => {
    expect(resolveRequiredAgentMemoryUpdates(
      "后续保持低饱和并且不要高反光且高度不得超过 1.2 米"
    ).map((candidate) => [candidate.kind, candidate.evidenceQuote])).toEqual([
      ["preference", "后续保持低饱和"],
      ["avoidance", "不要高反光"],
      ["constraint", "高度不得超过 1.2 米"]
    ]);
    expect(resolveRequiredAgentMemoryUpdates("这张图先不要高反光")).toEqual([]);
  });

  it("blocks turn-specific image and version instructions without an explicit long-term scope", () => {
    expect(resolveRequiredAgentMemoryUpdates("这张图不要高反光")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这版背景换白色")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次背景用暖光")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这个角度必须保留")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("新生成的图保持低饱和")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次不要用蓝色")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("本轮不要高反光")).toEqual([]);
  });

  it("keeps turn-referencing clauses when the user states an explicit long-term scope", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("这张图不要高反光，以后整个项目都保持低饱和")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "以后整个项目都保持低饱和"]
    ]);
    expect(resolveRequiredAgentMemoryUpdates("这张图的配色以后统一沿用")).not.toEqual([]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次调整后以后都保持低饱和")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "这次调整后以后都保持低饱和"]
    ]);
  });
});
