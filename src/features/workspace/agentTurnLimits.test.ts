import { describe, expect, it } from "vitest";

import {
  AGENT_TURN_EMERGENCY_DURATION_MS,
  AGENT_TURN_EMERGENCY_MODEL_TURN_CEILING,
  AGENT_TURN_REPEAT_TOOL_CALL_LIMIT,
  AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL,
  buildAgentEmergencyFinalizationRequest,
  isAgentMutatingTool,
  isRepeatedAgentToolCall,
  mergeAgentSearchCitations,
  shouldFinalizeAgentTurn,
  webSearchSourcesToCitations
} from "./agentTurnLimits";
import type { MorphoAgentToolArguments } from "./morphoAgent";

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

  it("keeps the web source cap scoped to one search payload", () => {
    expect(AGENT_WEB_SEARCH_MAX_SOURCES_PER_CALL).toBe(5);
  });

  it.each([3, 5, 6])("allows %i consecutive searches when every query is different", (count) => {
    const states = runSearchSequence(
      Array.from({ length: count }, (_, index) => ({
        name: "search_web_evidence" as const,
        args: { queries: [`research angle ${index + 1}`], reason: `Close evidence gap ${index + 1}.` }
      }))
    );

    expect(states).toHaveLength(count);
    expect(states.every((state) => !state.exceeded && state.repeatCount === 1)).toBe(true);
  });

  it("normalizes equivalent searches before applying the repeat-loop guard", () => {
    const searches: MorphoAgentToolArguments[] = Array.from(
      { length: AGENT_TURN_REPEAT_TOOL_CALL_LIMIT + 1 },
      (_, index) => ({
        name: "search_web_evidence",
        args: {
          queries: index % 2 === 0 ? ["  Rural   bathroom safety ", "grab rail"] : ["GRAB RAIL", "rural bathroom safety"],
          reason: `Changed commentary ${index + 1}`
        }
      })
    );

    const states = runSearchSequence(searches);
    expect(states.at(-1)).toMatchObject({
      repeatCount: AGENT_TURN_REPEAT_TOOL_CALL_LIMIT + 1,
      exceeded: true
    });
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

  it("deduplicates citations across repeated hosted and local search results", () => {
    const merged = mergeAgentSearchCitations(
      [
        { title: "Source A", url: "https://example.com/report#summary", snippet: "Shared evidence" },
        { title: "Source B", url: "https://example.org/other", snippet: "Different evidence" }
      ],
      [
        { title: "Source A", url: "https://example.com/report", snippet: "Shared evidence" },
        { title: "Mirror of Source B", url: "https://mirror.example.org/report", snippet: "  Different   evidence " },
        { title: "Source C", url: "https://example.net/new", snippet: "New evidence" }
      ]
    );

    expect(merged.map((citation) => citation.title.trim())).toEqual(["Source A", "Source B", "Source C"]);
  });

  it("uses the model ceiling, duration, and loop signal only as high-level finalization guards", () => {
    expect(
      shouldFinalizeAgentTurn({ emergencyGuardTriggered: false, modelTurnCount: 27, elapsedMs: 17 * 60 * 1000 })
    ).toBe(false);
    expect(
      shouldFinalizeAgentTurn({
        emergencyGuardTriggered: false,
        modelTurnCount: AGENT_TURN_EMERGENCY_MODEL_TURN_CEILING,
        elapsedMs: 0
      })
    ).toBe(true);
    expect(
      shouldFinalizeAgentTurn({
        emergencyGuardTriggered: false,
        modelTurnCount: 0,
        elapsedMs: AGENT_TURN_EMERGENCY_DURATION_MS
      })
    ).toBe(true);
    expect(shouldFinalizeAgentTurn({ emergencyGuardTriggered: true, modelTurnCount: 1, elapsedMs: 1 })).toBe(true);
  });

  it("finalizes with tools disabled while preserving prior outputs and trace input", () => {
    const priorInput = [
      { role: "user", content: [{ type: "input_text", text: "Research broadly." }] },
      { type: "function_call_output", call_id: "search-3", output: "{\"sources\":[\"kept\"]}" }
    ];

    const request = buildAgentEmergencyFinalizationRequest(priorInput);

    expect(request.tools).toEqual([]);
    expect(request.continuation).toBe(true);
    expect(request.input.slice(0, priorInput.length)).toEqual(priorInput);
    expect(request.input.at(-1)).toMatchObject({ role: "user" });
  });
});

function runSearchSequence(tools: MorphoAgentToolArguments[]) {
  let signature: string | undefined;
  let repeatCount = 0;

  return tools.map((tool) => {
    const next = isRepeatedAgentToolCall(signature, repeatCount, tool);
    signature = next.signature;
    repeatCount = next.repeatCount;
    return next;
  });
}
