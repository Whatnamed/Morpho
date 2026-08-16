import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * ZIP sync/async crossover measurement for the Phase 5 hybrid decision.
 *
 * The archive export path must pick between fflate `zipSync` (blocks the main
 * thread for the whole compression) and the async `zip` (compresses in Workers
 * but pays a per-call main-thread handoff that showed up as an ~85 ms frame on
 * the small editable-backup bundle). This spec measures both paths on the same
 * deterministic bundles in a real browser and records wall time, long-frame
 * blocking, input/compressed bytes — and whether the two paths produce
 * byte-identical archives.
 *
 * Records, never asserts thresholds. Runs under the perf5 project only.
 */

const FFLATE_BROWSER_ESM = resolve(process.cwd(), "node_modules/fflate/esm/browser.js");

type CrossoverRow = {
  tierMiB: number;
  inputBytes: number;
  syncWallMs: number;
  asyncWallMs: number;
  asyncFirstCallMs: number;
  asyncLongestFrameMs: number;
  asyncTotalFrameMs: number;
  syncCompressedBytes: number;
  asyncCompressedBytes: number;
  byteIdentical: boolean;
};

test.describe("ZIP 同步/异步 crossover（记录，不断言阈值）", () => {
  test("zipSync vs async zip across bundle sizes", async ({ page }) => {
    test.setTimeout(180_000);
    const fflateSource = readFileSync(FFLATE_BROWSER_ESM, "utf8");
    await page.route("**/__perf_fflate.mjs", (route) =>
      route.fulfill({ contentType: "text/javascript", body: fflateSource })
    );

    await page.goto("/");
    const rows = await page.evaluate(async (): Promise<CrossoverRow[]> => {
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
        let remainingText = textBytes;
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

      const runSync = (entries: Record<string, Uint8Array>): { wallMs: number; output: Uint8Array } => {
        const started = performance.now();
        const output = zipSync(entries, { level: 6 });
        return { wallMs: performance.now() - started, output };
      };

      const runAsync = (entries: Record<string, Uint8Array>): Promise<{ wallMs: number; output: Uint8Array; frames: { duration: number; start: number }[] }> => {
        const frames: { duration: number; start: number }[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            frames.push({ duration: entry.duration, start: entry.startTime });
          }
        });
        observer.observe({ type: "long-animation-frame" } as PerformanceObserverInit);
        const started = performance.now();
        return new Promise((resolve, reject) => {
          zip(entries, { level: 6 }, (error: Error | null, data: Uint8Array) => {
            const wallMs = performance.now() - started;
            observer.disconnect();
            if (error) {
              reject(error);
              return;
            }
            // Give the observer a moment to deliver buffered entries.
            setTimeout(() => resolve({ wallMs, output: data, frames }), 30);
          });
        });
      };

      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? 0;
      };

      const tiers = [0.2, 1, 4, 8, 16];
      const rows: CrossoverRow[] = [];

      // JIT warm on the smallest tier, discarded.
      {
        const warm = makeEntries(0.2 * 1024 * 1024);
        runSync(warm);
        await runAsync(warm);
      }

      for (const tierMiB of tiers) {
        const entries = makeEntries(tierMiB * 1024 * 1024);
        const inputBytes = Object.values(entries).reduce((total, chunk) => total + chunk.length, 0);

        const syncRuns = [runSync(entries), runSync(entries), runSync(entries)];
        const asyncFirst = await runAsync(entries);
        const asyncRuns = [asyncFirst, await runAsync(entries), await runAsync(entries)];

        const sync = syncRuns[1] ?? syncRuns[0]!;
        const asyncMedianOutput = asyncRuns[2]?.output ?? asyncFirst.output;
        const windowStart = Math.min(...asyncRuns.flatMap((run) => run.frames.map((frame) => frame.start)), Infinity);
        const frameDurations = asyncRuns.flatMap((run) => run.frames.filter((frame) => frame.start >= windowStart - 50).map((frame) => frame.duration));

        let byteIdentical = sync.output.length === asyncMedianOutput.length;
        if (byteIdentical) {
          for (let offset = 0; offset < sync.output.length; offset += 1) {
            if (sync.output[offset] !== asyncMedianOutput[offset]) {
              byteIdentical = false;
              break;
            }
          }
        }

        rows.push({
          tierMiB,
          inputBytes,
          syncWallMs: median(syncRuns.map((run) => run.wallMs)),
          asyncWallMs: median(asyncRuns.map((run) => run.wallMs)),
          asyncFirstCallMs: asyncFirst.wallMs,
          asyncLongestFrameMs: frameDurations.length === 0 ? 0 : Math.max(...frameDurations),
          asyncTotalFrameMs: frameDurations.reduce((total, duration) => total + duration, 0),
          syncCompressedBytes: sync.output.length,
          asyncCompressedBytes: asyncMedianOutput.length,
          byteIdentical
        });
      }

      return rows;
    });

    console.log("\nZIP crossover（同机同浏览器，3 次取中位，level 6，20% 文本 + 80% 噪声）：");
    for (const row of rows) {
      console.log(
        `  ${String(row.tierMiB).padStart(5)} MiB 输入 ${(row.inputBytes / 1024 / 1024).toFixed(2)} MiB · ` +
          `zipSync wall ${row.syncWallMs.toFixed(1).padStart(7)} ms · ` +
          `async wall ${row.asyncWallMs.toFixed(1).padStart(7)} ms（首调 ${row.asyncFirstCallMs.toFixed(1)} ms）· ` +
          `async 最长帧 ${row.asyncLongestFrameMs.toFixed(1).padStart(6)} ms · 帧合计 ${row.asyncTotalFrameMs.toFixed(1).padStart(7)} ms · ` +
          `压缩后 ${(row.syncCompressedBytes / 1024).toFixed(0)} KiB / ${(row.asyncCompressedBytes / 1024).toFixed(0)} KiB · 字节一致 ${row.byteIdentical}`
      );
    }
    // Measurement sanity only: both paths must have produced real archives.
    for (const row of rows) {
      expect(row.syncCompressedBytes).toBeGreaterThan(1000);
      expect(row.asyncCompressedBytes).toBeGreaterThan(1000);
      expect(row.syncWallMs).toBeGreaterThan(0);
      expect(row.asyncWallMs).toBeGreaterThan(0);
    }
  });
});
