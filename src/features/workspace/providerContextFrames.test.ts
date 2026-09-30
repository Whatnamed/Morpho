import { describe, expect, it } from "vitest";
import { resolveCurrentDesignDefinition } from "@/domain/morpho/derivedState";
import { applyDesignDefinitionProposal, recordDesignDefinitionProposal } from "@/domain/operations/operations";
import { deleteObject, hideObjects } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";

import {
  createProviderContextFrame,
  providerContextFrameMessage,
  type ProviderContextFrameInput
} from "@/domain/morpho/providerContextFrame";
import {
  buildAgentDefaultMemoryContext,
  type AgentDefaultMemoryContext
} from "@/domain/morpho/projectMemory";
import { createBlankWorkspace, createInitialWorkspace, migrateWorkspaceToCurrentSchema } from "@/domain/morpho/workspace";
import { estimateProviderSerializedTokens } from "@/shared/providerInputBudget";
import {
  appendAgentProviderContextFrames,
  buildAgentMemoryDeltaContext,
  ensureAgentConversationSummaryBaselines,
  getLatestProviderRuntimeConfiguration
} from "./providerContextFrames";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";

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

describe("Provider Context Frames", () => {
  it("reads independent definition B after A, preserves hidden-current identity, and never falls back after deletion", () => {
    let workspace = createBlankWorkspace("project-definition-integrity");
    for (const title of ["Definition A", "Definition B"]) {
      const proposed = recordDesignDefinitionProposal(workspace, {
        proposalId: title, workIntent: "createDesignDefinition", title, summary: title,
        projectGoal: title, targetUsers: [], primaryScenarios: [], coreProblem: title,
        designPrinciples: [], constraints: [], avoidDirections: [], opportunities: [],
        openQuestions: [], sourceObjectIds: [], citations: []
      });
      const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);
      if (applied.status !== "updated") throw new Error("Expected definition application.");
      workspace = applied.workspace;
    }
    const current = resolveCurrentDesignDefinition(workspace)!;
    expect(current.object.id).toBe(workspace.workingState.currentDesignDefinitionId);
    expect(current.revision.title).toBe("Definition B");
    expect(projectFrame(workspace)).toMatchObject({ designDefinitionRevisionId: current.object.currentRevisionId });
    expect(projectFrame(workspace)?.renderedText).toContain("当前设计定义：Definition B");

    const hidden = hideObjects(workspace, [current.object.id]);
    expect(resolveCurrentDesignDefinition(hidden)).toMatchObject({ object: { id: current.object.id }, availability: "hidden" });
    expect(projectFrame(hidden)?.designDefinitionRevisionId).toBeUndefined();
    expect(projectFrame(hidden)?.renderedText).toContain("当前设计定义已隐藏");
    expect(projectFrame(hidden)?.renderedText).not.toContain("当前设计定义：Definition A");

    const deleted = deleteObject(hidden, current.object.id, { confirmed: true });
    if (deleted.status !== "updated") throw new Error("Expected deletion.");
    expect(resolveCurrentDesignDefinition(deleted.workspace)).toBeUndefined();
    expect(projectFrame(deleted.workspace)?.designDefinitionRevisionId).toBeUndefined();
    expect(projectFrame(deleted.workspace)?.renderedText).toContain("当前没有已应用设计定义");
  });
  it("keeps task strategy policy out of the untrusted turn context frame", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "research",
      draft: "调研海洋浮标",
      selectedObjectIds: []
    });
    const next = appendAgentProviderContextFrames(workspace, {
      workspace,
      projectId: workspace.project.id,
      strategy: "research",
      mode: "auto",
      toolProfile: "standard",
      promptContractVersion: "morpho-agent-test",
      userMessageId: "user-research",
      context,
      providerTaskContext: buildProviderTaskContext(context),
      defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "research")
    });
    const turnFrame = next.ai.providerContextFrames?.find(
      (frame) => frame.kind === "turnContext" && frame.anchorMessageId === "user-research"
    );

    expect(turnFrame?.renderedText).toContain("本轮任务策略：research");
    expect(turnFrame?.renderedText).not.toContain("先使用本地已授权资料");
    expect(getLatestProviderRuntimeConfiguration(next.ai.providerContextFrames ?? [])).toMatchObject({
      mode: "auto",
      toolProfile: "standard",
      promptContractVersion: "morpho-agent-test"
    });
  });

  it("includes the formal key conclusion category in the selected turn context", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "继续讨论当前关键结论",
      selectedObjectIds: ["insight-continuous-support"]
    });
    const next = appendAgentProviderContextFrames(workspace, {
      workspace,
      projectId: workspace.project.id,
      strategy: "research",
      mode: "auto",
      toolProfile: "standard",
      promptContractVersion: "morpho-agent-test",
      userMessageId: "user-key-conclusion-category",
      context,
      providerTaskContext: buildProviderTaskContext(context),
      defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "research")
    });

    expect(next.ai.providerContextFrames?.find(
      (frame) => frame.kind === "turnContext" && frame.anchorMessageId === "user-key-conclusion-category"
    )?.renderedText).toContain("[category=unknown]");
  });

  it("adds provider frames without changing conversation messages or compaction state", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "继续讨论",
      selectedObjectIds: []
    });
    const messages = workspace.ai.messages;
    const compaction = workspace.ai.conversationCompaction;

    const next = appendAgentProviderContextFrames(workspace, {
      workspace,
      projectId: workspace.project.id,
      strategy: "discussion",
      mode: "auto",
      promptContractVersion: "morpho-agent-test",
      userMessageId: "user-conversation-invariant",
      context,
      providerTaskContext: buildProviderTaskContext(context),
      defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "discussion")
    });

    expect(next.ai.messages).toBe(messages);
    expect(next.ai.conversationCompaction).toBe(compaction);
  });

  it("serializes a frame as untrusted product data without a B context marker proof", () => {
    const frame = createProviderContextFrame(frameInput());
    const text = providerContextFrameMessage(frame).content[0].text;

    expect(text).toContain("Morpho Untrusted Project Data");
    expect(text).toContain('"renderedText":"项目状态"');
    expect(text).toContain(`"contentHash":"${frame.contentHash}"`);
    expect(text).not.toContain("morpho_context_state");
    expect(text).not.toContain("causalBindingHash");
  });

  it("creates one idempotent product-state baseline per summary revision and reloads it", () => {
    const revision = summaryRevision("summary-a", "旧摘要上下文");
    let workspace = createBlankWorkspace("project-ocean-buoy");
    workspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        conversationSummaryRevisions: { [revision.id]: revision },
        conversationCompaction: {
          summaryRevisionId: revision.id,
          coveredThroughMessageId: revision.sourceEndMessageId,
          coveredMessageCount: revision.sourceMessageCount,
          updatedAt: revision.createdAt,
          sourceMessageIdsHash: revision.sourceMessageIdsHash
        }
      }
    };

    const first = ensureAgentConversationSummaryBaselines(workspace, {
      projectId: workspace.project.id,
      promptContractVersion: "morpho-agent-test",
      summaryRevision: revision,
      mode: "auto",
      toolProfile: "standard"
    });
    const second = ensureAgentConversationSummaryBaselines(first, {
      projectId: first.project.id,
      promptContractVersion: "morpho-agent-test",
      summaryRevision: revision,
      mode: "auto",
      toolProfile: "standard"
    });
    const baselines = second.ai.providerContextFrames?.filter(
      (frame) => frame.placement === "conversationBaseline" && frame.summaryRevisionId === revision.id
    ) ?? [];

    expect(baselines.map((frame) => frame.kind).sort()).toEqual([
      "conversationSummary",
      "projectState",
      "runtimeConfiguration"
    ]);
    expect(second.ai.providerContextFrames).toEqual(first.ai.providerContextFrames);

    const restored = migrateWorkspaceToCurrentSchema(JSON.parse(JSON.stringify(second)));
    expect(restored.status).toBe("ok");
    if (restored.status === "ok") {
      expect(restored.workspace.ai.providerContextFrames).toEqual(second.ai.providerContextFrames);
    }
  });

  it("keeps only revision-and-section deltas in Turn Context memory", () => {
    const stable: AgentDefaultMemoryContext = {
      documents: [memoryDocument("projectOverview", "revision-overview", [
        { key: "goal", title: "目标", items: ["海洋浮标长期监测"] }
      ])],
      stageRecords: []
    };
    const task: AgentDefaultMemoryContext = {
      documents: [
        ...stable.documents,
        memoryDocument("outputPlan", "revision-output", [
          { key: "gaps", title: "待补", items: ["维护场景示意"] }
        ])
      ],
      stageRecords: []
    };

    const delta = buildAgentMemoryDeltaContext(task, stable);

    expect(delta.documents.map((document) => document.key)).toEqual(["outputPlan"]);
    expect(JSON.stringify(delta)).toContain("维护场景示意");
    expect(JSON.stringify(delta)).not.toContain("海洋浮标长期监测");
    expect(estimateProviderSerializedTokens(delta)).toBeLessThan(estimateProviderSerializedTokens(task));
  });
});

function projectFrame(workspace: MorphoWorkspace) {
  const context = buildTaskContext(workspace, { kind: "general", draft: "继续", selectedObjectIds: [] });
  return appendAgentProviderContextFrames(workspace, {
    workspace, projectId: workspace.project.id, strategy: "historyAndMemory", mode: "auto",
    promptContractVersion: "morpho-agent-test", userMessageId: "definition-integrity-user",
    context, providerTaskContext: buildProviderTaskContext(context),
    defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "historyAndMemory")
  }).ai.providerContextFrames?.filter((frame) => frame.kind === "projectState").at(-1);
}

function memoryDocument(
  key: "projectOverview" | "outputPlan",
  revisionId: string,
  sections: Array<{ key: string; title: string; items: string[] }>
): AgentDefaultMemoryContext["documents"][number] {
  return {
    key,
    title: key,
    revisionId,
    reviewRequired: false,
    empty: false,
    sections,
    sourceRefs: []
  };
}

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
