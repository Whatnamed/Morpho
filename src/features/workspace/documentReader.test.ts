import { describe, expect, it, vi } from "vitest";

import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { AssetRecord, FileObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import {
  buildDocumentReaderBlocks,
  loadDocumentReaderExtract,
  resolveDocumentReaderAvailability,
  searchDocumentReaderBlocks,
  shouldAcceptDocumentReaderLoadResult
} from "./documentReader";

describe("document reader blocks", () => {
  it("returns no blocks for empty or whitespace-only text", () => {
    expect(buildDocumentReaderBlocks("")).toEqual([]);
    expect(buildDocumentReaderBlocks(" \n\t\n")).toEqual([]);
  });

  it("builds stable text blocks with offsets into the original TXT extract", () => {
    const text = "第一行资料\n第二行资料\n\n第三段资料";
    const blocks = buildDocumentReaderBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
    for (const block of blocks) {
      expect(text.slice(block.startOffset, block.endOffset)).toBe(block.text);
      expect(block.startOffset).toBeGreaterThanOrEqual(0);
      expect(block.endOffset).toBeGreaterThan(block.startOffset);
    }
    expect(blocks.map((block) => block.text).join("\n\n")).toBe(text);
  });

  it("recognizes markdown headings and paragraphs without breaking source offsets", () => {
    const text = "# 课程要求\n\n需要保留低施力握持。\n\n## 限制\n不能做成医疗设备。";
    const blocks = buildDocumentReaderBlocks(text);

    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
    expect(blocks[0]?.text).toBe("# 课程要求");
    expect(blocks[2]?.text).toBe("## 限制");
    for (const block of blocks) {
      expect(text.slice(block.startOffset, block.endOffset)).toBe(block.text);
    }
  });

  it("splits a very long single paragraph into stable smaller blocks without reordering text", () => {
    const text = "甲".repeat(4_200);
    const blocks = buildDocumentReaderBlocks(text, { maxBlockLength: 1_000 });

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((block) => block.text.length <= 1_000)).toBe(true);
    expect(blocks.map((block) => block.text).join("")).toBe(text);
    expect(blocks[1]?.startOffset).toBe(blocks[0]?.endOffset);
  });

  it("searches literal text across Chinese, English, newlines, and repeated keywords", () => {
    const text = "低施力 grip\n第二行低施力\n\nGrip and low force grip.";
    const blocks = buildDocumentReaderBlocks(text);

    const chineseMatches = searchDocumentReaderBlocks(blocks, "低施力");
    const englishMatches = searchDocumentReaderBlocks(blocks, "grip");

    expect(chineseMatches).toHaveLength(2);
    expect(englishMatches).toHaveLength(3);
    expect(chineseMatches[0]).toMatchObject({
      blockId: blocks[0]?.id,
      startOffset: 0,
      matchStartInBlock: 0,
      matchEndInBlock: 3
    });
    expect(englishMatches.map((match) => text.slice(match.startOffset, match.endOffset))).toEqual([
      "grip",
      "Grip",
      "grip"
    ]);
  });

  it("treats search input as plain text rather than a regular expression", () => {
    const blocks = buildDocumentReaderBlocks("a+b aab a+b");
    const matches = searchDocumentReaderBlocks(blocks, "a+b");

    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.snippet)).toEqual(["a+b aab a+b", "a+b aab a+b"]);
  });

  it("keeps HTML, script, markdown links, and code-like text as inert text", () => {
    const text = "<script>alert(1)</script>\n\n[link](https://example.com) `code()`";
    const blocks = buildDocumentReaderBlocks(text);
    const matches = searchDocumentReaderBlocks(blocks, "<script>");

    expect(blocks.map((block) => block.text)).toEqual([
      "<script>alert(1)</script>",
      "[link](https://example.com) `code()`"
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.snippet).toContain("<script>alert(1)</script>");
  });
});

describe("document reader availability", () => {
  it("allows an active parsed file with a valid documentExtract asset", () => {
    const workspace = workspaceWithFile({
      filePatch: {
        parseStatus: "parsed",
        extractedAssetId: "asset-extract",
        extractedCharCount: 12
      },
      extractAsset: validExtractAsset()
    });

    expect(resolveDocumentReaderAvailability(workspace, "file-1")).toMatchObject({
      status: "ready",
      fileObjectId: "file-1",
      extractAssetId: "asset-extract"
    });
  });

  it("blocks unparsed, parsing, failed, missing extract id, invalid asset source, missing asset, hidden, and missing files", () => {
    const cases: Array<[string, MorphoWorkspace, string]> = [
      ["unparsed", workspaceWithFile({ filePatch: { parseStatus: "unparsed" } }), "尚未生成"],
      ["parsing", workspaceWithFile({ filePatch: { parseStatus: "parsing" } }), "正在解析"],
      [
        "failed",
        workspaceWithFile({ filePatch: { parseStatus: "failed", parseError: "PDF 解析失败" } }),
        "PDF 解析失败"
      ],
      ["missing id", workspaceWithFile({ filePatch: { parseStatus: "parsed" } }), "文本资源不可用"],
      [
        "wrong source",
        workspaceWithFile({
          filePatch: { parseStatus: "parsed", extractedAssetId: "asset-original" },
          extractAsset: { ...validExtractAsset(), id: "asset-original", sourceType: "originalFile" }
        }),
        "文本资源不可用"
      ],
      [
        "missing asset",
        workspaceWithFile({ filePatch: { parseStatus: "parsed", extractedAssetId: "asset-missing" } }),
        "文本资源不可用"
      ],
      [
        "hidden",
        workspaceWithFile({
          filePatch: { visibility: "hidden", parseStatus: "parsed", extractedAssetId: "asset-extract" },
          extractAsset: validExtractAsset()
        }),
        "已隐藏"
      ],
      ["missing file", createBlankWorkspace("reader"), "文件不存在"]
    ];

    for (const [label, workspace, expectedMessage] of cases) {
      const result = resolveDocumentReaderAvailability(workspace, "file-1");
      expect(result.status, label).toBe("blocked");
      expect(result.status === "blocked" ? result.message : "").toContain(expectedMessage);
    }
  });

  it("loads only the documentExtract Blob and reports local read failures without mutating workspace", async () => {
    const workspace = workspaceWithFile({
      filePatch: {
        parseStatus: "parsed",
        extractedAssetId: "asset-extract",
        extractedCharCount: 4
      },
      extractAsset: validExtractAsset()
    });
    const before = JSON.stringify(workspace);

    const loaded = await loadDocumentReaderExtract(workspace, "file-1", new MemoryBlobStore({ "blob:extract": "正文" }));
    const missing = await loadDocumentReaderExtract(workspace, "file-1", new MemoryBlobStore({}));

    expect(loaded).toMatchObject({ status: "loaded", text: "正文" });
    expect(missing).toMatchObject({ status: "error" });
    expect(missing.status === "error" ? missing.message : "").toContain("Blob");
    expect(JSON.stringify(workspace)).toBe(before);
  });
});

describe("document reader async load guards", () => {
  it("rejects a late A load after the user switches to B", () => {
    expect(
      shouldAcceptDocumentReaderLoadResult(
        { openFileObjectId: "file-b", requestId: 2 },
        { fileObjectId: "file-a", requestId: 1 }
      )
    ).toBe(false);
    expect(
      shouldAcceptDocumentReaderLoadResult(
        { openFileObjectId: "file-b", requestId: 2 },
        { fileObjectId: "file-b", requestId: 2 }
      )
    ).toBe(true);
  });

  it("rejects a late load after the reader is closed", () => {
    expect(
      shouldAcceptDocumentReaderLoadResult(
        { openFileObjectId: null, requestId: 3 },
        { fileObjectId: "file-a", requestId: 3 }
      )
    ).toBe(false);
  });
});

describe("document reader workspace isolation", () => {
  it("keeps reading, searching, and close guards out of workspace, AI, continuity, compare, and provider state", async () => {
    const workspace = workspaceWithFile({
      filePatch: {
        parseStatus: "parsed",
        extractedAssetId: "asset-extract",
        extractedCharCount: 16
      },
      extractAsset: validExtractAsset()
    });
    const beforeWorkspace = JSON.stringify(workspace);
    const beforeContinuity = JSON.stringify(workspace.projectContinuity);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("reader must not call provider"));

    const loaded = await loadDocumentReaderExtract(
      workspace,
      "file-1",
      new MemoryBlobStore({ "blob:extract": "关键词\n\n第二段关键词" })
    );
    const blocks = buildDocumentReaderBlocks(loaded.status === "loaded" ? loaded.text : "");
    const matches = searchDocumentReaderBlocks(blocks, "关键词");
    const closedGuard = shouldAcceptDocumentReaderLoadResult(
      { openFileObjectId: null, requestId: 2 },
      { fileObjectId: "file-1", requestId: 2 }
    );

    expect(loaded.status).toBe("loaded");
    expect(matches).toHaveLength(2);
    expect(closedGuard).toBe(false);
    expect(workspace.schemaVersion).toBe(13);
    expect(JSON.stringify(workspace)).toBe(beforeWorkspace);
    expect(JSON.stringify(workspace.projectContinuity)).toBe(beforeContinuity);
    expect(workspace.ai.messages).toEqual([]);
    expect(workspace.ai.conversationCheckpoints).toEqual([]);
    expect(workspace.ai.comparisonAnalyses).toEqual({});
    expect(workspace.decisionRecords).toEqual([]);
    expect(workspace.operations).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function validExtractAsset(): AssetRecord {
  return {
    id: "asset-extract",
    fileName: "brief.extract.txt",
    mimeType: "text/plain",
    size: 12,
    createdAt: "2026-07-01T00:00:00.000Z",
    storageKey: "blob:extract",
    sourceType: "documentExtract"
  };
}

function workspaceWithFile(input: { filePatch: Partial<FileObject>; extractAsset?: AssetRecord }): MorphoWorkspace {
  const workspace = createBlankWorkspace("reader");
  const file: FileObject = {
    id: "file-1",
    type: "file",
    title: "课程资料",
    summary: "本地文件",
    createdBy: "user",
    visibility: "active",
    fileKind: "document",
    sourceLabel: "用户导入",
    assetId: "asset-original",
    fileName: "brief.pdf",
    mimeType: "application/pdf",
    size: 128,
    ...input.filePatch
  };

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [file.id]: file
    },
    assets: input.extractAsset
      ? {
          ...workspace.assets,
          [input.extractAsset.id]: input.extractAsset
        }
      : workspace.assets
  };
}

class MemoryBlobStore implements BlobStore {
  constructor(private readonly textByKey: Record<string, string>) {}

  async put(): Promise<void> {
    throw new Error("not needed");
  }

  async get(storageKey: string): Promise<Blob | null> {
    const text = this.textByKey[storageKey];
    return text === undefined ? null : new Blob([text], { type: "text/plain" });
  }
}
