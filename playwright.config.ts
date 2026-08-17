import { defineConfig, devices } from "@playwright/test";

/**
 * Browser acceptance for Morpho.
 *
 * Scope is deliberately narrow: the paths where a regression silently destroys or
 * misrepresents project state. Provider calls are always intercepted — no test in
 * this suite may reach a paid model or image endpoint.
 *
 * The suite runs a production server on its own port so it never collides with, or
 * inherits the session of, a developer's `npm run dev` — Next refuses a second dev
 * server in the same directory anyway. Run `npm run build` first, or use
 * `npm run test:e2e:build`. `MORPHO_AUTH_REQUIRED` is off because these tests
 * exercise local-first project state, not access control.
 */

const port = Number(process.env.MORPHO_E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.ts",
  outputDir: "./e2e/.artifacts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "off",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      // The performance baselines are measurement, not acceptance. They never run in
      // CI: a perf number from a shared, virtualized runner would be worse than no
      // number because it would look official.
      testIgnore: /performance-baseline\.spec\.ts|performance-phase5\.spec\.ts|performance-zip-crossover\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Wide enough that the selection toolbar has somewhere to go without
        // colliding with the AI panel, which is what a design workstation looks like.
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      // Run via `npm run measure:perf:browser`, which pins --workers=1 (a measurement
      // must not share the CPU with a parallel worker) and --retries=0 (a retried
      // measurement is a different measurement).
      name: "perf",
      testMatch: /performance-baseline\.spec\.ts/,
      timeout: 300_000,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      // Phase 5 real-interaction latency atlas + zip crossover. Run via
      // `npm run measure:perf5:browser`, also pinned to --workers=1 --retries=0.
      name: "perf5",
      testMatch: /performance-phase5\.spec\.ts|performance-zip-crossover\.spec\.ts/,
      timeout: 600_000,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    }
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      MORPHO_AUTH_REQUIRED: "false",
      // Present but unusable: the suite intercepts every provider request, so a
      // real key must never be required for the app to boot.
      MORPHO_AI_API_KEY: "",
      MORPHO_GRS_API_KEY: "",
      MORPHO_ALLOW_PAID_SMOKE_TESTS: "false",
      MORPHO_E2E_BUILD_PROVENANCE: "true",
      MORPHO_REQUIRE_CLEAN_BUILD: "true"
    }
  }
});
