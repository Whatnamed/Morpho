import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertCleanTrackedWorktree,
  gitSourceSha,
  nextArtifactDigest,
  readBuildProvenance,
  worktreeSourceDigest
} from "./build-provenance.mjs";

const projectRoot = process.cwd();
const provenance = await readBuildProvenance(projectRoot);
const sourceSha = gitSourceSha(projectRoot);
if (provenance.sourceSha !== sourceSha) {
  throw new Error(`Served build source SHA ${provenance.sourceSha} does not match HEAD ${sourceSha}. Rebuild first.`);
}
if (provenance.sourceTreeSha256) {
  const sourceTree = await worktreeSourceDigest(projectRoot);
  if (
    sourceTree.digest !== provenance.sourceTreeSha256 ||
    sourceTree.fileCount !== provenance.sourceTreeFileCount
  ) {
    throw new Error("Served build source-tree digest does not match the current working tree. Rebuild first.");
  }
}
const isStrict =
  process.argv.includes("--strict") ||
  process.env.MORPHO_REQUIRE_CLEAN_BUILD === "true";

if (isStrict) {
  if (provenance.isDirty) {
    throw new Error("Served build was created from a dirty tracked worktree. Clean build required for evidence.");
  }
  assertCleanTrackedWorktree(projectRoot);
}
const artifact = await nextArtifactDigest(projectRoot);
if (artifact.digest !== provenance.artifactSha256 || artifact.fileCount !== provenance.artifactFileCount) {
  throw new Error("Served .next artifact does not match its provenance marker. Rebuild first.");
}

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--strict");
const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, "start", ...forwardedArgs], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MORPHO_BUILD_SOURCE_SHA: provenance.sourceSha,
    MORPHO_BUILD_SOURCE_TREE_SHA256: provenance.sourceTreeSha256 ?? "",
    MORPHO_BUILD_ID: provenance.buildId,
    MORPHO_BUILD_ARTIFACT_SHA256: provenance.artifactSha256,
    MORPHO_BUILD_IS_DIRTY: String(Boolean(provenance.isDirty))
  },
  shell: false,
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
