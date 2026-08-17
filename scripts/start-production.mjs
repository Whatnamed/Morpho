import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  nextArtifactDigest,
  readBuildProvenance
} from "./build-provenance.mjs";

const projectRoot = process.cwd();
const provenance = await readBuildProvenance(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
if (provenance.sourceSha !== sourceSha) {
  throw new Error(`Served build source SHA ${provenance.sourceSha} does not match HEAD ${sourceSha}. Rebuild first.`);
}
if (process.env.MORPHO_REQUIRE_CLEAN_BUILD === "true") {
  assertCleanTrackedWorktree(projectRoot);
}
const artifact = await nextArtifactDigest(projectRoot);
if (artifact.digest !== provenance.artifactSha256 || artifact.fileCount !== provenance.artifactFileCount) {
  throw new Error("Served .next artifact does not match its provenance marker. Rebuild first.");
}

const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MORPHO_BUILD_SOURCE_SHA: provenance.sourceSha,
    MORPHO_BUILD_ID: provenance.buildId,
    MORPHO_BUILD_ARTIFACT_SHA256: provenance.artifactSha256
  },
  shell: false,
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
