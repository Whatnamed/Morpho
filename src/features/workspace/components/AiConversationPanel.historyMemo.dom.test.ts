// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AiMessage, MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";

import {
  AiConversationPanel,
  areAiMessageHistoryPropsEqual
} from "./AiConversationPanel";
import { buildAiConversationPanelProps } from "./aiConversationPanelProps";

/**
 * Guard for the Phase 5 history/tail render split.
 *
 * The isolation is only correct while the comparator treats exactly the inputs a
 * row reads: message element identities, list length, objects, citation snapshots,
 * comparison analyses, and the row callbacks. These tests pin both directions —
 * the skip (streaming tick must not reconcile the whole list) and the fallback
 * (a real change to history must re-render).
 */

const roots = new Set<Root>();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

function workspaceWithMessages(messages: AiMessage[]): MorphoWorkspace {
  const workspace = createInitialWorkspace();
  return {
    ...workspace,
    ai: { ...workspace.ai, messages }
  };
}

/** Stable like the production useCallback the panel actually receives. */
const noopOpenProjectRecords = (): void => undefined;

function sharedProps(messages: AiMessage[]) {
  const workspace = workspaceWithMessages(messages);
  return {
    workspace,
    messages,
    onRequestComparisonAction: undefined,
    onLocateObject: undefined,
    onOpenProjectRecords: noopOpenProjectRecords
  };
}

describe("AiConversationPanel history memo", () => {
  it("skips re-render when only the streaming tail changed and identities hold", () => {
    const base = sharedProps(makeMessages(6));
    // Streaming tick: only the last message identity changes, and the workspace is
    // derived from the same instance the way production updates derive — sub-record
    // identities (objects, citations, analyses) are carried over unchanged.
    const tickMessages = [...base.messages.slice(0, -1), { ...base.messages.at(-1)!, body: "流式增量…" }];

    expect(areAiMessageHistoryPropsEqual(
      { ...base, messages: base.messages.slice(0, -1) },
      {
        ...base,
        messages: tickMessages.slice(0, -1),
        workspace: { ...base.workspace, ai: { ...base.workspace.ai, messages: tickMessages } }
      }
    )).toBe(true);
  });

  it("re-renders when a historical message identity changes", () => {
    const base = sharedProps(makeMessages(6));
    const changed = [...base.messages];
    changed[2] = { ...changed[2]!, body: "历史消息被更新（例如补入项目记录）。" };
    const next = sharedProps(changed);

    expect(areAiMessageHistoryPropsEqual(
      { ...base, messages: base.messages.slice(0, -1) },
      { ...next, messages: next.messages.slice(0, -1) }
    )).toBe(false);
  });

  it("re-renders when the list grows or shrinks", () => {
    const base = sharedProps(makeMessages(6));
    const grown = sharedProps([...base.messages, makeMessages(1)[0]!]);

    expect(areAiMessageHistoryPropsEqual(
      { ...base, messages: base.messages.slice(0, -1) },
      { ...grown, messages: grown.messages.slice(0, -1) }
    )).toBe(false);
  });

  it("re-renders when records the rows read change identity", () => {
    const base = sharedProps(makeMessages(6));
    const objectsChanged = { ...base.workspace, objects: { ...base.workspace.objects } };
    const citationsChanged = { ...base.workspace, citationSnapshots: { ...base.workspace.citationSnapshots } };
    const comparisonsChanged = {
      ...base.workspace,
      ai: { ...base.workspace.ai, comparisonAnalyses: { ...base.workspace.ai.comparisonAnalyses } }
    };

    for (const workspace of [objectsChanged, citationsChanged, comparisonsChanged]) {
      expect(areAiMessageHistoryPropsEqual(
        { ...base, messages: base.messages.slice(0, -1) },
        { ...base, messages: base.messages.slice(0, -1), workspace }
      )).toBe(false);
    }
  });

  it("keeps every row mounted while a streaming tick only re-renders the tail", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.add(root);

    const messages = makeMessages(8);
    const baseProps = buildAiConversationPanelProps({ workspace: workspaceWithMessages(messages) });

    act(() => {
      root.render(createElement(AiConversationPanel, baseProps));
    });
    expect(container.querySelectorAll(".ai-message")).toHaveLength(8);

    // Streaming tick: only the last message identity changes.
    const tickMessages = [...messages.slice(0, -1), { ...messages.at(-1)!, body: "正在生成的增量回答……", status: "streaming" as const }];
    const tickProps = buildAiConversationPanelProps({ workspace: workspaceWithMessages(tickMessages) });
    act(() => {
      root.render(createElement(AiConversationPanel, tickProps));
    });

    const rows = container.querySelectorAll(".ai-message");
    expect(rows).toHaveLength(8);
    expect(rows[rows.length - 1]?.getAttribute("data-message-id")).toBe("message-memo-7");
    expect(container.textContent).toContain("正在生成的增量回答……");
    // History rows keep their DOM anchors (keys unchanged), which is what message
    // navigation and scroll anchoring rely on.
    expect(rows[0]?.getAttribute("data-message-id")).toBe("message-memo-0");

    // A late citation snapshot for a HISTORICAL message must still appear: the
    // comparator falls back to a full segment re-render on record changes.
    const citation = {
      id: "citation-memo-1",
      operationId: "operation-memo-1",
      title: "公开资料",
      url: "https://example.com/material",
      retrievedAt: "2026-07-01T00:00:00.000Z"
    };
    const citedMessages = messages.map((message, index) =>
      index === 1 ? { ...message, citationIds: ["citation-memo-1"] } : message
    );
    const citedWorkspace: MorphoWorkspace = {
      ...workspaceWithMessages(citedMessages),
      citationSnapshots: { "citation-memo-1": citation }
    };
    act(() => {
      root.render(createElement(AiConversationPanel, buildAiConversationPanelProps({ workspace: citedWorkspace })));
    });
    expect(container.textContent).toContain("公开资料");
    expect(container.textContent).toContain("example.com");
  });
});
