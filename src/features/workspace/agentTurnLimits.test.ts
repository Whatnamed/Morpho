import { describe, expect, it } from "vitest";

import {
  AGENT_TURN_MAX_AUTO_IMAGE_ITEMS,
  AGENT_TURN_REPEAT_TOOL_CALL_LIMIT,
  isRepeatedAgentToolCall,
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
    expect(isAgentMutatingTool("revise_selected_proposal_draft")).toBe(false);
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

  it("detects only consecutive repeated tool signatures as an emergency-loop signal", () => {
    const first = isRepeatedAgentToolCall(undefined, 0, {
      name: "read_selected_context",
      args: {}
    });
    const second = isRepeatedAgentToolCall(first.signature, first.repeatCount, {
      name: "read_selected_context",
      args: {}
    });
    const different = isRepeatedAgentToolCall(second.signature, second.repeatCount, {
      name: "search_web_evidence",
      args: { queries: ["night safety"], reason: "Need current sources." }
    });

    expect(first).toMatchObject({ repeatCount: 1, exceeded: false });
    expect(second).toMatchObject({ repeatCount: 2, exceeded: false });
    expect(different).toMatchObject({ repeatCount: 1, exceeded: false });

    let repeated = second;
    for (let index = 0; index < AGENT_TURN_REPEAT_TOOL_CALL_LIMIT; index += 1) {
      repeated = isRepeatedAgentToolCall(repeated.signature, repeated.repeatCount, {
        name: "read_selected_context",
        args: {}
      });
    }
    expect(repeated.exceeded).toBe(true);
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
