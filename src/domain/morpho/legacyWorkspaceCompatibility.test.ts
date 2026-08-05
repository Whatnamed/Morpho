import { describe, expect, it } from "vitest";

import { applyConversationSummaryRevision, hashMessageIds } from "./conversationCompaction";
import { createBlankWorkspace, migrateWorkspaceToCurrentSchema } from "./workspace";

const LEGACY_MESSAGES = [
  {
    id: "legacy-user-1",
    role: "user",
    body: "先确认夜间路径的连续性。",
    createdAt: "2026-07-10T10:00:00.000Z",
    status: "done",
    conversationLaneKey: "legacy-lane",
    pairedMessageId: "legacy-assistant-1"
  },
  {
    id: "legacy-assistant-1",
    role: "assistant",
    body: "已经确认路径需要保持连续。",
    createdAt: "2026-07-10T10:01:00.000Z",
    status: "done",
    conversationLaneKey: "legacy-lane",
    conversationCheckpointId: "legacy-checkpoint",
    pairedMessageId: "legacy-user-1"
  },
  {
    id: "legacy-user-2",
    role: "user",
    body: "再确认转角的施工限制。",
    createdAt: "2026-07-10T10:02:00.000Z",
    status: "done",
    conversationLaneKey: "legacy-lane",
    pairedMessageId: "legacy-assistant-2"
  },
  {
    id: "legacy-assistant-2",
    role: "assistant",
    body: "转角施工限制仍需验证。",
    createdAt: "2026-07-10T10:03:00.000Z",
    status: "done",
    conversationLaneKey: "legacy-lane",
    pairedMessageId: "legacy-user-2"
  }
] as const;

const LEGACY_CHECKPOINT = {
  id: "legacy-checkpoint",
  laneKey: "legacy-lane",
  focusArea: "directionAndVisual",
  focusUpdatedAt: "2026-07-10T10:00:00.000Z",
  taskKind: "general",
  anchorObjectIds: ["legacy-image"],
  targetDirectionIds: [],
  sourceStartMessageId: "legacy-user-1",
  sourceEndMessageId: "legacy-assistant-2",
  sourceMessageCount: LEGACY_MESSAGES.length,
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:04:00.000Z",
  threadGoal: "收敛夜间路径与转角限制",
  progress: ["路径连续性已经确认。"],
  openThreads: ["施工限制仍需验证。"],
  nextTurnAnchor: "继续验证转角施工限制。"
};

describe("Schema 17 legacy workspace compatibility", () => {
  it("migrates one valid legacy checkpoint into a deterministic summary without rewriting messages", () => {
    const legacy = createLegacyWorkspace();
    const before = JSON.stringify(legacy);
    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }

    expect(legacy).toEqual(JSON.parse(before));
    expect(result.workspace.schemaVersion).toBe(17);
    expect(result.workspace.ai).not.toHaveProperty("conversationCheckpoints");
    expect(result.workspace.ai.messages.map((message) => ({
      id: message.id,
      role: message.role,
      body: message.body,
      pairedMessageId: message.pairedMessageId
    }))).toEqual(LEGACY_MESSAGES.map(({ id, role, body, pairedMessageId }) => ({
      id,
      role,
      body,
      pairedMessageId
    })));
    expect(result.workspace.ai.messages.every((message) => {
      return !Object.prototype.hasOwnProperty.call(message, "conversationLaneKey") &&
        !Object.prototype.hasOwnProperty.call(message, "conversationCheckpointId");
    })).toBe(true);

    const revisions = Object.values(result.workspace.ai.conversationSummaryRevisions);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      sourceStartMessageId: "legacy-user-1",
      sourceEndMessageId: "legacy-assistant-2",
      sourceMessageCount: 4,
      sourceMessageIdsHash: hashMessageIds(LEGACY_MESSAGES.map((message) => message.id)),
      summary: {
        threadGoal: LEGACY_CHECKPOINT.threadGoal,
        activeWork: LEGACY_CHECKPOINT.progress,
        unresolvedQuestions: LEGACY_CHECKPOINT.openThreads
      }
    });
    expect(result.workspace.ai.conversationCompaction.summaryRevisionId).toBe(revisions[0]?.id);
    expect(result.workspace.ai.conversationCompaction.coveredThroughMessageId).toBe("legacy-assistant-2");
  });

  it("preserves a valid current summary and does not append a migrated checkpoint summary", () => {
    const legacy = createLegacyWorkspace();
    const ai = legacy.ai as Record<string, unknown>;
    const sourceMessages = LEGACY_MESSAGES.slice(0, 2);
    const sourceMessageIdsHash = hashMessageIds(sourceMessages.map((message) => message.id));
    const currentRevision = {
      id: "summary-current",
      summary: {
        threadGoal: "保留当前项目摘要",
        establishedContext: ["当前摘要已经由项目运行时生成。"],
        decisionsAndReasons: [],
        activeWork: ["继续验证当前方向。"],
        unresolvedQuestions: [],
        referencedObjects: []
      },
      sourceStartMessageId: sourceMessages[0]!.id,
      sourceEndMessageId: sourceMessages[1]!.id,
      sourceMessageCount: sourceMessages.length,
      sourceMessageIdsHash,
      createdAt: "2026-07-10T10:05:00.000Z"
    };
    ai.conversationCompaction = {
      summaryRevisionId: currentRevision.id,
      coveredThroughMessageId: currentRevision.sourceEndMessageId,
      coveredMessageCount: 2,
      updatedAt: currentRevision.createdAt,
      sourceMessageIdsHash
    };
    ai.conversationSummaryRevisions = { [currentRevision.id]: currentRevision };

    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.workspace.ai.conversationSummaryRevisions).toEqual({ [currentRevision.id]: currentRevision });
    expect(result.workspace.ai.conversationCompaction).toEqual(ai.conversationCompaction);
    expect(result.workspace.ai).not.toHaveProperty("conversationCheckpoints");
  });

  it("migrates a valid checkpoint instead of trusting an orphaned summary revision", () => {
    const legacy = createLegacyWorkspace();
    const ai = legacy.ai as Record<string, unknown>;
    const orphan = createOrphanSummaryRevision();
    ai.conversationCompaction = {
      summaryRevisionId: "missing-current-summary",
      coveredThroughMessageId: "missing-assistant",
      coveredMessageCount: 2,
      sourceMessageIdsHash: "corrupted-hash"
    };
    ai.conversationSummaryRevisions = { [orphan.id]: orphan };

    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    const activeRevisionId = result.workspace.ai.conversationCompaction.summaryRevisionId;
    expect(activeRevisionId).toMatch(/^conversation-summary-migrated-/);
    expect(activeRevisionId).not.toBe(orphan.id);
    expect(result.workspace.ai.conversationSummaryRevisions).toHaveProperty(orphan.id);
    expect(result.workspace.ai.conversationSummaryRevisions).toHaveProperty(activeRevisionId!);
  });

  it("clears an invalid active pointer while preserving orphan history and allowing a new summary", () => {
    const legacy = createLegacyWorkspace({ checkpoint: undefined });
    const ai = legacy.ai as Record<string, unknown>;
    const orphan = createOrphanSummaryRevision();
    ai.conversationCompaction = {
      summaryRevisionId: "missing-current-summary",
      coveredThroughMessageId: "missing-assistant",
      coveredMessageCount: 2,
      sourceMessageIdsHash: "corrupted-hash"
    };
    ai.conversationSummaryRevisions = { [orphan.id]: orphan };

    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.workspace.ai.conversationSummaryRevisions).toHaveProperty(orphan.id);
    expect(result.workspace.ai.conversationCompaction).toMatchObject({ coveredMessageCount: 0 });
    expect(result.workspace.ai.conversationCompaction.summaryRevisionId).toBeUndefined();
    expect(result.workspace.ai.conversationCompaction.coveredThroughMessageId).toBeUndefined();

    const reapplied = applyConversationSummaryRevision(result.workspace, {
      summary: {
        threadGoal: "重新建立当前摘要",
        establishedContext: ["旧的孤立摘要仍作为历史记录保留。"],
        decisionsAndReasons: [],
        activeWork: ["继续处理当前项目讨论。"],
        unresolvedQuestions: [],
        referencedObjects: []
      },
      sourceMessageIds: LEGACY_MESSAGES.slice(0, 2).map((message) => message.id),
      expectedPreviousRevisionId: undefined,
      now: "2026-07-10T10:05:00.000Z"
    });

    expect(reapplied.status).toBe("applied");
  });

  it.each([
    ["missing start", { sourceStartMessageId: "missing" }],
    ["missing end", { sourceEndMessageId: "missing" }],
    ["reversed range", { sourceStartMessageId: "legacy-assistant-2", sourceEndMessageId: "legacy-user-1" }],
    ["wrong count", { sourceMessageCount: 3 }],
    ["non-assistant end", { sourceEndMessageId: "legacy-user-2" }]
  ])("does not fabricate a summary for a checkpoint with an invalid %s", (_reason, change) => {
    const legacy = createLegacyWorkspace({ checkpoint: { ...LEGACY_CHECKPOINT, ...change } });
    const result = migrateWorkspaceToCurrentSchema(legacy);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.workspace.ai.conversationSummaryRevisions).toEqual({});
    expect(result.workspace.ai.conversationCompaction).toMatchObject({ coveredMessageCount: 0 });
    expect(result.workspace.ai).not.toHaveProperty("conversationCheckpoints");
  });

  it("strips imageVariant without inferring or changing the image role and is idempotent", () => {
    const legacy = createLegacyWorkspace({ checkpoint: undefined });
    const first = migrateWorkspaceToCurrentSchema(legacy);

    expect(first.status).toBe("ok");
    if (first.status !== "ok") {
      throw new Error(first.reason);
    }
    const image = first.workspace.objects["legacy-image"];
    expect(image).toMatchObject({ type: "image", role: "reference", isDefaultReference: true });
    expect(image).not.toHaveProperty("imageVariant");
    expect(first.workspace.ai.conversationSummaryRevisions).toEqual({});

    const second = migrateWorkspaceToCurrentSchema(first.workspace);
    expect(second).toEqual({ status: "ok", workspace: first.workspace, didMigrate: false });
  });

  it("does not interpret retired checkpoint fields on an already-current schema 17 workspace", () => {
    const current = createLegacyWorkspace();
    current.schemaVersion = 17;
    const result = migrateWorkspaceToCurrentSchema(current);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.didMigrate).toBe(false);
    expect(result.workspace.ai.conversationSummaryRevisions).toEqual({});
    expect(result.workspace.ai.conversationCompaction).toMatchObject({ coveredMessageCount: 0 });
    expect(result.workspace.ai).not.toHaveProperty("conversationCheckpoints");
  });
});

function createLegacyWorkspace(options: {
  checkpoint?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const legacy = JSON.parse(JSON.stringify(createBlankWorkspace("schema-17-legacy-test"))) as Record<string, unknown>;
  legacy.schemaVersion = 16;
  const objects = legacy.objects as Record<string, unknown>;
  objects["legacy-image"] = {
    id: "legacy-image",
    type: "image",
    title: "Legacy reference",
    summary: "A reference retained during migration.",
    createdBy: "user",
    visibility: "active",
    role: "reference",
    imageVariant: "detail",
    assetId: "asset-legacy-image",
    isDefaultReference: true,
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:00.000Z"
  };

  const ai = legacy.ai as Record<string, unknown>;
  ai.messages = [...LEGACY_MESSAGES];
  const checkpoint = Object.prototype.hasOwnProperty.call(options, "checkpoint") ? options.checkpoint : LEGACY_CHECKPOINT;
  ai.conversationCheckpoints = checkpoint === undefined ? [] : [checkpoint];
  ai.conversationCompaction = { coveredMessageCount: 0 };
  ai.conversationSummaryRevisions = {};
  return legacy;
}

function createOrphanSummaryRevision() {
  const sourceMessages = LEGACY_MESSAGES.slice(0, 2);
  return {
    id: "orphan-summary",
    summary: {
      threadGoal: "历史摘要仍可被读取",
      establishedContext: ["这是一份没有被当前 compaction state 指向的历史摘要。"],
      decisionsAndReasons: [],
      activeWork: ["保留历史证据。"],
      unresolvedQuestions: [],
      referencedObjects: []
    },
    sourceStartMessageId: sourceMessages[0]!.id,
    sourceEndMessageId: sourceMessages[1]!.id,
    sourceMessageCount: sourceMessages.length,
    sourceMessageIdsHash: hashMessageIds(sourceMessages.map((message) => message.id)),
    createdAt: "2026-07-10T10:04:30.000Z"
  };
}
