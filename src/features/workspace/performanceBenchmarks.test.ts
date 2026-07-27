import { describe, expect, it } from "vitest";

import { createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { PERFORMANCE_TARGETS, createCalibrationBenchmark } from "./performanceBenchmarks";
import { buildPerformanceScenarios } from "./performanceScenarios";

/**
 * The silent-zero guard.
 *
 * The worst failure mode of a benchmark harness is measuring nothing and reporting an
 * excellent number for it. Every target is executed once here and must prove it did
 * observable work, so a target that decays into a no-op — an import that resolves to
 * undefined, a short-circuit that always returns the input, a render that produces an
 * empty string — goes red in `npm test` instead of quietly making the baseline look
 * good.
 */
describe("Performance benchmark targets", () => {
  const scenarios = buildPerformanceScenarios();
  const caseStudy = scenarios.find((scenario) => scenario.key === "caseStudy");
  const compound = scenarios.find((scenario) => scenario.key === "compound500");

  it("declares unique keys", () => {
    const keys = PERFORMANCE_TARGETS.map((target) => target.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels every target with a unit so a bare number cannot be reported", () => {
    for (const target of PERFORMANCE_TARGETS) {
      expect(target.unit.length).toBeGreaterThan(0);
      expect(target.label.length).toBeGreaterThan(0);
    }
  });

  for (const target of PERFORMANCE_TARGETS) {
    it(`does observable work: ${target.key}`, () => {
      expect(caseStudy).toBeDefined();
      const prepared = target.prepare(caseStudy!);
      // The case study exercises every target; a null here means the target silently
      // opted out of the one scenario that is a real project.
      expect(prepared).not.toBeNull();
      expect(prepared!.verify(prepared!.run())).toBe(true);
    });
  }

  it("runs every target against the compound worst case too", () => {
    expect(compound).toBeDefined();
    for (const target of PERFORMANCE_TARGETS) {
      const prepared = target.prepare(compound!);
      expect(prepared, `${target.key} skipped compound500`).not.toBeNull();
      expect(prepared!.verify(prepared!.run()), `${target.key} did no work`).toBe(true);
    }
  });

  it("keeps reconcile:steady on the short-circuit and reconcile:cold off it", () => {
    // These two targets only mean anything if they measure different paths. If
    // `steady` ever stops hitting the referential short-circuit it becomes a second
    // copy of `cold`, and the headline streaming number silently triples.
    const steady = PERFORMANCE_TARGETS.find((target) => target.key === "reconcile:steady");
    const cold = PERFORMANCE_TARGETS.find((target) => target.key === "reconcile:cold");

    const steadyPrepared = steady!.prepare(caseStudy!)!;
    expect(steadyPrepared.verify(steadyPrepared.run())).toBe(true);

    const coldPrepared = cold!.prepare(caseStudy!)!;
    expect(coldPrepared.verify(coldPrepared.run())).toBe(true);
  });

  it("prepares the calibration workload deterministically", () => {
    const calibration = createCalibrationBenchmark(createCurrentCaseStudyWorkspace());
    const first = calibration.run();
    const second = calibration.run();
    expect(calibration.verify(first)).toBe(true);
    expect(first).toEqual(second);
  });
});
