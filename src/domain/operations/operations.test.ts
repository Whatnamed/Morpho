import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "../morpho/workspace";
import {
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  canStartOperation,
  completeImageGenerationOperation,
  createImageGenerationOperation,
  createResearchOperation,
  detectResearchSourceChanges,
  failImageGenerationOperation,
  interruptActiveOperations,
  markImageGenerationOperationSubmitted,
  recordConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordResearchAnalysisProposal
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

    expect(detectResearchSourceChanges(changed, created.operation.id)).toContain("来源已变化");
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

  it("applies a concept direction proposal as pending-preview directions with lineage records", () => {
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
          openQuestions: ["是否会削弱支撑可信度？"],
          basedOnDirectionId: "direction-soft-rail",
          lineageKind: "splitFromDirection"
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
      expect(applied.workspace.directionLineage).toContainEqual(
        expect.objectContaining({
          kind: "splitFromDirection",
          fromDirectionId: "direction-soft-rail"
        })
      );
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
