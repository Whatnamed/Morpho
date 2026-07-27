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

  it("recovers a lost search response once without replaying the original search", async () => {
    const state = createAgentTurnState(createTestWorkspace());
    state.agentTurnLeaseId = "lease-unit";
    state.nextAgentLeaseSequence = 4;
    let searchCount = 0;
    let recoveryCount = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("/api/ai/web-search")) {
        searchCount += 1;
        throw new Error("transport reset");
      }
      recoveryCount += 1;
      return Response.json({
        active: true,
        expiresAt: "2026-07-27T14:00:00.000Z",
        providerCallCount: 3,
        webSearchCallCount: 1,
        nextProviderSequence: 5
      });
    };

    await expect(requestAgentWebSearch({
      queries: ["original query"],
      agentTurnId: "turn-unit",
      signal: new AbortController().signal,
      state,
      fetch: fetchImpl
    })).rejects.toThrow("未重放");
    expect(searchCount).toBe(1);
    expect(recoveryCount).toBe(1);
    expect(state.nextAgentLeaseSequence).toBe(5);
    expect(state.webSearchLeaseStateRecoveryUsed).toBe(true);
  });

  it("fails closed when the one-shot search Lease recovery cannot read state", async () => {
    const state = createAgentTurnState(createTestWorkspace());
    state.agentTurnLeaseId = "lease-unit";
    state.nextAgentLeaseSequence = 4;
    const fetchImpl: typeof fetch = async (input) =>
      String(input).includes("/api/ai/web-search")
        ? Promise.reject(new Error("transport reset"))
        : Response.json({ error: "inactive", reason: "inactive" }, { status: 403 });

    await expect(requestAgentWebSearch({
      queries: ["original query"],
      agentTurnId: "turn-unit",
      signal: new AbortController().signal,
      state,
      fetch: fetchImpl
    })).rejects.toThrow("安全终止");
    expect(state.webSearchLeaseStateRecoveryUsed).toBe(true);
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
