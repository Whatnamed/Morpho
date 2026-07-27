import { describe, expect, it } from "vitest";

import type { AiMessage, ConversationSummary, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { AgentStreamResult } from "@/shared/agentStreamProtocol";
import { agentStreamScript, textAnswerScript } from "./agentStreamScripts";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import { getManualCompactionStatusText } from "./manualConversationCompaction";
import { runManualCompactionTurn } from "./manualCompactionTurn";

const summary: ConversationSummary = {
  threadGoal: "继续收敛产品方向",
  establishedContext: ["用户要求保持克制"],
  decisionsAndReasons: ["保留当前结构，因为验证结果稳定"],
  activeWork: ["继续验证关键节点"],
  unresolvedQuestions: ["安装方式仍待确认"],
  referencedObjects: [],
  nextTurnAnchor: "从关键节点继续"
};

describe("manual conversation compaction turn", () => {
  it("finishes locally when there is not enough history to compact", async () => {
    const fixture = createFixture(createBlankWorkspace("manual-empty"), [
      textAnswerScript()
    ]);

    await runManualCompactionTurn(fixture.input, fixture.host);

    expect(fixture.agentRequestBodies).toEqual([]);
    expect(latestManualAssistant(fixture.workspace())).toMatchObject({
      body: getManualCompactionStatusText("notNeeded"),
      status: "done"
    });
    expect(fixture.fake.abortSlot.get()).toBeNull();
    expect(uiValues(fixture, "streaming")).toEqual([true, false]);
  });

  it("applies a valid summary and closes the lease as success", async () => {
    const fixture = createFixture(longConversationWorkspace(), [summaryScript()]);

    await runManualCompactionTurn(fixture.input, fixture.host);

    expect(Object.values(fixture.workspace().ai.conversationSummaryRevisions)).toHaveLength(1);
    expect(latestManualAssistant(fixture.workspace())).toMatchObject({
      body: getManualCompactionStatusText("completed"),
      status: "done"
    });
    expect(fixture.leaseRequestBodies).toEqual([
      expect.objectContaining({ outcome: "success", leaseId: "lease-manual" })
    ]);
    expect(uiValues(fixture, "failure")).toEqual([]);
  });

  it("marks an unusable summary as failed and shows the failure state", async () => {
    const fixture = createFixture(longConversationWorkspace(), [
      textAnswerScript({ text: "普通回答" })
    ]);

    await runManualCompactionTurn(fixture.input, fixture.host);

    expect(latestManualAssistant(fixture.workspace())).toMatchObject({
      body: getManualCompactionStatusText("failed"),
      status: "failed"
    });
    expect(uiValues(fixture, "failure")).toEqual([true]);
  });

  it("reports cancellation without opening the failure state", async () => {
    const fixture = createFixture(longConversationWorkspace(), [
      textAnswerScript({ text: "不会被消费" })
    ], { abortOnAgentRequest: true });

    await runManualCompactionTurn(fixture.input, fixture.host);

    expect(latestManualAssistant(fixture.workspace())).toMatchObject({
      body: "上下文压缩已取消。",
      status: "done"
    });
    expect(uiValues(fixture, "failure")).toEqual([]);
    expect(fixture.fake.abortSlot.get()).toBeNull();
  });
});

function createFixture(
  workspace: MorphoWorkspace,
  scripts: Array<{ body: string }>,
  options: { abortOnAgentRequest?: boolean } = {}
) {
  const agentRequestBodies: Array<Record<string, unknown>> = [];
  const leaseRequestBodies: Array<Record<string, unknown>> = [];
  let scriptIndex = 0;
  let fake: ReturnType<typeof createAgentTurnHostFake>;
  fake = createAgentTurnHostFake({
    workspace,
    routes: {
      "/api/ai/agent": async (request) => {
        agentRequestBodies.push((await request.json()) as Record<string, unknown>);
        if (options.abortOnAgentRequest) {
          fake.abortSlot.get()?.abort();
        }
        const script = scripts[scriptIndex++];
        if (!script) {
          return Response.json({ error: "Unexpected summary request" }, { status: 500 });
        }
        return new Response(script.body, {
          headers: { "content-type": "text/event-stream" }
        });
      },
      "/api/ai/agent/lease": async (request) => {
        leaseRequestBodies.push((await request.json()) as Record<string, unknown>);
        return Response.json({ ok: true });
      }
    }
  });
  const host: AgentTurnHost = {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    ui: {
      setContextWarning: (value) => fake.recordUiCall("warning", value),
      clearPendingDeliveryDraftTarget: () => fake.recordUiCall("clearDeliveryTarget"),
      setStreaming: (value) => fake.recordUiCall("streaming", value),
      setDraft: (value) => fake.recordUiCall("draft", value),
      setTaskMode: (value) => fake.recordUiCall("taskMode", value),
      openConversation: () => fake.recordUiCall("openConversation"),
      showFailure: () => fake.recordUiCall("failure", true),
      setPendingConfirmation: (value) => fake.recordUiCall("confirmation", value),
      selectObjects: (value) => fake.recordUiCall("selection", value),
      focusObject: (value) => fake.recordUiCall("focus", value),
      openProposal: (value) => fake.recordUiCall("proposal", value)
    },
    abortSlot: fake.abortSlot,
    streamFlushSlot: fake.streamFlushSlot,
    fetch: fake.fetch,
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: [],
      failedItems: []
    }),
    now: fake.now,
    randomSuffix: fake.randomSuffix
  };
  return {
    fake,
    host,
    input: {
      draft: "压缩上下文",
      selectedObjectIds: [],
      agentTurnMode: "auto" as const
    },
    workspace: fake.getWorkspace,
    agentRequestBodies,
    leaseRequestBodies
  };
}

function longConversationWorkspace(): MorphoWorkspace {
  const workspace = createBlankWorkspace("manual-long");
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: Array.from({ length: 6 }, (_, index) => [
        message(`u-${index + 1}`, "user", `用户第 ${index + 1} 轮 ${"要".repeat(90)}`),
        message(`a-${index + 1}`, "assistant", `助手第 ${index + 1} 轮 ${"答".repeat(90)}`)
      ]).flat()
    }
  };
}

function message(id: string, role: "user" | "assistant", body: string): AiMessage {
  return {
    id,
    role,
    body,
    createdAt: "2026-07-27T00:00:00.000Z",
    conversationLaneKey: "lane-manual",
    status: "done"
  };
}

function summaryScript() {
  const outputText = `\`\`\`json\n${JSON.stringify({
    morphoConversationSummary: summary
  })}\n\`\`\``;
  return agentStreamScript([
    {
      type: "turn-start",
      agentTurnId: "manual-compact-unit",
      startedAt: "2026-07-27T00:00:00.000Z",
      leaseId: "lease-manual"
    },
    {
      type: "turn-complete",
      result: streamResult(outputText)
    }
  ]);
}

function streamResult(outputText: string): AgentStreamResult {
  return {
    responseId: "response-manual",
    outputText,
    functionCalls: [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: []
  };
}

function latestManualAssistant(workspace: MorphoWorkspace) {
  const message = [...workspace.ai.messages]
    .reverse()
    .find((candidate) => candidate.id.startsWith("ai-assistant-compact-"));
  if (!message) {
    throw new Error("Manual compaction assistant message was not created.");
  }
  return message;
}

function uiValues(
  fixture: ReturnType<typeof createFixture>,
  name: string
): unknown[] {
  return fixture.fake
    .getEvents()
    .filter((event) => event.kind === "ui" && event.name === name)
    .map((event) => event.value);
}
