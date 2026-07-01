import { describe, expect, it } from "vitest";

import type { ComparisonAnalysis } from "../../domain/morpho/types";
import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import { validateComparisonActionTarget, validateComparisonKeyConclusionSources } from "./comparisonAction";

describe("comparison action target validation", () => {
  it("blocks actions when analysis is missing, target is outside sources, or target is hidden", () => {
    const workspace = withAnalysis(createInitialWorkspace(), makeAnalysis());

    expect(validateComparisonActionTarget(workspace, "missing-analysis", "setPrimary", "direction-soft-rail")).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "setPrimary", "direction-outside")).toMatchObject({
      status: "blocked"
    });
    expect(
      validateComparisonActionTarget(hideObject(workspace, "direction-soft-rail"), "comparison-a", "setPrimary", "direction-soft-rail")
    ).toMatchObject({ status: "blocked" });
  });

  it("only allows restoreAlternative for eliminated compare directions", () => {
    const base = createInitialWorkspace();
    const direction = base.objects["direction-soft-rail"];
    if (!direction || direction.type !== "conceptDirection") {
      throw new Error("missing direction fixture");
    }
    const workspace = withAnalysis(
      {
        ...base,
        objects: {
          ...base.objects,
          "direction-soft-rail": { ...direction, status: "eliminated" }
        }
      },
      makeAnalysis()
    );

    expect(validateComparisonActionTarget(workspace, "comparison-a", "setPrimary", "direction-soft-rail")).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "setAlternative", "direction-soft-rail")).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "restoreAlternative", "direction-soft-rail")).toMatchObject({
      status: "ok",
      targetObjectId: "direction-soft-rail"
    });
  });

  it("requires current type and state to match default-reference and key-conclusion actions", () => {
    const workspace = withAnalysis(createInitialWorkspace(), makeAnalysis());

    expect(validateComparisonActionTarget(workspace, "comparison-a", "setDefaultReference", "direction-soft-rail")).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "setDefaultReference", "image-soft-rail-v2")).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "clearDefaultReference", "image-soft-rail-v2")).toMatchObject({
      status: "ok"
    });
    expect(validateComparisonActionTarget(workspace, "comparison-a", "createKeyConclusion")).toMatchObject({
      status: "ok"
    });
  });

  it("requires pending key-conclusion sources to match the saved candidate exactly", () => {
    const workspace = withAnalysis(createInitialWorkspace(), makeAnalysis());

    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["direction-soft-rail"])).toMatchObject({
      status: "ok"
    });
    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["image-soft-rail-v2"])).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["direction-soft-rail", "image-soft-rail-v2"])).toMatchObject({
      status: "blocked"
    });
  });
});

function makeAnalysis(): ComparisonAnalysis {
  return {
    id: "comparison-a",
    assistantMessageId: "assistant-a",
    userMessageId: "user-a",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    sourceObjectIds: ["direction-soft-rail", "image-soft-rail-v2"],
    sourceRefs: [
      {
        objectId: "direction-soft-rail",
        objectType: "conceptDirection",
        title: "Direction",
        summary: "Direction summary",
        availability: "active"
      },
      {
        objectId: "image-soft-rail-v2",
        objectType: "image",
        title: "Image",
        summary: "Image summary",
        availability: "active"
      }
    ],
    comparisonGoal: "Compare",
    conclusionSummary: "Summary",
    objectComparisons: [
      {
        objectId: "direction-soft-rail",
        title: "Direction",
        summary: "Direction summary",
        strengths: [],
        risks: [],
        evidence: []
      },
      {
        objectId: "image-soft-rail-v2",
        title: "Image",
        summary: "Image summary",
        strengths: [],
        risks: [],
        evidence: []
      }
    ],
    recommendedQuestions: [],
    evidenceLimits: [],
    keyConclusionCandidate: {
      title: "Candidate",
      summary: "Candidate summary",
      body: "Candidate body",
      sourceObjectIds: ["direction-soft-rail"],
      evidence: [{ objectId: "direction-soft-rail", label: "Direction", evidence: "Evidence" }],
      confidence: "partial"
    }
  };
}

function withAnalysis(workspace: ReturnType<typeof createInitialWorkspace>, analysis: ComparisonAnalysis) {
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
