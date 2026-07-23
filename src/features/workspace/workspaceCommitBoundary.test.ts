import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it } from "vitest";

import { createResearchOperation } from "@/domain/operations/operations";
import type { AgentTrace, MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { appendAgentTurnMessages } from "./agentTurnMessages";
import {
  applyAgentStreamEventsToTrace,
  completeAgentTrace,
  createAgentTrace,
  finishLocalAgentToolActivity,
  startLocalAgentToolActivity
} from "./agentMessageTrace";
import { commitWorkspaceStateNow } from "./workspaceCommitBoundary";

describe("workspace commit boundary", () => {
  it("preserves streamed trace, concurrent user edits, tool writes, operation data, continuity, and final text", () => {
    const startedAt = "2026-07-13T00:00:00.000Z";
    const assistantMessageId = "assistant-agent";
    let workspace = createInitialWorkspace();
    const targetObjectId = Object.keys(workspace.objects)[0];
    if (!targetObjectId) {
      throw new Error("Expected the demo workspace to contain an object.");
    }
    const originalTitle = workspace.objects[targetObjectId]?.title;
    const setWorkspace: Dispatch<SetStateAction<MorphoWorkspace>> = (update) => {
      workspace = typeof update === "function" ? update(workspace) : update;
    };
    const commit = <T,>(
      transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }
    ): T => commitWorkspaceStateNow(setWorkspace, transform, (callback) => callback());

    commit((current) => {
      const next = appendAgentTurnMessages(current, {
        userMessageId: "user-agent",
        assistantMessageId,
        userBody: "继续整理",
        assistantBody: "",
        createdAt: startedAt,
        contextObjectIds: [targetObjectId],
        conversationLaneKey: "lane:test",
        workIntent: "discussion",
        agentTurnId: "turn-1",
        agentTrace: { ...createAgentTrace(startedAt), agentTurnId: "turn-1" }
      });
      return { workspace: next, value: undefined };
    });

    commit((current) => updateTrace(current, assistantMessageId, (trace) =>
      applyAgentStreamEventsToTrace(
        trace,
        [
          { type: "reasoning-start", partId: "reasoning-1", attemptId: "attempt-a" },
          { type: "reasoning-delta", partId: "reasoning-1", delta: "先核对现有材料。", attemptId: "attempt-a" }
        ],
        "2026-07-13T00:00:01.000Z"
      )
    ));
    commit((current) => updateTrace(current, assistantMessageId, (trace) =>
      startLocalAgentToolActivity(
        trace,
        {
          toolCallId: "tool-1",
          toolName: "create_research_analysis",
          activityKind: "analysis",
          label: "整理研究与分析"
        },
        "2026-07-13T00:00:02.000Z"
      )
    ));

    setWorkspace((current) => ({
      ...current,
      project: { ...current.project, title: "用户并发改名" },
      projectContinuity: {
        ...current.projectContinuity,
        currentFocus: {
          ...current.projectContinuity.currentFocus,
          note: "用户并发更新的连续性焦点"
        }
      }
    }));

    const operationId = commit((current) => {
      const created = createResearchOperation(current, {
        userInput: "继续整理",
        selectedObjectIds: [targetObjectId],
        allowWebSearch: false
      });
      const target = created.workspace.objects[targetObjectId];
      if (!target) {
        throw new Error("Expected the target object to remain available.");
      }
      const next: MorphoWorkspace = {
        ...created.workspace,
        objects: {
          ...created.workspace.objects,
          [targetObjectId]: { ...target, title: `${target.title}（工具更新）` }
        }
      };
      return { workspace: next, value: created.operation.id };
    });

    commit((current) => updateTrace(current, assistantMessageId, (trace) =>
      applyAgentStreamEventsToTrace(
        trace,
        [
          { type: "reasoning-end", partId: "reasoning-1", attemptId: "attempt-a" },
          { type: "commentary-start", partId: "commentary-1", attemptId: "attempt-a" },
          { type: "commentary-delta", partId: "commentary-1", delta: "已写入研究对象。", attemptId: "attempt-a" },
          { type: "commentary-end", partId: "commentary-1", attemptId: "attempt-a" }
        ],
        "2026-07-13T00:00:03.000Z"
      )
    ));
    commit((current) => updateTrace(current, assistantMessageId, (trace) =>
      finishLocalAgentToolActivity(trace, "tool-1", { state: "done" }, "2026-07-13T00:00:04.000Z")
    ));
    commit((current) => {
      const message = current.ai.messages.find((candidate) => candidate.id === assistantMessageId);
      if (!message?.agentTrace) {
        return { workspace: current, value: undefined };
      }
      const trace = message.agentTrace;
      const next: MorphoWorkspace = {
        ...current,
        ai: {
          ...current.ai,
          messages: current.ai.messages.map((candidate) =>
            candidate.id === assistantMessageId
              ? {
                  ...candidate,
                  body: "研究整理已经完成。",
                  status: "done",
                  agentTrace: completeAgentTrace(
                    trace,
                    "done",
                    "2026-07-13T00:00:05.000Z"
                  )
                }
              : candidate
          )
        }
      };
      return { workspace: next, value: undefined };
    });

    const assistantMessage = workspace.ai.messages.find((message) => message.id === assistantMessageId);
    expect(assistantMessage?.body).toBe("研究整理已经完成。");
    expect(assistantMessage?.agentTrace?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "toolActivity",
      "commentary"
    ]);
    expect(assistantMessage?.agentTrace?.parts).toEqual([
      expect.objectContaining({ id: "reasoning-1", text: "先核对现有材料。", state: "done" }),
      expect.objectContaining({ id: "tool-1", state: "done" }),
      expect.objectContaining({ id: "commentary-1", text: "已写入研究对象。", state: "done" })
    ]);
    expect(workspace.project.title).toBe("用户并发改名");
    expect(workspace.projectContinuity.currentFocus.note).toBe("用户并发更新的连续性焦点");
    expect(workspace.operations[operationId]).toMatchObject({ id: operationId, type: "research" });
    expect(workspace.objects[targetObjectId]?.title).toBe(`${originalTitle}（工具更新）`);
  });
});

function updateTrace(
  workspace: MorphoWorkspace,
  messageId: string,
  update: (trace: AgentTrace) => AgentTrace
): { workspace: MorphoWorkspace; value: undefined } {
  const message = workspace.ai.messages.find((candidate) => candidate.id === messageId);
  if (!message?.agentTrace) {
    return { workspace, value: undefined };
  }
  return {
    workspace: {
      ...workspace,
      ai: {
        ...workspace.ai,
        messages: workspace.ai.messages.map((candidate) =>
          candidate.id === messageId ? { ...candidate, agentTrace: update(message.agentTrace!) } : candidate
        )
      }
    },
    value: undefined
  };
}
