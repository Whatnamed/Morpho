import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import { createRequiredAgentReadState } from "./agentTaskStrategy";
import { createAgentTurnWorkLedger } from "./agentTurnMessages";
import { createAgentTurnRuntimeState, createAgentTurnState } from "./agentTurnState";

describe("Agent turn state", () => {
  it("starts the lease lifecycle with the current request-boundary workspace", () => {
    const workspace = createTestWorkspace();
    expect(createAgentTurnState(workspace)).toEqual({
      providerTranscriptReset: false,
      webSearchSequenceResyncUsed: false,
      webSearchLeaseStateRecoveryUsed: false,
      workspaceAtAgentStart: workspace
    });
  });

  it("retains the identity of containers captured by turn closures", () => {
    const requiredReadState = createRequiredAgentReadState(["read_project_memory"]);
    const contextBudgetState = createAgentContextBudgetState(1200);
    const agentWorkLedger = createAgentTurnWorkLedger();
    const state = createAgentTurnRuntimeState({
      conversationContext: {
        laneKey: "lane-unit",
        messages: [],
        rawMessageCount: 0,
        coveredMessageCount: 0,
        estimatedInputTokens: 1200,
        pressure: "normal"
      },
      conversationInput: [],
      requiredReadState,
      contextBudgetState,
      agentWorkLedger
    });
    const continuationItems = state.turnContinuationItems;
    const streamedText = state.streamedFinalTextByAttempt;
    const memoryEntryIds = state.memoryUpdateEntryIds;

    state.turnContinuationItems.push({ type: "function_call_output" });
    state.streamedFinalTextByAttempt.set("attempt-1", "partial");
    state.memoryUpdateEntryIds.add("entry-1");

    expect(state.turnContinuationItems).toBe(continuationItems);
    expect(state.streamedFinalTextByAttempt).toBe(streamedText);
    expect(state.memoryUpdateEntryIds).toBe(memoryEntryIds);
    expect(state.requiredReadState).toBe(requiredReadState);
    expect(state.contextBudgetState).toBe(contextBudgetState);
    expect(state.agentWorkLedger).toBe(agentWorkLedger);
  });
});
