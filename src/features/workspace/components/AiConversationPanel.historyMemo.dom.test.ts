// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AiMessage, MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";

import {
  AiConversationPanel,
  aiMessageRowRenderCount,
  areAiMessageListPropsEqual
} from "./AiConversationPanel";
import { buildAiConversationPanelProps } from "./aiConversationPanelProps";

/**
 * Guard for the Phase 5 message-list render isolation, in three parts:
 *
 * A. Comparator contract — the list comparator's skip/invalidate decisions.
 * B. Actual render isolation — a render counter inside the row component proves
 *    how many rows really rendered; DOM presence alone proves nothing.
 * C. State preservation — a tail message that becomes historical keeps its DOM
 *    node and its manually expanded Agent Process.
 *
 * Every workspace in these tests is DERIVED from one base instance the way
 * production updates derive (sub-record identities carried over), and every row
 * callback is a shared constant — mirroring the stable useCallbacks the real
 * panel receives. Building fresh workspaces per render would break the
 * comparators for reasons the production app never produces.
 */

const roots = new Set<Root>();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  aiMessageRowRenderCount.current = 0;
});

afterEach(() => {
  act(() => {
    roots.forEach((root) => root.unmount());
  });
  roots.clear();
});

function makeMessages(count: number): AiMessage[] {
  return Array.from({ length: count }, (_, index): AiMessage => ({
    id: `message-memo-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    body: `消息 ${index} 的正文。`,
    status: "done",
    createdAt: "2026-07-01T00:00:00.000Z"
  }));
}

function makeBaseWorkspace(): MorphoWorkspace {
  return { ...createInitialWorkspace(), ai: { ...createInitialWorkspace().ai, messages: [] } };
}

/**
 * Derives the next workspace the way production updates derive: sub-record
 * identities (objects, citation snapshots, comparison analyses) are carried over
 * unchanged, only `ai.messages` is replaced.
 */
function derivedWorkspace(base: MorphoWorkspace, messages: AiMessage[]): MorphoWorkspace {
  return { ...base, ai: { ...base.ai, messages } };
}

const noopComparisonAction = (): void => undefined;
const noopLocate = (): void => undefined;
const noopOpenProjectRecords = (): void => undefined;

function panelProps(workspace: MorphoWorkspace) {
  return buildAiConversationPanelProps({
    workspace,
    onRequestComparisonAction: noopComparisonAction,
    onLocateObject: noopLocate,
    onOpenProjectRecords: noopOpenProjectRecords
  });
}

function renderPanel(container: HTMLElement, workspace: MorphoWorkspace): Root {
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(createElement(AiConversationPanel, panelProps(workspace)));
  });
  return root;
}

describe("A. AiMessageList comparator contract", () => {
  it("skips re-render when no message and no record it reads changed, even on a new workspace identity", () => {
    const base = makeBaseWorkspace();
    const messages = makeMessages(6);
    // Production updates spread the workspace for unrelated reasons; the list
    // must skip when the messages and every record it reads are unchanged.
    const unrelatedUpdate = { ...base, project: { ...base.project, title: "重命名" } };

    expect(areAiMessageListPropsEqual(
      { ...listShared(base), messages },
      { ...listShared(unrelatedUpdate), messages }
    )).toBe(true);
  });

  it("re-renders the list on a streaming tick; row isolation is the row memo's job", () => {
    const base = makeBaseWorkspace();
    const messages = makeMessages(6);
    const tickMessages = [...messages.slice(0, -1), { ...messages.at(-1)!, body: "流式增量…" }];

    expect(areAiMessageListPropsEqual(
      { ...listShared(base), messages },
      { ...listShared(base), messages: tickMessages }
    )).toBe(false);
  });

  it("re-renders when a historical message identity changes", () => {
    const base = makeBaseWorkspace();
    const messages = makeMessages(6);
    const changed = [...messages];
    changed[2] = { ...changed[2]!, body: "历史消息被更新（例如补入项目记录）。" };

    expect(areAiMessageListPropsEqual(
      { ...listShared(base), messages },
      { ...listShared(base), messages: changed }
    )).toBe(false);
  });

  it("re-renders when the list grows or shrinks", () => {
    const base = makeBaseWorkspace();
    const messages = makeMessages(6);
    const grown = [...messages, makeMessages(1)[0]!];

    expect(areAiMessageListPropsEqual(
      { ...listShared(base), messages },
      { ...listShared(base), messages: grown }
    )).toBe(false);
  });

  it("re-renders when records the rows read change identity", () => {
    const base = makeBaseWorkspace();
    const messages = makeMessages(6);
    const objectsChanged = { ...base, objects: { ...base.objects } };
    const citationsChanged = { ...base, citationSnapshots: { ...base.citationSnapshots } };
    const comparisonsChanged = {
      ...base,
      ai: { ...base.ai, comparisonAnalyses: { ...base.ai.comparisonAnalyses } }
    };

    for (const workspace of [objectsChanged, citationsChanged, comparisonsChanged]) {
      expect(areAiMessageListPropsEqual(
        { ...listShared(base), messages },
        { ...listShared(base), messages, workspace }
      )).toBe(false);
    }
  });
});

function listShared(workspace: MorphoWorkspace) {
  return {
    workspace,
    onRequestComparisonAction: noopComparisonAction,
    onLocateObject: noopLocate,
    onOpenProjectRecords: noopOpenProjectRecords
  };
}

describe("B. message row render isolation (counted)", () => {
  it("a streaming tick renders exactly one row; an unrelated re-render renders none", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const base = makeBaseWorkspace();
    const messages = makeMessages(8);
    const root = renderPanel(container, derivedWorkspace(base, messages));
    expect(container.querySelectorAll(".ai-message")).toHaveLength(8);
    expect(aiMessageRowRenderCount.current).toBe(8);

    // Streaming tick: only the last message identity changes, derived from the
    // same workspace instance with the same callbacks.
    const tickMessages = [...messages.slice(0, -1), { ...messages.at(-1)!, body: "正在生成的增量回答……", status: "streaming" as const }];
    act(() => {
      root.render(createElement(AiConversationPanel, panelProps(derivedWorkspace(base, tickMessages))));
    });
    expect(container.querySelectorAll(".ai-message")).toHaveLength(8);
    expect(container.textContent).toContain("正在生成的增量回答……");
    expect(aiMessageRowRenderCount.current).toBe(9);

    // An unrelated panel re-render (e.g. the draft changed) renders no rows.
    act(() => {
      root.render(createElement(AiConversationPanel, { ...panelProps(derivedWorkspace(base, tickMessages)), draft: "草稿变化" }));
    });
    expect(aiMessageRowRenderCount.current).toBe(9);

    // A change to one historical message renders exactly that row.
    const amended = tickMessages.map((message, index) =>
      index === 1 ? { ...message, body: "历史消息被更新。" } : message
    );
    act(() => {
      root.render(createElement(AiConversationPanel, panelProps(derivedWorkspace(base, amended))));
    });
    expect(container.textContent).toContain("历史消息被更新。");
    expect(aiMessageRowRenderCount.current).toBe(10);

    // A record the rows read changes: every row re-renders (correctness
    // fallback — e.g. Compare cards must see updated objects).
    const objectsChanged: MorphoWorkspace = {
      ...derivedWorkspace(base, amended),
      objects: { ...base.objects }
    };
    act(() => {
      root.render(createElement(AiConversationPanel, panelProps(objectsChanged)));
    });
    expect(aiMessageRowRenderCount.current).toBe(18);

    // A late citation snapshot for a HISTORICAL message must still appear.
    const citation = {
      id: "citation-memo-1",
      operationId: "operation-memo-1",
      title: "公开资料",
      url: "https://example.com/material",
      retrievedAt: "2026-07-01T00:00:00.000Z"
    };
    const citedMessages = amended.map((message, index) =>
      index === 1 ? { ...message, citationIds: ["citation-memo-1"] } : message
    );
    act(() => {
      root.render(createElement(AiConversationPanel, panelProps({
        ...derivedWorkspace(base, citedMessages),
        citationSnapshots: { "citation-memo-1": citation }
      })));
    });
    expect(container.textContent).toContain("公开资料");
    expect(container.textContent).toContain("example.com");
  });
});

describe("C. tail -> history state preservation", () => {
  it("tail assistant keeps its manual Agent Process expansion when it becomes history", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const tracedAssistant: AiMessage = {
      id: "message-traced-assistant",
      role: "assistant",
      body: "带过程记录的完成回答。",
      status: "done",
      createdAt: "2026-07-01T00:00:00.000Z",
      agentTrace: {
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:00:01.000Z",
        status: "done",
        parts: [
          {
            id: "trace-part-1",
            type: "commentary",
            text: "先梳理当前设计定义与约束。",
            state: "done",
            createdAt: "2026-07-01T00:00:00.500Z"
          }
        ]
      }
    };
    const initialMessages: AiMessage[] = [makeMessages(2)[0]!, tracedAssistant];
    const base = makeBaseWorkspace();

    const root = renderPanel(container, derivedWorkspace(base, initialMessages));

    const trigger = container.querySelector<HTMLElement>(
      '[data-message-id="message-traced-assistant"] .agent-process-trigger'
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger!.click();
    });
    expect(trigger!.getAttribute("aria-expanded")).toBe("true");

    const rowBefore = container.querySelector('[data-message-id="message-traced-assistant"]');
    const triggerBefore = rowBefore?.querySelector<HTMLElement>(".agent-process-trigger") ?? null;

    // Append the next user message: the traced assistant moves from tail to history.
    const appendedMessages: AiMessage[] = [
      ...initialMessages,
      { ...makeMessages(2)[0]!, id: "message-memo-next", body: "下一条用户消息。" }
    ];
    act(() => {
      root.render(createElement(AiConversationPanel, panelProps(derivedWorkspace(base, appendedMessages))));
    });

    const rowAfter = container.querySelector('[data-message-id="message-traced-assistant"]');
    const triggerAfter = rowAfter?.querySelector<HTMLElement>(".agent-process-trigger") ?? null;

    // DOM identity: the row and its disclosure must be the SAME nodes, not copies.
    expect(rowAfter).toBe(rowBefore);
    expect(triggerAfter).toBe(triggerBefore);
    // The user's manual expansion must survive the tail -> history migration.
    expect(triggerAfter?.getAttribute("aria-expanded")).toBe("true");
  });
});
