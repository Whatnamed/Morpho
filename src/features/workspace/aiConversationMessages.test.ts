import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentTrace } from "./agentMessageTrace";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import {
  domainFromUrl,
  getAvailableCitationId,
  storeMessageCitations,
  updateAiMessage
} from "./aiConversationMessages";

afterEach(() => {
  vi.useRealTimers();
});

describe("AI conversation messages", () => {
  it("updates only the selected message and retains omitted metadata", () => {
    const workspace = withAssistantMessage();
    const trace = createAgentTrace("2026-07-01T00:00:00.000Z");
    const withTrace = updateAiMessage(workspace, "assistant-unit", "partial", "streaming", {
      agentTrace: trace,
      continuityEntryIds: ["entry-1"]
    });
    const failed = updateAiMessage(withTrace, "assistant-unit", "provider failed", "failed");

    expect(failed.ai.messages.find((message) => message.id === "assistant-unit")).toMatchObject({
      body: "provider failed",
      status: "failed",
      error: "provider failed",
      continuityEntryIds: ["entry-1"],
      agentTrace: trace
    });
    expect(failed.ai.messages.slice(0, -1)).toEqual(workspace.ai.messages.slice(0, -1));
  });

  it("stores citation snapshots and resolves deterministic id collisions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T03:04:05.000Z"));
    const workspace = withAssistantMessage();
    const occupied = {
      ...workspace,
      citationSnapshots: {
        ...workspace.citationSnapshots,
        "assistant-unit-citation-1": {
          id: "assistant-unit-citation-1",
          operationId: "old-operation",
          title: "Existing",
          retrievedAt: "2026-07-01T00:00:00.000Z"
        },
        "assistant-unit-citation-1-2": {
          id: "assistant-unit-citation-1-2",
          operationId: "old-operation",
          title: "Existing 2",
          retrievedAt: "2026-07-01T00:00:00.000Z"
        }
      }
    };

    const next = storeMessageCitations(occupied, {
      messageId: "assistant-unit",
      operationId: "operation-unit",
      citations: [{ title: "Source", url: "https://example.com/a" }]
    });

    expect(getAvailableCitationId(occupied, "assistant-unit-citation-1")).toBe(
      "assistant-unit-citation-1-3"
    );
    expect(next.citationSnapshots["assistant-unit-citation-1-3"]).toEqual({
      id: "assistant-unit-citation-1-3",
      operationId: "operation-unit",
      title: "Source",
      url: "https://example.com/a",
      domain: "example.com",
      snippet: undefined,
      retrievedAt: "2026-07-02T03:04:05.000Z"
    });
    expect(next.ai.messages.at(-1)).toMatchObject({
      id: "assistant-unit",
      status: "done",
      citationIds: ["assistant-unit-citation-1-3"]
    });
  });

  it("extracts only valid URL domains", () => {
    expect(domainFromUrl("https://sub.example.com/path")).toBe("sub.example.com");
    expect(domainFromUrl("not a url")).toBeUndefined();
    expect(domainFromUrl(undefined)).toBeUndefined();
  });
});

function withAssistantMessage() {
  const workspace = createTestWorkspace();
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: "assistant-unit",
          role: "assistant" as const,
          body: "initial",
          status: "streaming" as const,
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    }
  };
}
