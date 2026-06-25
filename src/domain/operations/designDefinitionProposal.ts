export type ParsedDesignDefinitionProposal = {
  title: string;
  summary: string;
  projectGoal: string;
  targetUsers: string[];
  primaryScenarios: string[];
  coreProblem: string;
  designPrinciples: string[];
  constraints: string[];
  avoidDirections: string[];
  opportunities: string[];
  openQuestions: string[];
  changeNote?: string;
};

export type ParseDesignDefinitionProposalResult =
  | {
      status: "ok";
      proposal: ParsedDesignDefinitionProposal;
    }
  | {
      status: "failed";
      reason: string;
    };

export function parseDesignDefinitionProposalPayload(text: string): ParseDesignDefinitionProposalResult {
  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    return { status: "failed", reason: "No structured Morpho design definition proposal JSON block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The Morpho design definition proposal JSON block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoDesignDefinitionProposal)) {
    return { status: "failed", reason: "The JSON block did not contain morphoDesignDefinitionProposal." };
  }

  const proposal = parsed.morphoDesignDefinitionProposal;
  const title = stringValue(proposal.title);
  const summary = stringValue(proposal.summary);
  const projectGoal = stringValue(proposal.projectGoal);
  const coreProblem = stringValue(proposal.coreProblem);
  const designPrinciples = stringArray(proposal.designPrinciples);

  if (!title || !summary || !projectGoal || !coreProblem || designPrinciples.length === 0) {
    return {
      status: "failed",
      reason: "The structured design definition proposal was missing title, summary, projectGoal, coreProblem, or designPrinciples."
    };
  }

  return {
    status: "ok",
    proposal: {
      title,
      summary,
      projectGoal,
      targetUsers: stringArray(proposal.targetUsers),
      primaryScenarios: stringArray(proposal.primaryScenarios),
      coreProblem,
      designPrinciples,
      constraints: stringArray(proposal.constraints),
      avoidDirections: stringArray(proposal.avoidDirections),
      opportunities: stringArray(proposal.opportunities),
      openQuestions: stringArray(proposal.openQuestions),
      changeNote: stringValue(proposal.changeNote) || undefined
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
      return isRecord(parsed) && isRecord(parsed.morphoDesignDefinitionProposal);
    } catch {
      return false;
    }
  });
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
