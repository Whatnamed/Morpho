import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";

/**
 * Node-side performance baseline. Mirrors `measure-storage-footprint.mjs`:
 * logic lives in tested modules under `src/`, this file only drives and reports.
 *
 * Nothing here optimizes anything. The output is the evidence phase 4C is required to
 * cite before changing any code, and a number that fails the trust gate may not be
 * cited at all.
 */

const projectRoot = process.cwd();
const reportPath = resolve(projectRoot, "docs/operations/performance-node.generated.json");

/** 3 interleaved rounds x 20 samples = 60 samples, twice the trust gate's minimum. */
const ROUND_COUNT = 3;
const SAMPLES_PER_ROUND = 20;
const SETTLE_MS = 50;

const args = process.argv.slice(2);
const readArg = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const scenarioFilter = readArg("scenario");
const targetFilter = readArg("target");

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value < 1 ? `${value.toFixed(3)}` : value < 100 ? `${value.toFixed(2)}` : `${value.toFixed(1)}`;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function padStart(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${" ".repeat(width - text.length)}${text}`;
}

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Floor on how long one timed sample must span.
 *
 * `performance.now()` resolution plus scheduler jitter is a fixed absolute cost. On a
 * 1 ms sample it is a large relative fraction — which reads as "noisy code" when it
 * actually means "unmeasurable instrument". Batching a cheap target until its sample
 * clears this floor fixes the instrument; it does not flatter the number, because the
 * elapsed time is divided by the iteration count either way.
 */
const MIN_SAMPLE_MS = 5;
const MAX_ITERATIONS_PER_SAMPLE = 5000;

const settle = () => new Promise((done) => setTimeout(done, SETTLE_MS));

/** Probes a prepared unit and picks a batch size that clears MIN_SAMPLE_MS. */
function calibrateIterations(prepared, override) {
  if (override && override > 1) {
    return override;
  }
  let fastest = Number.POSITIVE_INFINITY;
  for (let probe = 0; probe < 3; probe += 1) {
    const started = performance.now();
    prepared.run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  if (!Number.isFinite(fastest) || fastest >= MIN_SAMPLE_MS) {
    return 1;
  }
  // Guard the divisor: a run that reads as 0 ms would otherwise ask for infinity.
  return Math.min(MAX_ITERATIONS_PER_SAMPLE, Math.max(1, Math.ceil(MIN_SAMPLE_MS / Math.max(fastest, 0.0005))));
}

const server = await createServer({
  appType: "custom",
  configFile: resolve(projectRoot, "vitest.config.ts"),
  server: { middlewareMode: true }
});

try {
  const samplingModule = await server.ssrLoadModule("/src/shared/benchmarkSampling.ts");
  const scenarioModule = await server.ssrLoadModule("/src/features/workspace/performanceScenarios.ts");
  const benchmarkModule = await server.ssrLoadModule("/src/features/workspace/performanceBenchmarks.ts");
  const workspaceModule = await server.ssrLoadModule("/src/domain/morpho/workspace.ts");

  const {
    summarizeSamples,
    assessTrust,
    cpuOccupancyRatio,
    medianStabilityPercent,
    relativeToCalibration,
    warmupCount
  } = samplingModule;

  console.log("正在构建规模夹具…");
  const allScenarios = scenarioModule.buildPerformanceScenarios();
  const scenarios = scenarioFilter
    ? allScenarios.filter((scenario) => scenario.key === scenarioFilter)
    : allScenarios;
  if (scenarios.length === 0) {
    throw new Error(`没有匹配的场景：${scenarioFilter}`);
  }

  const targets = targetFilter
    ? benchmarkModule.PERFORMANCE_TARGETS.filter((target) => target.key === targetFilter)
    : benchmarkModule.PERFORMANCE_TARGETS;
  if (targets.length === 0) {
    throw new Error(`没有匹配的目标：${targetFilter}`);
  }

  // --- prepare every pair up front, outside the timed phase -------------------
  //
  // Ordered by TARGET first, then scenario. Grouping by scenario instead lets an
  // allocation-heavy target (SSR rendering) trigger a garbage collection that lands
  // inside the next scenario's unrelated target. That was measured, not assumed:
  // grouped by scenario, renderConversation at objects300 read 23.09 ms; run in
  // isolation the same unit is 2.77 ms. Keeping same-target units adjacent confines
  // that cost to units it is actually comparable against, while round rotation still
  // spreads thermal drift across everything.
  const units = [];
  const skipped = [];
  for (const target of targets) {
    for (const scenario of scenarios) {
      const prepared = target.prepare(scenario);
      if (!prepared) {
        skipped.push({ scenario: scenario.key, target: target.key });
        continue;
      }
      units.push({
        scenario,
        target,
        prepared,
        declaredIterationsPerSample: target.iterationsPerSample,
        iterationsPerSample: 1,
        samples: [],
        roundMedians: []
      });
    }
  }

  const calibration = benchmarkModule.createCalibrationBenchmark(
    workspaceModule.createCurrentCaseStudyWorkspace()
  );
  const calibrationUnit = {
    scenario: { key: "__calibration__", label: "校准负载 JSON.stringify(caseStudy)" },
    target: { key: "calibration", label: "校准负载", unit: "ms/次" },
    prepared: calibration,
    declaredIterationsPerSample: undefined,
    iterationsPerSample: 1,
    samples: [],
    roundMedians: []
  };
  const rotation = [...units, calibrationUnit];

  // --- verify once, before timing, that each unit actually does work ----------
  for (const unit of rotation) {
    if (!unit.prepared.verify(unit.prepared.run())) {
      throw new Error(
        `目标 ${unit.target.key} 在场景 ${unit.scenario.key} 上没有产生可观测效果；` +
          `拒绝记录一个测量了空操作的数字。`
      );
    }
  }

  // --- warmup, then size each batch above the timer's noise floor -------------
  const totalSamples = ROUND_COUNT * SAMPLES_PER_ROUND;
  const warmups = warmupCount(totalSamples);
  console.log(
    `预热 ${warmups} 次/项，正式 ${ROUND_COUNT} 轮 x ${SAMPLES_PER_ROUND} 次 = ${totalSamples} 次/项，共 ${rotation.length} 项…`
  );
  for (const unit of rotation) {
    for (let index = 0; index < warmups; index += 1) {
      unit.prepared.run();
    }
    // Calibrated after warmup so the probe sees steady-state, JIT-settled cost.
    unit.iterationsPerSample = calibrateIterations(unit.prepared, unit.declaredIterationsPerSample);
  }
  await settle();

  // --- timed phase: rotate blocks so drift is shared, not concentrated --------
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();

  for (let round = 0; round < ROUND_COUNT; round += 1) {
    process.stdout.write(`  第 ${round + 1}/${ROUND_COUNT} 轮 `);
    for (const unit of rotation) {
      const iterations = unit.iterationsPerSample;
      const roundSamples = [];
      for (let sample = 0; sample < SAMPLES_PER_ROUND; sample += 1) {
        const started = performance.now();
        for (let iteration = 0; iteration < iterations; iteration += 1) {
          unit.prepared.run();
        }
        roundSamples.push((performance.now() - started) / iterations);
      }
      unit.samples.push(...roundSamples);
      // Per-round median, so the trust gate can ask whether the median reproduces
      // across rounds even when a GC-heavy tail inflates the standard deviation.
      unit.roundMedians.push(summarizeSamples(roundSamples).p50Ms);
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    await settle();
  }

  const elapsedMs = performance.now() - wallBefore;
  const cpuDelta = process.cpuUsage(cpuBefore);
  const cpuOccupancy = cpuOccupancyRatio(cpuDelta.user + cpuDelta.system, elapsedMs);

  // --- summarize -------------------------------------------------------------
  const calibrationSummary = summarizeSamples(calibrationUnit.samples);
  const calibrationVerdict = assessTrust(calibrationSummary, {
    cpuOccupancy,
    roundMedians: calibrationUnit.roundMedians
  });

  const byScenario = new Map();
  let anyUntrusted = !calibrationVerdict.trusted;

  for (const unit of units) {
    const summary = summarizeSamples(unit.samples);
    const verdict = assessTrust(summary, { cpuOccupancy, roundMedians: unit.roundMedians });
    if (!verdict.trusted) {
      anyUntrusted = true;
    }

    if (!byScenario.has(unit.scenario.key)) {
      byScenario.set(unit.scenario.key, {
        key: unit.scenario.key,
        label: unit.scenario.label,
        note: unit.scenario.note,
        scale: unit.scenario.scale,
        serializedUtf16Length: workspaceModule.serializeWorkspace(unit.scenario.workspace).length,
        targets: []
      });
    }

    byScenario.get(unit.scenario.key).targets.push({
      key: unit.target.key,
      label: unit.target.label,
      unit: unit.target.unit,
      iterationsPerSample: unit.iterationsPerSample,
      p50Ms: summary.p50Ms,
      p75Ms: summary.p75Ms,
      p95Ms: summary.p95Ms,
      p99Ms: summary.p99Ms,
      minMs: summary.minMs,
      meanMs: summary.meanMs,
      sdMs: summary.sdMs,
      rmePercent: summary.rmePercent,
      sampleCount: summary.sampleCount,
      relativeToCalibration: relativeToCalibration(summary.p50Ms, calibrationSummary.p50Ms),
      medianSpreadPercent: medianStabilityPercent(unit.roundMedians),
      roundMedians: unit.roundMedians,
      trusted: verdict.trusted,
      trustCriterion: verdict.criterion ?? null,
      untrustedReasons: verdict.reasons
    });
  }

  // --- report ----------------------------------------------------------------
  for (const scenario of byScenario.values()) {
    console.log("");
    console.log(`## ${scenario.label}  [${scenario.key}]`);
    console.log(
      `   对象 ${scenario.scale.objects} · 消息 ${scenario.scale.messages} · Frame ${scenario.scale.contextFrames} · ` +
        `记忆修订 ${scenario.scale.memoryRevisions} · continuity ${scenario.scale.continuityEntries}` +
        `（引用 ${scenario.scale.continuitySourceRefs}，其中 message ${scenario.scale.messageSourceRefs}）· ` +
        `序列化 ${scenario.serializedUtf16Length.toLocaleString("en-US")} 字符`
    );
    if (scenario.note) {
      console.log(`   注：${scenario.note}`);
    }
    console.log(
      `     ${pad("目标", 34)}${padStart("p50", 9)}${padStart("p95", 9)}${padStart("rme", 8)}${padStart("轮间", 8)}${padStart("×校准", 9)}  可信`
    );
    for (const target of scenario.targets) {
      const batched = target.iterationsPerSample > 1 ? ` ×${target.iterationsPerSample}` : "";
      const verdict = target.trusted
        ? target.trustCriterion === "stableMedian"
          ? "是（中位数稳定）"
          : "是"
        : `否（${target.untrustedReasons.join("；")}）`;
      console.log(
        `     ${pad(target.key + batched, 34)}${padStart(formatMs(target.p50Ms), 9)}${padStart(formatMs(target.p95Ms), 9)}` +
          `${padStart(`${target.rmePercent.toFixed(1)}%`, 8)}${padStart(`${target.medianSpreadPercent.toFixed(1)}%`, 8)}` +
          `${padStart(target.relativeToCalibration.toFixed(2), 9)}  ${verdict}`
      );
    }
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("跳过的组合（场景无法驱动该目标）：");
    for (const entry of skipped) {
      console.log(`     ${pad(entry.scenario, 34)}${entry.target}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    // Both fields mean "the code commit that was measured", captured at run time.
    // The commit that adds this generated file is a later evidence commit and can
    // never equal a hash of content that includes itself.
    gitCommit: readGitCommit(),
    measuredCodeCommit: readGitCommit(),
    trusted: !anyUntrusted,
    protocol: {
      roundCount: ROUND_COUNT,
      samplesPerRound: SAMPLES_PER_ROUND,
      warmupPerUnit: warmups,
      settleMsBetweenRounds: SETTLE_MS,
      headlineStatistic: "p50",
      note:
        "块轮转交错采样：热降频或后台负载会均摊到所有目标，而不是惩罚最后运行的那个。" +
        "iterationsPerSample > 1 的目标单次调用低于计时器分辨率，批量执行后取每次调用的均值；批量大小按预热后的实测成本自动选取。" +
        "未通过 trusted 的数字不得被引用。"
    },
    environment: {
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      cpuModel: os.cpus()[0]?.model ?? null,
      cpuCount: os.cpus().length,
      totalMemBytes: os.totalmem()
    },
    calibration: {
      label: "JSON.stringify(createCurrentCaseStudyWorkspace())",
      p50Ms: calibrationSummary.p50Ms,
      rmePercent: calibrationSummary.rmePercent,
      sampleCount: calibrationSummary.sampleCount,
      trusted: calibrationVerdict.trusted,
      untrustedReasons: calibrationVerdict.reasons,
      note: "绝对毫秒不跨机器可比，比值可比。换机器后请比较 relativeToCalibration。"
    },
    cpuOccupancy,
    cpuOccupancyNote:
        "进程 CPU 时间（全部线程）与墙钟之比。低于 0.9 说明进程被抢占，整轮不可信；" +
        "高于 1 属正常，GC 与 JIT 在后台线程上并行工作。",
    elapsedMs,
    skipped,
    scenarios: [...byScenario.values()]
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log(
    `校准 p50 ${formatMs(calibrationSummary.p50Ms)} ms · CPU 占用率 ${cpuOccupancy.toFixed(2)} · 用时 ${(elapsedMs / 1000).toFixed(1)} s`
  );
  if (anyUntrusted) {
    console.log("");
    console.log("!! 本轮存在未通过可信门的数字。这些数字不得用于论证任何优化。");
    console.log("!! 请在空闲机器上重跑；若仍不可信，如实记录为不可信。");
  }
  console.log(`报告已写入 ${reportPath}`);
} finally {
  await server.close();
}
