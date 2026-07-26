import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

export const SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/seed.json");

/**
 * Builds the acceptance seed through Vite so it comes from the real domain code.
 * Playwright's own loader cannot resolve the bare JSON imports the case-study
 * fixture uses, so the seed is materialized here once per run and read back as
 * plain JSON by the specs.
 */
export default async function globalSetup(): Promise<void> {
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
  } finally {
    await server.close();
  }
}
