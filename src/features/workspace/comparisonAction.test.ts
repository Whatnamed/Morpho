import { describe, expect, it } from "vitest";

import type { ComparisonAnalysis, MorphoWorkspace } from "../../domain/morpho/types";
import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import { validateComparisonActionTarget, validateComparisonKeyConclusionSources } from "./comparisonAction";
import { buildDocumentReaderBlocks } from "./documentReader";
import { buildDocumentFragmentDraft, createDocumentFragment, resolveDocumentFragmentSelection } from "./documentFragments";

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

  it("blocks historical key-conclusion candidates backed only by direction summaries", () => {
    const workspace = withAnalysis(createInitialWorkspace(), makeAnalysis());

    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["direction-soft-rail"])).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["image-soft-rail-v2"])).toMatchObject({
      status: "blocked"
    });
    expect(validateComparisonKeyConclusionSources(workspace, "comparison-a", ["direction-soft-rail", "image-soft-rail-v2"])).toMatchObject({
      status: "blocked"
    });
  });

  it("allows historical key-conclusion candidates backed by current text evidence sources", () => {
    const workspaceWithFragment = withDocumentFragment(withParsedFile(createInitialWorkspace(), "file-course-brief"));
    const fragment = Object.values(workspaceWithFragment.objects).find((object) => object.type === "documentFragment");
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }
    const workspace = withAnalysis(
      workspaceWithFragment,
      makeTextEvidenceAnalysis({
        sourceObjectIds: ["research-night-path", "insight-low-construction", "file-course-brief", fragment.id],
        evidenceObjectIds: ["research-night-path", "insight-low-construction", "file-course-brief", fragment.id]
      })
    );

    expect(
      validateComparisonKeyConclusionSources(workspace, "comparison-text", [
        "research-night-path",
        "insight-low-construction",
        "file-course-brief",
        fragment.id
      ])
    ).toMatchObject({ status: "ok" });
  });

  it("blocks historical key-conclusion candidates with image, direction, unparsed file, or mismatched evidence ids", () => {
    const base = createInitialWorkspace();
    expect(
      validateComparisonKeyConclusionSources(
        withAnalysis(
          base,
          makeTextEvidenceAnalysis({
            sourceObjectIds: ["research-night-path", "image-soft-rail-v2"],
            evidenceObjectIds: ["research-night-path", "image-soft-rail-v2"]
          })
        ),
        "comparison-text",
        ["research-night-path", "image-soft-rail-v2"]
      )
    ).toMatchObject({ status: "blocked" });

    expect(
      validateComparisonKeyConclusionSources(
        withAnalysis(
          base,
          makeTextEvidenceAnalysis({
            sourceObjectIds: ["research-night-path", "direction-soft-rail"],
            evidenceObjectIds: ["research-night-path", "direction-soft-rail"]
          })
        ),
        "comparison-text",
        ["research-night-path", "direction-soft-rail"]
      )
    ).toMatchObject({ status: "blocked" });

    expect(
      validateComparisonKeyConclusionSources(
        withAnalysis(
          base,
          makeTextEvidenceAnalysis({
            sourceObjectIds: ["research-night-path", "file-course-brief"],
            evidenceObjectIds: ["research-night-path", "file-course-brief"]
          })
        ),
        "comparison-text",
        ["research-night-path", "file-course-brief"]
      )
    ).toMatchObject({ status: "blocked" });

    expect(
      validateComparisonKeyConclusionSources(
        withAnalysis(
          base,
          makeTextEvidenceAnalysis({
            sourceObjectIds: ["research-night-path", "insight-low-construction"],
            evidenceObjectIds: ["research-night-path"]
          })
        ),
        "comparison-text",
        ["research-night-path", "insight-low-construction"]
      )
    ).toMatchObject({ status: "blocked" });
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

function makeTextEvidenceAnalysis(input: {
  sourceObjectIds: string[];
  evidenceObjectIds: string[];
}): ComparisonAnalysis {
  return {
    id: "comparison-text",
    assistantMessageId: "assistant-text",
    userMessageId: "user-text",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    sourceObjectIds: [...input.sourceObjectIds],
    sourceRefs: input.sourceObjectIds.map((objectId) => ({
      objectId,
      objectType:
        objectId === "file-course-brief"
          ? "file"
          : objectId.startsWith("insight-")
            ? "keyConclusion"
            : objectId.startsWith("image-")
              ? "image"
              : objectId.startsWith("direction-")
                ? "conceptDirection"
                : "research",
      title: objectId,
      summary: `${objectId} summary`,
      availability: "active"
    })),
    comparisonGoal: "Compare text evidence",
    conclusionSummary: "Summary",
    objectComparisons: input.sourceObjectIds.map((objectId) => ({
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
      title: "Candidate",
      summary: "Candidate summary",
      body: "Candidate body",
      sourceObjectIds: [...input.sourceObjectIds],
      evidence: input.evidenceObjectIds.map((objectId) => ({
        objectId,
        label: objectId,
        evidence: `${objectId} evidence`
      })),
      confidence: "partial"
    }
  };
}

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

function withParsedFile(workspace: MorphoWorkspace, objectId: string): MorphoWorkspace {
  const object = workspace.objects[objectId];
  if (!object || object.type !== "file") {
    return workspace;
  }

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...object,
        parseStatus: "parsed",
        extractedAssetId: "asset-document-extract-a",
        extractedCharCount: 1200,
        extractedPageCount: 4
      }
    },
    assets: {
      ...workspace.assets,
      "asset-document-extract-a": {
        id: "asset-document-extract-a",
        fileName: "course-brief.extract.txt",
        mimeType: "text/plain",
        size: 1200,
        createdAt: "2026-06-26T00:00:00.000Z",
        storageKey: "extract:file-course-brief",
        sourceType: "documentExtract"
      }
    }
  };
}

function withDocumentFragment(workspace: MorphoWorkspace): MorphoWorkspace {
  const sourceText = "# Fragment\n\nfragment body for key conclusion";
  const blocks = buildDocumentReaderBlocks(sourceText);
  const selection = resolveDocumentFragmentSelection(workspace, {
    fileObjectId: "file-course-brief",
    extractAssetId: "asset-document-extract-a",
    blockIds: [blocks[1]?.id ?? ""],
    title: "Compare fragment",
    sourceText
  });
  if (selection.status !== "ready") {
    throw new Error(selection.reason);
  }
  const draft = buildDocumentFragmentDraft(workspace, selection, { title: "Compare fragment" });
  if (draft.status !== "ready") {
    throw new Error(draft.reason);
  }
  return createDocumentFragment(workspace, draft.draft).workspace;
}
