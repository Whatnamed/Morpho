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
