import { describe, expect, it } from "vitest";

import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import type { MorphoWorkspace } from "../../domain/morpho/types";

import { buildProviderTaskContext, buildTaskContext, TASK_CONTEXT_LIMITS } from "./taskContext";

describe("workspace task context assembly", () => {
  it("builds direction preview context from selected directions, current definition, related conclusions, selected images and parsed files", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");
    const context = buildTaskContext(workspace, {
      kind: "directionPreview",
      draft: "参考这份资料和这张图，分别为这几个方向生成预览图",
      selectedObjectIds: ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2", "file-course-brief"],
      targetDirectionIds: ["direction-soft-rail", "direction-support-island"]
    });

    expect(context.objectIds).toEqual(
      expect.arrayContaining(["direction-soft-rail", "direction-support-island", "definition-current", "image-soft-rail-v2", "file-course-brief"])
    );
    expect(context.directionRevisions.map((revision) => revision.directionId)).toEqual(
      expect.arrayContaining(["direction-soft-rail", "direction-support-island"])
    );
    expect(context.designDefinitionRevision?.designDefinitionId).toBe("definition-current");
    expect(context.semanticSummaries.some((summary) => summary.type === "keyConclusion")).toBe(true);
    expect(context.imageObjectIds).toEqual(["image-soft-rail-v2"]);
    expect(context.documentObjectIds).toEqual(["file-course-brief"]);
    expect(context.defaultReference.status).toBe("notIncluded");
    expect(context.scopeNote).toContain("directionPreview");
  });

  it("includes default reference pixels only when explicitly requested and available", () => {
    const context = buildTaskContext(createInitialWorkspace(), {
      kind: "directionPreview",
      draft: "保持和默认参考一致，为方向生成预览",
      selectedObjectIds: ["direction-soft-rail"],
      targetDirectionIds: ["direction-soft-rail"]
    });

    expect(context.defaultReference).toMatchObject({
      status: "included",
      objectId: "image-soft-rail-v2"
    });
    expect(context.imageObjectIds).toContain("image-soft-rail-v2");
  });

  it("does not include default reference pixels for non-visual tasks even when explicitly requested", () => {
    const context = buildTaskContext(createInitialWorkspace(), {
      kind: "research",
      draft: "请参考默认参考继续整理研究",
      selectedObjectIds: ["direction-soft-rail"],
      targetDirectionIds: ["direction-soft-rail"]
    });

    expect(context.defaultReference).toMatchObject({ status: "notIncluded", objectId: "image-soft-rail-v2" });
    expect(context.imageObjectIds).not.toContain("image-soft-rail-v2");
  });

  it("does not include a direction-bound default reference for another target direction", () => {
    const context = buildTaskContext(createInitialWorkspace(), {
      kind: "directionPreview",
      draft: "请参考默认参考，为方向 B 生成预览",
      selectedObjectIds: ["direction-support-island"],
      targetDirectionIds: ["direction-support-island"]
    });

    expect(context.defaultReference).toMatchObject({ status: "notIncluded", objectId: "image-soft-rail-v2" });
    expect(context.defaultReference.reason).toContain("reason:default-reference-direction-mismatch");
    expect(context.imageObjectIds).not.toContain("image-soft-rail-v2");
  });

  it("does not include a no-direction default reference for multi-direction preview", () => {
    const workspace = withoutDefaultReferenceDirection(createInitialWorkspace());
    const context = buildTaskContext(workspace, {
      kind: "directionPreview",
      draft: "请参考默认参考，分别为两个方向生成预览",
      selectedObjectIds: ["direction-soft-rail", "direction-support-island"],
      targetDirectionIds: ["direction-soft-rail", "direction-support-island"]
    });

    expect(context.defaultReference).toMatchObject({ status: "notIncluded", objectId: "image-soft-rail-v2" });
    expect(context.defaultReference.reason).toContain("reason:default-reference-ambiguous-multi-direction");
    expect(context.imageObjectIds).not.toContain("image-soft-rail-v2");
  });

  it("includes a no-direction default reference only for one clear visual target direction", () => {
    const workspace = withoutDefaultReferenceDirection(createInitialWorkspace());
    const context = buildTaskContext(workspace, {
      kind: "directionPreview",
      draft: "请参考默认参考，为这个方向生成预览",
      selectedObjectIds: ["direction-support-island"],
      targetDirectionIds: ["direction-support-island"]
    });

    expect(context.defaultReference).toMatchObject({ status: "included", objectId: "image-soft-rail-v2" });
    expect(context.imageObjectIds).toContain("image-soft-rail-v2");
  });

  it("exports bounded provider task context with semantic revisions and visual branches", () => {
    const context = buildTaskContext(createInitialWorkspace(), {
      kind: "visualDevelopment",
      draft: "继续发展这张图",
      selectedObjectIds: ["image-soft-rail-v2"]
    });
    const providerContext = buildProviderTaskContext(context);

    expect(providerContext).toMatchObject({
      kind: "visualDevelopment",
      objectIds: expect.arrayContaining(["image-soft-rail-v2", "direction-soft-rail", "definition-current"]),
      imageObjectIds: ["image-soft-rail-v2"],
      designDefinition: expect.objectContaining({
        objectId: "definition-current",
        revisionNumber: 1,
        projectGoal: expect.any(String),
        designPrinciples: expect.any(Array)
      }),
      directions: [
        expect.objectContaining({
          objectId: "direction-soft-rail",
          revisionNumber: 1,
          conceptStatement: expect.any(String),
          visualSignals: expect.any(Array)
        })
      ],
      visualBranches: expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), directionId: "direction-soft-rail", label: expect.any(String) })
      ])
    });
    expect(JSON.stringify(providerContext)).not.toContain("data:image");
  });

  it("excludes hidden objects and reports predictable skip reasons", () => {
    const hidden = hideObject(createInitialWorkspace(), "image-soft-rail-v2");
    const context = buildTaskContext(hidden, {
      kind: "visualDevelopment",
      draft: "保留整体结构语言，生成夜间使用场景",
      selectedObjectIds: ["image-soft-rail-v2"]
    });

    expect(context.objectIds).not.toContain("image-soft-rail-v2");
    expect(context.imageObjectIds).toEqual([]);
    expect(context.skipped).toContainEqual({
      objectId: "image-soft-rail-v2",
      reason: "对象已隐藏，默认不会进入本次 AI Context。"
    });
  });

  it("builds visual development context with source image metadata, direction revision and visual branch", () => {
    const context = buildTaskContext(createInitialWorkspace(), {
      kind: "visualDevelopment",
      draft: "保留整体结构语言，生成夜间使用场景",
      selectedObjectIds: ["image-soft-rail-v2"]
    });

    expect(context.imageObjectIds).toEqual(["image-soft-rail-v2"]);
    expect(context.directionRevisions).toHaveLength(1);
    expect(context.directionRevisions[0]?.directionId).toBe("direction-soft-rail");
    expect(context.visualBranches).toContainEqual(expect.objectContaining({ id: expect.any(String), directionId: "direction-soft-rail" }));
    expect(context.designDefinitionRevision?.designDefinitionId).toBe("definition-current");
  });

  it("applies stable object and document budgets with truncation metadata", () => {
    const workspace = createInitialWorkspace();
    const selectedObjectIds = Object.keys(workspace.objects);
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft: "整理这些材料",
      selectedObjectIds
    });

    expect(context.semanticSummaries.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.maxObjectSummaries);
    expect(context.documentObjectIds.length).toBeLessThanOrEqual(TASK_CONTEXT_LIMITS.maxDocumentExtracts);
    expect(context.truncated).toBe(true);
    expect(context.skipped.some((skip) => skip.reason.includes("数量上限"))).toBe(true);
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

function withoutDefaultReferenceDirection(workspace: MorphoWorkspace): MorphoWorkspace {
  const object = workspace.objects["image-soft-rail-v2"];
  if (!object || object.type !== "image") {
    return workspace;
  }

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      "image-soft-rail-v2": {
        ...object,
        directionId: undefined
      }
    }
  };
}
