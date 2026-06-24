import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks } from "./AiConversationPanel";

describe("AiConversationPanel markdown parsing", () => {
  it("parses headings, paragraphs, lists, and markdown tables", () => {
    const blocks = parseMarkdownBlocks(`# 方案比较

这是 **摘要**。

| 方案 | 成本 | 备注 |
| --- | --- | --- |
| A | 低 | 推荐 |
| B | 高 | 备选 |

- 保留输入
- 不自动执行`);

    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "方案比较" },
      { kind: "paragraph", text: "这是 **摘要**。" },
      {
        kind: "table",
        headers: ["方案", "成本", "备注"],
        rows: [
          ["A", "低", "推荐"],
          ["B", "高", "备选"]
        ]
      },
      { kind: "list", ordered: false, items: ["保留输入", "不自动执行"] }
    ]);
  });
});
