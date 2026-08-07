// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { collectDefaultReferenceReviewTargets, createInitialWorkspace } from "@/domain/morpho/workspace";
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

function createAgentConfirmation(): Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }> {
  return {
    kind: "agentRequestedAction",
    targetTitle: "方向 B",
    reason: "用户已明确确认",
    impact: "更新方向状态",
    action: "setDirectionPrimary",
    targetObjectId: "direction-support-island",
    draft: "设为主方向",
    sourceObjectIds: [],
    selectedDirectionIds: ["direction-support-island"],
    selectedImageIds: []
  };
}
