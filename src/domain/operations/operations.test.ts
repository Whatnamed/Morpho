import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "../morpho/workspace";
import {
  applyResearchAnalysisProposal,
  canStartOperation,
  completeImageGenerationOperation,
  createImageGenerationOperation,
  createResearchOperation,
  detectResearchSourceChanges,
  failImageGenerationOperation,
  interruptActiveOperations,
  markImageGenerationOperationSubmitted,
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
});
