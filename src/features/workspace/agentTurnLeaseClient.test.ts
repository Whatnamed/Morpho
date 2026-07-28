import { describe, expect, it, vi } from "vitest";

import type { ConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";
import { createProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import {
  createAgentTranscriptMessageItem,
  createAgentTurnOutcomeItem
} from "@/shared/agentCompactionProtocol";
import { agentStreamScript } from "./agentStreamScripts";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  closeAgentTurnLease,
  prepareAgentDurableCheckpoint,
  requestAgentWebSearch,
  requestConversationSummary
} from "./agentTurnLeaseClient";
import { createAgentTurnState } from "./agentTurnState";

describe("Agent turn lease client", () => {
  it("uses an unexpired durable checkpoint without refreshing an ordinary request", async () => {
    const token = clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 });
    const fetchImpl = vi.fn<typeof fetch>();

    const prepared = await prepareAgentDurableCheckpoint({
      projectId: "project-ocean-buoy",
      requestState: {
        promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
        transcriptManifestHash: "a".repeat(64),
        transcriptSnapshotToken: token
      },
      signal: new AbortController().signal,
      fetch: fetchImpl
    });

    expect(prepared).toMatchObject({ transcriptSnapshotToken: token });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired durable checkpoint before an ordinary request", async () => {
    const expired = clientSnapshotToken({ v: 3, exp: Date.now() - 1 });
    const refreshed = clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 });
    const fetchImpl: typeof fetch = async () => Response.json({
      transcriptSnapshotToken: refreshed,
      transcriptManifestHash: "b".repeat(64),
      expiresAt: Date.now() + 60_000
    });

    const prepared = await prepareAgentDurableCheckpoint({
      projectId: "project-ocean-buoy",
      requestState: {
        promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
        transcriptManifestHash: "a".repeat(64),
        transcriptSnapshotToken: expired
      },
      signal: new AbortController().signal,
      fetch: fetchImpl
    });

    expect(prepared).toMatchObject({
      transcriptSnapshotToken: refreshed,
      transcriptManifestHash: "b".repeat(64),
      transcriptSnapshotExpiresAt: expect.any(Number)
    });
  });

  it("fails closed before an ordinary request when durable checkpoint refresh fails", async () => {
    const state = {
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      transcriptManifestHash: "a".repeat(64),
      transcriptSnapshotToken: clientSnapshotToken({ v: 3, exp: Date.now() - 1 })
    };

    await expect(prepareAgentDurableCheckpoint({
      projectId: "project-ocean-buoy",
      requestState: state,
      signal: new AbortController().signal,
      fetch: async () => Response.json({ error: "refresh rejected" }, { status: 400 })
    })).rejects.toThrow("refresh rejected");
    expect(state.transcriptManifestHash).toBe("a".repeat(64));
  });

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

  it("retains the active lease when closure proof is missing", async () => {
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
    ).rejects.toThrow("缺少服务端签名 Proof");

    expect(leaseObservedDuringFetch).toBeUndefined();
    expect(state.agentTurnLeaseId).toBe("lease-unit");
  });

  it("returns the server-signed terminal outcome snapshot when lease completion proves it", async () => {
    const state = createAgentTurnState(createTestWorkspace());
    state.agentTurnLeaseId = "lease-unit";
    state.turnClosureToken = "closure-token-unit";
    const outcomeItem = createAgentTurnOutcomeItem({
      agentTurnId: "turn-unit",
      userMessageId: "user-unit",
      assistantMessageId: "assistant-unit",
      outcome: "partialSuccess"
    });
    let requestBody: Record<string, unknown> | undefined;
    const result = await closeAgentTurnLease({
      state,
      agentTurnId: "turn-unit",
      outcome: "partialSuccess",
      snapshot: {
        projectId: "project-ocean-buoy",
        userMessageId: "user-unit",
        assistantMessageId: "assistant-unit",
        transcriptSnapshotToken: "snapshot-token-unit",
        transcriptManifestHash: "b".repeat(64),
        closureToken: "closure-token-unit",
        providerOutputSnapshot: createProviderOutputSnapshot("provider answer")
      },
      fetch: async (_request, init) => {
        requestBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          status: "partial_success",
          outcomeItem,
          transcriptSnapshotToken: "snapshot-token-final",
          transcriptManifestHash: "a".repeat(64),
          expiresAt: 123
        });
      }
    });

    expect(requestBody).toMatchObject({
      projectId: "project-ocean-buoy",
      transcriptSnapshotToken: "snapshot-token-unit",
      closureToken: "closure-token-unit",
      outcome: "partialSuccess"
    });
    expect(result).toEqual({
      outcomeItem,
      transcriptSnapshotToken: "snapshot-token-final",
      transcriptManifestHash: "a".repeat(64),
      expiresAt: 123
    });
    expect(state.agentTurnLeaseId).toBeUndefined();
    expect(state.turnClosureToken).toBeUndefined();
  });

  it("retries a lost closure response once with the same request id", async () => {
    const state = createAgentTurnState(createTestWorkspace());
    state.agentTurnLeaseId = "lease-unit";
    state.turnClosureToken = "closure-token-unit";
    const outcomeItem = createAgentTurnOutcomeItem({
      agentTurnId: "turn-unit",
      userMessageId: "user-unit",
      assistantMessageId: "assistant-unit",
      outcome: "partialSuccess"
    });
    const bodies: Array<Record<string, unknown>> = [];
    let attempts = 0;

    await closeAgentTurnLease({
      state,
      agentTurnId: "turn-unit",
      outcome: "partialSuccess",
      snapshot: {
        projectId: "project-ocean-buoy",
        userMessageId: "user-unit",
        assistantMessageId: "assistant-unit",
        transcriptSnapshotToken: "snapshot-token-unit",
        transcriptManifestHash: "b".repeat(64),
        closureToken: "closure-token-unit",
        providerOutputSnapshot: createProviderOutputSnapshot("provider answer")
      },
      fetch: async (_request, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        attempts += 1;
        if (attempts === 1) {
          throw new Error("response lost");
        }
        return Response.json({
          status: "partialSuccess",
          replayed: true,
          outcomeItem,
          transcriptSnapshotToken: "snapshot-token-final",
          transcriptManifestHash: "a".repeat(64),
          expiresAt: 123
        });
      }
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.closureRequestId).toBe(bodies[1]?.closureRequestId);
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

  it("uses a current unexpired snapshot directly without refreshing it", async () => {
    const calls: string[] = [];
    const token = clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 });
    const fetchImpl: typeof fetch = async (request) => {
      calls.push(String(request));
      return new Response(agentStreamScript([{ type: "turn-complete", result: emptyAgentResult() }]).body, {
        headers: { "content-type": "text/event-stream" }
      });
    };

    await requestConversationSummary(compactionPlan(), new AbortController().signal, {
      projectId: "project-ocean-buoy",
      agentTurnId: "turn-current-snapshot",
      mode: "auto",
      previousTranscriptSnapshotToken: token
    }, fetchImpl);

    expect(calls).toEqual(["/api/ai/agent"]);
  });

  it("refreshes an expired current snapshot without a candidate manifest", async () => {
    const bodies: unknown[] = [];
    const expired = clientSnapshotToken({ v: 3, exp: Date.now() - 1 });
    const refreshed = clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 });
    const fetchImpl: typeof fetch = async (request, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      if (String(request).includes("/snapshot/refresh")) {
        return Response.json({
          transcriptSnapshotToken: refreshed,
          transcriptManifestHash: "b".repeat(64),
          expiresAt: Date.now() + 60_000
        });
      }
      return new Response(agentStreamScript([{ type: "turn-complete", result: emptyAgentResult() }]).body, {
        headers: { "content-type": "text/event-stream" }
      });
    };

    await requestConversationSummary(compactionPlan(), new AbortController().signal, {
      projectId: "project-ocean-buoy",
      agentTurnId: "turn-expired-snapshot",
      mode: "auto",
      previousTranscriptSnapshotToken: expired
    }, fetchImpl);

    expect(bodies[0]).toEqual({ projectId: "project-ocean-buoy", token: expired });
  });

  it("excludes the fresh user from a legacy snapshot upgrade candidate", async () => {
    const freshUser = createAgentTranscriptMessageItem({
      messageId: "user-fresh",
      role: "user",
      replayMode: "liveInput",
      providerItems: [{ role: "user", content: [{ type: "input_text", text: "当前新问题" }] }],
      durableProviderItems: [{ role: "user", content: [{ type: "input_text", text: "当前新问题" }] }]
    });
    let refreshBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (request, init) => {
      if (String(request).includes("/snapshot/refresh")) {
        refreshBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          transcriptSnapshotToken: clientSnapshotToken({ v: 3, exp: Date.now() + 60_000 }),
          transcriptManifestHash: "c".repeat(64),
          expiresAt: Date.now() + 60_000
        });
      }
      return new Response(agentStreamScript([{ type: "turn-complete", result: emptyAgentResult() }]).body, {
        headers: { "content-type": "text/event-stream" }
      });
    };

    await requestConversationSummary(compactionPlan(), new AbortController().signal, {
      projectId: "project-ocean-buoy",
      agentTurnId: "turn-legacy-snapshot",
      mode: "auto",
      previousTranscriptSnapshotToken: clientSnapshotToken({ v: 2, exp: Date.now() - 1 }),
      retainedTailItems: [freshUser],
      freshUserMessageId: "user-fresh"
    }, fetchImpl);

    expect(refreshBody?.transcriptManifest).toEqual(expect.objectContaining({
      items: expect.not.arrayContaining([expect.objectContaining({ messageId: "user-fresh" })])
    }));
  });
});

function clientSnapshotToken(claims: { v: number; exp: number }): string {
  return `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;
}

function emptyAgentResult() {
  return {
    responseId: "response-summary",
    outputText: "No structured summary",
    functionCalls: [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: []
  };
}

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
