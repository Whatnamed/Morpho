import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  nextArtifactDigest,
  readBuildProvenance
} from "./build-provenance.mjs";

const projectRoot = process.cwd();

// 1. Strict clean worktree validation at measurement start
assertCleanTrackedWorktree(projectRoot);

// 2. Validate served build provenance
const provenance = await readBuildProvenance(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
if (provenance.sourceSha !== sourceSha) {
  throw new Error(`Served build source SHA ${provenance.sourceSha} does not match current HEAD ${sourceSha}. Rebuild with npm run build:evidence first.`);
}
if (provenance.isDirty) {
  throw new Error("Served build was created from a dirty tracked worktree. Rebuild with npm run build:evidence on a clean commit.");
}

const artifact = await nextArtifactDigest(projectRoot);
if (artifact.digest !== provenance.artifactSha256 || artifact.fileCount !== provenance.artifactFileCount) {
  throw new Error("Served .next artifact does not match its provenance marker. Rebuild with npm run build:evidence first.");
}

// 3. Launch Playwright with strict evidence environment
const forwardedArgs = process.argv.slice(2);
const playwrightBin = resolve(
  projectRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

const result = spawnSync(
  process.execPath,
  [
    playwrightBin,
    "test",
    "--project=perf5",
    "--workers=1",
    "--retries=0",
    ...forwardedArgs
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      MORPHO_REQUIRE_CLEAN_BUILD: "true",
      MORPHO_EXPECTED_BUILD_SOURCE_SHA: sourceSha,
      MORPHO_E2E_BUILD_PROVENANCE: "true"
    },
    shell: false,
    stdio: "inherit"
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
