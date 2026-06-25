export type ParsedConceptDirectionDraft = {
  title: string;
  summary: string;
  conceptStatement: string;
  keywords: string[];
  strategy: string;
  differentiators: string[];
  visualSignals: string[];
  risks: string[];
  openQuestions: string[];
  basedOnDirectionId?: string;
  lineageKind?: "derivedFromDirection" | "splitFromDirection" | "mergedFromDirection" | "supersedesDirection";
};

export type ParsedConceptDirectionProposal = {
  title: string;
  summary: string;
  directions: ParsedConceptDirectionDraft[];
};

export type ParseConceptDirectionProposalResult =
  | {
      status: "ok";
      proposal: ParsedConceptDirectionProposal;
    }
  | {
      status: "failed";
      reason: string;
    };

export function parseConceptDirectionProposalPayload(text: string): ParseConceptDirectionProposalResult {
  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    return { status: "failed", reason: "No structured Morpho concept direction proposal JSON block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The Morpho concept direction proposal JSON block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoConceptDirectionProposal)) {
    return { status: "failed", reason: "The JSON block did not contain morphoConceptDirectionProposal." };
  }

  const proposal = parsed.morphoConceptDirectionProposal;
  const title = stringValue(proposal.title);
  const summary = stringValue(proposal.summary);
  const directions = parseDirections(proposal.directions);

  if (!title || !summary || directions.length === 0) {
    return {
      status: "failed",
      reason: "The structured concept direction proposal was missing title, summary, or directions."
    };
  }

  return {
    status: "ok",
    proposal: {
      title,
      summary,
      directions
    }
  };
}

function extractJsonBlock(text: string): string | undefined {
  const fencedBlocks = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  return fencedBlocks.find((block) => {
    if (!block) {
      return false;
    }

    try {
      const parsed = JSON.parse(block) as unknown;
      return isRecord(parsed) && isRecord(parsed.morphoConceptDirectionProposal);
    } catch {
      return false;
    }
  });
}

function parseDirections(value: unknown): ParsedConceptDirectionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      title: stringValue(item.title),
      summary: stringValue(item.summary),
      conceptStatement: stringValue(item.conceptStatement),
      keywords: stringArray(item.keywords),
      strategy: stringValue(item.strategy),
      differentiators: stringArray(item.differentiators),
      visualSignals: stringArray(item.visualSignals),
      risks: stringArray(item.risks),
      openQuestions: stringArray(item.openQuestions),
      basedOnDirectionId: stringValue(item.basedOnDirectionId) || undefined,
      lineageKind: parseLineageKind(item.lineageKind)
    }))
    .filter((direction) => direction.title && direction.summary && direction.conceptStatement);
}

function parseLineageKind(
  value: unknown
): ParsedConceptDirectionDraft["lineageKind"] {
  return value === "derivedFromDirection" ||
    value === "splitFromDirection" ||
    value === "mergedFromDirection" ||
    value === "supersedesDirection"
    ? value
    : undefined;
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
