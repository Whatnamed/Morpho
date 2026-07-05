import { describe, expect, it } from "vitest";

import {
  AGENT_TURN_MAX_AUTO_IMAGE_ITEMS,
  isAgentMutatingTool,
  webSearchSourcesToCitations,
  wouldExceedAutoImageTurnLimit
} from "./agentTurnLimits";
import type { GenerateVisualsArgs } from "./morphoAgent";

describe("agent turn limits", () => {
  it("classifies only project-writing agent tools as mutating", () => {
    expect(isAgentMutatingTool("read_selected_context")).toBe(false);
    expect(isAgentMutatingTool("search_web_evidence")).toBe(false);
    expect(isAgentMutatingTool("create_research_analysis")).toBe(true);
    expect(isAgentMutatingTool("create_design_definition_proposal")).toBe(true);
    expect(isAgentMutatingTool("create_concept_direction_proposal")).toBe(true);
    expect(isAgentMutatingTool("create_comparison_analysis")).toBe(true);
    expect(isAgentMutatingTool("generate_visuals")).toBe(true);
  });

  it("applies the automatic image cap across the whole agent turn", () => {
    expect(wouldExceedAutoImageTurnLimit(0, makePlan(AGENT_TURN_MAX_AUTO_IMAGE_ITEMS))).toBe(false);
    expect(wouldExceedAutoImageTurnLimit(3, makePlan(2))).toBe(true);
  });

  it("converts local web search sources into provider citations", () => {
    expect(
      webSearchSourcesToCitations([
        {
          title: "Source",
          url: "https://example.com/path",
          snippet: "Short snippet"
        }
      ])
    ).toEqual([
      {
        title: "Source",
        url: "https://example.com/path",
        domain: "example.com",
        snippet: "Short snippet"
      }
    ]);
  });
});

function makePlan(count: number): GenerateVisualsArgs {
  return {
    kind: "directionPreview",
    items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index + 1}`,
      title: `Item ${index + 1}`,
      purpose: "Preview",
      prompt: "Warm product preview",
      referenceObjectIds: ["direction-soft-rail"],
      role: "conceptImage"
    }))
  };
}
