import { describe, expect, it } from "vitest";

import { buildComparisonAuthorization, parseComparisonAnalysisPayload, resolveComparisonSelection, validateComparisonAnalysis } from "./comparisonAnalysis";
import { createInitialWorkspace, hideObject } from "./workspace";
import type { MorphoWorkspace } from "./types";

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
        imageAttachmentObjectIds: []
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

function getReadyAuthorization(result: ReturnType<typeof buildComparisonAuthorization>) {
  if (result.status !== "ready" || !("authorization" in result)) {
    throw new Error("expected ready authorization");
  }

  return result.authorization;
}
