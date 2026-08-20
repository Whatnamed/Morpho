import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { FullConfig } from "@playwright/test";
import { createServer } from "vite";

export const SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/seed.json");
export const PERF_SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/perf-seed.json");
export const PHASE5_SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/phase5-seed.json");

/**
 * Builds the acceptance seed through Vite so it comes from the real domain code.
 * Playwright's own loader cannot resolve the bare JSON imports the case-study
 * fixture uses, so the seed is materialized here once per run and read back as
 * plain JSON by the specs.
 *
 * The performance seeds are built the same way but written separately, because they
 * are several megabytes and only the perf projects read them. Both land in
 * `e2e/.seed/`, which is gitignored.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (process.env.MORPHO_EXPECTED_BUILD_SOURCE_SHA && process.env.MORPHO_EXPECTED_BUILD_SOURCE_SHA !== sourceSha) {
    throw new Error(`Expected build source SHA ${process.env.MORPHO_EXPECTED_BUILD_SOURCE_SHA} does not match HEAD ${sourceSha}.`);
  }
  const projectNames = config.projects.map((project) => project.name);
  const needsPerfSeed = projectNames.includes("perf");
  const needsPhase5Seed = projectNames.includes("perf5");

  if (process.env.MORPHO_REQUIRE_CLEAN_BUILD === "true") {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
    if (status) {
      throw new Error(`Performance evidence requires a clean tracked worktree at measurement time:\n${status}`);
    }
  }

  const server = await createServer({
    appType: "custom",
    configFile: resolve(process.cwd(), "vitest.config.ts"),
    server: { middlewareMode: true }
  });

  try {
    const seedModule = await server.ssrLoadModule("/e2e/support/seedWorkspace.ts");
    const payload = (seedModule as { buildSeedPayload: () => unknown }).buildSeedPayload();
    await mkdir(dirname(SEED_PAYLOAD_PATH), { recursive: true });
    await writeFile(SEED_PAYLOAD_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    // Skipped unless the perf project is running: building four scaled workspaces
    // costs several seconds and the acceptance suite never reads the result.
    if (needsPerfSeed) {
      const perfModule = await server.ssrLoadModule("/e2e/support/perfSeedWorkspace.ts");
      const perfPayload = (perfModule as { buildPerfSeedPayload: () => unknown }).buildPerfSeedPayload();
      await writeFile(PERF_SEED_PAYLOAD_PATH, `${JSON.stringify(perfPayload)}\n`, "utf8");
    }

    // Phase 5 interaction atlas: project tiers plus the synthetic asset manifest.
    if (needsPhase5Seed) {
      const phase5Module = await server.ssrLoadModule("/e2e/support/phase5SeedWorkspace.ts");
      const phase5Payload = (phase5Module as { buildPhase5SeedPayload: () => unknown }).buildPhase5SeedPayload();
      await writeFile(PHASE5_SEED_PAYLOAD_PATH, `${JSON.stringify(phase5Payload)}\n`, "utf8");
    }
  } finally {
    await server.close();
  }
}
