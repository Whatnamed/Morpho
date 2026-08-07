// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AiTaskMode, ComparisonAnalysis, MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace, hideObject } from "@/domain/morpho/workspace";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import {
  useWorkspaceComparisonDecisionController,
  type UseWorkspaceComparisonDecisionControllerInput,
  type WorkspaceComparisonDecisionController
} from "./useWorkspaceComparisonDecisionController";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useWorkspaceComparisonDecisionController", () => {
  it("requests all seven actions without committing or invoking an agent path", async () => {
    const cases = [
      ["setPrimary", "direction-support-island", "compareSetPrimary"],
      ["setAlternative", "direction-support-island", "compareSetAlternative"],
      ["eliminate", "direction-support-island", "compareEliminate"],
      ["restoreAlternative", "direction-support-island", "compareRestoreAlternative"],
      ["setDefaultReference", "image-night-scenario", "compareSetDefaultReference"],
      ["clearDefaultReference", "image-soft-rail-v2", "compareClearDefaultReference"],
      ["createKeyConclusion", undefined, "compareCreateKeyConclusion"]
    ] as const;

    for (const [action, objectId, expectedKind] of cases) {
      const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
      if (action === "restoreAlternative") {
        harness.workspace = makeEliminatedWorkspace();
      }
      const rendered = await renderController(createInput(harness));
      const before = structuredClone(harness.workspace);

      rendered.current().requestAction("comparison-controller", action, objectId);
      await rendered.rerender(createInput(harness));

      expect(harness.workspace).toEqual(before);
      expect(harness.commitCalls).toBe(0);
      expect(harness.undoCalls).toBe(0);
      expect(harness.pending?.kind).toBe(expectedKind);
      expect(harness.aiOpenCalls).toBe(1);
    }
  });

  it("does not overwrite an existing non-Compare confirmation", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
    harness.pending = {
      kind: "deleteObject",
      targetObjectId: "direction-support-island",
      targetTitle: "支撑岛",
      reasons: ["已有待确认操作"]
    };
    const rendered = await renderController(createInput(harness));
    const before = structuredClone(harness.workspace);
    const originalPending = structuredClone(harness.pending);

    rendered.current().requestAction("comparison-controller", "setPrimary", "direction-support-island");
    await rendered.rerender(createInput(harness));

    expect(harness.pending).toEqual(originalPending);
    expect(harness.workspace).toEqual(before);
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
    expect(harness.aiOpenCalls).toBe(0);
    expect(harness.notices.at(-1)).toContain("请先处理当前待确认操作");
  });

  it("confirms an optional-reason action exactly once and returns UI effects", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
    const rendered = await renderController(createInput(harness));

    rendered.current().requestAction("comparison-controller", "setPrimary", "direction-support-island");
    await rendered.rerender(createInput(harness));
    const beforeConfirm = structuredClone(harness.workspace);
    expect(getDirectionStatus(harness.workspace, "direction-support-island")).toBe(
      getDirectionStatus(beforeConfirm, "direction-support-island")
    );
    expect(harness.undoCalls).toBe(0);

    rendered.current().confirm();
    await rendered.rerender(createInput(harness));

    expect(getDirectionStatus(harness.workspace, "direction-support-island")).toBe("primary");
    expect(harness.workspace.decisionRecords).toHaveLength(beforeConfirm.decisionRecords.length + 1);
    expect(harness.workspace.decisionRecords.at(-1)?.comparison).toMatchObject({
      comparisonAnalysisId: "comparison-controller",
      comparisonAssistantMessageId: "assistant-controller"
    });
    expect(harness.pending).toBeNull();
    expect(harness.undoCalls).toBe(1);
    expect(harness.commitCalls).toBe(1);
    expect(harness.notices.at(-1)).toContain("主方向");
    expect(harness.taskMode).toBe("chatAnalysis");
  });

  it("blocks an empty required reason without undo or domain mutation", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
    const rendered = await renderController(createInput(harness));

    rendered.current().requestAction("comparison-controller", "eliminate", "direction-support-island");
    await rendered.rerender(createInput(harness));
    const before = structuredClone(harness.workspace);

    rendered.current().confirm();

    expect(harness.workspace).toEqual(before);
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
    expect(harness.pending?.kind).toBe("compareEliminate");
    expect(harness.notices.at(-1)).toContain("理由");
  });

  it("cancels a Compare confirmation without workspace, undo, or decision writes", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
    const rendered = await renderController(createInput(harness));

    rendered.current().requestAction("comparison-controller", "setPrimary", "direction-support-island");
    await rendered.rerender(createInput(harness));
    const before = structuredClone(harness.workspace);

    rendered.current().cancel();
    await rendered.rerender(createInput(harness));

    expect(harness.pending).toBeNull();
    expect(harness.workspace).toEqual(before);
    expect(harness.workspace.decisionRecords).toEqual(before.decisionRecords);
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
  });

  it("revalidates the current workspace before confirming", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis()));
    const rendered = await renderController(createInput(harness));

    rendered.current().requestAction("comparison-controller", "setPrimary", "direction-support-island");
    await rendered.rerender(createInput(harness));
    harness.workspace = hideObject(harness.workspace, "direction-support-island");
    await rendered.rerender(createInput(harness));
    const before = structuredClone(harness.workspace);

    rendered.current().confirm();

    expect(harness.workspace).toEqual(before);
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
    expect(harness.pending?.kind).toBe("compareSetPrimary");
  });

  it("clears Compare pending state on project transitions, keeps it on same-project rerenders, and rejects stale callbacks", async () => {
    const harness = createHarness(withAnalysis(createInitialWorkspace(), makeAnalysis(), "project-a"));
    const rendered = await renderController(createInput(harness));

    rendered.current().requestAction("comparison-controller", "setPrimary", "direction-support-island");
    await rendered.rerender(createInput(harness));
    expect(harness.pending?.kind).toBe("compareSetPrimary");
    const staleRequest = rendered.current().requestAction;
    const staleConfirm = rendered.current().confirm;

    await rendered.rerender(createInput(harness));
    expect(harness.pending?.kind).toBe("compareSetPrimary");

    harness.workspace = withAnalysis(createInitialWorkspace(), makeAnalysis(), "project-b");
    await rendered.rerender(createInput(harness, { projectId: "project-b" }));
    expect(harness.pending).toBeNull();

    harness.workspace = withAnalysis(createInitialWorkspace(), makeAnalysis(), "project-a");
    await rendered.rerender(createInput(harness, { projectId: "project-a" }));
    const beforeStale = structuredClone(harness.workspace);
    staleRequest("comparison-controller", "setPrimary", "direction-support-island");
    staleConfirm();

    expect(harness.workspace).toEqual(beforeStale);
    expect(harness.pending).toBeNull();
    expect(harness.commitCalls).toBe(0);
    expect(harness.undoCalls).toBe(0);
  });
});

type ComparisonControllerHarness = {
  workspace: MorphoWorkspace;
  pending: PendingAiConfirmation | null;
  selected: string[];
  focuses: string[];
  notices: string[];
  commitCalls: number;
  undoCalls: number;
  aiOpenCalls: number;
  aiDraft: string;
  taskMode: AiTaskMode;
};

function createHarness(workspace: MorphoWorkspace): ComparisonControllerHarness {
  return {
    workspace,
    pending: null,
    selected: [],
    focuses: [],
    notices: [],
    commitCalls: 0,
    undoCalls: 0,
    aiOpenCalls: 0,
    aiDraft: "",
    taskMode: "imageGeneration"
  };
}

function createInput(
  harness: ComparisonControllerHarness,
  options: { projectId?: string; workspaceReady?: boolean } = {}
): UseWorkspaceComparisonDecisionControllerInput {
  return {
    projectId: options.projectId ?? harness.workspace.project.id,
    workspace: harness.workspace,
    workspaceReady: options.workspaceReady ?? true,
    pendingConfirmation: harness.pending,
    setPendingConfirmation: (action) => {
      harness.pending = typeof action === "function" ? action(harness.pending) : action;
    },
    commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>): T => {
      harness.commitCalls += 1;
      const result = transform(harness.workspace);
      harness.workspace = result.workspace;
      return result.value;
    },
    pushUndoSnapshot: () => {
      harness.undoCalls += 1;
    },
    setSelectedObjectIds: (action) => {
      harness.selected = typeof action === "function" ? action([...harness.selected]) : [...action];
    },
    requestObjectFocus: (objectId) => {
      harness.focuses.push(objectId);
    },
    showNotice: (message) => {
      harness.notices.push(message);
    },
    setAiDraft: (draft) => {
      harness.aiDraft = draft;
    },
    setTaskMode: (taskMode) => {
      harness.taskMode = taskMode;
    },
    openAiPanel: () => {
      harness.aiOpenCalls += 1;
    }
  };
}

async function renderController(initialInput: UseWorkspaceComparisonDecisionControllerInput) {
  let controller: WorkspaceComparisonDecisionController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseWorkspaceComparisonDecisionControllerInput }) {
    controller = useWorkspaceComparisonDecisionController(input);
    return null;
  }

  const render = async (input: UseWorkspaceComparisonDecisionControllerInput) => {
    await act(async () => {
      root.render(createElement(Harness, { input }));
    });
  };
  await render(initialInput);

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller did not render.");
      }
      return controller;
    },
    rerender: render
  };
}

function withAnalysis(workspace: MorphoWorkspace, analysis: ComparisonAnalysis, projectId?: string): MorphoWorkspace {
  return {
    ...workspace,
    project: projectId ? { ...workspace.project, id: projectId } : workspace.project,
    ai: {
      ...workspace.ai,
      comparisonAnalyses: {
        ...workspace.ai.comparisonAnalyses,
        [analysis.id]: analysis
      }
    }
  };
}

function makeEliminatedWorkspace(): MorphoWorkspace {
  const workspace = createInitialWorkspace();
  const direction = workspace.objects["direction-support-island"];
  if (!direction || direction.type !== "conceptDirection") {
    throw new Error("Missing comparison direction fixture.");
  }
  return withAnalysis(
    {
      ...workspace,
      objects: {
        ...workspace.objects,
        [direction.id]: { ...direction, status: "eliminated" }
      }
    },
    makeAnalysis()
  );
}

function getDirectionStatus(workspace: MorphoWorkspace, objectId: string): string | undefined {
  const object = workspace.objects[objectId];
  return object?.type === "conceptDirection" ? object.status : undefined;
}

function makeAnalysis(): ComparisonAnalysis {
  const sourceObjectIds = [
    "direction-soft-rail",
    "direction-support-island",
    "image-soft-rail-v2",
    "image-night-scenario",
    "research-night-path"
  ];
  return {
    id: "comparison-controller",
    assistantMessageId: "assistant-controller",
    userMessageId: "user-controller",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    sourceObjectIds,
    sourceRefs: sourceObjectIds.map((objectId) => ({
      objectId,
      objectType: objectId.startsWith("direction-")
        ? "conceptDirection"
        : objectId.startsWith("image-")
          ? "image"
          : "research",
      title: objectId,
      summary: `${objectId} summary`,
      availability: "active"
    })),
    comparisonGoal: "Compare controller",
    conclusionSummary: "控制器测试用 Compare 摘要。",
    objectComparisons: sourceObjectIds.map((objectId) => ({
      objectId,
      title: objectId,
      summary: `${objectId} summary`,
      strengths: [],
      risks: [],
      evidence: []
    })),
    recommendedQuestions: [],
    evidenceLimits: [],
    keyConclusionCandidate: {
      title: "控制器关键结论",
      summary: "控制器关键结论摘要。",
      body: "控制器关键结论正文。",
      category: "finding",
      sourceObjectIds: ["research-night-path"],
      evidence: [{ objectId: "research-night-path", label: "研究", evidence: "研究证据" }],
      confidence: "supported"
    }
  };
}
