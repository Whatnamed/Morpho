import { describe, expect, it } from "vitest";
import { deferredOracles, judgeFacts, trajectories } from "../../e2e/eval/contracts";

describe("P7 independent oracle", () => {
  it("rejects false completion, identity drift and lost unresolved claims without consulting a projection", () => {
    const results = judgeFacts([
      { label: "partial image batch", expected: "partial", actual: "fulfilled" },
      { label: "frozen reference", expected: { asset: "original", caption: "unverified" }, actual: { asset: "latest", caption: "verified" } },
      { label: "same-effect recovery", expected: { submits: 0, id: "existing" }, actual: { submits: 1, id: "new" } }
    ]);
    expect(results.map((r) => r.verdict)).toEqual(["fail", "fail", "fail"]);
    expect(results[0].expected).toBe("partial"); expect(results[0].actual).toBe("fulfilled");
  });
  it("does not confuse key ordering, array ordering or absent facts", () => {
    expect(judgeFacts([
      { label: "object keys", expected: { a: 1, b: 2 }, actual: { b: 2, a: 1 } },
      { label: "reference order", expected: ["A", "M"], actual: ["M", "A"] },
      { label: "missing fact", expected: false, actual: undefined }
    ]).map((r) => r.verdict)).toEqual(["pass", "fail", "fail"]);
  });
  it("freezes an independent expected fact pack for every deferred T1/T3 checkpoint", () => {
    for (const id of ["T1", "T3"] as const) {
      const manifest = trajectories.find((t) => t.id === id)!;
      expect(deferredOracles[id].map((o) => o.checkpoint)).toEqual(manifest.checkpoints.map((c) => c.id));
      expect(manifest.budget.paidProviderCalls).toBe(0);
      expect(manifest.checkpoints.every((c) => c.truthLedger.length && c.mustNotChange.length && c.evidence.length)).toBe(true);
    }
  });
});
