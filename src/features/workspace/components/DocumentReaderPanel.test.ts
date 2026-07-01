import { describe, expect, it } from "vitest";

import { buildDocumentReaderBlocks } from "../documentReader";
import { buildSelectionWarning } from "./DocumentReaderPanel";

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
});
