import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { AgentStreamFunctionCall } from "@/shared/agentStreamProtocol";
import { createAgentTurnOutcomeItem } from "@/shared/agentCompactionProtocol";
import { agentStreamScript, functionCallScript, textAnswerScript } from "./agentStreamScripts";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnHostFake } from "./agentTurnHostFake";
import {
  runMorphoAgentTurn,
  type RunMorphoAgentTurnInput
} from "./agentTurnRunner";

describe("Morpho Agent turn runner", () => {
  it("completes a text-only turn through the host boundary", async () => {
    const fixture = createFixture([textAnswerScript({ text: "已完成当前讨论。" })]);

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({
      body: "已完成当前讨论。",
      status: "done"
    });
    expect(fixture.requestBodies).toHaveLength(1);
    expect(fixture.fake.abortSlot.get()).toBeNull();
    expect(uiValues(fixture, "streaming")).toEqual([true, false]);
  });

  it("keeps the original candidate terminal state pending when Closure recovery loses both responses", async () => {
    let closureAvailable = false;
    const fixture = createFixture([
      textAnswerScript({ text: "原候选成功回复。" }),
      textAnswerScript({ text: "恢复后继续的新回复。" })
    ], {
      onClosure: (requestBody) => {
        if (closureAvailable) {
          return successfulClosureResponse(requestBody);
        }
        throw new TypeError("simulated closure transport loss");
      }
    });

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.closureRequestBodies).toHaveLength(2);
    expect(fixture.closureRequestBodies[0]).toBe(fixture.closureRequestBodies[1]);
    expect(JSON.parse(fixture.closureRequestBodies[0]!)).toMatchObject({ outcome: "success" });
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({
      body: "本轮执行已结束，但终态待恢复。原候选终态已保留，恢复前不会进入后续上下文。",
      status: "failed"
    });
    expect(latestTurnAssistant(fixture.workspace())).not.toHaveProperty("agentTurnOutcome");
    expect(latestTurnAssistant(fixture.workspace()).agentTurnClosureRecovery).toMatchObject({
      outcome: "success",
      requestBody: fixture.closureRequestBodies[0]
    });
    expect(uiValues(fixture, "failure")).toEqual([true]);

    closureAvailable = true;
    fixture.advanceTime();
    fixture.input.draft = "继续讨论当前项目";
    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.closureRequestBodies[2]).toBe(fixture.closureRequestBodies[0]);
    const recovered = fixture.workspace().ai.messages.find(
      (message) => message.role === "assistant" && message.body === "原候选成功回复。"
    );
    expect(recovered).toMatchObject({ status: "done", agentTurnOutcome: "success" });
    expect(recovered).not.toHaveProperty("agentTurnClosureRecovery");
    expect(latestTurnAssistant(fixture.workspace()).body).toBe("恢复后继续的新回复。");
  });

  it("reminds once for a required read and then finishes with an honest failure notice", async () => {
    const fixture = createFixture([
      textAnswerScript({ text: "我先直接回答。" }),
      textAnswerScript({ text: "仍未读取。" })
    ]);
    fixture.input.draft = "项目记忆里记住了什么";

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.requestBodies).toHaveLength(2);
    expect(fixture.requestBodies[1]).toMatchObject({
      directive: { kind: "requiredRead", tools: ["read_project_memory"] }
    });
    expect(latestTurnAssistant(fixture.workspace()).body).toBe(
      "仍未读取。\n\n读取失败，无法确认相关项目记录（read_project_memory）。本轮不会据此断言不存在或未记录。"
    );
  });

  it.each([
    ["failedDuringProvider", undefined, "failed"],
    ["cancelledDuringProvider", "interrupted", "cancelled"]
  ] as const)("closes a server-recorded %s outcome at the exact Provider sequence", async (
    outcome,
    code,
    expectedStatus
  ) => {
    const fixture = createFixture([agentStreamScript([
      {
        type: "turn-start",
        startedAt: "2026-07-01T00:00:00.000Z",
        leaseId: "lease-provider-failure",
        providerCallCount: 1,
        nextProviderSequence: 2
      },
      {
        type: "turn-error",
        error: outcome === "cancelledDuringProvider" ? "当前执行已取消。" : "Provider 连接失败。",
        ...(code ? { code } : {}),
        providerFailureOutcome: outcome
      }
    ])]);

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(JSON.parse(fixture.closureRequestBodies[0]!)).toMatchObject({
      outcome,
      leaseSequence: 2
    });
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({
      agentTurnOutcome: outcome,
      status: expectedStatus
    });
  });

  it("stops after the fourth invalid tool-argument batch", async () => {
    const scripts = Array.from({ length: 4 }, (_, index) =>
      functionCallScript([
        toolCall("create_research_analysis", {}, `invalid-${index + 1}`)
      ])
    );
    const fixture = createFixture(scripts);

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.requestBodies).toHaveLength(4);
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({ status: "failed" });
    expect(latestTurnAssistant(fixture.workspace()).body).toBe(
      "Agent 连续返回不符合工具 schema 的参数，已停止本轮以避免重复执行。"
    );
    expect(uiValues(fixture, "failure")).toEqual([true]);
  });

  it("short-circuits a confirm-mode write before later calls can execute", async () => {
    const fixture = createFixture([
      functionCallScript(
        [
          toolCall(
            "create_research_analysis",
            {
              title: "待确认研究",
              summary: "尚未写入",
              findings: [],
              opportunities: [],
              constraints: [],
              openQuestions: [],
              evidence: []
            },
            "confirm-write"
          ),
          toolCall(
            "search_web_evidence",
            { queries: ["must not run"], reason: "后续调用" },
            "after-confirmation"
          )
        ],
        { outputText: "等待用户确认。" }
      )
    ]);
    fixture.input.agentTurnMode = "confirm";
    const researchCountBefore = objectsOfType(fixture.workspace(), "research");

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(objectsOfType(fixture.workspace(), "research")).toBe(researchCountBefore);
    expect(fixture.webSearchCount()).toBe(0);
    expect(uiValues(fixture, "confirmation")).toEqual([
      expect.objectContaining({ kind: "agentCreateResearchAnalysis" })
    ]);
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({ status: "done" });
  });

  it("preserves a successful first tool when the batch is aborted before the next call", async () => {
    const fixture = createFixture([
      functionCallScript([
        toolCall(
          "search_web_evidence",
          { queries: ["abort after search"], reason: "测试中止" },
          "search-before-abort"
        ),
        toolCall("read_selected_context", {}, "cancelled-read")
      ])
    ], {
      onWebSearch: (_request, fake) => {
        fake.abortSlot.get()?.abort();
        return Response.json({
          sources: [{ title: "Source", url: "https://example.com/source" }],
          nextProviderSequence: 3
        });
      }
    });

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.webSearchCount()).toBe(1);
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({
      status: "done",
      body: "本轮仅部分完成。已完成结果已保留，未完成步骤需要后续重试。"
    });
    expect(uiValues(fixture, "draft")).toContain(fixture.input.draft);
    expect(fixture.fake.abortSlot.get()).toBeNull();
  });

  it("uses a finalization request after the emergency model-turn ceiling", async () => {
    const toolScripts = Array.from({ length: 28 }, (_, index) =>
      functionCallScript([
        index % 2 === 0
          ? toolCall("read_selected_context", {}, `read-${index}`)
          : toolCall(
              "search_project_conversation",
              { mode: "latest", limit: 1 },
              `conversation-${index}`
            )
      ])
    );
    const fixture = createFixture([
      ...toolScripts,
      textAnswerScript({ text: "已整理此前取得的结果。" })
    ]);

    await runMorphoAgentTurn(fixture.input, fixture.host);

    expect(fixture.requestBodies).toHaveLength(29);
    expect(fixture.requestBodies.at(-1)).toMatchObject({
      directive: { kind: "finalize" }
    });
    expect(latestTurnAssistant(fixture.workspace())).toMatchObject({
      body: "已整理此前取得的结果。",
      status: "done"
    });
  });
});

function createFixture(
  scripts: Array<{ body: string }>,
  options: {
    workspace?: MorphoWorkspace;
    onWebSearch?: (
      request: Request,
      fake: ReturnType<typeof createAgentTurnHostFake>
    ) => Response | Promise<Response>;
    onClosure?: (requestBody: string) => Response | Promise<Response>;
  } = {}
) {
  const requestBodies: Array<Record<string, unknown>> = [];
  const closureRequestBodies: string[] = [];
  let scriptIndex = 0;
  let webSearchCalls = 0;
  const fake = createAgentTurnHostFake({
    workspace: options.workspace ?? createTestWorkspace(),
    routes: {
      "/api/ai/agent": async (request) => {
        requestBodies.push((await request.json()) as Record<string, unknown>);
        const script = scripts[scriptIndex++];
        if (!script) {
          return Response.json({ error: "Unexpected Agent request" }, { status: 500 });
        }
        return new Response(script.body, {
          headers: { "content-type": "text/event-stream" }
        });
      },
      "/api/ai/agent/lease/tool": () => Response.json({ status: "marked" }),
      "/api/ai/agent/lease/finalize-function-calls": () => Response.json({
        status: "pendingConfirmation",
        closureToken: "closure-token-unit-tools-finalized"
      }),
      "/api/ai/agent/snapshot/refresh": () => Response.json({
        transcriptSnapshotToken: "snapshot-token-refreshed",
        transcriptManifestHash: "c".repeat(64),
        expiresAt: Date.now() + 60_000
      }),
      "/api/ai/agent/lease": async (request) => {
        const requestBody = await request.text();
        closureRequestBodies.push(requestBody);
        if (options.onClosure) {
          return options.onClosure(requestBody);
        }
        return successfulClosureResponse(requestBody);
      }
    }
  });
  fake.setFetchRoute("/api/ai/web-search", async (request) => {
    webSearchCalls += 1;
    return options.onWebSearch
      ? options.onWebSearch(request, fake)
      : Response.json({ sources: [], nextProviderSequence: 2 });
  });
  const ui = {
    setContextWarning: (value: string | undefined) =>
      fake.recordUiCall("warning", value),
    clearPendingDeliveryDraftTarget: () => fake.recordUiCall("clearDeliveryTarget"),
    setStreaming: (value: boolean) => fake.recordUiCall("streaming", value),
    setDraft: (value: string) => fake.recordUiCall("draft", value),
    setTaskMode: (value: RunMorphoAgentTurnInput["taskMode"]) =>
      fake.recordUiCall("taskMode", value),
    openConversation: () => fake.recordUiCall("openConversation"),
    showFailure: () => fake.recordUiCall("failure", true),
    setPendingConfirmation: (value: Parameters<AgentTurnHost["ui"]["setPendingConfirmation"]>[0]) =>
      fake.recordUiCall("confirmation", value),
    selectObjects: (objectIds: string[]) => fake.recordUiCall("selection", objectIds),
    focusObject: (objectId: string) => fake.recordUiCall("focus", objectId),
    openProposal: (proposalId: string) => fake.recordUiCall("proposal", proposalId)
  } satisfies AgentTurnHost["ui"];
  let now = fake.now();
  const host: AgentTurnHost = {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    ui,
    abortSlot: fake.abortSlot,
    streamFlushSlot: fake.streamFlushSlot,
    fetch: fake.fetch,
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: [],
      failedItems: []
    }),
    now: () => now,
    randomSuffix: fake.randomSuffix
  };
  const input: RunMorphoAgentTurnInput = {
    draft: "讨论当前项目",
    taskMode: "chatAnalysis",
    recommendedTaskMode: "chatAnalysis",
    workIntent: "discussion",
    recommendedWorkIntent: "discussion",
    selectedObjectIds: [],
    selectedObjects: [],
    pendingDeliveryDraftTarget: null,
    directionPreviewCount: 1,
    agentTurnMode: "auto",
    imageGenerationModelId: "test-image-model",
    readConversationTokenLimits: () => undefined
  };
  return {
    fake,
    host,
    input,
    requestBodies,
    closureRequestBodies,
    workspace: fake.getWorkspace,
    webSearchCount: () => webSearchCalls,
    advanceTime: () => {
      now += 1;
    }
  };
}

function successfulClosureResponse(requestBody: string): Response {
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  if (typeof body.projectId !== "string") {
    return Response.json({ status: body.outcome });
  }
  return Response.json({
    status: body.outcome,
    outcomeItem: createAgentTurnOutcomeItem({
      agentTurnId: String(body.agentTurnId),
      userMessageId: String(body.userMessageId),
      assistantMessageId: String(body.assistantMessageId),
      outcome: body.outcome as "success" | "partialSuccess" | "pendingConfirmation",
      ...(body.outcome === "success" && body.providerOutputSnapshot &&
      typeof body.providerOutputSnapshot === "object" &&
      "text" in body.providerOutputSnapshot &&
      typeof body.providerOutputSnapshot.text === "string"
        ? { successText: body.providerOutputSnapshot.text }
        : {})
    }),
    transcriptSnapshotToken: "snapshot-token-final",
    transcriptManifestHash: "c".repeat(64),
    expiresAt: Date.now() + 60_000
  });
}

function toolCall(
  name: string,
  args: unknown,
  callId: string
): AgentStreamFunctionCall {
  return {
    id: `item-${callId}`,
    callId,
    name,
    argumentsText: JSON.stringify(args)
  };
}

function latestTurnAssistant(workspace: MorphoWorkspace) {
  const message = [...workspace.ai.messages]
    .reverse()
    .find((candidate) => candidate.id.startsWith("ai-assistant-agent-"));
  if (!message) {
    throw new Error("Agent assistant message was not created.");
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

function objectsOfType(workspace: MorphoWorkspace, type: MorphoWorkspace["objects"][string]["type"]) {
  return Object.values(workspace.objects).filter((object) => object.type === type).length;
}
