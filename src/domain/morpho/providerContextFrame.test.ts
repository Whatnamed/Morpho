import { describe, expect, it } from "vitest";

import {
  appendProviderContextFrame,
  buildProviderContextFrameTimeline,
  createProviderContextFrame,
  providerContextFrameMessage,
  type ProviderContextFrameInput
} from "./providerContextFrame";

function frameInput(overrides: Partial<ProviderContextFrameInput> = {}): ProviderContextFrameInput {
  return {
    projectId: "project-ocean-buoy",
    kind: "projectState",
    createdAt: "2026-07-22T00:00:00.000Z",
    promptContractVersion: "morpho-agent-test",
    projectMemoryRevisionIds: ["memory-2", "memory-1"],
    stageRecordRevisionIds: ["stage-1"],
    directionRevisionIds: ["direction-1"],
    selectedObjectIds: ["object-2", "object-1"],
    relatedObjectIds: ["object-1"],
    renderedText: "当前项目状态",
    sourceRefs: [{ kind: "projectMemoryRevision", id: "memory-1" }],
    reason: "测试",
    ...overrides
  };
}

describe("Provider Context Frames", () => {
  it("deduplicates identical content without making timestamps part of the cacheable identity", () => {
    const first = createProviderContextFrame(frameInput());
    const second = createProviderContextFrame(
      frameInput({
        createdAt: "2026-07-22T00:01:00.000Z",
        projectMemoryRevisionIds: ["memory-1", "memory-2"],
        selectedObjectIds: ["object-1", "object-2"]
      })
    );

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.id).toBe(first.id);
    expect(appendProviderContextFrame([first], second)).toEqual([first]);
  });

  it("keeps project-state identity independent from task strategy and selection", () => {
    const first = createProviderContextFrame(frameInput({
      taskStrategy: "discussion",
      selectedObjectIds: []
    }));
    const second = createProviderContextFrame(frameInput({
      taskStrategy: "research",
      selectedObjectIds: ["selected-later"]
    }));

    expect(second.id).toBe(first.id);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("records a new state occurrence after A to B to A while retaining the content identity", () => {
    const defaultA1 = createProviderContextFrame(frameInput({
      sequence: 1,
      defaultReferenceObjectId: "reference-a",
      renderedText: "默认参考 A"
    }));
    const defaultB = createProviderContextFrame(frameInput({
      sequence: 2,
      defaultReferenceObjectId: "reference-b",
      renderedText: "默认参考 B",
      supersedesFrameId: defaultA1.id
    }));
    const defaultA2 = createProviderContextFrame(frameInput({
      sequence: 3,
      defaultReferenceObjectId: "reference-a",
      renderedText: "默认参考 A",
      supersedesFrameId: defaultB.id
    }));
    const repeatedA = createProviderContextFrame(frameInput({
      sequence: 4,
      defaultReferenceObjectId: "reference-a",
      renderedText: "默认参考 A",
      supersedesFrameId: defaultA2.id
    }));

    expect(defaultA2.contentHash).toBe(defaultA1.contentHash);
    expect(defaultA2.id).not.toBe(defaultA1.id);
    expect(
      appendProviderContextFrame(
        appendProviderContextFrame(
          appendProviderContextFrame([defaultA1], defaultB),
          defaultA2
        ),
        repeatedA
      )
    ).toEqual([defaultA1, defaultB, defaultA2]);
  });

  it("records primary-direction and runtime A to B to A occurrences without repeating adjacent values", () => {
    const directionA1 = createProviderContextFrame(frameInput({
      sequence: 1,
      directionRevisionIds: ["direction-a"],
      renderedText: "当前主方向 A"
    }));
    const directionB = createProviderContextFrame(frameInput({
      sequence: 2,
      directionRevisionIds: ["direction-b"],
      renderedText: "当前主方向 B",
      supersedesFrameId: directionA1.id
    }));
    const directionA2 = createProviderContextFrame(frameInput({
      sequence: 3,
      directionRevisionIds: ["direction-a"],
      renderedText: "当前主方向 A",
      supersedesFrameId: directionB.id
    }));
    expect(directionA2.contentHash).toBe(directionA1.contentHash);
    expect(directionA2.id).not.toBe(directionA1.id);

    const runtimeA1 = createProviderContextFrame(frameInput({
      kind: "runtimeConfiguration",
      sequence: 4,
      renderedText: "Agent 模式：auto\nProvider Tool Profile：standard\nPrompt Contract：morpho-agent-test"
    }));
    const runtimeB = createProviderContextFrame(frameInput({
      kind: "runtimeConfiguration",
      sequence: 5,
      renderedText: "Agent 模式：confirm\nProvider Tool Profile：standardWithWebSearch\nPrompt Contract：morpho-agent-test",
      supersedesFrameId: runtimeA1.id
    }));
    const runtimeA2 = createProviderContextFrame(frameInput({
      kind: "runtimeConfiguration",
      sequence: 6,
      renderedText: "Agent 模式：auto\nProvider Tool Profile：standard\nPrompt Contract：morpho-agent-test",
      supersedesFrameId: runtimeB.id
    }));
    const repeatedRuntimeA = createProviderContextFrame(frameInput({
      kind: "runtimeConfiguration",
      sequence: 7,
      renderedText: "Agent 模式：auto\nProvider Tool Profile：standard\nPrompt Contract：morpho-agent-test",
      supersedesFrameId: runtimeA2.id
    }));

    expect(runtimeA2.contentHash).toBe(runtimeA1.contentHash);
    expect(runtimeA2.id).not.toBe(runtimeA1.id);
    expect(
      appendProviderContextFrame(
        appendProviderContextFrame(
          appendProviderContextFrame([runtimeA1], runtimeB),
          runtimeA2
        ),
        repeatedRuntimeA
      )
    ).toEqual([runtimeA1, runtimeB, runtimeA2]);
  });

  it("keeps the latest project/runtime state while dropping stale turn frames outside the active history", () => {
    const oldState = createProviderContextFrame(
      frameInput({
        createdAt: "2026-07-22T00:00:00.000Z",
        renderedText: "旧项目状态",
        anchorMessageId: "message-old"
      })
    );
    const latestState = createProviderContextFrame(
      frameInput({
        createdAt: "2026-07-22T00:02:00.000Z",
        renderedText: "当前项目状态",
        supersedesFrameId: oldState.id,
        anchorMessageId: "message-current"
      })
    );
    const oldTurn = createProviderContextFrame(
      frameInput({
        kind: "turnContext",
        taskStrategy: "research",
        renderedText: "旧回合",
        anchorMessageId: "message-old"
      })
    );
    const currentTurn = createProviderContextFrame(
      frameInput({
        kind: "turnContext",
        taskStrategy: "research",
        renderedText: "当前回合",
        anchorMessageId: "message-current"
      })
    );

    const timeline = buildProviderContextFrameTimeline({
      frames: [oldState, oldTurn, latestState, currentTurn],
      activeMessageIds: new Set(["message-current"])
    });

    expect(timeline.map((frame) => frame.renderedText)).toEqual(["当前项目状态", "当前回合"]);
  });

  it("renders as provider-only system input rather than a normal chat bubble", () => {
    const frame = createProviderContextFrame(frameInput());
    const message = providerContextFrameMessage(frame);

    expect(message.role).toBe("system");
    expect(message.content[0]?.text).toContain("Project State Frame");
    expect(message.content[0]?.text).toContain("当前项目状态");
  });

  it("keeps causal frame order instead of moving post-state before the initiating user", () => {
    const preState = createProviderContextFrame(frameInput({
      sequence: 1,
      placement: "beforeUser",
      anchorMessageId: "user-a",
      renderedText: "前置状态"
    }));
    const turn = createProviderContextFrame(frameInput({
      kind: "turnContext",
      sequence: 2,
      placement: "beforeUser",
      anchorMessageId: "user-a",
      renderedText: "本轮上下文"
    }));
    const postState = createProviderContextFrame(frameInput({
      sequence: 3,
      placement: "afterUser",
      anchorMessageId: "user-a",
      renderedText: "工具后的状态"
    }));

    expect(
      buildProviderContextFrameTimeline({
        frames: [postState, turn, preState],
        activeMessageIds: new Set(["user-a"])
      }).map((frame) => frame.renderedText)
    ).toEqual(["前置状态", "本轮上下文", "工具后的状态"]);
  });

  it("gives one active summary frame a revision identity and drops older summaries", () => {
    const first = createProviderContextFrame(frameInput({
      kind: "conversationSummary",
      sequence: 1,
      summaryRevisionId: "summary-1",
      renderedText: "摘要一"
    }));
    const duplicate = createProviderContextFrame(frameInput({
      kind: "conversationSummary",
      sequence: 2,
      summaryRevisionId: "summary-1",
      renderedText: "摘要一"
    }));
    const second = createProviderContextFrame(frameInput({
      kind: "conversationSummary",
      sequence: 3,
      summaryRevisionId: "summary-2",
      renderedText: "摘要二"
    }));

    expect(first.id).toBe("provider-frame-conversation-summary:summary-1");
    expect(appendProviderContextFrame([first], duplicate)).toHaveLength(1);
    expect(
      buildProviderContextFrameTimeline({
        frames: [first, duplicate, second],
        activeMessageIds: new Set(),
        activeSummaryRevisionId: "summary-2"
      }).map((frame) => frame.renderedText)
    ).toEqual(["摘要二"]);
  });
});
