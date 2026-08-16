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
    expect(resolveRequiredAgentMemoryUpdates("这次生成的图不要高反光")).toEqual([]);
  });

  it("treats bare product or dimension nouns as one-off without an explicit project scope", () => {
    expect(resolveRequiredAgentMemoryUpdates("这次产品不要用蓝色")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次尺寸不要改")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次产品图不要高反光")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次预算那段不要写")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次成本不要考虑")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("本轮预算不要写进去")).toEqual([]);
  });

  it("keeps project-level constraints even when they start with a bare turn-scope word", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("这次课设预算不能超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次课设预算不能超过 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("本轮项目产品尺寸必须控制在桌面范围内")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "本轮项目产品尺寸必须控制在桌面范围内"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算不得超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算不得超过 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算不要超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算不要超过 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算别超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算别超过 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("整个项目预算别再超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "整个项目预算别再超过 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("整个项目预算不要超过 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "整个项目预算不要超过 500 元"]
    ]);
  });

  it("lets shared quantitative constraint phrases through the message gate", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算上限 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算上限 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次成本封顶 300 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次成本封顶 300 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算最多 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算最多 500 元"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次成本控制在 300 元以内")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次成本控制在 300 元以内"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("这次预算低于 500 元")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "这次预算低于 500 元"]
    ]);
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

  it("recalls stable preference intent without any long-term scope word", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("我喜欢低饱和配色。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "我喜欢低饱和配色"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("默认用暖灰色。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "默认用暖灰色"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("我偏好哑光材质。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "我偏好哑光材质"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("以后所有方向都不要高反光。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["avoidance", "以后所有方向都不要高反光"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("以后这类主图都不要高反光。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["avoidance", "以后这类主图都不要高反光"]
    ]);
  });

  it("does not let bare 统一/稳定 or one-off preference wording bypass the one-off guard", () => {
    expect(resolveRequiredAgentMemoryUpdates("这张图统一一下配色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这张图颜色改成蓝色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这版保持哑光。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次产品不要用蓝色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次尺寸不要改。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次产品图不要高反光。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("本轮配色先别用蓝色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次预算那段不要写。")).toEqual([]);
  });

  it("keeps only the legal clause from a mixed one-off + project-constraint message", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("这次先把背景换白色；预算不能超过 500 元。")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "预算不能超过 500 元"]
    ]);
  });

  it("does not turn ordinary design discussion into memory candidates", () => {
    expect(resolveRequiredAgentMemoryUpdates("这个材质怎么样？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("颜色换哪个更好？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这个尺寸合适吗？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("高度大概多少比较合适？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("我想看看不同风格")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("怎么保持结构稳定？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这个方案的约束是什么？")).toEqual([]);
  });

  it("treats scope words, preference queries and threshold questions as non-declarations", () => {
    // Scope word alone is not a preference declaration.
    expect(resolveRequiredAgentMemoryUpdates("后续怎么做？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("以后这个方向怎么发展？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("长期来看还有什么风险？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("后续还有哪些方案？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("始终是什么意思？")).toEqual([]);
    // Preference queries read state or ask opinions, they do not declare.
    expect(resolveRequiredAgentMemoryUpdates("默认方案是什么？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("默认参考是哪张？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("你说的偏好是什么？")).toEqual([]);
    // Threshold questions are not rule statements.
    expect(resolveRequiredAgentMemoryUpdates("高度低于多少合适？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("尺寸小于 200 会怎么样？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("重量高于多少会有问题？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("预算低于多少才合理？")).toEqual([]);
    // Structured-state commands are handled by real workspace state, not memory.
    expect(resolveRequiredAgentMemoryUpdates("默认参考改成这张。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("把这张设为默认参考。")).toEqual([]);
  });

  it("rejects temporary avoidance and avoidance questions", () => {
    expect(resolveRequiredAgentMemoryUpdates("先别用蓝色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("先不要高反光。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("暂时不要蓝色。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("暂且不用镜面材质。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这轮先别改结构。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这次先不要加文字。")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("哪些颜色不要用？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("是不是不要高反光？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这个是不是应该避免？")).toEqual([]);
  });

  it("rejects open-question queries while keeping unresolved declarations", () => {
    expect(resolveRequiredAgentMemoryUpdates("有哪些待确认问题？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("现在还有什么未解决？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("这个还需要确认吗？")).toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("哪些地方尚不确定？")).toEqual([]);
    expect(
      resolveRequiredAgentMemoryUpdates("是否支持单手操作还需确认")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["openQuestion", "是否支持单手操作还需确认"]
    ]);
  });

  it("keeps high-confidence normative constraints and explicit preference stance", () => {
    expect(
      resolveRequiredAgentMemoryUpdates("尺寸必须小于 200 mm")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "尺寸必须小于 200 mm"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("记住这个尺寸")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["constraint", "记住这个尺寸"]
    ]);
    expect(
      resolveRequiredAgentMemoryUpdates("希望保持哑光材质")
        .map((candidate) => [candidate.kind, candidate.evidenceQuote])
    ).toEqual([
      ["preference", "希望保持哑光材质"]
    ]);
    expect(resolveRequiredAgentMemoryUpdates("我喜欢低饱和配色")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("默认用暖灰色")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("我偏好哑光材质")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("预算不能超过 500 元")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("以后都用低饱和配色")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("后续保持低饱和")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("高度不得超过 1.2 米")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("成本上限 300 元")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("重量控制在 2 kg 内")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("不要高反光")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("避免医疗器械感")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("不使用镜面金属")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("以后所有方向都不要高反光")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("跌倒求助方式还需确认")).not.toEqual([]);
    expect(resolveRequiredAgentMemoryUpdates("材料耐候性尚不确定")).not.toEqual([]);
  });
});
