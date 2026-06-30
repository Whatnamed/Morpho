import { describe, expect, it } from "vitest";

import { createResearchOperation } from "../../domain/operations/operations";
import { parseResearchAnalysisProposalPayload } from "../../domain/operations/researchProposal";
import { createInitialWorkspace } from "../../domain/morpho/workspace";

import { buildTaskContext } from "./taskContext";
import { applyResearchProposalWithSemanticPatch } from "./researchSemanticPatch";

describe("research success semantic patch", () => {
  it("creates a research card and writes a validated semantic patch without binding the new research card as source", () => {
    const draft = "请分析这些资料，后续不要做得太科技化。";
    const userMessageId = "ai-user-research-semantic-success";
    const userMessageCreatedAt = "2026-06-30T13:00:00.000Z";
    const workspaceWithMessage = {
      ...createInitialWorkspace(),
      ai: {
        messages: [
          {
            id: userMessageId,
            role: "user" as const,
            body: draft,
            createdAt: userMessageCreatedAt,
            taskMode: "researchOperation" as const
          }
        ]
      }
    };
    const created = createResearchOperation(workspaceWithMessage, {
      userInput: draft,
      selectedObjectIds: ["file-course-brief"],
      allowWebSearch: false
    });
    const context = buildTaskContext(created.workspace, {
      kind: "research",
      draft,
      selectedObjectIds: ["file-course-brief"]
    });
    const assistantText = [
      "研究结果如下。",
      "```json",
      JSON.stringify({
        morphoResearchProposal: {
          title: "夜航路径研究",
          summary: "围绕夜间识别和家庭使用约束整理机会。",
          findings: ["夜间识别需要比复杂造型更优先。"],
          opportunities: ["用温和灯带提示路径。"],
          constraints: ["避免医疗监测设备语义。"],
          openQuestions: [],
          evidence: []
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "avoidance",
              scope: "project",
              evidenceQuote: "后续不要做得太科技化",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const parsedProposal = parseResearchAnalysisProposalPayload(assistantText);
    if (parsedProposal.status !== "ok") {
      throw new Error(parsedProposal.reason);
    }

    const result = applyResearchProposalWithSemanticPatch({
      workspace: created.workspace,
      proposal: {
        proposalId: "proposal-research-semantic-success",
        operationId: created.operation.id,
        title: parsedProposal.proposal.title,
        summary: parsedProposal.proposal.summary,
        findings: parsedProposal.proposal.findings,
        opportunities: parsedProposal.proposal.opportunities,
        constraints: parsedProposal.proposal.constraints,
        openQuestions: parsedProposal.proposal.openQuestions,
        evidence: parsedProposal.proposal.evidence,
        sourceObjectIds: context.objectIds,
        citations: []
      },
      position: { x: 100, y: 100 },
      context,
      draft,
      userMessageId,
      userMessageCreatedAt,
      assistantText
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      throw new Error(result.reason);
    }
    expect(result.workspace.objects[result.researchObjectId]?.type).toBe("research");
    expect(result.semanticPatch.status).toBe("applied");
    const semanticPatch = result.semanticPatch;
    if (semanticPatch.status !== "applied") {
      throw new Error(semanticPatch.reason);
    }
    const entry = result.workspace.projectContinuity.recordEntries.find((candidate) => candidate.id === semanticPatch.entryIds[0]);
    expect(entry).toMatchObject({
      origin: "conversationSemanticPatch",
      semanticKind: "avoidance",
      sourceMessageId: userMessageId,
      evidenceQuote: "后续不要做得太科技化"
    });
    expect(entry?.sourceRefs.some((ref) => ref.kind === "object" && ref.id === result.researchObjectId)).toBe(false);
    expect(semanticPatch.visibleBody).not.toContain("morphoProjectContinuityPatch");
    expect(`已补入项目记录 · ${semanticPatch.entryIds.length} 条`).toBe("已补入项目记录 · 1 条");
  });
});
