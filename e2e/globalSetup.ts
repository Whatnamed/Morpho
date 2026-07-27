import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { createServer } from "vite";

export const SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/seed.json");
export const PERF_SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/perf-seed.json");

/**
 * Builds the acceptance seed through Vite so it comes from the real domain code.
 * Playwright's own loader cannot resolve the bare JSON imports the case-study
 * fixture uses, so the seed is materialized here once per run and read back as
 * plain JSON by the specs.
 *
 * The performance seed is built the same way but written separately, because it is
 * several megabytes and only the `perf` project reads it. Both land in `e2e/.seed/`,
 * which is gitignored.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // `--project=perf` filters config.projects, so this is how the setup knows whether
  // the several-second, several-megabyte perf seed is worth building. No env var and
  // no extra dependency to set one on Windows.
  const needsPerfSeed = config.projects.some((project) => project.name === "perf");

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
  } finally {
    await server.close();
  }
}
