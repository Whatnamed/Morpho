import { describe, expect, it } from "vitest";

import { parseDesignDefinitionProposalPayload } from "./designDefinitionProposal";

describe("Design definition proposal parser", () => {
  it("parses a structured Morpho design definition proposal block", () => {
    const result = parseDesignDefinitionProposalPayload(`
结论说明。

\`\`\`json
{
  "morphoDesignDefinitionProposal": {
    "title": "当前设计定义 v2",
    "summary": "收紧连续支撑边界。",
    "projectGoal": "让夜间路径更可辨认、更可扶持。",
    "targetUsers": ["独居老人"],
    "primaryScenarios": ["床边起身"],
    "coreProblem": "如何让最后几米更可信。",
    "designPrinciples": ["低施工", "连续支撑"],
    "constraints": ["避免医院感"],
    "avoidDirections": ["厚重器械感"],
    "opportunities": ["把触感和导光整合"],
    "openQuestions": ["转角是否需要更强提示？"],
    "changeNote": "收紧边界"
  }
}
\`\`\`
`);

    expect(result).toMatchObject({
      status: "ok",
      proposal: {
        title: "当前设计定义 v2",
        designPrinciples: ["低施工", "连续支撑"],
        changeNote: "收紧边界"
      }
    });
  });
});
