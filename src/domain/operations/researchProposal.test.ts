import { describe, expect, it } from "vitest";

import { parseResearchAnalysisProposalPayload } from "./researchProposal";

describe("ResearchAnalysisProposal structured parsing", () => {
  it("accepts a strict Morpho research proposal JSON block", () => {
    const result = parseResearchAnalysisProposalPayload(`
普通回答。

\`\`\`json
{
  "morphoResearchProposal": {
    "title": "Night path research",
    "summary": "A short summary.",
    "findings": ["Finding A"],
    "opportunities": ["Opportunity A"],
    "constraints": ["Constraint A"],
    "openQuestions": ["Question A"],
    "evidence": [
      {
        "claim": "Finding A",
        "sourceObjectIds": ["text-a"],
        "citationUrls": ["https://example.com/source"],
        "confidence": "partial"
      }
    ]
  }
}
\`\`\`
`);

    expect(result).toEqual({
      status: "ok",
      proposal: {
        title: "Night path research",
        summary: "A short summary.",
        findings: ["Finding A"],
        opportunities: ["Opportunity A"],
        constraints: ["Constraint A"],
        openQuestions: ["Question A"],
        evidence: [
          {
            claim: "Finding A",
            sourceObjectIds: ["text-a"],
            citationUrls: ["https://example.com/source"],
            confidence: "partial"
          }
        ]
      }
    });
  });

  it("rejects ordinary model text instead of guessing a half proposal", () => {
    expect(parseResearchAnalysisProposalPayload("Finding A\nFinding B")).toMatchObject({
      status: "failed"
    });
  });
});
