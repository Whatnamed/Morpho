import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * ZIP sync/async crossover measurement for the Phase 5 hybrid decision.
 *
 * The archive export path picks between fflate `zipSync` (blocks the main thread
 * for the whole compression) and the async `zip` (compresses in Workers but pays
 * a per-call main-thread handoff). This spec measures both paths on the same
 * deterministic bundles in a real browser.
 *
 * LoAF attribution rules (hardened after a review caught a polluted window):
 * - every measurement starts after TWO rAFs, so no long frame from a previous
 *   tier/rep can still be running when the window opens;
 * - each run records its own [startedAt, endedAt] and only Long Animation Frames
 *   genuinely overlapping that window are attributed to it;
 * - the headline figure is `blockingDuration`, not the raw frame `duration`;
 * - the window closes after two more rAFs so buffered entries get delivered.
 *
 * Records to docs/operations/performance-zip-crossover.generated.json; asserts
 * only measurement sanity (real archives were produced), never thresholds.
 * Runs under the perf5 project only.
 */

const FFLATE_BROWSER_ESM = resolve(process.cwd(), "node_modules/fflate/esm/browser.js");
const REPORT_PATH = resolve(process.cwd(), "docs/operations/performance-zip-crossover.generated.json");

type CrossoverRow = {
  tierMiB: number;
  inputBytes: number;
  syncWallMs: number;
  syncLongestBlockingMs: number;
  syncTotalBlockingMs: number;
  asyncWallMs: number;
  asyncFirstCallMs: number;
  asyncLongestBlockingMs: number;
  asyncTotalBlockingMs: number;
  syncCompressedBytes: number;
  asyncCompressedBytes: number;
  byteIdentical: boolean;
};

function readGitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

test.describe("ZIP 同步/异步 crossover（记录，不断言阈值）", () => {
  test("zipSync vs async zip across bundle sizes", async ({ page }) => {
    test.setTimeout(240_000);
    const fflateSource = readFileSync(FFLATE_BROWSER_ESM, "utf8");
    await page.route("**/__perf_fflate.mjs", (route) =>
      route.fulfill({ contentType: "text/javascript", body: fflateSource })
    );

    await page.goto("/");
    const buildIdentity = await page.evaluate(async () => {
      const response = await fetch("/api/build-provenance");
      if (!response.ok) {
        throw new Error(`Build provenance endpoint unavailable: ${response.status}`);
      }
      return response.json() as Promise<{ sourceSha: string | null; buildId: string | null; artifactSha256: string | null }>;
    });
    expect(buildIdentity.sourceSha, "served build missing source SHA").toBe(readGitCommit());
    expect(buildIdentity.buildId, "served build missing build ID").toBeTruthy();
    expect(buildIdentity.artifactSha256, "served build missing artifact digest").toMatch(/^[a-f0-9]{64}$/);
    const { rows, machine } = await page.evaluate(async () => {
      // Fulfilled by the page.route above; the specifier is deliberately dynamic
      // so TypeScript does not try to resolve a runtime-injected URL.
      const moduleUrl = "/__perf_fflate.mjs";
      const fflate = (await import(moduleUrl)) as typeof import("fflate");
      const { zipSync, zip } = fflate;

      const mulberry32 = (seed: number) => {
        let a = seed >>> 0;
        return () => {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };

      /** ~20% compressible JSON-ish text + ~80% PNG-like noise, like a real bundle. */
      const makeEntries = (totalBytes: number): Record<string, Uint8Array> => {
        const entries: Record<string, Uint8Array> = {};
        const textBytes = Math.floor(totalBytes * 0.2);
        const noiseBytes = totalBytes - textBytes;
        const chunkCount = Math.max(1, Math.floor(noiseBytes / (256 * 1024)));
        let remainingNoise = noiseBytes;
        for (let index = 0; index < chunkCount; index += 1) {
          const size = Math.floor(noiseBytes / chunkCount);
          const random = mulberry32(0xc0ffee + index);
          const chunk = new Uint8Array(Math.min(size, remainingNoise));
          for (let offset = 0; offset < chunk.length; offset += 1) {
            chunk[offset] = Math.floor(random() * 256);
          }
          remainingNoise -= chunk.length;
          entries[`assets/synthetic-${index}.png`] = chunk;
        }
        const textParts: string[] = [];
        let remainingText = textBytes;
        let textSeed = 1;
        while (remainingText > 0) {
          const part = JSON.stringify({ index: textSeed, note: "Morpho crossover 夹具的 JSON 文本内容。", values: Array.from({ length: 24 }, (_, i) => (textSeed * 31 + i) % 997) });
          textParts.push(part);
          remainingText -= part.length;
          textSeed += 1;
        }
        entries["workspace/workspace.json"] = new TextEncoder().encode(textParts.join("\n"));
        return entries;
      };

      /** Two rAFs = one frame boundary has passed; no old long frame can still run. */
      const cleanFrame = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );

      type LoafEntry = { startTime: number; duration: number; blockingDuration: number };

      /**
       * Runs one measured operation. Only Long Animation Frames whose
       * [startTime, startTime+duration] intersects the run's own [startedAt,
       * endedAt] window are attributed to it.
       */
      async function measure(op: () => Promise<Uint8Array> | Uint8Array): Promise<{
        wallMs: number;
        longestBlockingMs: number;
        totalBlockingMs: number;
        output: Uint8Array;
      }> {
        await cleanFrame();
        const frames: LoafEntry[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const loaf = entry as PerformanceEntry & { blockingDuration?: number };
            frames.push({
              startTime: loaf.startTime,
              duration: loaf.duration,
              blockingDuration: loaf.blockingDuration ?? 0
            });
          }
        });
        observer.observe({ type: "long-animation-frame" } as PerformanceObserverInit);
        const startedAt = performance.now();
        const output = await op();
        const endedAt = performance.now();
        // Let frame-end entries for any frame that overlapped the window arrive.
        await cleanFrame();
        await new Promise((resolve) => window.setTimeout(resolve, 30));
        observer.disconnect();
        const overlapping = frames.filter(
          (frame) => frame.startTime < endedAt && frame.startTime + frame.duration > startedAt
        );
        return {
          wallMs: endedAt - startedAt,
          longestBlockingMs: overlapping.length === 0 ? 0 : Math.max(...overlapping.map((f) => f.blockingDuration)),
          totalBlockingMs: overlapping.reduce((total, f) => total + f.blockingDuration, 0),
          output
        };
      }

      const runSync = (entries: Record<string, Uint8Array>) =>
        measure(() => zipSync(entries, { level: 6 }));

      const runAsync = (entries: Record<string, Uint8Array>) =>
        measure(
          () =>
            new Promise<Uint8Array>((resolve, reject) => {
              zip(entries, { level: 6 }, (error: Error | null, data: Uint8Array) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve(data);
              });
            })
        );

      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? 0;
      };

      const tiers = [0.2, 1, 2, 4, 8, 16];
      const rows: CrossoverRow[] = [];

      // JIT warm on the smallest tier, discarded.
      {
        const warm = makeEntries(0.2 * 1024 * 1024);
        await runSync(warm);
        await runAsync(warm);
      }

      for (const tierMiB of tiers) {
        const entries = makeEntries(tierMiB * 1024 * 1024);
        const inputBytes = Object.values(entries).reduce((total, chunk) => total + chunk.length, 0);

        const syncRuns = [await runSync(entries), await runSync(entries), await runSync(entries)];
        const asyncFirst = await runAsync(entries);
        const asyncRuns = [asyncFirst, await runAsync(entries), await runAsync(entries)];

        const syncMedianOutput = syncRuns[1]?.output ?? syncRuns[0]!.output;
        const asyncMedianOutput = asyncRuns[2]?.output ?? asyncFirst.output;

        let byteIdentical = syncMedianOutput.length === asyncMedianOutput.length;
        if (byteIdentical) {
          for (let offset = 0; offset < syncMedianOutput.length; offset += 1) {
            if (syncMedianOutput[offset] !== asyncMedianOutput[offset]) {
              byteIdentical = false;
              break;
            }
          }
        }

        rows.push({
          tierMiB,
          inputBytes,
          syncWallMs: median(syncRuns.map((run) => run.wallMs)),
          syncLongestBlockingMs: median(syncRuns.map((run) => run.longestBlockingMs)),
          syncTotalBlockingMs: median(syncRuns.map((run) => run.totalBlockingMs)),
          asyncWallMs: median(asyncRuns.map((run) => run.wallMs)),
          asyncFirstCallMs: asyncFirst.wallMs,
          asyncLongestBlockingMs: median(asyncRuns.map((run) => run.longestBlockingMs)),
          asyncTotalBlockingMs: median(asyncRuns.map((run) => run.totalBlockingMs)),
          syncCompressedBytes: syncMedianOutput.length,
          asyncCompressedBytes: asyncMedianOutput.length,
          byteIdentical
        });
      }

      return {
        rows,
        machine: {
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency
        }
      };
    });

    console.log("\nZIP crossover（同机同浏览器，3 次取中位，level 6，20% 文本 + 80% 噪声，净帧启动 + 窗口重叠归因）：");
    for (const row of rows) {
      console.log(
        `  ${String(row.tierMiB).padStart(5)} MiB 输入 ${(row.inputBytes / 1024 / 1024).toFixed(2)} MiB · ` +
          `sync wall ${row.syncWallMs.toFixed(1).padStart(7)} ms（最长阻塞 ${row.syncLongestBlockingMs.toFixed(1).padStart(6)}）· ` +
          `async wall ${row.asyncWallMs.toFixed(1).padStart(7)} ms（首调 ${row.asyncFirstCallMs.toFixed(1)} ms，最长阻塞 ${row.asyncLongestBlockingMs.toFixed(1).padStart(6)}，合计 ${row.asyncTotalBlockingMs.toFixed(1).padStart(7)}）· ` +
          `压缩后 ${(row.syncCompressedBytes / 1024).toFixed(0)} KiB / ${(row.asyncCompressedBytes / 1024).toFixed(0)} KiB · 字节一致 ${row.byteIdentical}`
      );
    }

    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          // Both fields mean "the code commit that was measured", captured at run
          // time; the commit that adds this generated file is a later evidence
          // commit and can never equal a hash of content that includes itself.
          gitCommit: readGitCommit(),
          measuredCodeCommit: readGitCommit(),
          note:
            "zipSync 与异步 zip 在真实浏览器内的 crossover。每次测量前双 rAF 进入净帧，只归因与该次运行窗口真正重叠的 Long Animation Frame，头条数字为 blockingDuration。" +
            "3 次取中位；JIT 预热档已丢弃。20% JSON 文本 + 80% 伪噪声（PNG 形态），level 6。" +
            "字节一致列是逐字节比对结果——两条路径逻辑内容一致但字节不保证相等。",
          machine,
          buildIdentity,
          rows
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    console.log(`\nZIP crossover 报告已写入 ${REPORT_PATH}`);

    // Measurement sanity only: both paths must have produced real archives on
    // every tier, and every wall/blocking figure must be a real number.
    for (const row of rows) {
      expect(row.syncCompressedBytes).toBeGreaterThan(1000);
      expect(row.asyncCompressedBytes).toBeGreaterThan(1000);
      expect(row.syncWallMs).toBeGreaterThan(0);
      expect(row.asyncWallMs).toBeGreaterThan(0);
      expect(Number.isFinite(row.syncLongestBlockingMs)).toBe(true);
      expect(Number.isFinite(row.asyncLongestBlockingMs)).toBe(true);
    }
    expect(rows.some((row) => row.tierMiB === 2), "2 MiB 阈值档位必须直接测量").toBe(true);
  });
});
