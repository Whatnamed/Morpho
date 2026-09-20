import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  isTrackedWorktreeClean,
  nextArtifactDigest,
  readBuildProvenance,
  worktreeSourceDigest
} from "./build-provenance.mjs";

const projectRoot = process.cwd();
const allowDirtyExact = process.argv.includes("--allow-dirty-exact");

// 1. Strict clean worktree validation at measurement start
if (!allowDirtyExact) {
  assertCleanTrackedWorktree(projectRoot);
}

// 2. Validate served build provenance
const provenance = await readBuildProvenance(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
if (provenance.sourceSha !== sourceSha) {
  throw new Error(`Served build source SHA ${provenance.sourceSha} does not match current HEAD ${sourceSha}. Rebuild with npm run build:evidence first.`);
}
if (provenance.isDirty && !allowDirtyExact) {
  throw new Error("Served build was created from a dirty tracked worktree. Rebuild with npm run build:evidence on a clean commit.");
}
const isDirty = !isTrackedWorktreeClean(projectRoot);
if (Boolean(provenance.isDirty) !== isDirty) {
  throw new Error("Served build dirty-state does not match the current tracked working tree. Rebuild first.");
}
const sourceTree = await worktreeSourceDigest(projectRoot);
if (
  provenance.sourceTreeSha256 !== sourceTree.digest ||
  provenance.sourceTreeFileCount !== sourceTree.fileCount
) {
  throw new Error("Served build source-tree digest does not match the current working tree. Rebuild first.");
}

const artifact = await nextArtifactDigest(projectRoot);
if (artifact.digest !== provenance.artifactSha256 || artifact.fileCount !== provenance.artifactFileCount) {
  throw new Error("Served .next artifact does not match its provenance marker. Rebuild with npm run build:evidence first.");
}

// 3. Launch Playwright with strict evidence environment
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--allow-dirty-exact");
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
      MORPHO_REQUIRE_CLEAN_BUILD: allowDirtyExact ? "false" : "true",
      MORPHO_EXPECTED_BUILD_SOURCE_SHA: sourceSha,
      MORPHO_EXPECTED_BUILD_SOURCE_TREE_SHA256: sourceTree.digest,
      MORPHO_EXPECTED_BUILD_IS_DIRTY: String(isDirty),
      MORPHO_E2E_BUILD_PROVENANCE: "true"
    },
    shell: false,
    stdio: "inherit"
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
