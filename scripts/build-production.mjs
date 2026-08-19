import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  isTrackedWorktreeClean,
  nextArtifactDigest,
  writeBuildProvenance
} from "./build-provenance.mjs";

const projectRoot = process.cwd();
const isStrict =
  process.argv.includes("--strict") ||
  process.env.MORPHO_STRICT_PROVENANCE === "true" ||
  process.env.MORPHO_REQUIRE_CLEAN_BUILD === "true";

if (isStrict) {
  assertCleanTrackedWorktree(projectRoot);
}

const isDirty = !isTrackedWorktreeClean(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
const environment = {
  ...process.env,
  MORPHO_BUILD_SOURCE_SHA: sourceSha,
  MORPHO_BUILD_IS_DIRTY: String(isDirty)
};
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: projectRoot,
  env: environment,
  shell: false,
  stdio: "inherit"
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const artifact = await nextArtifactDigest(projectRoot);
await writeBuildProvenance({
  schemaVersion: 1,
  sourceSha,
  buildId: (await readFile(resolve(projectRoot, ".next", "BUILD_ID"), "utf8")).trim(),
  artifactSha256: artifact.digest,
  artifactFileCount: artifact.fileCount,
  isDirty,
  nodeVersion: process.version,
  builtAt: new Date().toISOString()
}, projectRoot);
