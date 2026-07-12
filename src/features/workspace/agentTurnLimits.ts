import type { ProviderCitation } from "@/server/ai/types";
import type { WebSearchSource } from "@/server/ai/webSearch";
import type { GenerateVisualsArgs, MorphoAgentToolArguments } from "./morphoAgent";

export const AGENT_TURN_MAX_LOCAL_WEB_SEARCH_CALLS = 2;
export const AGENT_TURN_MAX_WEB_SEARCH_SOURCES = 5;
export const AGENT_TURN_MAX_AUTO_IMAGE_ITEMS = 4;
export const AGENT_TURN_EMERGENCY_MODEL_TURN_CEILING = 28;
export const AGENT_TURN_EMERGENCY_DURATION_MS = 18 * 60 * 1000;
export const AGENT_TURN_REPEAT_TOOL_CALL_LIMIT = 3;

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

export function isRepeatedAgentToolCall(
  previousSignature: string | undefined,
  repeatCount: number,
  tool: MorphoAgentToolArguments
): { signature: string; repeatCount: number; exceeded: boolean } {
  const signature = `${tool.name}:${stableSerialize(tool.args)}`;
  const nextRepeatCount = previousSignature === signature ? repeatCount + 1 : 1;
  return {
    signature,
    repeatCount: nextRepeatCount,
    exceeded: nextRepeatCount > AGENT_TURN_REPEAT_TOOL_CALL_LIMIT
  };
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

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
