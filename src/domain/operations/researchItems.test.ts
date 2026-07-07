import { describe, expect, it } from "vitest";

import { getResearchItemParts, normalizeResearchItem, normalizeResearchItems } from "./researchItems";

describe("researchItems", () => {
  it("removes research packaging while keeping the full atomic point", () => {
    expect(normalizeResearchItem("最稳固的设计判断一：问题真实且重要，且受影响对象可从鲸豚扩展到鱼类、海龟和生态系统功能。")).toBe(
      "问题真实且重要，且受影响对象可从鲸豚扩展到鱼类、海龟和生态系统功能。"
    );

    expect(
      normalizeResearchItem(
        "本地研究已经提供了较强的系统叙事框架：预测高风险海域 → 实时监听/识别 → 输出预警或管理建议 → 减少关键时段与热点区域的声学干扰。"
      )
    ).toBe("预测高风险海域 → 实时监听/识别 → 输出预警或管理建议 → 减少关键时段与热点区域的声学干扰。");
  });

  it("removes conversational transition leads", () => {
    expect(normalizeResearchItem("可以认为：这个方向更适合先做概念验证，而不是直接进入工程细化。")).toBe(
      "这个方向更适合先做概念验证，而不是直接进入工程细化。"
    );
  });

  it("deduplicates and drops empty items after normalization", () => {
    expect(
      normalizeResearchItems([
        "",
        "设计机会一：把监测结果翻译成可执行的避让建议。",
        "把监测结果翻译成可执行的避让建议。"
      ])
    ).toEqual(["把监测结果翻译成可执行的避让建议。"]);
  });

  it("preserves a scannable title and explanation structure", () => {
    expect(normalizeResearchItem("证据边界：现有资料能支持问题重要性，但还不足以证明完整工业产品定义。")).toBe(
      "证据边界：现有资料能支持问题重要性，但还不足以证明完整工业产品定义。"
    );
    expect(getResearchItemParts("证据边界：现有资料能支持问题重要性，但还不足以证明完整工业产品定义。")).toEqual({
      title: "证据边界",
      detail: "现有资料能支持问题重要性，但还不足以证明完整工业产品定义。"
    });
  });

  it("accepts structured point objects from provider output while storing strings", () => {
    expect(
      normalizeResearchItems([
        {
          title: "管理动作",
          detail: "把风险识别结果转译成港航管理可执行的避让、限速或提示。"
        }
      ])
    ).toEqual(["管理动作：把风险识别结果转译成港航管理可执行的避让、限速或提示。"]);
  });
});
