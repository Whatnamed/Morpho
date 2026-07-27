/**
 * Sampling statistics for the measurement harnesses.
 *
 * Pure functions only — no timers, no I/O, no clock. The driver collects raw
 * durations; everything that turns them into a number a decision can rest on lives
 * here, so it can be unit-tested against known inputs rather than trusted.
 *
 * The headline statistic is the median, not the mean. On a developer laptop the mean
 * is dragged around by scheduler preemption and background work; the median is the
 * typical cost and p95 is the tail. Both get reported; the mean alone never does.
 */

export type BenchmarkSummary = {
  sampleCount: number;
  minMs: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  sdMs: number;
  /** Relative margin of error at 95% confidence, as a percentage of the mean. */
  rmePercent: number;
};

/**
 * Two-sided 95% critical values by degrees of freedom.
 *
 * Using Student's t rather than the normal approximation matters at the sample sizes
 * this harness actually runs: at n=30 (df=29) t is 2.045 against z's 1.960, so the
 * normal approximation would understate the margin of error by ~4% — right at the
 * 5% trust gate, which is exactly where being wrong is expensive.
 */
const T_95: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042
];
const T_95_LARGE_SAMPLE = 1.96;

function criticalValue(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) {
    return Number.NaN;
  }
  return T_95[degreesOfFreedom - 1] ?? T_95_LARGE_SAMPLE;
}

/**
 * Nearest-rank percentile over an ascending array.
 *
 * Nearest-rank rather than interpolation: every reported value is then a duration that
 * was actually observed, which keeps the report auditable against the raw samples.
 */
export function percentile(ascending: readonly number[], fraction: number): number {
  if (ascending.length === 0) {
    return Number.NaN;
  }
  const rank = Math.ceil(fraction * ascending.length);
  const index = Math.min(Math.max(rank - 1, 0), ascending.length - 1);
  return ascending[index] as number;
}

export function summarizeSamples(samples: readonly number[]): BenchmarkSummary {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      minMs: Number.NaN,
      p50Ms: Number.NaN,
      p75Ms: Number.NaN,
      p95Ms: Number.NaN,
      p99Ms: Number.NaN,
      meanMs: Number.NaN,
      sdMs: Number.NaN,
      rmePercent: Number.NaN
    };
  }

  const ascending = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((total, value) => total + value, 0) / sampleCount;

  // Sample standard deviation (n-1): these are a sample of possible runs, not the
  // whole population of them.
  const variance =
    sampleCount < 2
      ? 0
      : samples.reduce((total, value) => total + (value - mean) ** 2, 0) / (sampleCount - 1);
  const sd = Math.sqrt(variance);
  const standardError = sampleCount < 2 ? 0 : sd / Math.sqrt(sampleCount);
  const marginOfError = sampleCount < 2 ? Number.NaN : criticalValue(sampleCount - 1) * standardError;

  return {
    sampleCount,
    minMs: ascending[0] as number,
    p50Ms: percentile(ascending, 0.5),
    p75Ms: percentile(ascending, 0.75),
    p95Ms: percentile(ascending, 0.95),
    p99Ms: percentile(ascending, 0.99),
    meanMs: mean,
    sdMs: sd,
    rmePercent: mean === 0 ? 0 : (marginOfError / mean) * 100
  };
}

/**
 * Spread of the per-round medians, as a percentage of their mean.
 *
 * The reproducibility check that `rmePercent` cannot provide. Allocation-heavy work
 * — SSR rendering above all — produces a distribution with a tight body and rare
 * garbage-collection spikes an order of magnitude above it. Mean and standard
 * deviation are dominated by those spikes, so `rmePercent` reports 25-30% for a
 * target whose median reproduces to within 2% across independent rounds.
 *
 * A median that lands in the same place in every interleaved round is a median a
 * baseline can be built on, regardless of how wild the tail is. The tail is not
 * hidden by this — p95 and p99 are reported alongside and are where it shows.
 */
export function medianStabilityPercent(roundMedians: readonly number[]): number {
  if (roundMedians.length < 2) {
    return Number.NaN;
  }
  const mean = roundMedians.reduce((total, value) => total + value, 0) / roundMedians.length;
  if (mean === 0) {
    return 0;
  }
  return ((Math.max(...roundMedians) - Math.min(...roundMedians)) / mean) * 100;
}

export type TrustThresholds = {
  maxRmePercent: number;
  maxMedianSpreadPercent: number;
  minSampleCount: number;
  /** Floor on observed CPU occupancy; below it the process was starved. */
  minCpuOccupancy: number;
};

export const DEFAULT_TRUST_THRESHOLDS: TrustThresholds = {
  maxRmePercent: 5,
  maxMedianSpreadPercent: 5,
  minSampleCount: 30,
  minCpuOccupancy: 0.9
};

export type TrustVerdict = {
  trusted: boolean;
  /** Which criterion carried it. Undefined when untrusted. */
  criterion?: "tightDistribution" | "stableMedian";
  /** Why not, in words the report can print. Empty when trusted. */
  reasons: string[];
};

/**
 * Whether a measurement may be cited.
 *
 * A number that fails this gate is not a slow number — it is an unknown number, and
 * the baseline document forbids quoting it. Reasons are returned rather than a bare
 * boolean so a failed run says what went wrong instead of just going red.
 *
 * Two ways to pass, because there are two ways for a timing to be sound:
 * the whole distribution is tight (`tightDistribution`), or the median reproduces
 * across independent rounds even though the tail is spiky (`stableMedian`). The
 * second exists for GC-bound work and requires round medians to be supplied; without
 * them only the first is available.
 */
export function assessTrust(
  summary: BenchmarkSummary,
  options: {
    cpuOccupancy?: number;
    roundMedians?: readonly number[];
    thresholds?: TrustThresholds;
  } = {}
): TrustVerdict {
  const thresholds = options.thresholds ?? DEFAULT_TRUST_THRESHOLDS;
  const reasons: string[] = [];

  if (summary.sampleCount < thresholds.minSampleCount) {
    reasons.push(`样本数 ${summary.sampleCount} < ${thresholds.minSampleCount}`);
  }
  if (options.cpuOccupancy !== undefined && options.cpuOccupancy < thresholds.minCpuOccupancy) {
    reasons.push(`CPU 占用率 ${options.cpuOccupancy.toFixed(2)} < ${thresholds.minCpuOccupancy}（进程被抢占）`);
  }

  const spread = medianStabilityPercent(options.roundMedians ?? []);
  const tight = Number.isFinite(summary.rmePercent) && summary.rmePercent < thresholds.maxRmePercent;
  const stable = Number.isFinite(spread) && spread < thresholds.maxMedianSpreadPercent;

  if (!tight && !stable) {
    if (!Number.isFinite(summary.rmePercent)) {
      reasons.push("误差范围无法计算（样本不足）");
    } else {
      reasons.push(`相对误差 ${summary.rmePercent.toFixed(1)}% >= ${thresholds.maxRmePercent}%`);
    }
    if (Number.isFinite(spread)) {
      reasons.push(`轮间中位数波动 ${spread.toFixed(1)}% >= ${thresholds.maxMedianSpreadPercent}%`);
    }
  }

  if (reasons.length > 0) {
    return { trusted: false, reasons };
  }
  return { trusted: true, criterion: tight ? "tightDistribution" : "stableMedian", reasons: [] };
}

/**
 * Fraction of wall-clock time this process actually spent on CPU.
 *
 * Used instead of `os.loadavg()`, which is always `[0, 0, 0]` on Windows. A value
 * well below 1 means the run competed with something else and its absolute timings
 * are not comparable to a quiet run.
 */
export function cpuOccupancyRatio(cpuMicroseconds: number, elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return Number.NaN;
  }
  return cpuMicroseconds / 1000 / elapsedMs;
}

/**
 * A target's cost expressed as a multiple of the calibration workload.
 *
 * Absolute milliseconds do not survive a machine change; this ratio does. When a later
 * run reports a different CPU model, compare ratios and ignore the raw numbers.
 */
export function relativeToCalibration(p50Ms: number, calibrationP50Ms: number): number {
  if (!Number.isFinite(calibrationP50Ms) || calibrationP50Ms <= 0) {
    return Number.NaN;
  }
  return p50Ms / calibrationP50Ms;
}

/**
 * Warmup count for a target that will be sampled `iterations` times.
 *
 * Discarded runs let the JIT tier up and hidden classes settle, so the recorded
 * samples measure steady-state work rather than the first-call cliff.
 */
export function warmupCount(iterations: number): number {
  return Math.max(5, Math.ceil(iterations / 10));
}
