import { describe, expect, it } from "vitest";

import { createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { createProviderContextFrame, type ProviderContextFrameInput } from "@/domain/morpho/providerContextFrame";
import { buildAgentProviderInput, getProviderInputReplayBoundaryReasons } from "./providerContextFrames";

function frameInput(overrides: Partial<ProviderContextFrameInput> = {}): ProviderContextFrameInput {
  return {
    projectId: "project-ocean-buoy",
    kind: "projectState",
    createdAt: "2026-07-22T00:00:00.000Z",
    sequence: 1,
    placement: "beforeUser",
    anchorMessageId: "user-a",
    promptContractVersion: "morpho-agent-test",
    projectMemoryRevisionIds: [],
    stageRecordRevisionIds: [],
    directionRevisionIds: [],
    selectedObjectIds: [],
    relatedObjectIds: [],
    renderedText: "项目状态",
    sourceRefs: [],
    reason: "测试",
    ...overrides
  };
}

function userMessage(text: string) {
  return {
    role: "user" as const,
    content: [{ type: "input_text" as const, text }]
  };
}

describe("Agent provider transcript reconstruction", () => {
  it("replays a persisted user snapshot so the next turn keeps the previous prefix", () => {
    const state = createProviderContextFrame(frameInput({ sequence: 1, renderedText: "项目状态" }));
    const turnA = createProviderContextFrame(
      frameInput({ kind: "turnContext", sequence: 2, renderedText: "回合 A", taskStrategy: "discussion" })
    );
    const turnB = createProviderContextFrame(
      frameInput({
        kind: "turnContext",
        sequence: 3,
        anchorMessageId: "user-b",
        renderedText: "回合 B",
        taskStrategy: "discussion"
      })
    );
    const snapshot = createProviderInputSnapshot({
      message: userMessage("Provider-visible enhanced input A"),
      promptContractVersion: "morpho-agent-test"
    });
    const first = buildAgentProviderInput({
      stableSystemPrompt: "稳定规则",
      frames: [state, turnA, turnB],
      history: [],
      currentUserMessageId: "user-a",
      userInput: userMessage("Provider-visible enhanced input A")
    });
    const next = buildAgentProviderInput({
      stableSystemPrompt: "稳定规则",
      frames: [state, turnA, turnB],
      history: [
        { id: "user-a", role: "user", body: "原始草稿 A", providerInputSnapshot: snapshot },
        { id: "assistant-a", role: "assistant", body: "回答 A" }
      ],
      currentUserMessageId: "user-b",
      userInput: userMessage("输入 B")
    });

    expect(next.slice(0, first.length)).toEqual(first);
    expect(next.map((item) => JSON.stringify(item)).join("\n")).toContain("Provider-visible enhanced input A");
    expect(getProviderInputReplayBoundaryReasons([{ role: "user", providerInputSnapshot: snapshot }])).toEqual([]);
  });

  it("puts a post-tool project state after the initiating user and before its assistant message", () => {
    const frames = [
      createProviderContextFrame(frameInput({ sequence: 1, renderedText: "前置状态" })),
      createProviderContextFrame(frameInput({ kind: "turnContext", sequence: 2, renderedText: "回合上下文", taskStrategy: "discussion" })),
      createProviderContextFrame(
        frameInput({ sequence: 3, placement: "afterUser", renderedText: "工具后的状态" })
      )
    ];
    const input = buildAgentProviderInput({
      stableSystemPrompt: "稳定规则",
      frames,
      history: [{ id: "user-a", role: "user", body: "用户 A" }, { id: "assistant-a", role: "assistant", body: "回答 A" }],
      currentUserMessageId: "user-b",
      userInput: userMessage("用户 B")
    });
    const texts = input.map((item) =>
      item.content.map((part) => ("text" in part ? part.text : "[image]")).join("\n")
    );
    const userIndex = texts.findIndex((text) => text.includes("用户 A"));
    const postStateIndex = texts.findIndex((text) => text.includes("工具后的状态"));
    const assistantIndex = texts.findIndex((text) => text.includes("回答 A"));
    expect(userIndex).toBeLessThan(postStateIndex);
    expect(postStateIndex).toBeLessThan(assistantIndex);
  });

  it("marks legacy raw user history as a cache boundary instead of silently claiming a hit", () => {
    expect(getProviderInputReplayBoundaryReasons([
      { role: "user" },
      { role: "assistant" }
    ])).toEqual(["legacyProviderInput"]);
  });

  it("reports prompt-contract and tool-profile changes as explicit cache boundaries", () => {
    const snapshot = createProviderInputSnapshot({
      message: userMessage("原始 Provider 输入"),
      promptContractVersion: "morpho-agent-v1"
    });
    const oldRuntime = createProviderContextFrame(frameInput({
      kind: "runtimeConfiguration",
      sequence: 1,
      renderedText: "Agent 模式：chat\nProvider Tool Profile：standard\nPrompt Contract：morpho-agent-v1"
    }));

    expect(
      getProviderInputReplayBoundaryReasons(
        [{ role: "user", providerInputSnapshot: snapshot }],
        {
          currentPromptContractVersion: "morpho-agent-v2",
          currentToolProfile: "standardWithWebSearch",
          frames: [oldRuntime]
        }
      )
    ).toEqual(["promptContractChanged", "toolProfileChanged"]);
  });
});
