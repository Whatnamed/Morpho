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

  it("accepts structured research point objects while preserving title and detail", () => {
    const result = parseResearchAnalysisProposalPayload(`
\`\`\`json
{
  "morphoResearchProposal": {
    "title": "海洋噪声研究",
    "summary": "筛出可用于定义阶段的候选点。",
    "findings": [{ "title": "证据边界", "detail": "现有资料能支持问题重要性，但还不足以证明完整工业产品定义。" }],
    "opportunities": [],
    "constraints": [],
    "openQuestions": [],
    "evidence": []
  }
}
\`\`\`
`);

    expect(result).toMatchObject({
      status: "ok",
      proposal: {
        findings: ["证据边界：现有资料能支持问题重要性，但还不足以证明完整工业产品定义。"]
      }
    });
  });
});
