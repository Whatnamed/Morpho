import { describe, expect, it } from "vitest";

import {
  assessTrust,
  cpuOccupancyRatio,
  medianStabilityPercent,
  percentile,
  relativeToCalibration,
  summarizeSamples,
  warmupCount
} from "./benchmarkSampling";

describe("percentile", () => {
  const ascending = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("uses nearest rank so every reported value was actually observed", () => {
    expect(percentile(ascending, 0.5)).toBe(5);
    expect(percentile(ascending, 0.75)).toBe(8);
    expect(percentile(ascending, 0.95)).toBe(10);
    // Never interpolates: 5.5 would not be a duration anyone measured.
    expect(ascending).toContain(percentile(ascending, 0.5));
  });

  it("clamps both ends rather than reading past the array", () => {
    expect(percentile(ascending, 0)).toBe(1);
    expect(percentile(ascending, 1)).toBe(10);
    expect(percentile(ascending, 2)).toBe(10);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it("returns the single sample for a one-element array", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });
});

describe("summarizeSamples", () => {
  it("computes mean and sample standard deviation on a known set", () => {
    // mean 5; deviations -3,-1,0,1,3 => sum sq 20; n-1 = 4 => variance 5 => sd sqrt(5)
    const summary = summarizeSamples([2, 4, 5, 6, 8]);
    expect(summary.meanMs).toBe(5);
    expect(summary.sdMs).toBeCloseTo(Math.sqrt(5), 10);
    expect(summary.minMs).toBe(2);
    expect(summary.sampleCount).toBe(5);
  });

  it("uses the n-1 denominator, not n", () => {
    // Population sd of [2,4,5,6,8] would be sqrt(4) = 2. Sample sd is sqrt(5).
    expect(summarizeSamples([2, 4, 5, 6, 8]).sdMs).not.toBeCloseTo(2, 6);
  });

  it("reports zero spread and zero error for identical samples", () => {
    const summary = summarizeSamples(Array.from({ length: 30 }, () => 7));
    expect(summary.sdMs).toBe(0);
    expect(summary.rmePercent).toBe(0);
    expect(summary.p50Ms).toBe(7);
    expect(summary.p99Ms).toBe(7);
  });

  it("applies Student's t rather than the normal approximation at n=30", () => {
    // sd is fixed, so rme is driven purely by the critical value. t(29) = 2.045.
    const samples = [...Array.from({ length: 15 }, () => 9), ...Array.from({ length: 15 }, () => 11)];
    const summary = summarizeSamples(samples);
    const expectedSd = Math.sqrt((15 * 1 + 15 * 1) / 29);
    const expectedRme = ((2.045 * (expectedSd / Math.sqrt(30))) / 10) * 100;
    expect(summary.meanMs).toBe(10);
    expect(summary.rmePercent).toBeCloseTo(expectedRme, 6);
    // The normal approximation (1.96) would have produced a visibly smaller figure.
    expect(summary.rmePercent).toBeGreaterThan(((1.96 * (expectedSd / Math.sqrt(30))) / 10) * 100);
  });

  it("degrades cleanly on empty and single-sample input instead of throwing", () => {
    const empty = summarizeSamples([]);
    expect(empty.sampleCount).toBe(0);
    expect(empty.p50Ms).toBeNaN();

    const single = summarizeSamples([3]);
    expect(single.sampleCount).toBe(1);
    expect(single.meanMs).toBe(3);
    expect(single.sdMs).toBe(0);
    expect(single.rmePercent).toBeNaN();
  });

  it("does not mutate the caller's array while sorting", () => {
    const samples = [5, 1, 3];
    summarizeSamples(samples);
    expect(samples).toEqual([5, 1, 3]);
  });
});

describe("medianStabilityPercent", () => {
  it("reports the spread of round medians against their mean", () => {
    expect(medianStabilityPercent([10, 10, 10])).toBe(0);
    expect(medianStabilityPercent([9, 10, 11])).toBeCloseTo(20, 10);
  });

  it("needs at least two rounds to say anything", () => {
    expect(medianStabilityPercent([10])).toBeNaN();
    expect(medianStabilityPercent([])).toBeNaN();
  });
});

describe("assessTrust", () => {
  const tight = summarizeSamples(Array.from({ length: 30 }, (_, index) => 10 + (index % 2) * 0.01));

  it("trusts a tight 30-sample run on a quiet process", () => {
    expect(assessTrust(tight, { cpuOccupancy: 0.98 })).toEqual({
      trusted: true,
      criterion: "tightDistribution",
      reasons: []
    });
  });

  it("rejects an under-sampled run and says so", () => {
    const verdict = assessTrust(summarizeSamples([10, 10, 10]));
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("样本数 3");
  });

  it("rejects a noisy run with no reproducible median", () => {
    const noisy = summarizeSamples(Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 1 : 40)));
    const verdict = assessTrust(noisy, { cpuOccupancy: 0.99, roundMedians: [1, 40, 20] });
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("相对误差");
    expect(verdict.reasons.join(" ")).toContain("轮间中位数波动");
  });

  it("trusts a GC-spiky distribution whose median reproduces across rounds", () => {
    // The renderConversation shape: a tight body with rare collections an order of
    // magnitude above it. rme is hopeless; the median lands in the same place every
    // round, which is the property a baseline actually needs.
    const spiky = summarizeSamples([
      ...Array.from({ length: 57 }, () => 32),
      ...Array.from({ length: 3 }, () => 260)
    ]);
    expect(spiky.rmePercent).toBeGreaterThan(5);

    const verdict = assessTrust(spiky, { cpuOccupancy: 0.99, roundMedians: [32, 32.3, 32.1] });
    expect(verdict).toEqual({ trusted: true, criterion: "stableMedian", reasons: [] });
  });

  it("does not let a stable median rescue an under-sampled or starved run", () => {
    const stableRounds = { roundMedians: [32, 32.1, 32.05] };
    expect(assessTrust(summarizeSamples([32, 32, 32]), stableRounds).trusted).toBe(false);
    expect(assessTrust(tight, { ...stableRounds, cpuOccupancy: 0.42 }).trusted).toBe(false);
  });

  it("rejects a starved process even when the samples look tight", () => {
    const verdict = assessTrust(tight, { cpuOccupancy: 0.42 });
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("CPU 占用率");
  });

  it("accumulates every failing reason rather than stopping at the first", () => {
    const verdict = assessTrust(summarizeSamples([1, 40, 1, 40]), { cpuOccupancy: 0.1 });
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("skips the CPU check when occupancy was not measured", () => {
    expect(assessTrust(tight).trusted).toBe(true);
  });

  it("falls back to the distribution check when no round medians are supplied", () => {
    const spiky = summarizeSamples([
      ...Array.from({ length: 57 }, () => 32),
      ...Array.from({ length: 3 }, () => 260)
    ]);
    expect(assessTrust(spiky, { cpuOccupancy: 0.99 }).trusted).toBe(false);
  });
});

describe("cpuOccupancyRatio", () => {
  it("returns ~1 when the process had a core to itself", () => {
    expect(cpuOccupancyRatio(1_000_000, 1000)).toBeCloseTo(1, 10);
  });

  it("returns well below 1 when the process was preempted", () => {
    expect(cpuOccupancyRatio(400_000, 1000)).toBeCloseTo(0.4, 10);
  });

  it("guards against a zero or negative window", () => {
    expect(cpuOccupancyRatio(1000, 0)).toBeNaN();
    expect(cpuOccupancyRatio(1000, -5)).toBeNaN();
  });
});

describe("relativeToCalibration", () => {
  it("expresses a target as a multiple of the calibration workload", () => {
    expect(relativeToCalibration(15, 5)).toBe(3);
  });

  it("refuses to divide by a missing or nonsensical calibration", () => {
    expect(relativeToCalibration(15, 0)).toBeNaN();
    expect(relativeToCalibration(15, Number.NaN)).toBeNaN();
    expect(relativeToCalibration(15, -1)).toBeNaN();
  });
});

describe("warmupCount", () => {
  it("keeps a floor of five discarded runs for small sample counts", () => {
    expect(warmupCount(30)).toBe(5);
    expect(warmupCount(1)).toBe(5);
  });

  it("scales to a tenth for large sample counts", () => {
    expect(warmupCount(200)).toBe(20);
    expect(warmupCount(95)).toBe(10);
  });
});
