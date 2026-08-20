import { describe, expect, it } from "vitest";

import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import type { MorphoWorkspace } from "../../domain/morpho/types";
import { recordDesignDefinitionProposal } from "../../domain/operations/operations";

import { buildProviderComparisonTaskContext, buildProviderTaskContext, buildTaskContext, TASK_CONTEXT_LIMITS } from "./taskContext";
import { buildDocumentReaderBlocks } from "./documentReader";
import { buildDocumentFragmentDraft, createDocumentFragment, resolveDocumentFragmentSelection } from "./documentFragments";

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

  it("keeps comparison context limited to explicit selection and converts it through the comparison builder", () => {
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief");
    const context = buildTaskContext(workspace, {
      kind: "comparison",
      draft: "比较这几个对象",
      selectedObjectIds: ["direction-soft-rail", "file-course-brief"]
    });

    expect(context.objectIds).toEqual(["direction-soft-rail", "file-course-brief"]);
    expect(context.defaultReference).toEqual({
      status: "notIncluded",
      reason: "Compare never auto-includes default reference."
    });
    expect(context.scopeNote).toContain("explicit selected objects");
    // The generic provider builder still refuses comparison contexts; the A+
    // preparation must pick the comparison builder explicitly.
    expect(() => buildProviderTaskContext(context)).toThrow(/Comparison task context/);
    const providerContext = buildProviderComparisonTaskContext(context);
    expect(providerContext).toMatchObject({
      kind: "general",
      objectIds: ["direction-soft-rail", "file-course-brief"],
      imageObjectIds: [],
      documentObjectIds: ["file-course-brief"],
      defaultReference: expect.stringContaining("notIncluded"),
      directions: [],
      visualBranches: []
    });
    expect(providerContext.projectContinuity).toBeDefined();
    expect(JSON.stringify(providerContext)).not.toContain("data:image");
  });

  it("includes document fragments only when explicitly selected and sends bounded fragment body, not source file text", () => {
    const workspace = withDocumentFragment(withParsedFile(createInitialWorkspace(), "file-course-brief"));
    const fragment = Object.values(workspace.objects).find((object) => object.type === "documentFragment");
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }

    const unselected = buildTaskContext(workspace, {
      kind: "research",
      draft: "鏁寸悊璧勬枡",
      selectedObjectIds: ["research-night-path"]
    });
    expect(unselected.objectIds).not.toContain(fragment.id);

    const selected = buildTaskContext(workspace, {
      kind: "research",
      draft: "鏁寸悊杩欐鏂囨。鐗囨",
      selectedObjectIds: [fragment.id]
    });
    const provider = buildProviderTaskContext(selected);

    expect(selected.objectIds).toContain(fragment.id);
    expect(selected.documentObjectIds).toEqual([]);
    expect(provider.documentFragmentExtracts).toEqual([
      expect.objectContaining({
        objectId: fragment.id,
        title: fragment.title,
        text: fragment.body,
        sourceFileObjectId: fragment.source.fileObjectId
      })
    ]);
    expect(JSON.stringify(provider)).not.toContain("source file full text");
  });

  it("includes full editable fields for an explicitly selected proposal draft", () => {
    const proposed = recordDesignDefinitionProposal(createInitialWorkspace(), {
      proposalId: "proposal-definition-context",
      operationId: "operation-definition-context",
      workIntent: "createDesignDefinition",
      title: "Definition draft",
      summary: "Draft summary.",
      projectGoal: "Clarify a safer product definition.",
      targetUsers: ["Designer"],
      primaryScenarios: ["Reviewing concepts"],
      coreProblem: "The first draft is too broad.",
      designPrinciples: ["Be explicit"],
      constraints: ["No extra product scope"],
      avoidDirections: ["Generic wording"],
      opportunities: ["Sharper decision language"],
      openQuestions: ["What needs validation first?"],
      sourceObjectIds: ["research-night-path"],
      citations: [],
      position: { x: 100, y: 100 }
    });

    const context = buildTaskContext(proposed.workspace, {
      kind: "designDefinition",
      draft: "把这张草案改得更明确",
      selectedObjectIds: ["proposal-definition-context"]
    });

    expect(context.proposalDrafts).toEqual([
      expect.objectContaining({
        proposalId: "proposal-definition-context",
        proposalType: "designDefinition",
        title: "Definition draft",
        projectGoal: "Clarify a safer product definition.",
        constraints: ["No extra product scope"]
      })
    ]);
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

function withDocumentFragment(workspace: MorphoWorkspace): MorphoWorkspace {
  const sourceText = "# 鏂囨。鐗囨\n\nsource file full text should not be sent unless the file is selected\n\nfragment bounded body";
  const blocks = buildDocumentReaderBlocks(sourceText);
  const selection = resolveDocumentFragmentSelection(workspace, {
    fileObjectId: "file-course-brief",
    extractAssetId: "asset-document-extract-a",
    blockIds: [blocks[2]?.id ?? ""],
    title: "Fragment",
    sourceText
  });
  if (selection.status !== "ready") {
    throw new Error(selection.reason);
  }
  const draft = buildDocumentFragmentDraft(workspace, selection, { title: "Fragment" });
  if (draft.status !== "ready") {
    throw new Error(draft.reason);
  }
  return createDocumentFragment(workspace, draft.draft).workspace;
}
