import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "../morpho/workspace";
import {
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  canStartOperation,
  completeImageGenerationOperation,
  createImageGenerationOperation,
  createArtifactProposalOperation,
  createResearchOperation,
  detectResearchSourceChanges,
  failImageGenerationOperation,
  getActiveOperation,
  interruptActiveOperations,
  failOperation,
  markImageGenerationOperationSubmitted,
  recordConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordImageGenerationPlan,
  recordImageGenerationOperationItemFailure,
  recordImageGenerationOperationResult,
  recordResearchAnalysisProposal,
  rejectArtifactProposal,
  updateResearchAnalysisProposalDraft
} from "./operations";

describe("Morpho Operation Runtime", () => {
  it("creates a finite research operation from an input snapshot without mutating objects", () => {
    const workspace = createBlankWorkspace("project-op");
    const operation = createResearchOperation(workspace, {
      userInput: "基于这些资料做调研",
      selectedObjectIds: [],
      allowWebSearch: false
    });

    expect(operation.workspace.objects).toEqual(workspace.objects);
    expect(operation.operation.status).toBe("queued");
    expect(operation.operation.type).toBe("research");
    expect(operation.operation.allowedCapabilities.webSearch).toBe(false);
    expect(operation.operation.steps.map((step) => step.kind)).toEqual(["inputSnapshot"]);
  });

  it("marks unfinished operations interrupted after reload", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "调研已选资料",
      selectedObjectIds: [],
      allowWebSearch: false
    }).workspace;

    const interrupted = interruptActiveOperations(created, "browserReload");

    expect(Object.values(interrupted.operations)[0]?.status).toBe("interrupted");
    expect(Object.values(interrupted.operations)[0]?.retryable).toBe(true);
  });

  it("blocks a second operation while one is active", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "调研已选资料",
      selectedObjectIds: [],
      allowWebSearch: false
    }).workspace;

    const gate = canStartOperation(created);

    expect(gate.status).toBe("blocked");
    if (gate.status === "blocked") {
      expect(gate.operation.status).toBe("queued");
      expect(gate.reason).toContain("未完成");
    }
  });

  it("unblocks new work after a text operation fails", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "继续联网调研",
      selectedObjectIds: [],
      allowWebSearch: true
    }).workspace;

    const failed = failOperation(created, Object.values(created.operations)[0]?.id ?? "", {
      status: "failed",
      reason: "MiMo 请求失败。"
    });

    expect(Object.values(failed.operations)[0]?.status).toBe("failed");
    expect(canStartOperation(failed).status).toBe("ok");
  });

  it("records a research proposal without directly creating a ResearchObject", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "调研已选资料",
      selectedObjectIds: [],
      allowWebSearch: false
    });

    const proposed = recordResearchAnalysisProposal(created.workspace, {
      operationId: created.operation.id,
      title: "夜间路径研究草案",
      summary: "基于本地资料形成的候选分析。",
      findings: ["夜间路径风险来自连续转移。"],
      opportunities: ["用低位连续导向降低迷失感。"],
      constraints: ["不能大施工。"],
      openQuestions: ["如何避免医疗感？"],
      sourceObjectIds: [],
      citations: []
    });

    expect(Object.values(proposed.workspace.objects)).toHaveLength(0);
    expect(proposed.proposal.status).toBe("pending");
    expect(proposed.workspace.artifactProposals[proposed.proposal.id]).toEqual(proposed.proposal);
  });

  it("updates a pending research proposal draft without mutating formal objects", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "原始资料",
          summary: "原始摘要",
          body: "原始正文",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const created = createResearchOperation(workspace, {
      userInput: "基于资料形成研究草案",
      selectedObjectIds: ["text-source"],
      allowWebSearch: false
    });
    const proposed = recordResearchAnalysisProposal(created.workspace, {
      proposalId: "proposal-research-editable",
      operationId: created.operation.id,
      title: "研究草案",
      summary: "原始摘要",
      findings: ["发现 A"],
      opportunities: ["机会 A"],
      constraints: ["约束 A"],
      openQuestions: ["问题 A"],
      evidence: [
        {
          claim: "发现 A",
          sourceObjectIds: ["text-source"],
          citationUrls: [],
          confidence: "partial"
        }
      ],
      sourceObjectIds: ["text-source"],
      citations: []
    });

    const updated = updateResearchAnalysisProposalDraft(proposed.workspace, proposed.proposal.id, {
      title: "研究草案 v2",
      summary: "更新后的摘要",
      findings: ["发现 B"],
      opportunities: ["机会 B"],
      constraints: ["约束 B"],
      openQuestions: ["问题 B"],
      evidence: [
        {
          claim: "发现 B",
          sourceObjectIds: ["text-source"],
          citationIds: [],
          confidence: "supported"
        }
      ]
    });

    expect(updated.objects).toEqual(proposed.workspace.objects);
    expect(updated.artifactProposals[proposed.proposal.id]).toMatchObject({
      title: "研究草案 v2",
      summary: "更新后的摘要",
      findings: ["发现 B"],
      opportunities: ["机会 B"],
      constraints: ["约束 B"],
      openQuestions: ["问题 B"],
      status: "pending"
    });
  });

  it("marks a pending proposal rejected without touching formal objects", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "research selected materials",
      selectedObjectIds: [],
      allowWebSearch: false
    });
    const proposed = recordResearchAnalysisProposal(created.workspace, {
      proposalId: "proposal-research-reject",
      operationId: created.operation.id,
      title: "Research proposal",
      summary: "Summary",
      findings: ["Finding"],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: []
    });

    const rejected = rejectArtifactProposal(proposed.workspace, proposed.proposal.id, "用户明确放弃当前草案。");

    expect(rejected.objects).toEqual(proposed.workspace.objects);
    expect(rejected.artifactProposals[proposed.proposal.id]).toMatchObject({
      status: "rejected",
      rejectedReason: "用户明确放弃当前草案。"
    });
  });

  it("uses a caller-provided research proposal id when it is available", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "research selected materials",
      selectedObjectIds: [],
      allowWebSearch: false
    });

    const proposed = recordResearchAnalysisProposal(created.workspace, {
      proposalId: "proposal-stable-ui-target",
      operationId: created.operation.id,
      title: "Research proposal",
      summary: "A stable proposal target.",
      findings: ["Finding"],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: []
    });

    expect(proposed.proposal.id).toBe("proposal-stable-ui-target");
    expect(proposed.workspace.artifactProposals["proposal-stable-ui-target"]).toEqual(proposed.proposal);
  });

  it("creates a ResearchObject and source relations only after user confirmation", () => {
    const workspace = createBlankWorkspace("project-op");
    const withSource = {
      ...workspace,
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "课程说明",
          summary: "夜间居家安全要求。",
          body: "夜间居家安全要求。",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const created = createResearchOperation(withSource, {
      userInput: "调研已选资料",
      selectedObjectIds: ["text-source"],
      allowWebSearch: false
    });
    const proposed = recordResearchAnalysisProposal(created.workspace, {
      operationId: created.operation.id,
      title: "夜间路径研究草案",
      summary: "基于本地资料形成的候选分析。",
      findings: ["夜间路径风险来自连续转移。"],
      opportunities: ["用低位连续导向降低迷失感。"],
      constraints: ["不能大施工。"],
      openQuestions: ["如何避免医疗感？"],
      sourceObjectIds: ["text-source"],
      citations: []
    });

    const applied = applyResearchAnalysisProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 100, y: 120 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.researchObject.type).toBe("research");
      expect(applied.workspace.relations).toContainEqual(
        expect.objectContaining({
          kind: "source",
          fromObjectId: "text-source",
          toObjectId: applied.researchObject.id
        })
      );
      expect(applied.workspace.artifactProposals[proposed.proposal.id]?.status).toBe("applied");
    }
  });

  it("persists image generation operation request and provider ids", () => {
    const created = createImageGenerationOperation(createBlankWorkspace("project-op"), {
      operationId: "operation-image-stable",
      clientRequestId: "client-request-stable",
      prompt: "generate a new image",
      selectedObjectIds: ["image-source"],
      imagePixels: false,
      modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast",
      aspectRatio: "1:1",
      referenceObjectIds: ["image-source"]
    });

    const submitted = markImageGenerationOperationSubmitted(created.workspace, {
      operationId: "operation-image-stable",
      referenceObjectIds: ["image-source"],
      imagePixels: true
    });
    const completed = completeImageGenerationOperation(submitted, {
      operationId: "operation-image-stable",
      providerTaskId: "provider-task-1",
      resultObjectId: "image-generated-result"
    });

    expect(completed.operations["operation-image-stable"]).toMatchObject({
      type: "imageGeneration",
      status: "succeeded",
      imageGeneration: {
        clientRequestId: "client-request-stable",
        providerTaskId: "provider-task-1",
        resultObjectId: "image-generated-result",
        modelId: "nano-banana-fast",
        referenceObjectIds: ["image-source"]
      },
      allowedCapabilities: {
        imagePixels: true
      }
    });
  });

  it("persists visual generation plan, multiple results, and partial item failures", () => {
    const created = createImageGenerationOperation(createBlankWorkspace("project-op"), {
      operationId: "operation-image-plan",
      clientRequestId: "client-request-plan",
      prompt: "给每个方向生成预览图",
      selectedObjectIds: ["direction-a", "direction-b"],
      imagePixels: false,
      modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast",
      aspectRatio: "1:1",
      referenceObjectIds: ["direction-a", "direction-b"]
    });
    const planned = recordImageGenerationPlan(created.workspace, {
      operationId: "operation-image-plan",
      plan: {
        kind: "directionPreview",
        items: [
          {
            id: "item-a",
            targetDirectionId: "direction-a",
            title: "方向 A",
            purpose: "首版预览",
            prompt: "生成方向 A",
            referenceObjectIds: ["direction-a"],
            role: "conceptImage"
          },
          {
            id: "item-b",
            targetDirectionId: "direction-b",
            title: "方向 B",
            purpose: "首版预览",
            prompt: "生成方向 B",
            referenceObjectIds: ["direction-b"],
            role: "conceptImage"
          }
        ]
      }
    });
    const withResultA = recordImageGenerationOperationResult(planned, {
      operationId: "operation-image-plan",
      providerTaskId: "provider-task-a",
      resultObjectId: "image-a"
    });
    const withFailure = recordImageGenerationOperationItemFailure(withResultA, {
      operationId: "operation-image-plan",
      planItemId: "item-b",
      reason: "provider failed"
    });

    expect(withFailure.operations["operation-image-plan"]).toMatchObject({
      imageGeneration: {
        plan: {
          kind: "directionPreview"
        },
        resultObjectIds: ["image-a"],
        failedItems: [
          {
            planItemId: "item-b",
            reason: "provider failed"
          }
        ]
      }
    });
  });

  it("marks uncertain image generation responses interrupted instead of resubmitting", () => {
    const created = createImageGenerationOperation(createBlankWorkspace("project-op"), {
      operationId: "operation-image-interrupted",
      clientRequestId: "client-request-interrupted",
      prompt: "generate a new image",
      selectedObjectIds: [],
      imagePixels: false,
      modelId: "nano-banana-fast",
      modelLabel: "nano-banana-fast",
      aspectRatio: "1:1",
      referenceObjectIds: []
    });

    const failed = failImageGenerationOperation(created.workspace, {
      operationId: "operation-image-interrupted",
      status: "interrupted",
      reason: "network interrupted after submit",
      providerTaskId: "provider-task-maybe"
    });

    expect(failed.operations["operation-image-interrupted"]).toMatchObject({
      status: "interrupted",
      errorSummary: "network interrupted after submit",
      retryable: true,
      imageGeneration: {
        providerTaskId: "provider-task-maybe",
        clientRequestId: "client-request-interrupted"
      }
    });
  });

  it("persists research evidence and provenance when applying a proposal", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "Source",
          summary: "Original summary",
          body: "Original body",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const created = createResearchOperation(workspace, {
      userInput: "research selected materials",
      selectedObjectIds: ["text-source"],
      allowWebSearch: true
    });
    const proposed = recordResearchAnalysisProposal(created.workspace, {
      operationId: created.operation.id,
      title: "Structured research",
      summary: "Structured summary.",
      findings: ["Finding A"],
      opportunities: ["Opportunity A"],
      constraints: ["Constraint A"],
      openQuestions: ["Question A"],
      evidence: [
        {
          claim: "Finding A",
          sourceObjectIds: ["text-source"],
          citationUrls: ["https://example.com/source"],
          confidence: "partial"
        }
      ],
      sourceObjectIds: ["text-source"],
      citations: [
        {
          title: "Source citation",
          url: "https://example.com/source",
          domain: "example.com"
        }
      ]
    });

    const applied = applyResearchAnalysisProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 100, y: 120 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.researchObject.evidence).toEqual([
        {
          claim: "Finding A",
          sourceObjectIds: ["text-source"],
          citationIds: proposed.proposal.citationIds,
          confidence: "partial"
        }
      ]);
      expect(applied.researchObject.provenance).toEqual({
        operationId: created.operation.id,
        proposalId: proposed.proposal.id,
        sourceObjectIds: ["text-source"],
        citationIds: proposed.proposal.citationIds,
        didUseWebSearch: true
      });
    }
  });

  it("detects changed research sources before saving a proposal", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "Source",
          summary: "Original summary",
          body: "Original body",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const created = createResearchOperation(workspace, {
      userInput: "research selected materials",
      selectedObjectIds: ["text-source"],
      allowWebSearch: true
    });
    const changed = {
      ...created.workspace,
      objects: {
        ...created.workspace.objects,
        "text-source": {
          ...created.workspace.objects["text-source"],
          summary: "Changed summary",
          body: "Changed body",
          visibility: "hidden" as const
        }
      }
    };

    expect(detectResearchSourceChanges(changed, created.operation.id)).toContain("来源对象已被隐藏");
  });

  it("keeps design-definition proposal operations waiting for user and blocks unrelated operations", () => {
    const workspace = createInitialWorkspace();
    const operationCreated = createArtifactProposalOperation(workspace, {
      operationId: "operation-definition-create",
      type: "designDefinition",
      userInput: "生成设计定义",
      selectedObjectIds: ["research-night-path"],
      workIntent: "createDesignDefinition"
    });
    const proposed = recordDesignDefinitionProposal(operationCreated.workspace, {
      operationId: operationCreated.operation.id,
      workIntent: "createDesignDefinition",
      title: "夜航设计定义",
      summary: "收束当前设计定义。",
      projectGoal: "降低夜间路径风险。",
      targetUsers: ["老人"],
      primaryScenarios: ["夜间起身"],
      coreProblem: "夜间转移缺少连续导向。",
      designPrinciples: ["低干扰"],
      constraints: ["低施工"],
      avoidDirections: ["医疗化"],
      opportunities: ["连续低位导向"],
      openQuestions: ["如何保证触感？"],
      sourceObjectIds: ["research-night-path"],
      citations: []
    });

    expect(proposed.workspace.operations[operationCreated.operation.id]).toMatchObject({
      type: "designDefinition",
      status: "waiting_for_user",
      proposalIds: [proposed.proposal.id]
    });
    expect(canStartOperation(proposed.workspace)).toMatchObject({
      status: "blocked"
    });
    expect(getActiveOperation(proposed.workspace)).toBeUndefined();

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);
    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.workspace.operations[operationCreated.operation.id]?.status).toBe("succeeded");
    }
  });

  it("cancels a waiting proposal operation when the proposal is rejected", () => {
    const workspace = createInitialWorkspace();
    const operationCreated = createArtifactProposalOperation(workspace, {
      operationId: "operation-direction-create",
      type: "conceptDirection",
      userInput: "生成方向",
      selectedObjectIds: ["definition-current"],
      workIntent: "createConceptDirections"
    });
    const proposed = recordConceptDirectionProposal(operationCreated.workspace, {
      operationId: operationCreated.operation.id,
      workIntent: "createConceptDirections",
      title: "方向草案",
      summary: "生成一条方向。",
      sourceObjectIds: ["definition-current"],
      citations: [],
      directions: [
        {
          title: "方向 D",
          summary: "更轻的轨道。",
          conceptStatement: "用连续低位轨道降低风险。",
          keywords: ["轨道"],
          strategy: "低位连续。",
          differentiators: ["低干扰"],
          visualSignals: ["暖光"],
          risks: ["触感不足"],
          openQuestions: ["如何安装？"]
        }
      ]
    });

    const rejected = rejectArtifactProposal(proposed.workspace, proposed.proposal.id, "用户放弃。");

    expect(rejected.artifactProposals[proposed.proposal.id]?.status).toBe("rejected");
    expect(rejected.operations[operationCreated.operation.id]?.status).toBe("cancelled");
  });

  it("does not treat source title or summary edits as semantic source changes", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "Source",
          summary: "Original summary",
          body: "Stable body",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const created = createResearchOperation(workspace, {
      userInput: "research selected materials",
      selectedObjectIds: ["text-source"],
      allowWebSearch: false
    });
    const renamed = {
      ...created.workspace,
      objects: {
        ...created.workspace.objects,
        "text-source": {
          ...created.workspace.objects["text-source"],
          title: "Renamed source",
          summary: "Changed summary only"
        }
      }
    };

    expect(detectResearchSourceChanges(renamed, created.operation.id)).toBeUndefined();
  });

  it("stores review details when source content changes before applying a proposal", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "Source",
          summary: "Original summary",
          body: "Original body",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-source-review",
      title: "首版定义",
      summary: "摘要",
      projectGoal: "目标",
      targetUsers: ["用户"],
      primaryScenarios: ["场景"],
      coreProblem: "问题",
      designPrinciples: ["原则"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: ["text-source"],
      citations: []
    });
    const changed = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        "text-source": {
          ...proposed.workspace.objects["text-source"],
          body: "Changed body"
        }
      }
    };

    const applied = applyDesignDefinitionProposal(changed, proposed.proposal.id);

    expect(applied.status).toBe("blocked");
    if (applied.status === "blocked") {
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        reviewState: "sourceChanged",
        reviewDetails: [
          expect.objectContaining({
            objectId: "text-source",
            reason: "sourceContentChanged"
          })
        ]
      });
    }
  });

  it("allows explicitly reviewed sourceChanged proposals to apply", () => {
    const workspace = {
      ...createBlankWorkspace("project-op"),
      objects: {
        "text-source": {
          id: "text-source",
          type: "text" as const,
          title: "Source",
          summary: "Original summary",
          body: "Original body",
          createdBy: "user" as const,
          visibility: "active" as const
        }
      }
    };
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-source-reviewed",
      title: "首版定义",
      summary: "摘要",
      projectGoal: "目标",
      targetUsers: ["用户"],
      primaryScenarios: ["场景"],
      coreProblem: "问题",
      designPrinciples: ["原则"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: ["text-source"],
      citations: []
    });
    const hidden = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        "text-source": {
          ...proposed.workspace.objects["text-source"],
          visibility: "hidden" as const
        }
      }
    };

    const applied = applyDesignDefinitionProposal(hidden, proposed.proposal.id, { allowSourceChanged: true });

    expect(applied.status).toBe("updated");
  });

  it("applies a design definition proposal as a new revision on the current definition object", () => {
    const workspace = createInitialWorkspace();
    const currentDefinition =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"]
        : undefined;
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-revision",
      title: "当前设计定义 v2",
      summary: "在连续支撑基础上收紧转角与触感边界。",
      projectGoal: "让独居老人夜间起身路径更可辨认、更可扶持、更不打扰家居氛围。",
      targetUsers: ["独居老人"],
      primaryScenarios: ["床边起身", "转角转身", "进入卫浴"],
      coreProblem: "把连续支撑做得更可信，同时保持居家语气。",
      designPrinciples: ["低施工", "连续支撑", "柔和触感"],
      constraints: ["避免医院感", "不依赖重施工"],
      avoidDirections: ["厚重器械感"],
      opportunities: ["把转角和触感做成同一套轨道语言"],
      openQuestions: ["转角连接是否需要更明确的触感变化？"],
      sourceObjectIds: ["insight-continuous-support", "insight-nonmedical"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: currentDefinition?.currentRevisionId,
      changeNote: "把当前定义收紧为更明确的连续支撑边界。"
    });

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.designDefinitionObject.id).toBe("definition-current");
      expect(applied.designDefinitionObject.currentRevisionId).toBe(applied.revision.id);
      expect(applied.designDefinitionObject.revisionIds).toHaveLength(2);
      expect(applied.revision.previousRevisionId).toBe("definition-revision-current-1");
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        status: "applied",
        appliedObjectId: "definition-current"
      });
      expect(applied.workspace.workingState.currentDesignDefinitionId).toBe("definition-current");
      expect(applied.workspace.decisionRecords.at(-1)?.kind).toBe("applyDesignDefinition");
    }
  });

  it("applies a design definition proposal as a first definition when no current definition exists", () => {
    const workspace = createBlankWorkspace("project-op");
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-initial",
      title: "首版夜航设计定义",
      summary: "把夜间起身支撑与柔和路径提示合并为一套居家连续语言。",
      projectGoal: "让夜间起身、转角与入卫浴路径更安全，同时保持居家感。",
      targetUsers: ["独居老人"],
      primaryScenarios: ["床边起身", "进入卫浴"],
      coreProblem: "如何在不增加器械感的情况下建立连续且可信的夜间支撑。",
      designPrinciples: ["连续支撑", "柔和导向", "低施工介入"],
      constraints: ["避免医院感", "尽量不依赖重施工"],
      avoidDirections: ["厚重医疗器械语言"],
      opportunities: ["把扶持、导向与照明整合为一套连续界面"],
      openQuestions: ["转角区域是否需要更明确的触感变化？"],
      sourceObjectIds: [],
      citations: []
    });

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.designDefinitionObject.id).toBe(`design-definition-${proposed.proposal.id}`);
      expect(applied.designDefinitionObject.revisionIds).toEqual([applied.revision.id]);
      expect(applied.revision.revisionNumber).toBe(1);
      expect(applied.revision.previousRevisionId).toBeUndefined();
      expect(applied.workspace.workingState.currentDesignDefinitionId).toBe(applied.designDefinitionObject.id);
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        status: "applied",
        appliedObjectId: applied.designDefinitionObject.id
      });
    }
  });

  it("blocks a design definition proposal when its base revision has been superseded", () => {
    const workspace = createInitialWorkspace();
    const currentDefinition =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"]
        : undefined;
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-stale-base",
      title: "当前设计定义 v2",
      summary: "在连续支撑基础上收紧转角与触感边界。",
      projectGoal: "让独居老人夜间起身路径更可辨识、更可扶持、更不打扰家居氛围。",
      targetUsers: ["独居老人"],
      primaryScenarios: ["床边起身", "转角转身", "进入卫生间"],
      coreProblem: "把连续支撑做得更可确认，同时保持居家语气。",
      designPrinciples: ["低施工", "连续支撑", "柔和触感"],
      constraints: ["避免医院感", "不依赖重施工"],
      avoidDirections: ["厚重器械感"],
      opportunities: ["把转角和触感做成同一套轨道语言"],
      openQuestions: ["转角连接是否需要更明确的触感变化？"],
      sourceObjectIds: ["insight-continuous-support", "insight-nonmedical"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: currentDefinition?.currentRevisionId,
      changeNote: "把当前定义收紧为更明确的连续支撑边界。"
    });
    if (!currentDefinition) {
      throw new Error("Expected seed workspace to include current design definition.");
    }
    const revisionCount = Object.keys(proposed.workspace.designDefinitionRevisions).length;
    const staleWorkspace = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        "definition-current": {
          ...currentDefinition,
          currentRevisionId: "definition-revision-current-2"
        }
      }
    };

    const applied = applyDesignDefinitionProposal(staleWorkspace, proposed.proposal.id);

    expect(applied.status).toBe("blocked");
    if (applied.status === "blocked") {
      expect(applied.reason).toContain("版本");
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        reviewState: "baseSuperseded",
        status: "pending"
      });
      expect(applied.workspace.objects["definition-current"]?.type).toBe("designDefinition");
      expect(Object.keys(applied.workspace.designDefinitionRevisions)).toHaveLength(revisionCount);
    }
  });

  it("applies a create concept direction proposal as pending-preview directions without lineage", () => {
    const workspace = createInitialWorkspace();
    const basedOnRevisionId =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"].currentRevisionId
        : undefined;
    const proposed = recordConceptDirectionProposal(workspace, {
      proposalId: "proposal-direction-batch",
      title: "夜航概念方向组",
      summary: "围绕当前设计定义提出两条并行方向。",
      sourceObjectIds: ["definition-current", "insight-continuous-support"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId,
      directions: [
        {
          title: "方向 D：轨道扶持壁带",
          summary: "把扶持与导光做成更薄的壁带。",
          conceptStatement: "在不增加器械感的前提下，把轨道进一步压薄并强化触感。",
          keywords: ["薄壁带", "连续触感"],
          strategy: "沿用主方向，但压缩结构厚度。",
          differentiators: ["更轻", "更贴墙"],
          visualSignals: ["细窄光带", "贴墙截面"],
          risks: ["触感不够明确"],
          openQuestions: ["是否会削弱支撑可信度？"]
        },
        {
          title: "方向 E：门口支撑拱带",
          summary: "把重点支撑集中在门口与转角。",
          conceptStatement: "用更聚焦的支撑节点处理高风险转角区域。",
          keywords: ["转角支撑", "门口节点"],
          strategy: "集中强化转角与门口，不覆盖全路径。",
          differentiators: ["更聚焦", "节点明确"],
          visualSignals: ["拱形扶持", "门口亮点"],
          risks: ["连续性不足"],
          openQuestions: ["如何避免只剩单点扶手逻辑？"]
        }
      ]
    });

    const applied = applyConceptDirectionProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 1480, y: 980 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.directions).toHaveLength(2);
      expect(applied.directions.every((direction) => direction.status === "pendingPreview")).toBe(true);
      expect(applied.workspace.directionLineage).toHaveLength(workspace.directionLineage.length);
      expect(applied.workspace.relations).toContainEqual(
        expect.objectContaining({
          kind: "supports",
          fromObjectId: "definition-current"
        })
      );
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        status: "applied"
      });
      expect(applied.workspace.workingState.primaryDirectionId).toBe("direction-soft-rail");
      expect(applied.workspace.decisionRecords.at(-1)?.kind).toBe("applyConceptDirection");
    }
  });

  it("revises a concept direction in place without creating a new direction or lineage", () => {
    const workspace = createInitialWorkspace();
    const target = workspace.objects["direction-soft-rail"];
    if (!target || target.type !== "conceptDirection") {
      throw new Error("Expected seed direction.");
    }
    const previousRevision = workspace.directionRevisions[target.currentRevisionId];
    const proposed = recordConceptDirectionProposal(workspace, {
      proposalId: "proposal-direction-revise",
      workIntent: "reviseConceptDirection",
      applicationMode: "revise",
      targetDirectionId: target.id,
      title: "修订柔光轨道",
      summary: "把主方向收紧为更轻的连续触感语言。",
      sourceObjectIds: ["definition-current", target.id],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId:
        workspace.objects["definition-current"]?.type === "designDefinition"
          ? workspace.objects["definition-current"].currentRevisionId
          : undefined,
      directions: [
        {
          title: "方向 A：轻薄柔光轨道",
          summary: "在原方向上压薄体量并强化手部触感。",
          conceptStatement: "以连续低位轨道保持路径安全，同时减少装置感。",
          keywords: ["轻薄轨道", "连续触感"],
          strategy: "保留连续路线，降低截面厚度。",
          differentiators: ["更轻", "更弱器械感"],
          visualSignals: ["薄截面", "暖色低位光"],
          risks: ["支撑感可能不足"],
          openQuestions: ["触感与结构强度如何平衡？"]
        }
      ]
    });

    const applied = applyConceptDirectionProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 1480, y: 980 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      const revised = applied.workspace.objects[target.id];
      expect(applied.directions.map((direction) => direction.id)).toEqual([target.id]);
      expect(revised).toMatchObject({
        id: target.id,
        type: "conceptDirection",
        title: "方向 A：轻薄柔光轨道",
        summary: "在原方向上压薄体量并强化手部触感。",
        keywords: ["轻薄轨道", "连续触感"]
      });
      expect(revised?.type === "conceptDirection" ? revised.revisionIds : []).toHaveLength(target.revisionIds.length + 1);
      expect(applied.workspace.directionRevisions[target.currentRevisionId]).toMatchObject({
        id: target.currentRevisionId,
        isCurrent: false
      });
      const currentRevisionId = revised?.type === "conceptDirection" ? revised.currentRevisionId : "";
      expect(applied.workspace.directionRevisions[currentRevisionId]).toMatchObject({
        revisionNumber: (previousRevision?.revisionNumber ?? 1) + 1,
        previousRevisionId: target.currentRevisionId,
        isCurrent: true
      });
      expect(applied.workspace.directionLineage).toHaveLength(workspace.directionLineage.length);
    }
  });

  it("splits one concept direction into child directions without eliminating the parent", () => {
    const workspace = createInitialWorkspace();
    const parent = workspace.objects["direction-soft-rail"];
    if (!parent || parent.type !== "conceptDirection") {
      throw new Error("Expected seed direction.");
    }
    const proposed = recordConceptDirectionProposal(workspace, {
      proposalId: "proposal-direction-split",
      workIntent: "splitConceptDirection",
      applicationMode: "split",
      parentDirectionIds: [parent.id],
      title: "拆分柔光轨道",
      summary: "把主方向拆成两条可比较路线。",
      sourceObjectIds: ["definition-current", parent.id],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId:
        workspace.objects["definition-current"]?.type === "designDefinition"
          ? workspace.objects["definition-current"].currentRevisionId
          : undefined,
      directions: [
        {
          title: "方向 A1：薄壁连续轨",
          summary: "强调墙面连续触摸。",
          conceptStatement: "用更薄的墙面轨道提供连续安全感。",
          keywords: ["薄壁", "连续"],
          strategy: "沿墙展开。",
          differentiators: ["更轻"],
          visualSignals: ["细长截面"],
          risks: ["触感弱"],
          openQuestions: ["如何保证握持？"]
        },
        {
          title: "方向 A2：节点扶持轨",
          summary: "强调关键节点扶持。",
          conceptStatement: "保留低位导向，把支撑集中到风险节点。",
          keywords: ["节点", "扶持"],
          strategy: "重点强化转角。",
          differentiators: ["更聚焦"],
          visualSignals: ["节点亮点"],
          risks: ["连续性弱"],
          openQuestions: ["节点间如何衔接？"]
        }
      ]
    });

    const applied = applyConceptDirectionProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 1480, y: 980 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.directions).toHaveLength(2);
      expect(applied.workspace.objects[parent.id]).toMatchObject({ id: parent.id, status: parent.status });
      expect(applied.directions.map((direction) => direction.lineageRootId)).toEqual([parent.lineageRootId, parent.lineageRootId]);
      const splitLineage = applied.workspace.directionLineage.filter(
        (record) => record.kind === "splitFromDirection" && record.fromDirectionId === parent.id
      );
      expect(splitLineage).toHaveLength(2);
      expect(splitLineage.map((record) => record.toDirectionId).sort()).toEqual(
        applied.directions.map((direction) => direction.id).sort()
      );
    }
  });

  it("merges multiple concept directions into one new direction with all parent lineage preserved", () => {
    const workspace = createInitialWorkspace();
    const parentIds = ["direction-soft-rail", "direction-support-island"];
    const proposed = recordConceptDirectionProposal(workspace, {
      proposalId: "proposal-direction-merge",
      workIntent: "mergeConceptDirections",
      applicationMode: "merge",
      parentDirectionIds: parentIds,
      title: "合并方向 A/B",
      summary: "把连续导光和家具化支撑合并成一个新方向。",
      sourceObjectIds: ["definition-current", ...parentIds],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId:
        workspace.objects["definition-current"]?.type === "designDefinition"
          ? workspace.objects["definition-current"].currentRevisionId
          : undefined,
      directions: [
        {
          title: "方向 AB：家具化柔光支撑轨",
          summary: "把低位导光与家具化支撑统一。",
          conceptStatement: "用家具化节点承接连续轨道，形成更温和的安全路径。",
          keywords: ["家具化", "柔光支撑"],
          strategy: "轨道提供连续性，节点提供支撑可信度。",
          differentiators: ["连续且可信"],
          visualSignals: ["木质节点", "低位光带"],
          risks: ["系统复杂度增加"],
          openQuestions: ["节点密度如何控制？"]
        }
      ]
    });

    const applied = applyConceptDirectionProposal(proposed.workspace, proposed.proposal.id, {
      position: { x: 1480, y: 980 }
    });

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.directions).toHaveLength(1);
      const merged = applied.directions[0];
      expect(merged?.lineageRootId).toBe(merged?.id);
      for (const parentId of parentIds) {
        expect(applied.workspace.objects[parentId]).toMatchObject({
          id: parentId,
          type: "conceptDirection",
          status: workspace.objects[parentId]?.type === "conceptDirection" ? workspace.objects[parentId].status : undefined
        });
      }
      const mergeLineage = applied.workspace.directionLineage.filter(
        (record) => record.kind === "mergedFromDirection" && record.toDirectionId === merged?.id
      );
      expect(mergeLineage.map((record) => record.fromDirectionId).sort()).toEqual([...parentIds].sort());
    }
  });

  it("blocks a concept direction proposal when a source object has been hidden", () => {
    const workspace = createInitialWorkspace();
    const basedOnRevisionId =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"].currentRevisionId
        : undefined;
    const proposed = recordConceptDirectionProposal(workspace, {
      proposalId: "proposal-direction-hidden-source",
      title: "夜航概念方向组",
      summary: "围绕当前设计定义提出两条并行方向。",
      sourceObjectIds: ["insight-continuous-support", "insight-nonmedical"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId,
      directions: [
        {
          title: "方向 D：轨道扶持墙带",
          summary: "把扶持与导向做成更薄的墙带。",
          conceptStatement: "在不增加器械感的前提下，让路径更连续。",
          keywords: ["轨道", "扶持"],
          strategy: "压缩结构厚度。",
          differentiators: ["更轻", "更贴墙"],
          visualSignals: ["细窄光带"],
          risks: ["触感不够明确"],
          openQuestions: ["是否会削弱支撑感？"]
        }
      ]
    });
    const sourceObject = proposed.workspace.objects["insight-continuous-support"];
    if (!sourceObject) {
      throw new Error("Expected seed workspace to include source object.");
    }
    const canvasInstanceCount = proposed.workspace.canvas.instances.length;
    const hiddenWorkspace = {
      ...proposed.workspace,
      objects: {
        ...proposed.workspace.objects,
        "insight-continuous-support": {
          ...sourceObject,
          visibility: "hidden" as const
        }
      }
    };

    const applied = applyConceptDirectionProposal(hiddenWorkspace, proposed.proposal.id, {
      position: { x: 1480, y: 980 }
    });

    expect(applied.status).toBe("blocked");
    if (applied.status === "blocked") {
      expect(applied.reason).toContain("来源");
      expect(applied.workspace.artifactProposals[proposed.proposal.id]).toMatchObject({
        reviewState: "sourceChanged",
        status: "pending"
      });
      expect(applied.workspace.objects["direction-soft-rail"]?.type).toBe("conceptDirection");
      expect(applied.workspace.canvas.instances).toHaveLength(canvasInstanceCount);
    }
  });
});
