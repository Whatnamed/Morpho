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

  it.each([5, 6])("accepts one complete %i-item visual development plan", (count) => {
    const expected = resolveExpectedVisualGenerationCount({
      draft: `请生成 ${count} 张视觉素材`,
      kind: "visualDevelopment",
      selectedDirectionCount: 0
    });
    const batch = buildAgentVisualGenerationBatch({
      expected,
      calls: [{ callId: `call-${count}`, plan: makePlan(count, `batch-${count}`) }]
    });

    expect(batch).toMatchObject({ status: "ok", expected: { totalItems: count } });
    if (batch.status === "ok") {
      expect(batch.plan.items).toHaveLength(count);
      expect(batch.plan.items[0]?.id).toBe(`batch-${count}-1`);
    }
  });

  it("accepts two independent 3-item plans in the same agent turn", () => {
    const expected = { totalItems: 3, source: "explicitTotal" as const };
    const firstBatch = buildAgentVisualGenerationBatch({
      expected,
      calls: [{ callId: "call-first-3", plan: makePlan(3, "first") }]
    });
    const secondBatch = buildAgentVisualGenerationBatch({
      expected,
      calls: [{ callId: "call-second-3", plan: makePlan(3, "second") }]
    });

    expect(firstBatch.status).toBe("ok");
    expect(secondBatch.status).toBe("ok");
    if (firstBatch.status === "ok" && secondBatch.status === "ok") {
      expect([...firstBatch.plan.items, ...secondBatch.plan.items]).toHaveLength(6);
    }
  });
});

function makePlan(count: number, prefix: string) {
  return {
    kind: "visualDevelopment" as const,
    items: Array.from({ length: count }, (_, index) => ({
      ...firstItem,
      id: `${prefix}-${index + 1}`,
      title: `${prefix} ${index + 1}`
    }))
  };
}
