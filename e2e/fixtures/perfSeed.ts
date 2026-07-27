import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import type { PerfSeedPayload, PerfSeedTier } from "../support/perfSeedWorkspace";

const PERF_SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/perf-seed.json");

let cached: PerfSeedPayload | undefined;

/** Written by `e2e/globalSetup.ts` when MORPHO_E2E_PERF_SEED=1. */
export function perfSeedPayload(): PerfSeedPayload {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(PERF_SEED_PAYLOAD_PATH, "utf8")) as PerfSeedPayload;
    } catch {
      throw new Error(
        `找不到 ${PERF_SEED_PAYLOAD_PATH}。种子只在 perf project 被选中时生成；` +
          `请用 npm run measure:perf:browser 运行，而不是直接调用 playwright test。`
      );
    }
  }
  return cached;
}

export function perfTier(key: string): PerfSeedTier {
  const tier = perfSeedPayload().tiers.find((candidate) => candidate.key === key);
  if (!tier) {
    throw new Error(`性能种子中没有档位 ${key}。`);
  }
  return tier;
}

/**
 * Writes a tier into localStorage from a cheap route, then verifies the write landed.
 *
 * Deliberately `page.evaluate` on an already-loaded page rather than `addInitScript`:
 * an init script re-serializes its multi-megabyte argument through CDP on every
 * navigation, including the very navigation whose load time is being measured. Seeding
 * on a cheap route first and navigating afterwards keeps that cost out of the number.
 *
 * The verification is not ceremony. These payloads run to several megabytes against a
 * quota around 9.95 MiB; a silently truncated or rejected write would produce a fast,
 * confident, meaningless load measurement.
 */
export async function seedPerfTier(page: Page, tier: PerfSeedTier): Promise<void> {
  const payload = perfSeedPayload();
  const written = await page.evaluate(
    (input: { catalogKey: string; catalogValue: string; workspaceKey: string; workspaceValue: string }) => {
      try {
        window.localStorage.clear();
        window.localStorage.setItem(input.catalogKey, input.catalogValue);
        window.localStorage.setItem(input.workspaceKey, input.workspaceValue);
      } catch (error) {
        return { ok: false, length: 0, reason: String(error) };
      }
      const readBack = window.localStorage.getItem(input.workspaceKey);
      return { ok: readBack !== null, length: readBack?.length ?? 0, reason: "" };
    },
    {
      catalogKey: payload.catalogKey,
      catalogValue: tier.catalogValue,
      workspaceKey: tier.workspaceKey,
      workspaceValue: tier.workspaceValue
    }
  );

  if (!written.ok || written.length !== tier.workspaceValueLength) {
    throw new Error(
      `档位 ${tier.key} 的种子未完整写入：期望 ${tier.workspaceValueLength} 字符，实际 ${written.length}。` +
        (written.reason ? ` 原因：${written.reason}` : "")
    );
  }
}
