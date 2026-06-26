import { describe, expect, it } from "vitest";

import { proposalTargetMessage, proposalTypeLabel } from "./ProposalDraftCard";

const workspace = {
  objects: {
    "definition-current": {
      id: "definition-current",
      type: "designDefinition",
      title: "当前设计定义",
      summary: "summary"
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
});
