import { hashSourceMessageIds } from "@/shared/agentProductHash";
import { describe, expect, it } from "vitest";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import { rebuildAgentProviderConversation } from "./agentTurnProductPreparationAPlus";
import type { APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { normalizeProviderInputSnapshot, createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";

describe("P2B input materialization", () => {
  it("rebuilds post-compaction history and summary only for a new request without mutating its frozen predecessor", () => {
    const workspace = createTestWorkspace();
    workspace.ai.messages = [
      { id: "old-user", role: "user", body: "old-covered-input", status: "done" },
      { id: "old-assistant", role: "assistant", body: "old-covered-response", status: "done" },
      { id: "tail-user", role: "user", body: "new-tail", status: "done" },
      { id: "current-user", role: "user", body: "current-task", status: "done" }
    ];
    workspace.ai.conversationSummaryRevisions["new-summary"] = { id: "new-summary", sourceStartMessageId: "old-user", sourceEndMessageId: "old-assistant", sourceMessageCount: 2, sourceMessageIdsHash: hashSourceMessageIds(["old-user", "old-assistant"]), createdAt: "2026-10-01T00:00:00Z", summary: { threadGoal: "fresh-summary-marker", establishedContext: [], decisionsAndReasons: [], activeWork: [], unresolvedQuestions: [], referencedObjects: [] } };
    workspace.ai.conversationCompaction = { ...workspace.ai.conversationCompaction, summaryRevisionId: "new-summary", coveredThroughMessageId: "old-assistant" };
    const base: APlusAgentProviderRequest = { input: [{ role: "user", content: [{ type: "input_text", text: "old-covered-input" }] }, { role: "user", content: [{ type: "input_text", text: "<morpho_input_coverage>current-task</morpho_input_coverage>" }] }], promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION, mode: "auto", capabilityIntent: { comparisonAnalysis: false }, taskContract: { version: 1, readContractVersion: 1, userGoal: "current-task", primaryFocus: "discussion", requiredReads: [], completionConditions: [], execution: { taskMode: "chatAnalysis", taskModeSource: "userSelected", workIntent: "discussion", workIntentSource: "userSelected" }, activities: [{ id: "task", kind: "discussion", instruction: "current-task", sourceObjectIds: [], targetObjectIds: [], referenceObjectIds: [], excludedObjectIds: [], includeDefaultReference: false, requiredFacts: [], effectGrants: [], expectedOutputs: ["chatAnswer"] }] } };
    const frozen = structuredClone(base);
    const next = rebuildAgentProviderConversation({ workspace, base, userMessageId: "current-user" });
    expect(JSON.stringify(next.input)).toContain("fresh-summary-marker");
    expect(JSON.stringify(next.input)).toContain("new-tail");
    expect(JSON.stringify(next.input)).toContain("current-task");
    expect(JSON.stringify(next.input)).not.toContain("old-covered-input");
    expect(base).toEqual(frozen);
    expect(rebuildAgentProviderConversation({ workspace, base: { ...base, taskContract: undefined }, userMessageId: "current-user" })).toEqual({ ...base, taskContract: undefined });
  });

  it("normalizes real coverage idempotently and leaves old snapshots unknown", () => {
    const snapshot = createProviderInputSnapshot({ message: { content: [{ type: "input_text", text: "included range" }] }, promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION, coverage: [{ id: "source", source: "request", kind: "document", objectId: "file", incarnationId: "incarnation", assetId: "extract", contentHash: "hash", status: "partial", range: { start: 0, end: 14, total: 100, nextStart: 14 }, delivered: false }] });
    const once = normalizeProviderInputSnapshot(snapshot);
    expect(normalizeProviderInputSnapshot(once)).toEqual(once);
    expect(once?.coverage).toEqual(snapshot.coverage);
    const { coverage: omitted, ...legacy } = snapshot;
    void omitted;
    expect(normalizeProviderInputSnapshot(legacy)?.coverage).toBeUndefined();
  });
});
