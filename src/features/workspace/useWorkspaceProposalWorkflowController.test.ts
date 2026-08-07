// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AiTaskMode, AiWorkIntent, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  recordConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordResearchAnalysisProposal
} from "@/domain/operations/operations";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  useWorkspaceProposalWorkflowController,
  type UseWorkspaceProposalWorkflowControllerInput,
  type WorkspaceProposalWorkflowController
} from "./useWorkspaceProposalWorkflowController";

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

describe("useWorkspaceProposalWorkflowController", () => {
  it.each(["researchAnalysis", "designDefinition", "conceptDirection"] as const)(
    "uses one apply workflow for active and direct %s proposals",
    async (type) => {
      const directHarness = createHarness(createProposalWorkspace(type));
      const direct = await renderController(createInput(directHarness));
      direct.current().applyProposal("proposal-1");

      const activeHarness = createHarness(createProposalWorkspace(type));
      const active = await renderController(createInput(activeHarness));
      active.current().activateProposal("proposal-1");
      await active.rerender(createInput(activeHarness));
      active.current().applyActiveProposal();

      expect(directHarness.workspace.artifactProposals["proposal-1"]?.status).toBe("applied");
      expect(activeHarness.workspace.artifactProposals["proposal-1"]?.status).toBe("applied");
      expect(activeHarness.selected).toEqual(directHarness.selected);
      expect(activeHarness.focuses).toEqual(directHarness.focuses);
      expect(activeHarness.closedProposalDetails).toBe(1);
    }
  );

  it("selects and focuses every result returned by the unified apply workflow", async () => {
    const cases = [
      { type: "researchAnalysis" as const, expectedSelectionCount: 1 },
      { type: "designDefinition" as const, expectedSelectionCount: 1 },
      { type: "conceptDirection" as const, expectedSelectionCount: 2 }
    ];

    for (const testCase of cases) {
      const harness = createHarness(createProposalWorkspace(testCase.type));
      const rendered = await renderController(createInput(harness));

      rendered.current().applyProposal("proposal-1");

      expect(harness.selected).toHaveLength(testCase.expectedSelectionCount);
      expect(harness.focuses).toHaveLength(1);
      expect(harness.selected).toContain(harness.focuses[0]);
    }
  });

  it("clears active Proposal attention on project transitions but keeps it on same-project rerenders", async () => {
    const harness = createHarness(createProposalWorkspace("researchAnalysis", "project-a"));
    const rendered = await renderController(createInput(harness));

    rendered.current().activateProposal("proposal-1");
    await rendered.rerender(createInput(harness));
    expect(rendered.current().activeProposal?.id).toBe("proposal-1");

    await rendered.rerender(createInput(harness));
    expect(rendered.current().activeProposal?.id).toBe("proposal-1");

    harness.workspace = createProposalWorkspace("researchAnalysis", "project-b");
    await rendered.rerender(createInput(harness, { projectId: "project-b" }));
    expect(rendered.current().activeProposal).toBeUndefined();
  });

  it("fails closed for stale A callbacks across B and A2, including apply, reject, and draft save", async () => {
    const harness = createHarness(createProposalWorkspace("researchAnalysis", "project-a"));
    const rendered = await renderController(createInput(harness));
    const staleApply = rendered.current().applyProposal;
    const staleReject = rendered.current().rejectProposal;
    const staleSave = rendered.current().saveResearchDraft;

    harness.workspace = createProposalWorkspace("researchAnalysis", "project-b");
    await rendered.rerender(createInput(harness, { projectId: "project-b" }));
    harness.workspace = createProposalWorkspace("researchAnalysis", "project-a");
    const projectA2Before = structuredClone(harness.workspace);
    await rendered.rerender(createInput(harness, { projectId: "project-a" }));

    staleApply("proposal-1");
    staleReject("proposal-1");
    staleSave("proposal-1", {
      title: "不应写入",
      summary: "不应写入",
      findings: [],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      evidence: []
    });

    expect(harness.workspace).toEqual(projectA2Before);
    expect(harness.commitCalls).toBe(0);
    expect(harness.selected).toEqual([]);
    expect(harness.focuses).toEqual([]);
  });

  it("rejects through the domain workflow and performs active/detail/selection cleanup", async () => {
    const harness = createHarness(createProposalWorkspace("researchAnalysis"));
    harness.selected = ["proposal-1", "other-object"];
    const rendered = await renderController(createInput(harness));

    rendered.current().openProposal("proposal-1");
    rendered.current().rejectProposal("proposal-1");
    await rendered.rerender(createInput(harness));

    expect(harness.workspace.artifactProposals["proposal-1"]?.status).toBe("rejected");
    expect(harness.workspace.objects["proposal-1"]).toBeUndefined();
    expect(rendered.current().activeProposal).toBeUndefined();
    expect(harness.selected).toEqual(["other-object"]);
    expect(harness.closedProposalDetailIf).toEqual([["proposal-1"]]);
  });

  it("saves each draft type while keeping it pending and active", async () => {
    const cases = [
      {
        type: "researchAnalysis" as const,
        run: (controller: WorkspaceProposalWorkflowController) =>
          controller.saveResearchDraft("proposal-1", {
            title: "研究新标题",
            summary: "研究新摘要",
            findings: ["新发现"],
            opportunities: [],
            constraints: [],
            openQuestions: [],
            evidence: []
          })
      },
      {
        type: "designDefinition" as const,
        run: (controller: WorkspaceProposalWorkflowController) =>
          controller.saveDesignDefinitionDraft("proposal-1", {
            title: "定义新标题",
            summary: "定义新摘要",
            projectGoal: "目标",
            targetUsers: [],
            primaryScenarios: [],
            coreProblem: "问题",
            designPrinciples: [],
            constraints: [],
            avoidDirections: [],
            opportunities: [],
            openQuestions: []
          })
      },
      {
        type: "conceptDirection" as const,
        run: (controller: WorkspaceProposalWorkflowController) =>
          controller.saveConceptDirectionDraft("proposal-1", {
            title: "方向新标题",
            summary: "方向新摘要",
            directions: [createDirectionDraft("方向新内容")]
          })
      }
    ];

    for (const testCase of cases) {
      const harness = createHarness(createProposalWorkspace(testCase.type));
      const rendered = await renderController(createInput(harness));

      testCase.run(rendered.current());
      await rendered.rerender(createInput(harness));

      expect(harness.workspace.artifactProposals["proposal-1"]?.status).toBe("pending");
      expect(rendered.current().activeProposal?.id).toBe("proposal-1");
      expect(Object.values(harness.workspace.objects).some((object) => object.type !== "proposalDraft")).toBe(false);
    }
  });

  it("prepares discussion and regeneration drafts without starting a provider action", async () => {
    const harness = createHarness(createProposalWorkspace("designDefinition"));
    const rendered = await renderController(createInput(harness));

    await act(async () => {
      rendered.current().continueDiscussion("proposal-1");
    });
    expect(harness.aiOpenCalls).toBe(1);
    expect(harness.taskMode).toBe("chatAnalysis");
    expect(harness.workIntent).toBe("createDesignDefinition");
    expect(harness.aiDraft).toContain("继续围绕");
    expect(harness.commitCalls).toBe(0);

    await act(async () => {
      rendered.current().regenerate("proposal-1");
    });
    expect(harness.aiOpenCalls).toBe(2);
    expect(harness.aiDraft).toContain("不要直接应用");
    expect(harness.commitCalls).toBe(0);
  });
});

type ProposalKind = "researchAnalysis" | "designDefinition" | "conceptDirection";

type ProposalControllerHarness = {
  workspace: MorphoWorkspace;
  selected: string[];
  focuses: string[];
  commitCalls: number;
  closedProposalDetails: number;
  closedProposalDetailIf: string[][];
  aiOpenCalls: number;
  aiDraft: string;
  taskMode: AiTaskMode;
  workIntent: AiWorkIntent;
};

function createHarness(workspace: MorphoWorkspace): ProposalControllerHarness {
  return {
    workspace,
    selected: [],
    focuses: [],
    commitCalls: 0,
    closedProposalDetails: 0,
    closedProposalDetailIf: [],
    aiOpenCalls: 0,
    aiDraft: "",
    taskMode: "chatAnalysis",
    workIntent: "discussion"
  };
}

function createInput(
  harness: ProposalControllerHarness,
  options: { projectId?: string; workspaceReady?: boolean } = {}
): UseWorkspaceProposalWorkflowControllerInput {
  return {
    projectId: options.projectId ?? harness.workspace.project.id,
    workspace: harness.workspace,
    workspaceReady: options.workspaceReady ?? true,
    commitWorkspace: <T,>(transform: WorkspaceCommitTransform<T>): T => {
      harness.commitCalls += 1;
      const result = transform(harness.workspace);
      harness.workspace = result.workspace;
      return result.value;
    },
    setSelectedObjectIds: (action) => {
      harness.selected = typeof action === "function" ? action([...harness.selected]) : [...action];
    },
    requestObjectFocus: (objectId) => {
      harness.focuses.push(objectId);
    },
    openProposalDetail: () => undefined,
    closeProposalDetail: () => {
      harness.closedProposalDetails += 1;
    },
    closeProposalDetailIf: (objectIds) => {
      harness.closedProposalDetailIf.push([...objectIds]);
    },
    openAiPanel: () => {
      harness.aiOpenCalls += 1;
    },
    setAiDraft: (draft) => {
      harness.aiDraft = draft;
    },
    setTaskMode: (taskMode) => {
      harness.taskMode = taskMode;
    },
    setWorkIntent: (workIntent) => {
      harness.workIntent = workIntent;
    }
  };
}

async function renderController(initialInput: UseWorkspaceProposalWorkflowControllerInput) {
  let controller: WorkspaceProposalWorkflowController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseWorkspaceProposalWorkflowControllerInput }) {
    controller = useWorkspaceProposalWorkflowController(input);
    return null;
  }

  const render = async (input: UseWorkspaceProposalWorkflowControllerInput) => {
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

function createProposalWorkspace(type: ProposalKind, projectId = "project-a"): MorphoWorkspace {
  const workspace = createBlankWorkspace(projectId);
  switch (type) {
    case "researchAnalysis":
      return recordResearchAnalysisProposal(workspace, {
        proposalId: "proposal-1",
        operationId: "operation-research-1",
        workIntent: "discussion",
        title: "研究草案",
        summary: "研究摘要",
        findings: ["发现"],
        opportunities: [],
        constraints: [],
        openQuestions: [],
        sourceObjectIds: [],
        citations: []
      }).workspace;
    case "designDefinition":
      return recordDesignDefinitionProposal(workspace, {
        proposalId: "proposal-1",
        operationId: "operation-definition-1",
        workIntent: "createDesignDefinition",
        title: "设计定义草案",
        summary: "定义摘要",
        projectGoal: "目标",
        targetUsers: [],
        primaryScenarios: [],
        coreProblem: "问题",
        designPrinciples: [],
        constraints: [],
        avoidDirections: [],
        opportunities: [],
        openQuestions: [],
        sourceObjectIds: [],
        citations: []
      }).workspace;
    case "conceptDirection":
      return recordConceptDirectionProposal(workspace, {
        proposalId: "proposal-1",
        operationId: "operation-direction-1",
        workIntent: "createConceptDirections",
        title: "方向草案",
        summary: "方向摘要",
        applicationMode: "create",
        parentDirectionIds: [],
        directions: [createDirectionDraft("方向 A"), createDirectionDraft("方向 B")],
        sourceObjectIds: [],
        citations: []
      }).workspace;
  }
}

function createDirectionDraft(title: string) {
  return {
    title,
    summary: `${title} 摘要`,
    conceptStatement: `${title} 说明`,
    keywords: [title],
    strategy: `${title} 策略`,
    differentiators: [`${title} 差异`],
    visualSignals: [`${title} 视觉信号`],
    risks: [],
    openQuestions: []
  };
}
