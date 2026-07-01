import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { buildDocumentReaderBlocks } from "./documentReader";
import {
  buildDocumentFragmentDraft,
  createDocumentFragment,
  createDocumentFragmentWithContinuity,
  resolveDocumentFragmentLocation,
  resolveDocumentFragmentSelection,
  resolveDocumentFragmentSourceAvailability,
  validateDocumentFragmentSelection
} from "./documentFragments";

describe("document fragment selection", () => {
  it("accepts one to eight consecutive parsed reader blocks from a parsed file", () => {
    const text = sampleText();
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief", text);
    const blocks = buildDocumentReaderBlocks(text);

    const selection = resolveDocumentFragmentSelection(workspace, {
      fileObjectId: "file-course-brief",
      extractAssetId: "asset-document-extract-a",
      blockIds: blocks.slice(0, 2).map((block) => block.id),
      title: "Course brief fragment",
      sourceText: text
    });

    expect(selection.status).toBe("ready");
    if (selection.status !== "ready") {
      throw new Error(selection.reason);
    }

    expect(selection.blockIds).toEqual(blocks.slice(0, 2).map((block) => block.id));
    expect(selection.body).toBe(text.slice(selection.startOffset, selection.endOffset));
    expect(selection.fileObjectId).toBe("file-course-brief");
  });

  it("rejects non-consecutive, duplicate, empty, or over-limit selections", () => {
    const text = sampleText();
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief", text);
    const blocks = buildDocumentReaderBlocks(text);

    expect(
      validateDocumentFragmentSelection(workspace, {
        fileObjectId: "file-course-brief",
        extractAssetId: "asset-document-extract-a",
        blockIds: [blocks[0]?.id ?? "", blocks[2]?.id ?? ""],
        title: "invalid",
        sourceText: text
      })
    ).toMatchObject({ status: "blocked" });

    expect(
      validateDocumentFragmentSelection(workspace, {
        fileObjectId: "file-course-brief",
        extractAssetId: "asset-document-extract-a",
        blockIds: [blocks[0]?.id ?? "", blocks[0]?.id ?? ""],
        title: "invalid",
        sourceText: text
      })
    ).toMatchObject({ status: "blocked" });

    expect(
      validateDocumentFragmentSelection(workspace, {
        fileObjectId: "file-course-brief",
        extractAssetId: "asset-document-extract-a",
        blockIds: [],
        title: "invalid",
        sourceText: text
      })
    ).toMatchObject({ status: "blocked" });

    const overLimitText = Array.from({ length: 9 }, (_, index) => `Block ${index + 1}`).join("\n\n");
    const overLimitWorkspace = withParsedFile(createInitialWorkspace(), "file-course-brief", overLimitText);
    const overLimitBlocks = buildDocumentReaderBlocks(overLimitText);

    expect(
      validateDocumentFragmentSelection(overLimitWorkspace, {
        fileObjectId: "file-course-brief",
        extractAssetId: "asset-document-extract-a",
        blockIds: overLimitBlocks.slice(0, 9).map((block) => block.id),
        title: "invalid",
        sourceText: overLimitText
      })
    ).toMatchObject({ status: "blocked" });
  });
});

describe("document fragment draft and creation", () => {
  it("builds a draft from real source offsets and persists explicit source metadata", () => {
    const text = sampleText();
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief", text);
    const blocks = buildDocumentReaderBlocks(text);
    const selection = resolveDocumentFragmentSelection(workspace, {
      fileObjectId: "file-course-brief",
      extractAssetId: "asset-document-extract-a",
      blockIds: blocks.slice(0, 2).map((block) => block.id),
      title: "Course brief fragment",
      sourceText: text
    });

    if (selection.status !== "ready") {
      throw new Error(selection.reason);
    }

    const draft = buildDocumentFragmentDraft(workspace, selection, {
      title: "Course brief fragment",
      summary: "A bounded excerpt explicitly extracted by the user."
    });

    expect(draft.status).toBe("ready");
    if (draft.status !== "ready") {
      throw new Error(draft.reason);
    }

    expect(draft.draft.body).toBe(text.slice(selection.startOffset, selection.endOffset));
    expect(draft.draft.source.blockIds).toEqual(blocks.slice(0, 2).map((block) => block.id));

    const created = createDocumentFragment(workspace, draft.draft);
    expect(created.fragment.type).toBe("documentFragment");
    expect(created.fragment.body).toBe(draft.draft.body);
    expect(created.fragment.source.fileObjectId).toBe("file-course-brief");
    expect(created.fragment.source.sourceExtractAssetId).toBe("asset-document-extract-a");
    expect(created.fragment.source.startOffset).toBe(selection.startOffset);
    expect(created.fragment.source.endOffset).toBe(selection.endOffset);
  });

  it("blocks caller-provided summaries that exceed the document fragment summary limit", () => {
    const text = sampleText();
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief", text);
    const blocks = buildDocumentReaderBlocks(text);
    const selection = resolveDocumentFragmentSelection(workspace, {
      fileObjectId: "file-course-brief",
      extractAssetId: "asset-document-extract-a",
      blockIds: blocks.slice(0, 1).map((block) => block.id),
      title: "Course brief fragment",
      sourceText: text
    });
    if (selection.status !== "ready") {
      throw new Error(selection.reason);
    }

    expect(
      buildDocumentFragmentDraft(workspace, selection, {
        title: "Course brief fragment",
        summary: "x".repeat(301)
      })
    ).toMatchObject({ status: "blocked" });
  });

  it("records explicit extraction continuity without changing Current Focus or AI state", () => {
    const text = sampleText();
    const workspace = withParsedFile(createInitialWorkspace(), "file-course-brief", text);
    const blocks = buildDocumentReaderBlocks(text);
    const selection = resolveDocumentFragmentSelection(workspace, {
      fileObjectId: "file-course-brief",
      extractAssetId: "asset-document-extract-a",
      blockIds: blocks.slice(0, 2).map((block) => block.id),
      title: "Course brief fragment",
      sourceText: text
    });
    if (selection.status !== "ready") {
      throw new Error(selection.reason);
    }
    const draft = buildDocumentFragmentDraft(workspace, selection, { title: "Course brief fragment" });
    if (draft.status !== "ready") {
      throw new Error(draft.reason);
    }

    const created = createDocumentFragmentWithContinuity(workspace, draft.draft);

    expect(created.workspace.projectContinuity.currentFocus).toEqual(workspace.projectContinuity.currentFocus);
    expect(created.workspace.projectContinuity.recordEntries).toHaveLength(workspace.projectContinuity.recordEntries.length + 1);
    expect(created.workspace.projectContinuity.recordEntries.at(-1)?.sourceRefs.map((ref) => ref.id)).toContain(created.fragment.id);
    expect(created.workspace.ai.messages).toEqual(workspace.ai.messages);
    expect(created.workspace.decisionRecords).toEqual(workspace.decisionRecords);
    expect(created.workspace.ai.comparisonAnalyses).toEqual(workspace.ai.comparisonAnalyses);
  });
});

describe("document fragment source availability and location", () => {
  it("reports active source and exact reader location only when file and extract asset still match", () => {
    const workspace = withCreatedFragment(withParsedFile(createInitialWorkspace(), "file-course-brief", sampleText()));
    const fragment = Object.values(workspace.objects).find(
      (object) => object.type === "documentFragment" && object.title === "Course brief fragment"
    );
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }

    expect(resolveDocumentFragmentSourceAvailability(workspace, fragment)).toMatchObject({ status: "active" });
    expect(resolveDocumentFragmentLocation(workspace, fragment)).toMatchObject({
      status: "ready",
      fileObjectId: "file-course-brief",
      extractAssetId: "asset-document-extract-a",
      startOffset: fragment.source.startOffset,
      endOffset: fragment.source.endOffset
    });
  });

  it("keeps fragment body while reporting hidden, missing, and asset mismatch source states", () => {
    const workspace = withCreatedFragment(withParsedFile(createInitialWorkspace(), "file-course-brief", sampleText()));
    const fragment = Object.values(workspace.objects).find(
      (object) => object.type === "documentFragment" && object.title === "Course brief fragment"
    );
    if (!fragment || fragment.type !== "documentFragment") {
      throw new Error("Expected document fragment fixture.");
    }
    const sourceFile = workspace.objects[fragment.source.fileObjectId];
    if (!sourceFile || sourceFile.type !== "file") {
      throw new Error("Expected source file.");
    }

    const hidden: MorphoWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [sourceFile.id]: { ...sourceFile, visibility: "hidden" }
      }
    };
    expect(resolveDocumentFragmentSourceAvailability(hidden, fragment)).toMatchObject({ status: "hidden" });
    expect(resolveDocumentFragmentLocation(hidden, fragment)).toMatchObject({ status: "blocked" });

    const missing: MorphoWorkspace = {
      ...workspace,
      objects: Object.fromEntries(Object.entries(workspace.objects).filter(([objectId]) => objectId !== sourceFile.id))
    };
    expect(resolveDocumentFragmentSourceAvailability(missing, fragment)).toMatchObject({ status: "missing" });
    expect(resolveDocumentFragmentLocation(missing, fragment)).toMatchObject({ status: "blocked" });

    const changedAsset: MorphoWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [sourceFile.id]: { ...sourceFile, extractedAssetId: "asset-document-extract-b" }
      }
    };
    expect(resolveDocumentFragmentSourceAvailability(changedAsset, fragment)).toMatchObject({ status: "assetMismatch" });
    expect(resolveDocumentFragmentLocation(changedAsset, fragment)).toMatchObject({ status: "blocked" });
    expect(fragment.body.length).toBeGreaterThan(0);
  });
});

function sampleText(): string {
  return "# Heading\n\nFirst parsed block.\n\nSecond parsed block.\n\nThird parsed block.";
}

function withParsedFile(workspace: MorphoWorkspace, objectId: string, text: string): MorphoWorkspace {
  const file = workspace.objects[objectId];
  if (!file || file.type !== "file") {
    return workspace;
  }

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [objectId]: {
        ...file,
        parseStatus: "parsed",
        extractedAssetId: "asset-document-extract-a",
        extractedCharCount: text.length
      }
    },
    assets: {
      ...workspace.assets,
      "asset-document-extract-a": {
        id: "asset-document-extract-a",
        fileName: "course-brief.extract.txt",
        mimeType: "text/plain",
        size: text.length,
        createdAt: "2026-07-01T00:00:00.000Z",
        storageKey: "extract:file-course-brief",
        sourceType: "documentExtract"
      }
    }
  };
}

function withCreatedFragment(workspace: MorphoWorkspace): MorphoWorkspace {
  const text = sampleText();
  const blocks = buildDocumentReaderBlocks(text);
  const selection = resolveDocumentFragmentSelection(workspace, {
    fileObjectId: "file-course-brief",
    extractAssetId: "asset-document-extract-a",
    blockIds: blocks.slice(0, 2).map((block) => block.id),
    title: "Course brief fragment",
    sourceText: text
  });
  if (selection.status !== "ready") {
    throw new Error(selection.reason);
  }
  const draft = buildDocumentFragmentDraft(workspace, selection, {
    title: "Course brief fragment"
  });
  if (draft.status !== "ready") {
    throw new Error(draft.reason);
  }
  return createDocumentFragment(workspace, draft.draft).workspace;
}
