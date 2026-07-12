import { describe, expect, it } from "vitest";

import {
  buildAgentVisualGenerationBatch,
  resolveExpectedVisualGenerationCount
} from "./agentVisualGenerationBatch";

const firstItem = {
  id: "item-a",
  title: "方向图 A",
  purpose: "验证路径",
  prompt: "生成方向 A",
  referenceObjectIds: ["direction-soft-rail"],
  role: "conceptImage" as const,
  targetDirectionId: "direction-soft-rail"
};

describe("agent visual generation batch", () => {
  it("uses an explicit total from the user instead of inferring it from the first function call", () => {
    expect(
      resolveExpectedVisualGenerationCount({
        draft: "请生成 2 张不同方向图",
        kind: "visualDevelopment",
        selectedDirectionCount: 0
      })
    ).toMatchObject({ totalItems: 2, source: "explicitTotal" });
  });

  it("keeps per-direction preview counts distinct from a total count", () => {
    expect(
      resolveExpectedVisualGenerationCount({
        draft: "每个方向生成两张预览",
        kind: "directionPreview",
        selectedDirectionCount: 2
      })
    ).toMatchObject({ totalItems: 4, requestedPreviewCount: 2, source: "explicitPerDirection" });

    expect(
      resolveExpectedVisualGenerationCount({
        draft: "总共生成 2 张预览",
        kind: "directionPreview",
        selectedDirectionCount: 2
      })
    ).toMatchObject({ totalItems: 2, requestedPreviewCount: 1, source: "explicitTotal" });
  });

  it("merges two single-item generate calls into one complete batch", () => {
    const expected = resolveExpectedVisualGenerationCount({
      draft: "生成两张图",
      kind: "visualDevelopment",
      selectedDirectionCount: 0
    });
    const batch = buildAgentVisualGenerationBatch({
      expected,
      calls: [
        { callId: "call-a", plan: { kind: "visualDevelopment", items: [{ ...firstItem, role: "preview" }] } },
        {
          callId: "call-b",
          plan: {
            kind: "visualDevelopment",
            items: [{ ...firstItem, id: "item-b", title: "方向图 B", role: "preview" }]
          }
        }
      ]
    });

    expect(batch).toMatchObject({
      status: "ok",
      plan: { kind: "visualDevelopment", items: [{ id: "item-a" }, { id: "item-b" }] }
    });
  });

  it("blocks a partial batch before it can submit its first image request", () => {
    const batch = buildAgentVisualGenerationBatch({
      expected: { totalItems: 2, source: "explicitTotal" },
      calls: [{ callId: "call-a", plan: { kind: "visualDevelopment", items: [{ ...firstItem, role: "preview" }] } }]
    });

    expect(batch).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("不得拆分")
    });
  });
});
