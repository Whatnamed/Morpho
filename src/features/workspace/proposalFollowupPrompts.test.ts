import { describe, expect, it } from "vitest";

import {
  buildProposalDiscussionDraft,
  buildProposalRegenerationDraft
} from "./proposalFollowupPrompts";

describe("proposal follow-up prompts", () => {
  it("distinguishes design-definition discussion prompts for create vs revise", () => {
    expect(
      buildProposalDiscussionDraft({
        type: "designDefinition",
        title: "首版定义",
        workIntent: "createDesignDefinition"
      } as never)
    ).toContain("首版设计定义草案");

    expect(
      buildProposalDiscussionDraft({
        type: "designDefinition",
        title: "当前定义 v2",
        workIntent: "reviseDesignDefinition"
      } as never)
    ).toContain("设计定义修订草案");
  });

  it("distinguishes design-definition regeneration prompts for create vs revise", () => {
    expect(
      buildProposalRegenerationDraft({
        type: "designDefinition",
        title: "首版定义",
        workIntent: "createDesignDefinition"
      } as never)
    ).toContain("重新生成一版首版设计定义草案");

    expect(
      buildProposalRegenerationDraft({
        type: "designDefinition",
        title: "当前定义 v2",
        workIntent: "reviseDesignDefinition"
      } as never)
    ).toContain("重新生成一版设计定义修订草案");
  });
});
