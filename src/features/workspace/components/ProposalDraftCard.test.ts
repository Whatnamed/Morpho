import { describe, expect, it } from "vitest";

import { proposalTargetMessage, proposalTypeLabel } from "./ProposalDraftCard";

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
    ).toBe("应用后会创建首版当前设计定义，成为后续方向生成的默认依据。");

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
});
