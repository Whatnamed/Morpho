import { describe, expect, it } from "vitest";

import type { ComparisonAnalysis, MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace, hideObject } from "@/domain/morpho/workspace";
import {
  applyConfirmedComparisonDecision,
  isComparisonDecisionReasonRequired,
  prepareComparisonDecision,
  resolveComparisonWritebackSourceObjectIds,
  type PendingComparisonConfirmation
} from "./comparisonDecision";

describe("comparison decision workflow", () => {
  it("uses the key conclusion candidate subset when confirming compareCreateKeyConclusion", () => {
    const confirmation: PendingComparisonConfirmation = {
      kind: "compareCreateKeyConclusion",
      targetTitle: "夜间连续导向优先于装饰复杂度",
      comparisonAnalysisId: "comparison-1",
      comparisonAssistantMessageId: "assistant-1",
      comparisonSourceObjectIds: ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2"],
      keyConclusionSourceObjectIds: ["direction-soft-rail"],
      summary: "柔光轨道更适合作为主方向。",
      userReason: "",
      reasonRequired: false,
      keyConclusionDraft: {
        title: "夜间连续导向优先于装饰复杂度",
        body: "夜间连续导向优先于装饰复杂度。",
        summary: "优先保留连续导向。",
        category: "finding",
        confidence: "partial"
      }
    };

    expect(resolveComparisonWritebackSourceObjectIds(confirmation)).toEqual(["direction-soft-rail"]);
  });

  it("keeps the full compare selection for non-key-conclusion decisions", () => {
    const confirmation: PendingComparisonConfirmation = {
      kind: "compareSetPrimary",
      targetObjectId: "direction-soft-rail",
      targetTitle: "柔光轨道",
      comparisonAnalysisId: "comparison-1",
      comparisonAssistantMessageId: "assistant-1",
      comparisonSourceObjectIds: ["direction-soft-rail", "direction-support-island"],
      summary: "柔光轨道更适合作为主方向。",
      userReason: "",
      reasonRequired: false
    };

    expect(resolveComparisonWritebackSourceObjectIds(confirmation)).toEqual([
      "direction-soft-rail",
      "direction-support-island"
    ]);
  });

  it("prepares all seven Compare actions without mutating the workspace", () => {
    const workspace = withAnalysis(createInitialWorkspace(), makeWorkflowAnalysis());
    const before = structuredClone(workspace);
    const cases = [
      ["setPrimary", "direction-support-island", "compareSetPrimary"],
      ["setAlternative", "direction-support-island", "compareSetAlternative"],
      ["eliminate", "direction-support-island", "compareEliminate"],
      ["setDefaultReference", "image-night-scenario", "compareSetDefaultReference"],
      ["clearDefaultReference", "image-soft-rail-v2", "compareClearDefaultReference"],
      ["createKeyConclusion", undefined, "compareCreateKeyConclusion"]
    ] as const;

    for (const [action, objectId, kind] of cases) {
      const result = prepareComparisonDecision(workspace, "comparison-workflow", action, objectId);
      expect(result).toMatchObject({ status: "ready", confirmation: { kind } });
    }

    const restore = prepareComparisonDecision(
      makeEliminatedWorkspace(),
      "comparison-workflow",
      "restoreAlternative",
      "direction-support-island"
    );
    expect(restore).toMatchObject({ status: "ready", confirmation: { kind: "compareRestoreAlternative" } });
    expect(workspace).toEqual(before);
  });

  it("applies every confirmed action through the domain writeback contract", () => {
    const cases = [
      ["setPrimary", "direction-support-island"],
      ["setAlternative", "direction-support-island"],
      ["eliminate", "direction-support-island"],
      ["setDefaultReference", "image-night-scenario"],
      ["clearDefaultReference", "image-soft-rail-v2"]
    ] as const;

    for (const [action, objectId] of cases) {
      const workspace = withAnalysis(createInitialWorkspace(), makeWorkflowAnalysis());
      const prepared = prepareComparisonDecision(workspace, "comparison-workflow", action, objectId);
      if (prepared.status !== "ready") {
        throw new Error(prepared.reason);
      }

      const confirmation = prepared.confirmation.reasonRequired
        ? { ...prepared.confirmation, userReason: "用户确认此 Compare 决定的理由。" }
        : prepared.confirmation;
      const result = applyConfirmedComparisonDecision(workspace, confirmation);
      expect(result.status).toBe("applied");
      if (result.status === "applied") {
        expect(result.workspace.decisionRecords.at(-1)?.comparison).toMatchObject({
          comparisonAnalysisId: "comparison-workflow",
          comparisonAssistantMessageId: "assistant-workflow",
          comparisonSourceObjectIds: [
            "direction-soft-rail",
            "direction-support-island",
            "image-soft-rail-v2",
            "image-night-scenario",
            "research-night-path"
          ]
        });
      }
    }

    const restore = prepareComparisonDecision(
      makeEliminatedWorkspace(),
      "comparison-workflow",
      "restoreAlternative",
      "direction-support-island"
    );
    if (restore.status !== "ready") {
      throw new Error(restore.reason);
    }
    expect(
      applyConfirmedComparisonDecision(
        makeEliminatedWorkspace(),
        { ...restore.confirmation, userReason: "恢复为备选的理由。" }
      ).status
    ).toBe("applied");

    const keyConclusionWorkspace = withAnalysis(createInitialWorkspace(), makeWorkflowAnalysis());
    const keyConclusion = prepareComparisonDecision(keyConclusionWorkspace, "comparison-workflow", "createKeyConclusion");
    if (keyConclusion.status !== "ready") {
      throw new Error(keyConclusion.reason);
    }
    const keyConclusionResult = applyConfirmedComparisonDecision(keyConclusionWorkspace, keyConclusion.confirmation);
    expect(keyConclusionResult.status).toBe("applied");
    if (keyConclusionResult.status === "applied") {
      const created = keyConclusionResult.focusObjectId
        ? keyConclusionResult.workspace.objects[keyConclusionResult.focusObjectId]
        : undefined;
      expect(created?.type === "keyConclusion" ? created.sourceObjectIds : undefined).toEqual(["research-night-path"]);
      expect(keyConclusionResult.selectionObjectIds).toEqual([keyConclusionResult.focusObjectId]);
      expect(keyConclusionResult.workspace.decisionRecords.at(-1)?.comparison?.comparisonSourceObjectIds).toHaveLength(5);
    }
  });

  it("enforces reason rules and revalidates current analysis and targets", () => {
    expect(isComparisonDecisionReasonRequired("setPrimary")).toBe(false);
    expect(isComparisonDecisionReasonRequired("setAlternative")).toBe(false);
    expect(isComparisonDecisionReasonRequired("createKeyConclusion")).toBe(false);
    expect(isComparisonDecisionReasonRequired("eliminate")).toBe(true);
    expect(isComparisonDecisionReasonRequired("restoreAlternative")).toBe(true);
    expect(isComparisonDecisionReasonRequired("setDefaultReference")).toBe(true);
    expect(isComparisonDecisionReasonRequired("clearDefaultReference")).toBe(true);

    const workspace = withAnalysis(createInitialWorkspace(), makeWorkflowAnalysis());
    const required = prepareComparisonDecision(workspace, "comparison-workflow", "eliminate", "direction-support-island");
    if (required.status !== "ready") {
      throw new Error(required.reason);
    }
    expect(applyConfirmedComparisonDecision(workspace, required.confirmation)).toMatchObject({ status: "blocked" });
    expect(getDirectionStatus(workspace, "direction-support-island")).not.toBe("eliminated");

    const optional = prepareComparisonDecision(workspace, "comparison-workflow", "setPrimary", "direction-support-island");
    if (optional.status !== "ready") {
      throw new Error(optional.reason);
    }
    expect(applyConfirmedComparisonDecision(workspace, optional.confirmation).status).toBe("applied");
    expect(
      applyConfirmedComparisonDecision(hideObject(workspace, "direction-support-island"), optional.confirmation).status
    ).toBe("blocked");

    const mismatchedAnalysis: MorphoWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        comparisonAnalyses: {
          ...workspace.ai.comparisonAnalyses,
          "comparison-workflow": {
            ...makeWorkflowAnalysis(),
            assistantMessageId: "assistant-replaced"
          }
        }
      }
    };
    expect(applyConfirmedComparisonDecision(mismatchedAnalysis, optional.confirmation).status).toBe("blocked");

    const removedAnalysis: MorphoWorkspace = {
      ...workspace,
      ai: {
        ...workspace.ai,
        comparisonAnalyses: {}
      }
    };
    expect(applyConfirmedComparisonDecision(removedAnalysis, optional.confirmation).status).toBe("blocked");
  });
});

function withAnalysis(workspace: MorphoWorkspace, analysis: ComparisonAnalysis): MorphoWorkspace {
  return {
    ...workspace,
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
    makeWorkflowAnalysis()
  );
}

function getDirectionStatus(workspace: MorphoWorkspace, objectId: string): string | undefined {
  const object = workspace.objects[objectId];
  return object?.type === "conceptDirection" ? object.status : undefined;
}

function makeWorkflowAnalysis(): ComparisonAnalysis {
  const sourceObjectIds = [
    "direction-soft-rail",
    "direction-support-island",
    "image-soft-rail-v2",
    "image-night-scenario",
    "research-night-path"
  ];
  return {
    id: "comparison-workflow",
    assistantMessageId: "assistant-workflow",
    userMessageId: "user-workflow",
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
    comparisonGoal: "Compare workflow",
    conclusionSummary: "当前 Compare 决策摘要。",
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
      title: "研究证据支持的关键结论",
      summary: "保留研究证据中的关键结论。",
      body: "研究证据支持这一关键结论。",
      category: "finding",
      sourceObjectIds: ["research-night-path"],
      evidence: [{ objectId: "research-night-path", label: "研究", evidence: "明确研究证据" }],
      confidence: "supported"
    }
  };
}
