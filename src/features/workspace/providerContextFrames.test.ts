import { describe, expect, it } from "vitest";

import { createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { createProviderContextFrame, type ProviderContextFrameInput } from "@/domain/morpho/providerContextFrame";
import { createBlankWorkspace, migrateWorkspaceToCurrentSchema } from "@/domain/morpho/workspace";
import {
  appendAgentProviderRuntimeConfigurationFrame,
  buildAgentProviderInput,
  ensureAgentConversationSummaryBaselines,
  getProviderInputReplayBoundaryReasons
} from "./providerContextFrames";

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

  it("creates one current state baseline per summary revision and restores it idempotently", () => {
    const summaryA = summaryRevision("summary-a", "旧摘要上下文");
    const oldState = createProviderContextFrame(frameInput({
      sequence: 1,
      anchorMessageId: "covered-user",
      renderedText: "旧锚定项目状态"
    }));
    let workspace = createBlankWorkspace("project-ocean-buoy");
    workspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        conversationSummaryRevisions: { [summaryA.id]: summaryA },
        conversationCompaction: {
          summaryRevisionId: summaryA.id,
          coveredThroughMessageId: "covered-assistant",
          coveredMessageCount: 2,
          updatedAt: summaryA.createdAt,
          sourceMessageIdsHash: summaryA.sourceMessageIdsHash
        },
        providerContextFrames: [oldState]
      }
    };
    workspace = appendAgentProviderRuntimeConfigurationFrame(workspace, {
      projectId: workspace.project.id,
      promptContractVersion: "morpho-agent-test",
      mode: "auto",
      toolProfile: "standard",
      userMessageId: "covered-user"
    });
    const compacted = ensureAgentConversationSummaryBaselines(workspace, {
      projectId: workspace.project.id,
      promptContractVersion: "morpho-agent-test",
      summaryRevision: summaryA,
      mode: "auto"
    });
    const compactedAgain = ensureAgentConversationSummaryBaselines(compacted, {
      projectId: compacted.project.id,
      promptContractVersion: "morpho-agent-test",
      summaryRevision: summaryA,
      mode: "auto"
    });
    const baselines = compactedAgain.ai.providerContextFrames?.filter(
      (frame) => frame.placement === "conversationBaseline" && frame.summaryRevisionId === summaryA.id
    ) ?? [];

    expect(baselines.map((frame) => frame.kind).sort()).toEqual([
      "conversationSummary",
      "projectState",
      "runtimeConfiguration"
    ]);
    expect(compactedAgain.ai.providerContextFrames).toEqual(compacted.ai.providerContextFrames);

    const input = buildAgentProviderInput({
      stableSystemPrompt: "稳定规则",
      frames: compactedAgain.ai.providerContextFrames ?? [],
      history: [{ id: "after-user", role: "user", body: "压缩后的问题" }],
      currentUserMessageId: "current-user",
      userInput: userMessage("当前问题"),
      activeSummaryRevisionId: summaryA.id
    });
    const serialized = JSON.stringify(input);
    expect(serialized).toContain("项目聊天摘要目标：旧摘要上下文");
    expect(serialized).toContain("当前没有已确定主方向。");
    expect(serialized).toContain("Provider Tool Profile：standard");
    expect(serialized).not.toContain("旧锚定项目状态");

    const summaryB = summaryRevision("summary-b", "新摘要上下文");
    const withSecondRevision = ensureAgentConversationSummaryBaselines(
      {
        ...compactedAgain,
        ai: {
          ...compactedAgain.ai,
          conversationSummaryRevisions: {
            ...compactedAgain.ai.conversationSummaryRevisions,
            [summaryB.id]: summaryB
          },
          conversationCompaction: {
            ...compactedAgain.ai.conversationCompaction,
            summaryRevisionId: summaryB.id,
            coveredThroughMessageId: summaryB.sourceEndMessageId,
            sourceMessageIdsHash: summaryB.sourceMessageIdsHash
          }
        }
      },
      {
        projectId: compactedAgain.project.id,
        promptContractVersion: "morpho-agent-test",
        summaryRevision: summaryB,
        mode: "auto"
      }
    );
    expect(
      withSecondRevision.ai.providerContextFrames?.filter(
        (frame) => frame.placement === "conversationBaseline" && frame.summaryRevisionId === summaryB.id
      )
    ).toHaveLength(3);

    const restored = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(withSecondRevision)));
    expect(restored.status).toBe("ok");
    if (restored.status !== "ok") {
      throw new Error(restored.reason);
    }
    expect(
      ensureAgentConversationSummaryBaselines(restored.workspace, {
        projectId: restored.workspace.project.id,
        promptContractVersion: "morpho-agent-test",
        summaryRevision: summaryB,
        mode: "auto"
      }).ai.providerContextFrames
    ).toEqual(restored.workspace.ai.providerContextFrames);
  });

  it("reports only the boundary between adjacent provider requests", () => {
    const imageSnapshot = createProviderInputSnapshot({
      message: userMessage("图像分析"),
      promptContractVersion: "morpho-agent-test",
      attachmentRefs: [{ objectId: "image-buoy" }]
    });
    const plainSnapshot = createProviderInputSnapshot({
      message: userMessage("继续讨论"),
      promptContractVersion: "morpho-agent-test"
    });
    const previous = {
      promptContractVersion: "morpho-agent-test",
      toolProfile: "standard" as const,
      latestUserMessageId: "user-before"
    };
    const imageCurrent = {
      promptContractVersion: "morpho-agent-test",
      toolProfile: "standard" as const,
      latestUserMessageId: "user-image",
      attachmentBoundary: "imageInput" as const
    };

    expect(
      getProviderInputReplayBoundaryReasons(
        [{ id: "user-image", role: "user", providerInputSnapshot: imageSnapshot }],
        { previousRequestState: previous, currentRequestState: imageCurrent }
      )
    ).toEqual(["imageInput"]);
    expect(
      getProviderInputReplayBoundaryReasons(
        [
          { id: "user-image", role: "user", providerInputSnapshot: imageSnapshot },
          { id: "user-plain", role: "user", providerInputSnapshot: plainSnapshot }
        ],
        {
          previousRequestState: imageCurrent,
          currentRequestState: {
            promptContractVersion: "morpho-agent-test",
            toolProfile: "standard",
            latestUserMessageId: "user-plain"
          }
        }
      )
    ).toEqual([]);
    expect(
      getProviderInputReplayBoundaryReasons([], {
        previousRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standard",
          summaryRevisionId: "summary-a"
        },
        currentRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standardWithWebSearch",
          summaryRevisionId: "summary-b"
        }
      })
    ).toEqual(["toolProfileChanged", "compaction"]);
    expect(
      getProviderInputReplayBoundaryReasons([], {
        previousRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standardWithWebSearch",
          summaryRevisionId: "summary-b"
        },
        currentRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standardWithWebSearch",
          summaryRevisionId: "summary-b"
        }
      })
    ).toEqual([]);
    expect(
      getProviderInputReplayBoundaryReasons([], {
        previousRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standardWithWebSearch"
        },
        currentRequestState: {
          promptContractVersion: "morpho-agent-test",
          toolProfile: "standard"
        }
      })
    ).toEqual(["toolProfileChanged"]);
  });
});

function summaryRevision(id: string, goal: string) {
  return {
    id,
    sourceStartMessageId: "covered-user",
    sourceEndMessageId: "covered-assistant",
    sourceMessageCount: 2,
    sourceMessageIdsHash: `${id}-hash`,
    createdAt: "2026-07-23T00:00:00.000Z",
    summary: {
      threadGoal: goal,
      establishedContext: ["海洋浮标项目"],
      decisionsAndReasons: ["保留高可见性"],
      activeWork: ["继续验证"],
      unresolvedQuestions: ["维护方式"],
      referencedObjects: []
    }
  };
}
