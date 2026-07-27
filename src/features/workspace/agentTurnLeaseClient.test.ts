import { describe, expect, it } from "vitest";

import type { ConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import { agentStreamScript } from "./agentStreamScripts";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  closeAgentTurnLease,
  requestAgentWebSearch,
  requestConversationSummary
} from "./agentTurnLeaseClient";
import { createAgentTurnState } from "./agentTurnState";

describe("Agent turn lease client", () => {
  it("resynchronizes one replayed web-search sequence and adopts it before retrying", async () => {
    const workspace = createTestWorkspace();
    const state = createAgentTurnState(workspace);
    state.agentTurnLeaseId = "lease-unit";
    state.nextAgentLeaseSequence = 1;
    const requestBodies: unknown[] = [];
    let callCount = 0;
    const fake = createAgentTurnHostFake({
      workspace,
      routes: {
        "/api/ai/web-search": async (request) => {
          requestBodies.push(await request.json());
          callCount += 1;
          return callCount === 1
            ? Response.json(
                { error: "Sequence replay", reason: "sequence_replay", nextProviderSequence: 2 },
                { status: 409 }
              )
            : Response.json({
                sources: [{ title: "Source", url: "https://example.com" }],
                nextProviderSequence: 3
              });
        }
      }
    });

    const result = await requestAgentWebSearch({
      queries: ["query"],
      agentTurnId: "turn-unit",
      signal: new AbortController().signal,
      state,
      fetch: fake.fetch
    });

    expect(result.sources).toEqual([{ title: "Source", url: "https://example.com" }]);
    expect(requestBodies).toEqual([
      expect.objectContaining({ leaseSequence: 1 }),
      expect.objectContaining({ leaseSequence: 2 })
    ]);
    expect(state.nextAgentLeaseSequence).toBe(3);
    expect(state.webSearchSequenceResyncUsed).toBe(true);
  });

  it("keeps a consumed sequence even when the web search fails", async () => {
    const workspace = createTestWorkspace();
    const state = createAgentTurnState(workspace);
    const fake = createAgentTurnHostFake({
      workspace,
      routes: {
        "/api/ai/web-search": () =>
          Response.json({ error: "Search failed", nextProviderSequence: 8 }, { status: 502 })
      }
    });

    await expect(
      requestAgentWebSearch({
        queries: ["query"],
        agentTurnId: "turn-unit",
        signal: new AbortController().signal,
        state,
        fetch: fake.fetch
      })
    ).rejects.toThrow("Search failed");
    expect(state.nextAgentLeaseSequence).toBe(8);
  });

  it("clears the active lease before a best-effort close request", async () => {
    const state = createAgentTurnState(createTestWorkspace());
    state.agentTurnLeaseId = "lease-unit";
    let leaseObservedDuringFetch: string | undefined;
    const fetchImpl: typeof fetch = async () => {
      leaseObservedDuringFetch = state.agentTurnLeaseId;
      throw new Error("network unavailable");
    };

    await expect(
      closeAgentTurnLease({
        state,
        agentTurnId: "turn-unit",
        outcome: "partialSuccess",
        fetch: fetchImpl
      })
    ).resolves.toBeUndefined();

    expect(leaseObservedDuringFetch).toBeUndefined();
    expect(state.agentTurnLeaseId).toBeUndefined();
  });

  it("projects lease and continuation updates from summary streams", async () => {
    const script = agentStreamScript([
      {
        type: "turn-start",
        agentTurnId: "turn-summary",
        startedAt: "2026-07-01T00:00:00.000Z",
        leaseId: "lease-summary",
        nextProviderSequence: 4
      },
      {
        type: "turn-complete",
        continuationToken: "continuation-summary",
        result: {
          responseId: "response-summary",
          outputText: "No structured summary",
          functionCalls: [],
          citations: [],
          webSearchCallCount: 0,
          outputItems: []
        }
      }
    ]);
    const fake = createAgentTurnHostFake({
      workspace: createTestWorkspace(),
      routes: {
        "/api/ai/agent": () =>
          new Response(script.body, { headers: { "content-type": "text/event-stream" } })
      }
    });
    const observed: Array<string | number> = [];

    const result = await requestConversationSummary(
      compactionPlan(),
      new AbortController().signal,
      {
        projectId: "project-unit",
        agentTurnId: "turn-summary",
        mode: "auto",
        onLeaseStarted: (leaseId) => observed.push(leaseId),
        onLeaseSequence: (sequence) => observed.push(sequence),
        onContinuationToken: (token) => observed.push(token)
      },
      fake.fetch
    );

    expect(observed).toEqual(["lease-summary", 4, "continuation-summary"]);
    expect(result).toMatchObject({
      leaseId: "lease-summary",
      parsed: { status: "empty" }
    });
  });
});

function compactionPlan(): ConversationCompactionPlan {
  return {
    sourceMessages: [
      { id: "user-1", role: "user", body: "Question" },
      { id: "assistant-1", role: "assistant", body: "Answer" }
    ],
    sourceStartMessageId: "user-1",
    sourceEndMessageId: "assistant-1",
    sourceMessageCount: 2,
    sourceMessageIdsHash: "hash-unit",
    remainingMessages: [],
    estimatedInputTokens: 1200,
    pressure: "compact"
  };
}
