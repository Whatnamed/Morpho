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
  recordAndApplyConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordImageGenerationPlan,
  recordImageGenerationOperationItemFailure,
  recordImageGenerationOperationResult,
  recordResearchAnalysisProposal,
  rejectArtifactProposal,
  setCurrentDesignDefinition,
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

  it("does not block new work for an older proposal operation that is waiting for user review", () => {
    const created = createArtifactProposalOperation(createBlankWorkspace("project-op"), {
      operationId: "operation-old-waiting-proposal",
      type: "conceptDirection",
      userInput: "generate drafts",
      selectedObjectIds: [],
      workIntent: "createConceptDirections"
    }).workspace;
    const operation = created.operations["operation-old-waiting-proposal"];
    expect(operation).toBeDefined();
    const waiting = {
      ...created,
      operations: {
        ...created.operations,
        "operation-old-waiting-proposal": {
          ...operation!,
          status: "waiting_for_user" as const
        }
      }
    };

    expect(canStartOperation(waiting).status).toBe("ok");
  });

  it("can directly place explicit concept direction drafts as separate canvas directions", () => {
    const workspace = createInitialWorkspace();
    const result = recordAndApplyConceptDirectionProposal(workspace, {
      operationId: undefined,
      workIntent: "createConceptDirections",
      title: "声浮概念方向组",
      summary: "三个可并排判断的方向。",
      directions: [
        {
          title: "方向 1 | 声学锚定式声学哨站",
          summary: "用固定部署形成稳定声学边界。",
          conceptStatement: "以长期驻留节点承担连续监测。",
          keywords: ["固定部署", "远距预警"],
          strategy: "把关键节点做成稳定基础设施。",
          differentiators: ["部署稳定", "系统边界清楚"],
          visualSignals: ["竖向锚点", "模块化外壳"],
          risks: ["初期布设成本较高"],
          openQuestions: ["如何降低维护频率"]
        },
        {
          title: "方向 2 | 漂移拼接式避险浮标群",
          summary: "用可迁移浮标构成动态态势网络。",
          conceptStatement: "以群体协同覆盖复杂海域。",
          keywords: ["群体协同", "动态部署"],
          strategy: "把系统做成可重组网络。",
          differentiators: ["适应性强", "覆盖范围可变"],
          visualSignals: ["浮体阵列", "柔性连接"],
          risks: ["边界稳定性需要验证"],
          openQuestions: ["如何表达群体协同"]
        },
        {
          title: "方向 3 | 近人引导式声学交互终端",
          summary: "把系统收束为人与环境之间的交互终端。",
          conceptStatement: "以近人端提示理解和行动。",
          keywords: ["近人引导", "交互反馈"],
          strategy: "把复杂监测结果翻译为可行动反馈。",
          differentiators: ["用户理解成本低", "反馈更直接"],
          visualSignals: ["手持终端", "柔和声光提示"],
          risks: ["信息过载风险"],
          openQuestions: ["如何控制提示层级"]
        }
      ],
      sourceObjectIds: ["definition-current"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: "definition-revision-current-1",
      position: { x: 1200, y: 320 }
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.directions).toHaveLength(3);
    expect(result.workspace.objects[result.proposal.id]).toBeUndefined();
    expect(result.workspace.artifactProposals[result.proposal.id]?.status).toBe("applied");
    const directionInstances = result.workspace.canvas.instances
      .filter((instance) => result.directions.some((direction) => direction.id === instance.objectId))
      .sort((left, right) => left.position.y - right.position.y);
    expect(directionInstances).toHaveLength(3);
    expect(directionInstances.map((instance) => instance.position.x)).toEqual([1200, 1200, 1200]);
    expect(directionInstances[1]!.position.y).toBe(
      directionInstances[0]!.position.y + directionInstances[0]!.size.h + 32
    );
    expect(directionInstances[2]!.position.y).toBe(
      directionInstances[1]!.position.y + directionInstances[1]!.size.h + 32
    );
    expect(directionInstances.every((instance) => instance.size.w === 320)).toBe(true);
    expect(result.workspace.objects[result.directions[1]!.id]).toMatchObject({
      type: "conceptDirection",
      title: "方向 2 | 漂移拼接式避险浮标群",
      summary: "用可迁移浮标构成动态态势网络。",
      status: "pendingPreview"
    });
  });

  it("unblocks new work after a text operation fails", () => {
    const created = createResearchOperation(createBlankWorkspace("project-op"), {
      userInput: "继续联网调研",
      selectedObjectIds: [],
      allowWebSearch: true
    }).workspace;

    const failed = failOperation(created, Object.values(created.operations)[0]?.id ?? "", {
      status: "failed",
      reason: "AiJWS 请求失败。"
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

    expect(Object.values(proposed.workspace.objects).filter((object) => object.type === "research")).toHaveLength(0);
    expect(proposed.workspace.objects[proposed.proposal.id]).toMatchObject({
      type: "proposalDraft",
      proposalId: proposed.proposal.id,
      proposalType: "researchAnalysis"
    });
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

    expect(updated.objects["text-source"]).toEqual(proposed.workspace.objects["text-source"]);
    expect(updated.objects[proposed.proposal.id]).toMatchObject({
      type: "proposalDraft",
      title: updated.artifactProposals[proposed.proposal.id]?.title,
      summary: updated.artifactProposals[proposed.proposal.id]?.summary
    });
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

    expect(rejected.objects[proposed.proposal.id]).toBeUndefined();
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

  it("completes design-definition proposal operations after placing the draft on canvas", () => {
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
      status: "succeeded",
      proposalIds: [proposed.proposal.id]
    });
    expect(canStartOperation(proposed.workspace)).toMatchObject({
      status: "ok"
    });
    expect(getActiveOperation(proposed.workspace)).toBeUndefined();

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);
    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.workspace.operations[operationCreated.operation.id]?.status).toBe("succeeded");
    }
  });

  it("keeps completed proposal operations completed when the canvas draft is rejected", () => {
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
    expect(rejected.operations[operationCreated.operation.id]?.status).toBe("succeeded");
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
      workIntent: "reviseDesignDefinition",
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

  it("keeps create-definition alternatives as separate canvas objects when switching the current definition", () => {
    const workspace = createBlankWorkspace("project-definition-alternatives");
    const proposalA = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-a",
      operationId: "operation-definition-alternatives",
      workIntent: "createDesignDefinition",
      title: "方案 A｜Acoustic warning buoy",
      summary: "Definition A",
      projectGoal: "Clarify route A.",
      targetUsers: ["Port operator"],
      primaryScenarios: ["Shipping lane"],
      coreProblem: "Warn operators about acoustic risk.",
      designPrinciples: ["Clear warning"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 640, y: 320 }
    });
    const proposalB = recordDesignDefinitionProposal(proposalA.workspace, {
      proposalId: "proposal-definition-b",
      operationId: "operation-definition-alternatives",
      workIntent: "createDesignDefinition",
      title: "方案 B｜Dynamic refuge network",
      summary: "Definition B",
      projectGoal: "Clarify route B.",
      targetUsers: ["Conservation operator"],
      primaryScenarios: ["Acoustic refuge"],
      coreProblem: "Coordinate a dynamic protected area.",
      designPrinciples: ["Adaptive boundary"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 640, y: 520 }
    });

    const appliedA = applyDesignDefinitionProposal(proposalB.workspace, proposalA.proposal.id);
    expect(appliedA.status).toBe("updated");
    if (appliedA.status !== "updated") {
      return;
    }

    const appliedB = applyDesignDefinitionProposal(appliedA.workspace, proposalB.proposal.id);
    expect(appliedB.status).toBe("updated");
    if (appliedB.status !== "updated") {
      return;
    }

    expect(appliedB.designDefinitionObject.id).not.toBe(appliedA.designDefinitionObject.id);
    expect(appliedB.workspace.objects[appliedA.designDefinitionObject.id]).toMatchObject({
      title: "方案 A｜Acoustic warning buoy",
      type: "designDefinition",
      isCurrentEffective: false
    });
    expect(appliedB.workspace.objects[appliedB.designDefinitionObject.id]).toMatchObject({
      title: "方案 B｜Dynamic refuge network",
      type: "designDefinition",
      isCurrentEffective: true
    });
    expect(appliedB.workspace.canvas.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectId: appliedA.designDefinitionObject.id,
          position: { x: 640, y: 320 }
        }),
        expect.objectContaining({
          objectId: appliedB.designDefinitionObject.id,
          position: { x: 640, y: 640 }
        })
      ])
    );
  });

  it("can restore a previous definition as current without moving either definition", () => {
    const workspace = createInitialWorkspace();
    const original = workspace.objects["definition-current"];
    if (!original || original.type !== "designDefinition") {
      throw new Error("Expected a current design definition.");
    }
    const alternative = {
      ...original,
      id: "definition-alternative",
      title: "Alternative definition",
      isCurrentEffective: false,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    };
    const withAlternative = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [alternative.id]: alternative
      },
      canvas: {
        ...workspace.canvas,
        instances: [
          ...workspace.canvas.instances,
          {
            id: "canvas-definition-alternative",
            objectId: alternative.id,
            position: { x: 900, y: 500 },
            size: { w: 320, h: 210 }
          }
        ]
      }
    };

    const switched = setCurrentDesignDefinition(withAlternative, alternative.id);

    expect(switched.objects["definition-current"]).toMatchObject({ isCurrentEffective: false });
    expect(switched.objects[alternative.id]).toMatchObject({ isCurrentEffective: true });
    expect(switched.workingState.currentDesignDefinitionId).toBe(alternative.id);
    expect(switched.canvas.instances).toEqual(withAlternative.canvas.instances);
  });

  it("places an applied first design definition on the canvas at the proposal placement", () => {
    const workspace = createBlankWorkspace("project-definition-placement");
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-canvas-placement",
      title: "Definition draft",
      summary: "A concise design definition draft.",
      projectGoal: "Create a clear product definition.",
      targetUsers: ["User"],
      primaryScenarios: ["Scenario"],
      coreProblem: "The project needs a stable definition.",
      designPrinciples: ["Clear boundary"],
      constraints: ["Low complexity"],
      avoidDirections: ["Vague scope"],
      opportunities: ["Better decision making"],
      openQuestions: ["What should be verified next?"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 640, y: 360 }
    });

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.workspace.canvas.instances).toContainEqual(
        expect.objectContaining({
          objectId: applied.designDefinitionObject.id,
          position: { x: 640, y: 360 },
          size: { w: 340, h: 210 }
        })
      );
      expect(applied.workspace.ui.lastSelectionIds).toEqual([applied.designDefinitionObject.id]);
    }
  });

  it("records a pending design proposal as a real canvas object until it is applied or rejected", () => {
    const workspace = createBlankWorkspace("project-real-proposal-object");
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-real-object",
      title: "Definition draft",
      summary: "Short draft summary.",
      projectGoal: "Create a clear product definition.",
      targetUsers: ["User"],
      primaryScenarios: ["Scenario"],
      coreProblem: "The project needs a stable definition.",
      designPrinciples: ["Clear boundary"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 640, y: 360 }
    });

    expect(proposed.workspace.objects[proposed.proposal.id]).toMatchObject({
      id: proposed.proposal.id,
      type: "proposalDraft",
      proposalId: proposed.proposal.id,
      proposalType: "designDefinition",
      visibility: "active",
      title: "Definition draft",
      summary: "Short draft summary."
    });
    expect(proposed.workspace.canvas.instances).toContainEqual(
      expect.objectContaining({
        objectId: proposed.proposal.id,
        position: { x: 640, y: 360 }
      })
    );

    const rejected = rejectArtifactProposal(proposed.workspace, proposed.proposal.id, "discarded");
    expect(rejected.artifactProposals[proposed.proposal.id]?.status).toBe("rejected");
    expect(rejected.objects[proposed.proposal.id]).toBeUndefined();
    expect(rejected.canvas.instances.some((instance) => instance.objectId === proposed.proposal.id)).toBe(false);
  });

  it("removes the pending proposal object when applying the proposal", () => {
    const workspace = createBlankWorkspace("project-apply-real-proposal-object");
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-apply-removes-draft",
      title: "Definition draft",
      summary: "Short draft summary.",
      projectGoal: "Create a clear product definition.",
      targetUsers: ["User"],
      primaryScenarios: ["Scenario"],
      coreProblem: "The project needs a stable definition.",
      designPrinciples: ["Clear boundary"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 320, y: 180 }
    });

    const applied = applyDesignDefinitionProposal(proposed.workspace, proposed.proposal.id);

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.workspace.objects[proposed.proposal.id]).toBeUndefined();
      expect(applied.workspace.canvas.instances.some((instance) => instance.objectId === proposed.proposal.id)).toBe(false);
      expect(applied.workspace.canvas.instances.some((instance) => instance.objectId === applied.designDefinitionObject.id)).toBe(true);
    }
  });

  it("applies a moved proposal draft from its real canvas object position", () => {
    const workspace = createBlankWorkspace("project-apply-moved-proposal-object");
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-apply-moved-draft",
      title: "Definition draft",
      summary: "Short draft summary.",
      projectGoal: "Create a clear product definition.",
      targetUsers: ["User"],
      primaryScenarios: ["Scenario"],
      coreProblem: "The project needs a stable definition.",
      designPrinciples: ["Clear boundary"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 320, y: 180 }
    });
    const movedWorkspace = {
      ...proposed.workspace,
      canvas: {
        ...proposed.workspace.canvas,
        instances: proposed.workspace.canvas.instances.map((instance) =>
          instance.objectId === proposed.proposal.id
            ? { ...instance, position: { x: 820, y: 420 } }
            : instance
        )
      }
    };

    const applied = applyDesignDefinitionProposal(movedWorkspace, proposed.proposal.id);

    expect(applied.status).toBe("updated");
    if (applied.status === "updated") {
      expect(applied.workspace.canvas.instances).toContainEqual(
        expect.objectContaining({
          objectId: applied.designDefinitionObject.id,
          position: { x: 820, y: 420 }
        })
      );
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
