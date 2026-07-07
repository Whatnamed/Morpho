import { describe, expect, it } from "vitest";

import {
  buildComparisonAnalysisVisibleSummary,
  buildComparisonAuthorization,
  parseComparisonAnalysisPayload,
  resolveComparisonSelection,
  validateComparisonAnalysis
} from "./comparisonAnalysis";
import { createInitialWorkspace, hideObject } from "./workspace";
import type { MorphoWorkspace } from "./types";
import { buildDocumentReaderBlocks } from "@/features/workspace/documentReader";
import { buildDocumentFragmentDraft, createDocumentFragment, resolveDocumentFragmentSelection } from "@/features/workspace/documentFragments";

describe("comparison analysis domain rules", () => {
  it("allows 2 active directions, 4 active images, and valid mixed selections with an explicit shared goal", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");

    expect(resolveComparisonSelection(workspace, ["direction-soft-rail", "direction-support-island"]).status).toBe("ready");
    expect(
      resolveComparisonSelection(workspace, [
        "image-soft-rail-v2",
        "image-night-scenario",
        "image-support-island-preview",
        "image-cmf-board"
      ]).status
    ).toBe("ready");
    expect(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: ["direction-soft-rail", "file-course-brief", "insight-low-construction"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "比较这些对象对后续发展价值、风险和设计取舍的影响。",
        imageAttachmentObjectIds: []
      }).status
    ).toBe("ready");
  });

  it("allows active document fragments as explicit Compare text sources with documentFragment evidence basis", () => {
    const workspace = withDocumentFragment(withParsedFile(createInitialWorkspace(), "file-course-brief"));
    const fragment = Object.values(workspace.objects).find((object) => object.type === "documentFragment");
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }

    expect(resolveComparisonSelection(workspace, [fragment.id, "research-night-path"])).toMatchObject({ status: "ready" });
    expect(resolveComparisonSelection(hideObject(workspace, fragment.id), [fragment.id, "research-night-path"])).toMatchObject({ status: "blocked" });

    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: [fragment.id, "research-night-path"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "compare selected text evidence",
        imageAttachmentObjectIds: [],
        documentExtractObjectIds: [],
        documentFragmentExtractObjectIds: [fragment.id]
      })
    );

    expect(
      validateComparisonAnalysis(
        {
          comparisonGoal: "compare",
          conclusionSummary: "summary",
          objectComparisons: [
            {
              objectId: fragment.id,
              title: fragment.title,
              evidenceBasis: "documentFragment",
              summary: "fragment summary",
              strengths: [],
              risks: [],
              evidence: [fragment.body]
            },
            {
              objectId: "research-night-path",
              title: "Research",
              evidenceBasis: "objectSummary",
              summary: "research summary",
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
            sourceObjectIds: [fragment.id],
            evidence: [{ objectId: fragment.id, label: "Fragment", evidence: fragment.body }],
            confidence: "partial"
          }
        },
        authorization
      )
    ).toMatchObject({
      status: "ok",
      analysis: {
        objectComparisons: expect.arrayContaining([
          expect.objectContaining({ objectId: fragment.id, evidenceBasis: "documentFragment" })
        ])
      }
    });
  });

  it("blocks documentFragment evidence basis when the fragment body was not sent to the provider", () => {
    const workspace = withDocumentFragment(withParsedFile(createInitialWorkspace(), "file-course-brief"));
    const fragment = Object.values(workspace.objects).find((object) => object.type === "documentFragment");
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }

    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: [fragment.id, "research-night-path"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "compare selected text evidence",
        imageAttachmentObjectIds: [],
        documentExtractObjectIds: [],
        documentFragmentExtractObjectIds: []
      })
    );

    expect(
      validateComparisonAnalysis(
        {
          comparisonGoal: "compare",
          conclusionSummary: "summary",
          objectComparisons: [
            {
              objectId: fragment.id,
              title: fragment.title,
              evidenceBasis: "documentFragment",
              summary: "fragment summary",
              strengths: [],
              risks: [],
              evidence: [fragment.body]
            },
            {
              objectId: "research-night-path",
              title: "Research",
              evidenceBasis: "objectSummary",
              summary: "research summary",
              strengths: [],
              risks: [],
              evidence: []
            }
          ],
          recommendedQuestions: [],
          evidenceLimits: []
        },
        authorization
      )
    ).toMatchObject({ status: "failed" });
  });

  it("blocks fewer than 2, more than 4, duplicate, hidden, missing, or unparsed file selections", () => {
    const workspace = createInitialWorkspace();
    expect(resolveComparisonSelection(workspace, ["direction-soft-rail"]).status).toBe("blocked");
    expect(
      resolveComparisonSelection(workspace, [
        "direction-soft-rail",
        "direction-support-island",
        "image-soft-rail-v2",
        "image-night-scenario",
        "insight-low-construction"
      ]).status
    ).toBe("blocked");
    expect(resolveComparisonSelection(workspace, ["direction-soft-rail", "direction-soft-rail"]).status).toBe("blocked");
    expect(resolveComparisonSelection(hideObject(workspace, "direction-soft-rail"), ["direction-soft-rail", "direction-support-island"]).status).toBe(
      "blocked"
    );
    expect(resolveComparisonSelection(workspace, ["direction-soft-rail", "missing-id"]).status).toBe("blocked");
    expect(resolveComparisonSelection(workspace, ["direction-soft-rail", "file-course-brief"]).status).toBe("blocked");
  });

  it("blocks mixed sources without a shared comparison target", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");
    const result = buildComparisonAuthorization({
      workspace,
      selectedObjectIds: ["direction-soft-rail", "file-course-brief", "image-soft-rail-v2"],
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      createdAt: "2026-07-01T10:00:00.000Z",
      comparisonGoal: "看看这些。",
      imageAttachmentObjectIds: ["image-soft-rail-v2"]
    });

    expect(result).toMatchObject({ status: "blocked" });
  });

  it("suppresses compare payload parsing when the same reply contains design or direction proposals", () => {
    const parsed = parseComparisonAnalysisPayload([
      "普通说明",
      "```json",
      JSON.stringify({ morphoConceptDirectionProposal: { title: "方向草案", summary: "只保留 proposal", directions: [] } }),
      "```",
      "```json",
      JSON.stringify({
        morphoComparisonAnalysis: {
          comparisonGoal: "比较",
          conclusionSummary: "不应生效",
          objectComparisons: [],
          recommendedQuestions: [],
          evidenceLimits: []
        }
      }),
      "```"
    ].join("\n"));

    expect(parsed.status).toBe("blockedByProposal");
  });

  it("builds a readable fallback when a compare reply contains only the structured payload", () => {
    const visible = buildComparisonAnalysisVisibleSummary({
      comparisonGoal: "compare",
      conclusionSummary: "Direction A is stronger for the current goal.",
      objectComparisons: [
        {
          objectId: "direction-a",
          title: "Direction A",
          summary: "Keeps the route continuous.",
          strengths: ["Clear guidance"],
          risks: ["Corner detail needs validation"],
          evidence: []
        },
        {
          objectId: "file-brief",
          title: "Brief",
          evidenceBasis: "documentExtract",
          summary: "Confirms the night-use constraint.",
          strengths: [],
          risks: [],
          evidence: ["Night-use constraint"]
        }
      ],
      recommendedQuestions: ["Validate the corner detail."],
      evidenceLimits: ["One image was not available as pixels."]
    });

    expect(visible).toContain("Compare 分析");
    expect(visible).toContain("Direction A is stronger");
    expect(visible).toContain("Direction A");
    expect(visible).toContain("证据边界");
  });

  it("requires exact selection coverage and valid key conclusion candidate evidence", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");
    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: ["direction-soft-rail", "file-course-brief"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "比较这些对象对后续设计取舍的影响。",
        imageAttachmentObjectIds: [],
        documentExtractObjectIds: ["file-course-brief"]
      })
    );

    const valid = validateComparisonAnalysis(
      {
        comparisonGoal: "比较",
        conclusionSummary: "结论",
        objectComparisons: [
          {
            objectId: "direction-soft-rail",
            title: "柔光轨道",
            summary: "A",
            strengths: [],
            risks: [],
            evidence: []
          },
          {
            objectId: "file-course-brief",
            title: "课程简报",
            summary: "B",
            strengths: [],
            risks: [],
            evidence: ["extract"]
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: [],
        keyConclusionCandidate: {
          title: "候选结论",
          summary: "结论摘要",
          body: "结论正文",
          sourceObjectIds: ["file-course-brief"],
          evidence: [
            {
              objectId: "file-course-brief",
              label: "文档依据",
              evidence: "extract text"
            }
          ],
          confidence: "partial"
        }
      },
      authorization
    );

    expect(valid.status).toBe("ok");

    const invalidCoverage = validateComparisonAnalysis(
      {
        comparisonGoal: "比较",
        conclusionSummary: "结论",
        objectComparisons: [
          {
            objectId: "direction-soft-rail",
            title: "柔光轨道",
            summary: "A",
            strengths: [],
            risks: [],
            evidence: []
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: []
      },
      authorization
    );
    expect(invalidCoverage.status).toBe("failed");

    const invalidCandidate = validateComparisonAnalysis(
      {
        comparisonGoal: "比较",
        conclusionSummary: "结论",
        objectComparisons: [
          {
            objectId: "direction-soft-rail",
            title: "柔光轨道",
            summary: "A",
            strengths: [],
            risks: [],
            evidence: []
          },
          {
            objectId: "file-course-brief",
            title: "课程简报",
            summary: "B",
            strengths: [],
            risks: [],
            evidence: ["extract"]
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: [],
        keyConclusionCandidate: {
          title: "候选结论",
          summary: "结论摘要",
          body: "结论正文",
          sourceObjectIds: ["direction-soft-rail"],
          evidence: [
            {
              objectId: "direction-soft-rail",
              label: "方向摘要",
              evidence: ""
            }
          ],
          confidence: "partial"
        }
      },
      authorization
    );
    expect(invalidCandidate.status).toBe("failed");
  });

  it("rejects key conclusion candidates backed by direction summaries or mismatched evidence sources", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");
    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: ["direction-soft-rail", "file-course-brief"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "compare these sources against the current design definition",
        imageAttachmentObjectIds: [],
        documentExtractObjectIds: ["file-course-brief"]
      })
    );
    const basePayload = {
      comparisonGoal: "compare",
      conclusionSummary: "summary",
      objectComparisons: [
        {
          objectId: "direction-soft-rail",
          title: "Direction",
          evidenceBasis: "objectSummary" as const,
          summary: "direction summary",
          strengths: [],
          risks: [],
          evidence: []
        },
        {
          objectId: "file-course-brief",
          title: "Brief",
          evidenceBasis: "documentExtract" as const,
          summary: "document summary",
          strengths: [],
          risks: [],
          evidence: ["document evidence"]
        }
      ],
      recommendedQuestions: [],
      evidenceLimits: []
    };

    expect(
      validateComparisonAnalysis(
        {
          ...basePayload,
          keyConclusionCandidate: {
            title: "candidate",
            summary: "candidate summary",
            body: "candidate body",
            sourceObjectIds: ["direction-soft-rail"],
            evidence: [{ objectId: "file-course-brief", label: "brief", evidence: "actual text" }],
            confidence: "partial"
          }
        },
        authorization
      )
    ).toMatchObject({ status: "failed" });

    expect(
      validateComparisonAnalysis(
        {
          ...basePayload,
          keyConclusionCandidate: {
            title: "candidate",
            summary: "candidate summary",
            body: "candidate body",
            sourceObjectIds: [],
            evidence: [{ objectId: "file-course-brief", label: "brief", evidence: "actual text" }],
            confidence: "partial"
          }
        },
        authorization
      )
    ).toMatchObject({ status: "failed" });

    expect(
      validateComparisonAnalysis(
        {
          ...basePayload,
          keyConclusionCandidate: {
            title: "candidate",
            summary: "candidate summary",
            body: "candidate body",
            sourceObjectIds: ["file-course-brief"],
            evidence: [{ objectId: "file-course-brief", label: "brief", evidence: "actual text" }],
            confidence: "partial"
          }
        },
        authorization
      )
    ).toMatchObject({
      status: "ok",
      analysis: {
        keyConclusionCandidate: {
          sourceObjectIds: ["file-course-brief"]
        }
      }
    });
  });

  it("requires evidence limits and object-summary basis for selected images without pixels", () => {
    const workspace = createInitialWorkspace();
    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: ["image-soft-rail-v2", "image-night-scenario"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "compare images",
        imageAttachmentObjectIds: ["image-soft-rail-v2"],
        documentExtractObjectIds: []
      })
    );

    const missingLimit = validateComparisonAnalysis(
      {
        comparisonGoal: "compare images",
        conclusionSummary: "Only object summaries are safe for one image.",
        objectComparisons: [
          {
            objectId: "image-soft-rail-v2",
            title: "Image A",
            evidenceBasis: "pixels",
            summary: "Pixel-backed summary.",
            strengths: [],
            risks: [],
            evidence: []
          },
          {
            objectId: "image-night-scenario",
            title: "Image B",
            evidenceBasis: "objectSummary",
            summary: "Metadata-only summary.",
            strengths: [],
            risks: [],
            evidence: []
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: []
      },
      authorization
    );
    expect(missingLimit.status).toBe("failed");

    const visualClaimForUnavailable = validateComparisonAnalysis(
      {
        comparisonGoal: "compare images",
        conclusionSummary: "Only object summaries are safe for one image.",
        objectComparisons: [
          {
            objectId: "image-soft-rail-v2",
            title: "Image A",
            evidenceBasis: "pixels",
            summary: "Pixel-backed summary.",
            strengths: [],
            risks: [],
            evidence: []
          },
          {
            objectId: "image-night-scenario",
            title: "Image B",
            evidenceBasis: "pixels",
            summary: "Claims pixels despite missing attachment.",
            strengths: [],
            risks: [],
            evidence: []
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: ["image-night-scenario pixels were unavailable"]
      },
      authorization
    );
    expect(visualClaimForUnavailable.status).toBe("failed");
  });

  it("requires attached pixels before image comparisons can claim visual evidence", () => {
    const workspace = createInitialWorkspace();
    const authorization = getReadyAuthorization(
      buildComparisonAuthorization({
        workspace,
        selectedObjectIds: ["image-soft-rail-v2", "image-night-scenario"],
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        createdAt: "2026-07-01T10:00:00.000Z",
        comparisonGoal: "比较图片",
        imageAttachmentObjectIds: []
      })
    );

    const result = validateComparisonAnalysis(
      {
        comparisonGoal: "比较图片",
        conclusionSummary: "不能假装看图",
        objectComparisons: [
          {
            objectId: "image-soft-rail-v2",
            title: "图 A",
            summary: "A",
            strengths: [],
            risks: [],
            evidence: ["像素依据"]
          },
          {
            objectId: "image-night-scenario",
            title: "图 B",
            summary: "B",
            strengths: [],
            risks: [],
            evidence: []
          }
        ],
        recommendedQuestions: [],
        evidenceLimits: ["本轮未附带像素。"]
      },
      authorization
    );

    expect(result.status).toBe("failed");
  });
});

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
  const sourceText = "# Fragment\n\nfragment body for compare\n\nother source text";
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

function getReadyAuthorization(result: ReturnType<typeof buildComparisonAuthorization>) {
  if (result.status !== "ready" || !("authorization" in result)) {
    throw new Error("expected ready authorization");
  }

  return result.authorization;
}
