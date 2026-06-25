import type { ResearchEvidence } from "./types";

export type ParsedResearchAnalysisProposal = {
  title: string;
  summary: string;
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  evidence: Array<{
    claim: string;
    sourceObjectIds: string[];
    citationUrls: string[];
    confidence: ResearchEvidence["confidence"];
  }>;
};

export type ParseResearchProposalResult =
  | {
      status: "ok";
      proposal: ParsedResearchAnalysisProposal;
    }
  | {
      status: "failed";
      reason: string;
    };

export function parseResearchAnalysisProposalPayload(text: string): ParseResearchProposalResult {
  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    return { status: "failed", reason: "No structured Morpho research proposal JSON block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The Morpho research proposal JSON block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoResearchProposal)) {
    return { status: "failed", reason: "The JSON block did not contain morphoResearchProposal." };
  }

  const proposal = parsed.morphoResearchProposal;
  const title = stringValue(proposal.title);
  const summary = stringValue(proposal.summary);
  const findings = stringArray(proposal.findings);
  const opportunities = stringArray(proposal.opportunities);
  const constraints = stringArray(proposal.constraints);
  const openQuestions = stringArray(proposal.openQuestions);
  const evidence = parseEvidence(proposal.evidence);

  if (!title || !summary || findings.length === 0) {
    return { status: "failed", reason: "The structured proposal was missing title, summary, or findings." };
  }

  return {
    status: "ok",
    proposal: {
      title,
      summary,
      findings,
      opportunities,
      constraints,
      openQuestions,
      evidence
    }
  };
}

function extractJsonBlock(text: string): string | undefined {
  const fencedBlocks = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean);
  return fencedBlocks.find((block) => {
    if (!block) {
      return false;
    }

    try {
      const parsed = JSON.parse(block) as unknown;
      return isRecord(parsed) && isRecord(parsed.morphoResearchProposal);
    } catch {
      return false;
    }
  });
}

function parseEvidence(value: unknown): ParsedResearchAnalysisProposal["evidence"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      claim: stringValue(item.claim),
      sourceObjectIds: stringArray(item.sourceObjectIds),
      citationUrls: stringArray(item.citationUrls),
      confidence: parseConfidence(item.confidence)
    }))
    .filter((item) => item.claim);
}

function parseConfidence(value: unknown): ResearchEvidence["confidence"] {
  return value === "supported" || value === "partial" || value === "needsVerification" ? value : "needsVerification";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
