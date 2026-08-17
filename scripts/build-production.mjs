import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  nextArtifactDigest,
  writeBuildProvenance
} from "./build-provenance.mjs";

const projectRoot = process.cwd();
assertCleanTrackedWorktree(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
const environment = {
  ...process.env,
  MORPHO_BUILD_SOURCE_SHA: sourceSha
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
  nodeVersion: process.version,
  builtAt: new Date().toISOString()
}, projectRoot);
