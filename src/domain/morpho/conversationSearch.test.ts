import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "./workspace";
import { searchProjectConversation } from "./conversationSearch";
import type { AiMessage, MorphoWorkspace } from "./types";

describe("project conversation search", () => {
  it("finds the earliest and latest user messages across conversation lane labels", () => {
    const workspace = fixture();
    const earliest = searchProjectConversation(workspace, { mode: "earliest", neighborCount: 1 });
    const latest = searchProjectConversation(workspace, { mode: "latest", role: "user", neighborCount: 0 });

    expect(earliest.matches[0]?.message).toMatchObject({ messageId: "m1", body: "最早先讨论夜间路径。" });
    expect(earliest.matches[0]?.after[0]?.messageId).toBe("m2");
    expect(latest.matches[0]?.message.messageId).toBe("m5");
  });

  it("supports keyword, role, time range, bounded results, and neighbor context", () => {
    const result = searchProjectConversation(fixture(), {
      mode: "keyword",
      keyword: "默认参考",
      role: "any",
      from: "2026-07-13T10:01:00.000Z",
      to: "2026-07-13T10:05:00.000Z",
      limit: 1,
      neighborCount: 2
    });

    expect(result.totalMatched).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.matches[0]?.message).toMatchObject({ messageId: "m3", role: "user" });
    expect(result.matches[0]?.before.map((entry) => entry.messageId)).toEqual(["m1", "m2"]);
    expect(result.matches[0]?.after.map((entry) => entry.messageId)).toEqual(["m4", "m5"]);
  });

  it("keeps original messages queryable after they are covered by a summary revision", () => {
    const workspace = fixture();
    const summarized: MorphoWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        conversationCompaction: {
          summaryRevisionId: "summary-1",
          coveredThroughMessageId: "m4",
          coveredMessageCount: 4
        },
        conversationSummaryRevisions: {
          "summary-1": {
            id: "summary-1",
            summary: {
              threadGoal: "收敛默认参考",
              establishedContext: [],
              decisionsAndReasons: [],
              activeWork: [],
              unresolvedQuestions: [],
              referencedObjects: []
            },
            sourceStartMessageId: "m1",
            sourceEndMessageId: "m4",
            sourceMessageCount: 4,
            sourceMessageIdsHash: "test-hash",
            createdAt: "2026-07-13T11:00:00.000Z"
          }
        }
      }
    };

    expect(searchProjectConversation(summarized, { mode: "keyword", keyword: "最早" }).matches[0]?.message.messageId).toBe("m1");
  });

  it("keeps UI-only compaction messages and failed/cancelled turns out of normal search unless diagnostics are requested", () => {
    const workspace = fixture();
    const withDiagnostics: MorphoWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        messages: [
          ...workspace.ai.messages,
          { ...item("ui-only", "user", "diagnostic ui-only", "10:06", "lane-c"), contextVisibility: "uiOnly" },
          { ...item("failed", "assistant", "diagnostic failed", "10:07", "lane-c"), status: "failed", error: "upstream" },
          { ...item("cancelled", "assistant", "diagnostic cancelled", "10:08", "lane-c"), status: "cancelled" }
        ]
      }
    };

    expect(searchProjectConversation(withDiagnostics, { mode: "keyword", keyword: "diagnostic" }).totalMatched).toBe(0);
    const diagnostics = searchProjectConversation(withDiagnostics, {
      mode: "keyword",
      keyword: "diagnostic",
      includeDiagnostics: true,
      limit: 5
    });
    expect(diagnostics.totalMatched).toBe(3);
    expect(diagnostics.query.includeDiagnostics).toBe(true);
  });
});

function fixture(): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-search-test");
  const messages: AiMessage[] = [
    item("m1", "user", "最早先讨论夜间路径。", "10:00", "lane-a"),
    item("m2", "assistant", "先梳理路径与扶持边界。", "10:01", "lane-a"),
    item("m3", "user", "后来为什么把柔光轨道设为默认参考？", "10:02", "lane-b"),
    item("m4", "assistant", "因为它最能保持主方向的一致性，所以设置默认参考。", "10:03", "lane-b"),
    item("m5", "user", "现在进度到哪里？", "10:04", "lane-c"),
    { ...item("m6", "assistant", "未完成内容", "10:05", "lane-c"), status: "streaming" }
  ];
  return { ...workspace, ai: { ...workspace.ai, messages } };
}

function item(
  id: string,
  role: "user" | "assistant",
  body: string,
  time: string,
  conversationLaneKey: string
): AiMessage {
  return {
    id,
    role,
    body,
    createdAt: `2026-07-13T${time}:00.000Z`,
    conversationLaneKey,
    status: "done"
  };
}
