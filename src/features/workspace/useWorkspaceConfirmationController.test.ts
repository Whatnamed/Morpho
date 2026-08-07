// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  clearDefaultReference,
  collectDefaultReferenceReviewTargets,
  createBlankWorkspace,
  createInitialWorkspace,
  setDefaultReference
} from "@/domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "@/domain/operations/operations";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
import {
  useWorkspaceConfirmationController,
  type WorkspaceConfirmationController
} from "./useWorkspaceConfirmationController";
import {
  useWorkspaceConfirmationExecutionController,
  type UseWorkspaceConfirmationExecutionControllerInput,
  type WorkspaceConfirmationExecutionController
} from "./useWorkspaceConfirmationExecutionController";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

const roots: Root[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

describe("useWorkspaceConfirmationController", () => {
  it("accepts one confirmation, rejects every later origin, and preserves the slot on same-project rerenders", async () => {
    const workspace = createInitialWorkspace();
    const local = createDefaultReferenceConfirmation(workspace);
    const agent = createAgentConfirmation();
    const rendered = await renderSlot(workspace, true);

    let result!: ReturnType<WorkspaceConfirmationController["requestPendingConfirmation"]>;
    await act(async () => {
      result = rendered.current.requestPendingConfirmation(local);
    });
    expect(result).toMatchObject({ status: "accepted", origin: "local" });
    await rendered.rerender(workspace, true);
    expect(rendered.current.pendingConfirmation).toBe(local);

    await act(async () => {
      result = rendered.current.requestPendingConfirmation(agent);
    });
    expect(result).toMatchObject({ status: "rejected", code: "confirmation_slot_occupied", origin: "agent" });
    expect(rendered.current.pendingConfirmation).toBe(local);
  });

  it("clears a project-local slot and rejects stale callbacks across A to B to A", async () => {
    const workspaceA = createInitialWorkspace();
    const workspaceB = { ...workspaceA, project: { ...workspaceA.project, id: "project-b" } };
    const rendered = await renderSlot(workspaceA, true);
    const staleRequest = rendered.current.requestPendingConfirmation;
    const localA = createDefaultReferenceConfirmation(workspaceA);
    await act(async () => {
      expect(staleRequest(localA).status).toBe("accepted");
    });

    await rendered.rerender(workspaceB, true);
    expect(rendered.current.pendingConfirmation).toBeNull();
    await act(async () => {
      expect(staleRequest(createAgentConfirmation())).toMatchObject({
        status: "rejected",
        code: "confirmation_session_stale"
      });
    });

    await rendered.rerender(workspaceA, true);
    await act(async () => {
      expect(rendered.current.requestPendingConfirmation(createAgentConfirmation()).status).toBe("accepted");
    });
  });
});

describe("useWorkspaceConfirmationExecutionController", () => {
  it("does not acknowledge local confirmation and creates exactly one undo entry", async () => {
    const workspace = createInitialWorkspace();
    const harness = createExecutionHarness(workspace, createDefaultReferenceConfirmation(workspace));
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.acknowledge).not.toHaveBeenCalled();
    expect(harness.undoCalls).toBe(1);
    expect(harness.pending).toBeNull();
    expect(Object.values(harness.workspace.objects).some((object) => object.type === "image" && object.isDefaultReference && object.id === "image-night-scenario")).toBe(true);
  });

  it("keeps a blocked confirmation visible and does not create undo before preflight passes", async () => {
    const workspace = createInitialWorkspace();
    const confirmation = createDefaultReferenceConfirmation(workspace);
    const harness = createExecutionHarness(workspace, confirmation);
    harness.workspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [confirmation.targetObjectId]: {
          ...workspace.objects[confirmation.targetObjectId],
          visibility: "hidden"
        }
      }
    };
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.undoCalls).toBe(0);
    expect(harness.pending).toBe(confirmation);
    expect(harness.notices.at(-1)).toContain("不可用");
  });

  it("does not write or create undo when Agent acknowledgement fails", async () => {
    const workspace = createInitialWorkspace();
    const confirmation = createAgentConfirmation();
    const harness = createExecutionHarness(workspace, confirmation);
    harness.acknowledge.mockResolvedValue(false);
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.acknowledge).toHaveBeenCalledTimes(1);
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
    expect(harness.pending).toBe(confirmation);
  });

  it("removes a deleted confirmation target from selection and local editing", async () => {
    const workspace = createInitialWorkspace();
    const confirmation: Extract<PendingAiConfirmation, { kind: "deleteObject" }> = {
      kind: "deleteObject",
      targetObjectId: "image-night-scenario",
      targetTitle: "夜间场景",
      reasons: ["用户确认删除"]
    };
    const harness = createExecutionHarness(workspace, confirmation);
    harness.selectedObjectIds = [confirmation.targetObjectId];
    harness.localEditObjectId = confirmation.targetObjectId;
    harness.setSelectedObjectIds = (value) => {
      harness.selectedObjectIds = typeof value === "function" ? value(harness.selectedObjectIds) : value;
    };
    harness.setLocalEditObjectId = (value) => {
      harness.localEditObjectId = typeof value === "function" ? value(harness.localEditObjectId) : value;
    };
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.pending).toBeNull();
    expect(harness.undoCalls).toBe(1);
    expect(harness.selectedObjectIds).not.toContain(confirmation.targetObjectId);
    expect(harness.localEditObjectId).toBeNull();
  });

  it("acknowledges Agent only after preflight and applies the bound target once", async () => {
    const workspace = createInitialWorkspace();
    const confirmation = createAgentConfirmation();
    const harness = createExecutionHarness(workspace, confirmation);
    harness.acknowledge.mockImplementation(async () => {
      harness.events.push(`ack:commit=${harness.commitCalls}:undo=${harness.undoCalls}`);
      return true;
    });
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.events).toEqual(["ack:commit=0:undo=0"]);
    expect(harness.commitCalls).toBe(1);
    expect(harness.undoCalls).toBe(1);
    expect(harness.pending).toBeNull();
    const target = harness.workspace.objects[confirmation.targetObjectId!];
    expect(target?.type).toBe("conceptDirection");
    if (target?.type === "conceptDirection") {
      expect(target.status).toBe("primary");
    }
  });

  it("blocks Agent design-definition actions before acknowledgement when the proposal is no longer applicable", async () => {
    const initial = createInitialWorkspace();
    const processed = recordDesignDefinitionProposal(initial, createDefinitionProposalInput({
      proposalId: "agent-processed-definition"
    }));
    const processedWorkspace = {
      ...processed.workspace,
      artifactProposals: {
        ...processed.workspace.artifactProposals,
        [processed.proposal.id]: { ...processed.proposal, status: "applied" as const }
      }
    };

    const sourceBase = createBlankWorkspace("agent-source-review");
    const sourceWorkspace = {
      ...sourceBase,
      objects: {
        ...sourceBase.objects,
        "agent-source": {
          id: "agent-source",
          type: "text" as const,
          title: "来源",
          summary: "摘要",
          body: "原始内容",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const sourceProposal = recordDesignDefinitionProposal(sourceWorkspace, createDefinitionProposalInput({
      proposalId: "agent-source-definition",
      sourceObjectIds: ["agent-source"]
    }));
    const sourceChangedWorkspace = {
      ...sourceProposal.workspace,
      objects: {
        ...sourceProposal.workspace.objects,
        "agent-source": {
          ...sourceProposal.workspace.objects["agent-source"],
          body: "修改后的内容"
        }
      }
    };

    const baseProposal = recordDesignDefinitionProposal(initial, createDefinitionProposalInput({
      proposalId: "agent-base-definition",
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: "stale-definition-revision"
    }));

    for (const [workspace, proposalId] of [
      [processedWorkspace, processed.proposal.id],
      [sourceChangedWorkspace, sourceProposal.proposal.id],
      [baseProposal.workspace, baseProposal.proposal.id]
    ] as const) {
      const confirmation = createAgentDefinitionConfirmation(workspace, proposalId);
      const harness = createExecutionHarness(workspace, confirmation);
      const rendered = await renderExecution(harness);

      await act(async () => rendered.current.confirm());

      expect(harness.acknowledge).not.toHaveBeenCalled();
      expect(harness.commitCalls).toBe(0);
      expect(harness.undoCalls).toBe(0);
      expect(harness.pending).toBe(confirmation);
      expect(harness.notices.at(-1)).toContain("重新发起确认");
    }
  });

  it("blocks Agent default-reference actions when the previous default identity has changed", async () => {
    const workspace = createInitialWorkspace();
    const previous = getDefaultImage(workspace);
    const target = getActiveImage(workspace, previous.id);
    const replacement = getActiveImage(workspace, previous.id, target.id);
    const withoutDefault = clearDefaultReference(workspace, previous.id, { reason: "用户先清除默认参考。" });
    const scenarios = [
      {
        confirmationWorkspace: workspace,
        changedWorkspace: setDefaultReference(workspace, replacement.id, { reason: "用户先改了默认参考。" }),
        expectedDefaultId: replacement.id
      },
      {
        confirmationWorkspace: workspace,
        changedWorkspace: withoutDefault,
        expectedDefaultId: null
      },
      {
        confirmationWorkspace: withoutDefault,
        changedWorkspace: setDefaultReference(withoutDefault, replacement.id, { reason: "用户后来设置了默认参考。" }),
        expectedDefaultId: replacement.id
      }
    ];

    for (const scenario of scenarios) {
      const confirmation = createAgentDefaultReferenceConfirmation(scenario.confirmationWorkspace, target.id);
      const harness = createExecutionHarness(scenario.changedWorkspace, confirmation);
      const rendered = await renderExecution(harness);

      await act(async () => rendered.current.confirm());

      expect(harness.acknowledge).not.toHaveBeenCalled();
      expect(harness.commitCalls).toBe(0);
      expect(harness.undoCalls).toBe(0);
      expect(harness.pending).toBe(confirmation);
      expect(getCurrentDefaultImageId(harness.workspace)).toBe(scenario.expectedDefaultId);
      expect(harness.notices.at(-1)).toContain("默认参考已变化");
    }
  });

  it("blocks Agent direction actions when the bound status has changed", async () => {
    const workspace = createInitialWorkspace();
    const confirmation = createAgentConfirmation(workspace);
    const target = workspace.objects[confirmation.targetObjectId!];
    if (!target || target.type !== "conceptDirection") throw new Error("Expected a concept direction target");
    const changedWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [target.id]: {
          ...target,
          status: target.status === "primary" ? "alternative" as const : "primary" as const
        }
      }
    };
    const harness = createExecutionHarness(changedWorkspace, confirmation);
    const rendered = await renderExecution(harness);

    await act(async () => rendered.current.confirm());

    expect(harness.acknowledge).not.toHaveBeenCalled();
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
    expect(harness.pending).toBe(confirmation);
    expect(harness.notices.at(-1)).toContain("方向状态已变化");
  });
});

type SlotRenderer = {
  current: WorkspaceConfirmationController;
  rerender: (workspace: MorphoWorkspace, workspaceReady: boolean) => Promise<void>;
};

async function renderSlot(workspace: MorphoWorkspace, workspaceReady: boolean): Promise<SlotRenderer> {
  let current: WorkspaceConfirmationController | null = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const SlotProbe = ({ nextWorkspace, nextReady }: { nextWorkspace: MorphoWorkspace; nextReady: boolean }) => {
    current = useWorkspaceConfirmationController({
      projectId: nextWorkspace.project.id,
      workspace: nextWorkspace,
      workspaceReady: nextReady
    });
    return null;
  };
  const render = (nextWorkspace: MorphoWorkspace, nextReady: boolean) => {
    root.render(createElement(SlotProbe, { nextWorkspace, nextReady }));
  };
  await act(async () => render(workspace, workspaceReady));
  if (!current) throw new Error("slot controller did not render");
  return {
    get current() {
      if (!current) throw new Error("slot controller is unavailable");
      return current;
    },
    rerender: async (nextWorkspace, nextReady) => {
      await act(async () => render(nextWorkspace, nextReady));
    }
  };
}

type ExecutionHarness = {
  workspace: MorphoWorkspace;
  pending: PendingAiConfirmation | null;
  commitCalls: number;
  undoCalls: number;
  notices: string[];
  events: string[];
  acknowledge: Mock<() => Promise<boolean>>;
  selectedObjectIds: string[];
  localEditObjectId: string | null;
  setSelectedObjectIds: (value: string[] | ((current: string[]) => string[])) => void;
  setLocalEditObjectId: (value: string | null | ((current: string | null) => string | null)) => void;
};

function createExecutionHarness(workspace: MorphoWorkspace, pending: PendingAiConfirmation): ExecutionHarness {
  return {
    workspace,
    pending,
    commitCalls: 0,
    undoCalls: 0,
    notices: [],
    events: [],
    acknowledge: vi.fn<() => Promise<boolean>>(async () => true),
    selectedObjectIds: [],
    localEditObjectId: null,
    setSelectedObjectIds: () => undefined,
    setLocalEditObjectId: () => undefined
  };
}

async function renderExecution(harness: ExecutionHarness): Promise<{ current: WorkspaceConfirmationExecutionController }> {
  let current: WorkspaceConfirmationExecutionController | null = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(() => {
      const input: UseWorkspaceConfirmationExecutionControllerInput = {
        projectId: harness.workspace.project.id,
        workspace: harness.workspace,
        workspaceReady: true,
        pendingConfirmation: harness.pending,
        ownsPendingConfirmation: (expected) => harness.pending === expected,
        updatePendingConfirmation: (updater, expected) => {
          if (!harness.pending || (expected && harness.pending !== expected)) return false;
          harness.pending = updater(harness.pending);
          return true;
        },
        clearPendingConfirmation: (expected) => {
          if (!harness.pending || (expected && harness.pending !== expected)) return false;
          harness.pending = null;
          return true;
        },
        commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>): T => {
          harness.commitCalls += 1;
          const result = transform(harness.workspace);
          harness.workspace = result.workspace;
          return result.value;
        },
        readWorkspace: () => harness.workspace,
        pushUndoSnapshot: () => {
          harness.undoCalls += 1;
        },
        setSelectedObjectIds: harness.setSelectedObjectIds,
        setLocalEditObjectId: harness.setLocalEditObjectId,
        setAiDraft: () => undefined,
        setTaskMode: () => undefined,
        showNotice: (message) => harness.notices.push(message),
        requestObjectFocus: () => undefined,
        setImageTaskStatus: () => undefined,
        executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
          workspace: workspaceSnapshot,
          createdObjectIds: [],
          failedItems: []
        }),
        beginLocalAbortableTask: () => ({
          controller: new AbortController(),
          signal: new AbortController().signal,
          isCurrent: () => true
        }),
        finishLocalAbortableTask: () => undefined,
        acknowledgePendingConfirmation: harness.acknowledge,
      };
      current = useWorkspaceConfirmationExecutionController(input);
      return null;
    }));
  });
  if (!current) throw new Error("execution controller did not render");
  return { current };
}

function createDefaultReferenceConfirmation(workspace: MorphoWorkspace): Extract<PendingAiConfirmation, { kind: "setDefaultReference" }> {
  const previous = Object.values(workspace.objects).find((object) => object.type === "image" && object.isDefaultReference);
  if (!previous) throw new Error("test workspace has no default reference");
  const target = workspace.objects["image-night-scenario"];
  if (!target || target.type !== "image") throw new Error("test workspace has no target image");
  const scope = collectDefaultReferenceReviewTargets(workspace, previous.id, target.id);
  return {
    kind: "setDefaultReference",
    targetObjectId: target.id,
    targetTitle: target.title,
    previousReferenceObjectId: previous.id,
    previousReferenceTitle: previous.title,
    reviewImageCount: scope.imageIds.length,
    reviewCollectionCount: scope.collectionIds.length,
    reviewImageIds: [...scope.imageIds],
    reviewCollectionIds: [...scope.collectionIds]
  };
}

function createAgentConfirmation(
  workspace: MorphoWorkspace = createInitialWorkspace()
): Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }> {
  const target = workspace.objects["direction-support-island"];
  const previousReferenceObjectId = Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.isDefaultReference
  )?.id ?? null;
  return {
    kind: "agentRequestedAction",
    targetTitle: "方向 B",
    reason: "用户已明确确认",
    impact: "更新方向状态",
    action: "setDirectionPrimary",
    targetObjectId: "direction-support-island",
    previousReferenceObjectId,
    boundTargetStatus: target?.type === "conceptDirection" ? target.status : undefined,
    draft: "设为主方向",
    sourceObjectIds: [],
    selectedDirectionIds: ["direction-support-island"],
    selectedImageIds: []
  };
}

function createAgentDefinitionConfirmation(
  workspace: MorphoWorkspace,
  proposalId: string
): Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }> {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "designDefinition") throw new Error("Expected a design definition proposal");
  return {
    kind: "agentRequestedAction",
    targetTitle: proposal.title,
    reason: "用户已明确确认",
    impact: "应用设计定义",
    action: "applyDesignDefinition",
    targetObjectId: proposalId,
    previousReferenceObjectId: null,
    draft: "应用设计定义",
    sourceObjectIds: [...proposal.sourceObjectIds],
    selectedDirectionIds: [],
    selectedImageIds: []
  };
}

function createAgentDefaultReferenceConfirmation(
  workspace: MorphoWorkspace,
  targetObjectId: string
): Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }> {
  const target = workspace.objects[targetObjectId];
  const previous = Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.isDefaultReference
  );
  if (!target || target.type !== "image") throw new Error("Expected an image target");
  return {
    kind: "agentRequestedAction",
    targetTitle: target.title,
    reason: "用户已明确确认",
    impact: "更新默认参考",
    action: "setDefaultReference",
    targetObjectId,
    previousReferenceObjectId: previous?.type === "image" ? previous.id : null,
    draft: "设为默认参考",
    sourceObjectIds: [],
    selectedDirectionIds: [],
    selectedImageIds: []
  };
}

function createDefinitionProposalInput(overrides: {
  proposalId: string;
  sourceObjectIds?: string[];
  basedOnDesignDefinitionId?: string;
  basedOnRevisionId?: string;
}) {
  return {
    ...overrides,
    sourceObjectIds: overrides.sourceObjectIds ?? [],
    title: "Agent 设计定义",
    summary: "Agent 设计定义摘要。",
    projectGoal: "Agent 设计目标。",
    targetUsers: ["用户"],
    primaryScenarios: ["场景"],
    coreProblem: "Agent 设计问题。",
    designPrinciples: ["原则"],
    constraints: [],
    avoidDirections: [],
    opportunities: [],
    openQuestions: [],
    citations: []
  };
}

function getDefaultImage(workspace: MorphoWorkspace) {
  const image = Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.isDefaultReference
  );
  if (!image || image.type !== "image") throw new Error("Expected a default image");
  return image;
}

function getCurrentDefaultImageId(workspace: MorphoWorkspace): string | null {
  return Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.isDefaultReference
  )?.id ?? null;
}

function getActiveImage(workspace: MorphoWorkspace, ...excludedIds: string[]) {
  const image = Object.values(workspace.objects).find(
    (object) => object.type === "image" && object.visibility === "active" && !excludedIds.includes(object.id)
  );
  if (!image || image.type !== "image") throw new Error("Expected an active image");
  return image;
}
