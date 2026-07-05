import type { ProviderCitation } from "@/server/ai/types";
import type { WebSearchSource } from "@/server/ai/webSearch";
import type { GenerateVisualsArgs, MorphoAgentToolArguments } from "./morphoAgent";

export const AGENT_TURN_MAX_LOCAL_WEB_SEARCH_CALLS = 2;
export const AGENT_TURN_MAX_WEB_SEARCH_SOURCES = 5;
export const AGENT_TURN_MAX_AUTO_IMAGE_ITEMS = 4;

export function isAgentMutatingTool(tool: MorphoAgentToolArguments["name"]): boolean {
  return (
    tool === "create_research_analysis" ||
    tool === "create_design_definition_proposal" ||
    tool === "create_concept_direction_proposal" ||
    tool === "generate_visuals" ||
    tool === "create_comparison_analysis"
  );
}

export function wouldExceedAutoImageTurnLimit(currentCount: number, plan: GenerateVisualsArgs): boolean {
  return currentCount + plan.items.length > AGENT_TURN_MAX_AUTO_IMAGE_ITEMS;
}

export function webSearchSourcesToCitations(sources: WebSearchSource[]): ProviderCitation[] {
  return sources.map((source) => ({
    title: source.title,
    url: source.url,
    domain: source.domain ?? domainFromUrl(source.url),
    snippet: source.snippet ?? source.excerpt
  }));
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
