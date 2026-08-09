import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createInitialWorkspace } from "../../../domain/morpho/workspace";
import { buildDocumentReaderBlocks } from "../documentReader";
import { DocumentReaderPanel, buildSelectionWarning } from "./DocumentReaderPanel";

describe("DocumentReaderPanel selection helpers", () => {
  it("warns and disables extraction for non-consecutive parsed blocks", () => {
    const blocks = buildDocumentReaderBlocks("First block.\n\nSecond block.\n\nThird block.");
    const selectedBlocks = [blocks[0], blocks[2]].filter((block) => Boolean(block));

    expect(buildSelectionWarning(selectedBlocks, selectedBlocks.reduce((total, block) => total + block.text.length, 0))).toBe(
      "一次只能提取连续的解析片段，请缩小范围后重试。"
    );
  });

  it("allows consecutive parsed blocks within the extraction limits", () => {
    const blocks = buildDocumentReaderBlocks("First block.\n\nSecond block.\n\nThird block.");
    const selectedBlocks = [blocks[0], blocks[1]].filter((block) => Boolean(block));

    expect(buildSelectionWarning(selectedBlocks, selectedBlocks.reduce((total, block) => total + block.text.length, 0))).toBeNull();
  });

  it("renders an original source preview beside parsed text when the source file can be previewed", () => {
    const workspace = createInitialWorkspace();
    const file = workspace.objects["file-course-brief"];

    if (!file || file.type !== "file") {
      throw new Error("Expected seed workspace to include a file object.");
    }

    const html = renderToStaticMarkup(
      createElement(DocumentReaderPanel, {
        file,
        sourcePreview: {
          status: "ready",
          kind: "pdf",
          url: "blob:http://localhost/source-preview",
          mimeType: "application/pdf",
          fileName: file.fileName ?? file.title
        },
        text: "Parsed local text",
        status: "loaded",
        onClose: () => undefined,
        onExtractFragment: () => ({ status: "blocked" as const, reason: "not used" })
      })
    );

    expect(html).toContain("源文件与解析文本");
    expect(html).toContain("源文件视窗");
    expect(html).toContain("Parsed local text");
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("states unsupported original previews honestly while keeping parsed text readable", () => {
    const workspace = createInitialWorkspace();
    const seedFile = workspace.objects["file-course-brief"];

    if (!seedFile || seedFile.type !== "file") {
      throw new Error("Expected seed workspace to include a file object.");
    }

    const html = renderToStaticMarkup(
      createElement(DocumentReaderPanel, {
        file: {
          ...seedFile,
          fileKind: "document",
          fileName: "deck.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        },
        sourcePreview: {
          status: "unsupported",
          fileName: "deck.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          message: "当前文件类型暂不能在工作台内预览原版式；下方仍可查看已提取的解析文本。"
        },
        text: "Extracted slide text",
        status: "loaded",
        onClose: () => undefined,
        onExtractFragment: () => ({ status: "blocked" as const, reason: "not used" })
      })
    );

    expect(html).toContain("暂不能在工作台内预览原版式");
    expect(html).toContain("Extracted slide text");
  });
});
