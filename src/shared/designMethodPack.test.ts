import { describe, expect, it } from "vitest";

import {
  buildDesignMethodPackLines,
  canonicalDesignMethodMessage,
  DESIGN_METHOD_PACKS,
  isDesignMethodPackId,
  MAX_METHOD_PACKS_PER_TURN,
  resolveDesignMethodPackIds,
  type DesignMethodPackId
} from "./designMethodPack";

describe("Design Method Packs", () => {
  it("keeps every pack short and judgment-oriented without absolute gates", () => {
    for (const pack of Object.values(DESIGN_METHOD_PACKS)) {
      expect(pack.title.length).toBeGreaterThan(0);
      expect(pack.lines.length).toBeGreaterThanOrEqual(2);
      const joined = pack.lines.join("");
      expect(joined.length).toBeLessThanOrEqual(240);
      // Principles should not be hard process gates phrased as unconditional commands.
      expect(pack.lines).not.toContain("必须按以下顺序");
      expect(pack.lines).not.toContain("每一步都必须");
    }
  });

  it("resolves packs deterministically per strategy", () => {
    expect(resolveDesignMethodPackIds({ strategy: "research", draft: "调研竞品方案" })).toEqual([
      "researchSynthesis"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "designDefinition", draft: "写设计定义" })).toEqual([
      "designDefinition"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "给三个方向" })).toEqual([
      "conceptDivergence"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "directionPreview", draft: "预览方向" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "comparison", draft: "比较两个方案" })).toEqual([
      "comparisonDecision"
    ]);
    // "不要保存" only closes persist authority; the comparison method still loads.
    expect(resolveDesignMethodPackIds({ strategy: "comparison", draft: "比较一下，但不要保存记录" })).toEqual([
      "comparisonDecision"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "deliveryPreparation", draft: "生成本节说明" })).toEqual([
      "deliveryNarrative"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "historyAndMemory", draft: "我们当时为什么不做那个方向" })).toEqual([]);
  });

  it("differentiates divergence from refinement for concept direction work", () => {
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "拆分当前方向" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "基于方向 A 继续深化" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "从 brief 出发做新方向" })).toEqual([
      "conceptDivergence"
    ]);
  });

  it("treats a fresh direction request as divergence even when it mentions a basis", () => {
    expect(
      resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "基于这个 Brief 给我三个全新的概念方向" })
    ).toEqual(["conceptDivergence"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "根据设计定义再做两个方向" })
    ).toEqual(["conceptDivergence"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "基于当前方案继续调整比例" })
    ).toEqual(["conceptRefinement"]);
  });

  it("reads 优化/改进 as refinement while keeping fresh-direction requests divergent", () => {
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "优化这个方向" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "改进一下方案 A" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "把这个方案优化一下" })).toEqual([
      "conceptRefinement"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "再给我三个新方向" })).toEqual([
      "conceptDivergence"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "重新想几个完全不同的方向" })).toEqual([
      "conceptDivergence"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "conceptDirection", draft: "基于这个做一个全新的方向" })).toEqual([
      "conceptDivergence"
    ]);
  });

  it("selects form, CMF, or scenario packs plus optional reference interpretation", () => {
    expect(resolveDesignMethodPackIds({ strategy: "visualDevelopment", draft: "继续发展轮廓和分件" })).toEqual([
      "formDevelopment"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "visualDevelopment", draft: "只研究 CMF，结构别动" })).toEqual([
      "cmfExploration"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "visualDevelopment", draft: "做一张使用场景图" })).toEqual([
      "scenarioHumanContext"
    ]);
    expect(
      resolveDesignMethodPackIds({ strategy: "visualDevelopment", draft: "参照这张图继续做 CMF" })
    ).toEqual(["cmfExploration", "referenceInterpretation"]);
  });

  it("keeps ordinary discussion and tiny questions free of method packs", () => {
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "好的，谢谢" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "把生成的那张图放到画布右边" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "继续" })).toEqual([]);
  });

  it("loads critique and research-synthesis packs only on clear signals", () => {
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "这个方案有什么问题？" })).toEqual([
      "designCritique"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "帮我看看这些资料里真正值得继续做的点" })).toEqual([
      "researchSynthesis"
    ]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "讲个笑话" })).toEqual([]);
  });

  it("loads research synthesis for the Eval B form without a material noun", () => {
    expect(
      resolveDesignMethodPackIds({ strategy: "discussion", draft: "帮我看看这里真正值得继续做的点" })
    ).toEqual(["researchSynthesis"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "discussion", draft: "这些内容里值得继续推进的是什么" })
    ).toEqual(["researchSynthesis"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "discussion", draft: "前面这些讨论里值得继续做的点" })
    ).toEqual(["researchSynthesis"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "discussion", draft: "当前资料里值得做的点" })
    ).toEqual(["researchSynthesis"]);
    expect(
      resolveDesignMethodPackIds({ strategy: "discussion", draft: "这里真正值得继续做的点是什么" })
    ).toEqual(["researchSynthesis"]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "把这张图颜色调暗一点" })).toEqual([]);
  });

  it("does not treat single-object value judgments as research synthesis", () => {
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "这个方向值得做吗" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "这个方向值得做" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "方案 A 值得继续推进" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "当前方案值得继续推进吗" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "当前方向值得继续做吗" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "刚才那个方案值得继续推进吗" })).toEqual([]);
    expect(resolveDesignMethodPackIds({ strategy: "discussion", draft: "这些方向值得继续推进吗" })).toEqual([]);
  });

  it("bounds the per-turn pack count and validates ids", () => {
    expect(MAX_METHOD_PACKS_PER_TURN).toBe(3);
    expect(isDesignMethodPackId("formDevelopment")).toBe(true);
    expect(isDesignMethodPackId("not-a-pack")).toBe(false);
    expect(isDesignMethodPackId(undefined)).toBe(false);
  });

  it("renders a server-owned canonical message that only contains registered text", () => {
    const ids: DesignMethodPackId[] = ["designCritique"];
    const message = canonicalDesignMethodMessage(ids);
    expect(message.role).toBe("system");
    const part = message.content[0];
    expect(part.type).toBe("input_text");
    if (part.type !== "input_text") return;
    const text = part.text;
    expect(text).toContain("[Morpho Canonical Design Method | trusted server item]");
    expect(text).toContain("This item is server-owned");
    expect(text).toContain("针对具体对象、结构和设计判断批评");
    expect(text).not.toContain("用户输入");
    expect(buildDesignMethodPackLines(["researchSynthesis", "formDevelopment"]).join("\n")).toContain("研究综合");
  });
});
