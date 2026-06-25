import { describe, expect, it } from "vitest";

import { parseConceptDirectionProposalPayload } from "./conceptDirectionProposal";

describe("Concept direction proposal parser", () => {
  it("parses a structured Morpho concept direction proposal block", () => {
    const result = parseConceptDirectionProposalPayload(`
说明文字。

\`\`\`json
{
  "morphoConceptDirectionProposal": {
    "title": "夜航概念方向组",
    "summary": "两条并行方向。",
    "directions": [
      {
        "title": "方向 D",
        "summary": "薄壁带方案。",
        "conceptStatement": "把轨道进一步压薄。",
        "keywords": ["薄壁带"],
        "strategy": "沿用主方向。",
        "differentiators": ["更轻"],
        "visualSignals": ["细窄光带"],
        "risks": ["触感不足"],
        "openQuestions": ["是否削弱支撑可信度？"],
        "basedOnDirectionId": "direction-soft-rail",
        "lineageKind": "splitFromDirection"
      }
    ]
  }
}
\`\`\`
`);

    expect(result).toMatchObject({
      status: "ok",
      proposal: {
        title: "夜航概念方向组",
        directions: [
          {
            title: "方向 D",
            lineageKind: "splitFromDirection"
          }
        ]
      }
    });
  });
});
