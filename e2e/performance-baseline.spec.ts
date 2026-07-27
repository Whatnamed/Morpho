import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installAgentMock, releaseAgentStream, setAgentResponse } from "./fixtures/agentMock";
import { perfSeedPayload, perfTier, seedPerfTier } from "./fixtures/perfSeed";
import {
  beginPerfPhase,
  endPerfPhase,
  installPerfProbe,
  readProbeSupport,
  type PerfPhaseSamples
} from "./fixtures/perfProbe";
import { textAnswerScript } from "./support/agentSse";

/**
 * Browser half of the phase 4A performance baseline.
 *
 * This spec MEASURES; it does not judge. Following the precedent set by
 * `storage-capacity.spec.ts`, numbers are recorded and only wide sanity bounds are
 * asserted. There is no defensible latency threshold yet — producing one is what this
 * baseline is for — and a flaky perf assertion in CI teaches everyone to ignore red.
 *
 * The three assertions that DO exist all guard against the same failure: reporting a
 * fast number for something that never happened.
 *   - the seed actually wrote (a truncated write would make a huge project load fast),
 *   - the canvas actually mounted (a blank page is very quick),
 *   - the probes actually produced data (an observer that never fired reports zero).
 *
 * Never runs in CI. `quality.yml` runs `--project=chromium`, and the config excludes
 * this file from that project. A perf number from a shared, virtualized runner would
 * be worse than no number, because it would look official.
 */

const REPORT_PATH = resolve(process.cwd(), "docs/operations/performance-browser.generated.json");

const TIER_KEYS = ["objects100", "objects300", "objects500", "compound500"] as const;

/** ~60 moves at ~16 ms is a fast but human-plausible drag. Achieved rate is recorded. */
const DRAG_STEPS = 60;
const DRAG_INTERVAL_MS = 16;
const SELECTION_CLICKS = 20;
const TYPING_TEXT = "把这个方向再往结构化收一收，重点说明它和现有设计定义之间的关系，并给出可以继续展开的角度。";

type PhaseReport = PerfPhaseSamples & { phase: string; extra?: Record<string, number | null> };

const collected: {
  tier: string;
  scale: Record<string, number>;
  serializedUtf16Length: number;
  phases: PhaseReport[];
}[] = [];

function readGitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Waits for the selection toolbar only.
 *
 * Deliberately NOT `fixtures/canvas.ts:selectObject`, which polls `readStoredWorkspace`
 * — that JSON.parses a multi-megabyte string on every attempt. On a 500-object project
 * that single helper would dominate every number in this file.
 */
async function lightweightSelect(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
  await page
    .locator('[aria-label="选中对象工具"]')
    .waitFor({ state: "visible", timeout: 4_000 })
    .catch(() => undefined);
}

async function shapeCentres(page: Page, count: number): Promise<{ x: number; y: number }[]> {
  return page.evaluate((wanted: number) => {
    const centres: { x: number; y: number }[] = [];
    const hosts = Array.from(document.querySelectorAll(".morpho-shape-host"));
    for (const host of hosts) {
      const rect = host.getBoundingClientRect();
      // Only shapes fully on screen; a partially clipped one gives a click point
      // outside the viewport and the interaction silently does nothing.
      if (rect.width > 0 && rect.top > 80 && rect.bottom < window.innerHeight - 80 && rect.right < 960) {
        centres.push({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      }
      if (centres.length >= wanted) {
        break;
      }
    }
    return centres;
  }, count);
}

test.describe("性能基线（记录，不断言阈值）", () => {
  test.describe.configure({ mode: "serial" });

  for (const tierKey of TIER_KEYS) {
    test(`档位 ${tierKey}`, async ({ page }) => {
      test.setTimeout(300_000);
      const tier = perfTier(tierKey);
      const phases: PhaseReport[] = [];

      await installPerfProbe(page);
      await installAgentMock(page);

      // Seed from a cheap route. An addInitScript would re-serialize these megabytes
      // through CDP on the very navigation whose load time is being measured.
      await page.goto("/");
      await seedPerfTier(page, tier);

      // --- phase: first load ---------------------------------------------------
      await page.goto(`/projects/${tier.projectId}`);
      await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(1_500);

      const support = await readProbeSupport(page);
      expect(support.injected, "React DevTools hook never received a renderer").toBeGreaterThan(0);
      expect(support.loaf, "此浏览器不支持 long-animation-frame，基线无法测量阻塞时长").toBe(true);
      expect(support.event, "此浏览器不支持 Event Timing，基线无法测量交互阻塞").toBe(true);

      const loadSamples = await endPerfPhase(page);
      phases.push({
        ...loadSamples,
        phase: "load",
        extra: { firstShapeAtMs: support.firstShapeAtMs }
      });
      expect(support.firstShapeAtMs, "首个 shape 从未出现").not.toBeNull();

      const shapeCount = await page.locator(".morpho-shape-host").count();
      expect(shapeCount, "画布没有挂载任何 shape；快速的空白页不是性能数据").toBeGreaterThan(0);

      // --- phase: continuous selection ----------------------------------------
      const centres = await shapeCentres(page, SELECTION_CLICKS);
      expect(centres.length, "视口内没有可点击的 shape").toBeGreaterThan(0);

      await beginPerfPhase(page);
      for (const centre of centres) {
        await lightweightSelect(page, centre.x, centre.y);
      }
      const selectionSamples = await endPerfPhase(page);
      phases.push({
        ...selectionSamples,
        phase: "selection",
        extra: { clicks: centres.length }
      });

      // --- phase: high-frequency drag -----------------------------------------
      const origin = centres[0] ?? { x: 300, y: 300 };
      await beginPerfPhase(page);
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      for (let step = 1; step <= DRAG_STEPS; step += 1) {
        await page.mouse.move(origin.x + step * 4, origin.y + step * 2);
        await page.waitForTimeout(DRAG_INTERVAL_MS);
      }
      await page.mouse.up();
      await page.waitForTimeout(500);
      const dragSamples = await endPerfPhase(page);
      // `waitForTimeout` is not precise and the app can fall behind the synthetic
      // pointer stream, so the report states the rate actually achieved rather than
      // the rate intended. This comes from the raw pointermove listener, not from
      // Event Timing, which only ever holds events at or above 16 ms.
      phases.push({
        ...dragSamples,
        phase: "drag",
        extra: {
          requestedSteps: DRAG_STEPS,
          requestedIntervalMs: DRAG_INTERVAL_MS,
          achievedPointerRateHz: dragSamples.pointerRateHz === null ? null : Math.round(dragSamples.pointerRateHz)
        }
      });

      // --- phase: continuous typing -------------------------------------------
      const input = page.locator('textarea[placeholder="描述你想继续发展的内容…"]');
      await input.click();
      await beginPerfPhase(page);
      await input.type(TYPING_TEXT, { delay: 30 });
      await page.waitForTimeout(500);
      const typingSamples = await endPerfPhase(page);
      phases.push({
        ...typingSamples,
        phase: "typing",
        extra: { characters: TYPING_TEXT.length }
      });

      // --- phase: agent stream -------------------------------------------------
      // Frames come from the production SSE encoder, so the ~48 ms batcher and the
      // flushSync commit boundary on this path are the real ones.
      // Held after the first frame so the stream is genuinely in flight while the
      // 48 ms batcher runs, rather than completing before the phase window opens.
      await setAgentResponse(page, {
        kind: "stream",
        chunks: textAnswerScript({ text: "已经理解，这里是回应。" }).chunks,
        chunkDelayMs: 20,
        holdAfterChunks: 1
      });
      await beginPerfPhase(page);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_200);
      await releaseAgentStream(page);
      await page.waitForTimeout(2_500);
      const streamSamples = await endPerfPhase(page);
      phases.push({ ...streamSamples, phase: "agentStream" });

      // --- phase: workspace save ----------------------------------------------
      // An edit is required: with nothing dirty there is no debounced write to see,
      // and the phase would record an idle window. Persistence is 400 ms with a
      // 1200 ms max-wait and canvas instances persist at 140 ms, so a two-second
      // window after a nudge contains the write. This is correlation by debounce
      // signature, not direct attribution, and the report says so.
      await beginPerfPhase(page);
      await page.mouse.move(origin.x + 8, origin.y + 8);
      await page.mouse.down();
      await page.mouse.move(origin.x + 40, origin.y + 30);
      await page.mouse.up();
      await page.waitForTimeout(2_000);

      const saveProbe = await page.evaluate((key: string) => {
        const value = window.localStorage.getItem(key);
        if (value === null) {
          return { writeMs: null, readMs: null, length: 0 };
        }
        // Overwrite the SAME key rather than writing a copy. A duplicate would double
        // this project's quota usage — which is how compound500 first hit
        // QuotaExceededError — and an overwrite is what a real save actually does.
        const writeStart = performance.now();
        window.localStorage.setItem(key, value);
        const writeMs = performance.now() - writeStart;
        const readStart = performance.now();
        const readBack = window.localStorage.getItem(key);
        const readMs = performance.now() - readStart;
        return { writeMs, readMs, length: readBack?.length ?? 0 };
      }, tier.workspaceKey);
      const saveSamples = await endPerfPhase(page);
      phases.push({
        ...saveSamples,
        phase: "save",
        extra: {
          localStorageWriteMs: saveProbe.writeMs,
          localStorageReadMs: saveProbe.readMs,
          probedValueLength: saveProbe.length
        }
      });

      // Every phase must have produced data; a silent observer is a failed measurement.
      for (const phase of phases) {
        expect(phase.commitCount + phase.loafCount + phase.frameCount, `阶段 ${phase.phase} 没有采到任何数据`).toBeGreaterThan(0);
      }

      collected.push({
        tier: tierKey,
        scale: tier.scale as unknown as Record<string, number>,
        serializedUtf16Length: tier.workspaceValueLength,
        phases
      });


      console.log(
        `\n[${tierKey}] 对象 ${tier.scale.objects} · 消息 ${tier.scale.messages} · ${tier.workspaceValueLength.toLocaleString("en-US")} 字符`
      );
      for (const phase of phases) {

        console.log(
          `   ${phase.phase.padEnd(12)} commit ${String(phase.commitCount).padStart(4)} · ` +
            `最长阻塞 ${phase.longestBlockingMs.toFixed(1).padStart(7)} ms · 累计阻塞 ${phase.totalBlockingMs.toFixed(1).padStart(8)} ms · ` +
            `慢事件p95 ${phase.slowEventProcessingP95Ms.toFixed(1).padStart(6)} ms`
        );
      }
    });
  }

  test.afterAll(async () => {
    if (collected.length === 0) {
      return;
    }
    const payload = perfSeedPayload();
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          gitCommit: readGitCommit(),
          note:
            "浏览器侧只记录不断言阈值。插桩全部由测试注入，产品代码零改动。" +
            "本档位夹具不含图片二进制（assetId 已剥离），因此不代表图片解码开销。" +
            "save 阶段的写入按去抖签名相关，不是精确归因；localStorageWriteMs 是隔离的同步 I/O 探针。" +
            "slowEvent* 系列只包含 >=16ms 的事件（Event Timing 的 durationThreshold 下限），是尾部而非全部输入；" +
            "输入总量与速率来自原生监听器 pointerMoveCount / keyPressCount / pointerRateHz。",
          fixtureLimitations: [
            "无图片资产：assetId 与 assets 已清空，避免数百次 IndexedDB 未命中污染数据。",
            "网格布局：实例按网格排布，视口内只有一部分；但 syncShapesFromEditor 与 syncWorkspaceToEditor 是 O(全部实例)，不受可见数量限制。",
            "指针速率由 Playwright 合成，快于真人；实际达成速率记录在 achievedPointerRateHz。"
          ],
          tierCount: payload.tiers.length,
          tiers: collected
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log(`\n浏览器性能报告已写入 ${REPORT_PATH}`);
  });
});
