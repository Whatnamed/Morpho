import { describe, expect, it } from "vitest";

import {
  getManualCompactionStatusText,
  parseManualCompactCommand
} from "./manualConversationCompaction";

describe("manual conversation compaction", () => {
  it("recognizes the Codex-style /compact command without treating ordinary text as a command", () => {
    expect(parseManualCompactCommand("/compact")).toEqual({ matched: true });
    expect(parseManualCompactCommand("  /COMPACT  ")).toEqual({ matched: true });
    expect(parseManualCompactCommand("/compact please")).toEqual({ matched: false });
    expect(parseManualCompactCommand("请帮我 compact 一下")).toEqual({ matched: false });
  });

  it("uses explicit visible progress text for manual compaction", () => {
    expect(getManualCompactionStatusText("running")).toBe("正在压缩当前上下文…");
    expect(getManualCompactionStatusText("completed")).toContain("上下文压缩完成");
    expect(getManualCompactionStatusText("notNeeded")).toContain("无需压缩");
    expect(getManualCompactionStatusText("failed")).toContain("上下文压缩未完成");
  });
});
