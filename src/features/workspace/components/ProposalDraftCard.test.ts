import { describe, expect, it } from "vitest";

import { formatProposalForClipboard, proposalTargetMessage, proposalTypeLabel } from "./ProposalDraftCard";

const workspace = {
  objects: {
    "definition-current": {
      id: "definition-current",
      type: "designDefinition",
      title: "当前设计定义",
      summary: "summary"
    },
    "direction-a": {
      id: "direction-a",
      type: "conceptDirection",
      title: "方向 A",
      summary: "summary",
      currentRevisionId: "direction-a-r1"
    },
    "direction-b": {
      id: "direction-b",
      type: "conceptDirection",
      title: "方向 B",
      summary: "summary",
      currentRevisionId: "direction-b-r1"
    }
  }
} as never;

describe("ProposalDraftCard labels", () => {
  it("distinguishes create vs revise design-definition proposal labels", () => {
    expect(
      proposalTypeLabel({
        type: "designDefinition",
        workIntent: "createDesignDefinition"
      } as never)
    ).toBe("设计定义草案");

    expect(
      proposalTypeLabel({
        type: "designDefinition",
        workIntent: "reviseDesignDefinition"
      } as never)
    ).toBe("设计定义修订草案");
  });

  it("describes the application target for create vs revise design-definition proposals", () => {
    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "designDefinition",
          workIntent: "createDesignDefinition"
        } as never
      )
    ).toBe("应用后会把这张草案作为独立设计定义并设为当前；原有定义会保留为非当前定义。");

    expect(
      proposalTargetMessage(
        { objects: {} } as never,
        {
          type: "designDefinition",
          workIntent: "createDesignDefinition"
        } as never
      )
    ).toBe("应用后会创建首个当前设计定义，成为后续方向生成的默认依据。");

    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "designDefinition",
          workIntent: "reviseDesignDefinition",
          basedOnDesignDefinitionId: "definition-current"
        } as never
      )
    ).toContain("当前设计定义");
  });

  it("describes the concrete application target for concept direction proposal modes", () => {
    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "conceptDirection",
          applicationMode: "create"
        } as never
      )
    ).toBe("本次操作：新建方向。应用后会创建新的概念方向，不会自动设为主方向。");

    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "conceptDirection",
          applicationMode: "revise",
          targetDirectionId: "direction-a"
        } as never
      )
    ).toBe("本次操作：修订方向。修订目标：方向 A（当前修订 direction-a-r1）。");

    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "conceptDirection",
          applicationMode: "split",
          parentDirectionIds: ["direction-a"]
        } as never
      )
    ).toBe("本次操作：拆分方向。拆分来源：方向 A。");

    expect(
      proposalTargetMessage(
        workspace,
        {
          type: "conceptDirection",
          applicationMode: "merge",
          parentDirectionIds: ["direction-a", "direction-b"]
        } as never
      )
    ).toBe("本次操作：合并方向。合并来源：方向 A、方向 B。");
  });

  it("serializes proposal values for reliable copy from the detail dialog", () => {
    const text = formatProposalForClipboard({
      type: "designDefinition",
      title: "海洋噪音浮标课设",
      summary: "形成三个可继续筛选的设计定义草案。",
      projectGoal: "帮助海上活动更早识别风险。",
      coreProblem: "低频噪音影响生态保护判断。",
      targetUsers: ["海洋生态保护机构"],
      primaryScenarios: ["热点海域浮标节点"],
      designPrinciples: ["风险地图优先"],
      constraints: ["不能只围绕旗舰物种"],
      avoidDirections: ["单一物种装置"],
      opportunities: ["分级响应输出"],
      openQuestions: ["固定热点还是移动浮标？"],
      workIntent: "createDesignDefinition"
    } as never);

    expect(text).toContain("海洋噪音浮标课设");
    expect(text).toContain("项目目标：帮助海上活动更早识别风险。");
    expect(text).toContain("- 海洋生态保护机构");
    expect(text).toContain("- 固定热点还是移动浮标？");
  });
});
