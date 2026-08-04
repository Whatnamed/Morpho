import { describe, expect, it } from "vitest";

import { resolveComparisonWritebackSourceObjectIds } from "./comparisonDecision";
import type { PendingComparisonConfirmation } from "./components/AiConversationPanel";

describe("comparison decision helpers", () => {
  it("uses the key conclusion candidate subset when confirming compareCreateKeyConclusion", () => {
    const confirmation: PendingComparisonConfirmation = {
      kind: "compareCreateKeyConclusion",
      targetTitle: "夜间连续导向优先于装饰复杂度",
      comparisonAnalysisId: "comparison-1",
      comparisonAssistantMessageId: "assistant-1",
      comparisonSourceObjectIds: ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2"],
      keyConclusionSourceObjectIds: ["direction-soft-rail"],
      summary: "柔光轨道更适合作为主方向。",
      userReason: "",
      reasonRequired: false,
      keyConclusionDraft: {
        title: "夜间连续导向优先于装饰复杂度",
        body: "夜间连续导向优先于装饰复杂度。",
        summary: "优先保留连续导向。",
        category: "finding",
        confidence: "partial"
      }
    };

    expect(resolveComparisonWritebackSourceObjectIds(confirmation)).toEqual(["direction-soft-rail"]);
  });

  it("keeps the full compare selection for non-key-conclusion decisions", () => {
    const confirmation: PendingComparisonConfirmation = {
      kind: "compareSetPrimary",
      targetObjectId: "direction-soft-rail",
      targetTitle: "柔光轨道",
      comparisonAnalysisId: "comparison-1",
      comparisonAssistantMessageId: "assistant-1",
      comparisonSourceObjectIds: ["direction-soft-rail", "direction-support-island"],
      summary: "柔光轨道更适合作为主方向。",
      userReason: "",
      reasonRequired: false
    };

    expect(resolveComparisonWritebackSourceObjectIds(confirmation)).toEqual([
      "direction-soft-rail",
      "direction-support-island"
    ]);
  });
});
