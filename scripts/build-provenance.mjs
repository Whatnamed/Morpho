import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export const NEXT_BUILD_DIR = ".next";
export const PROVENANCE_FILE = "morpho-build-provenance.json";

export function gitSourceSha(projectRoot = process.cwd()) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim();
}

export function isTrackedWorktreeClean(projectRoot = process.cwd()) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim();
  return status.length === 0;
}

export function assertCleanTrackedWorktree(projectRoot = process.cwd()) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: projectRoot,
    encoding: "utf8"
  }).trim();
  if (status) {
    throw new Error(`Build provenance requires a clean tracked worktree:\n${status}`);
  }
}

export async function sha256File(filePath) {
  return sha256Bytes(await readFile(filePath));
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, absolute));
    } else if (entry.isFile() && relative(root, absolute) !== PROVENANCE_FILE) {
      files.push(absolute);
    }
  }
  return files;
}

export async function nextArtifactDigest(projectRoot = process.cwd()) {
  const root = resolve(projectRoot, NEXT_BUILD_DIR);
  const files = (await listFiles(root)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const relativePath = relative(root, file).replaceAll("\\", "/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return { digest: hash.digest("hex"), fileCount: files.length };
}

export async function writeBuildProvenance(input, projectRoot = process.cwd()) {
  const markerPath = resolve(projectRoot, NEXT_BUILD_DIR, PROVENANCE_FILE);
  await writeFile(markerPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  return markerPath;
}

export async function readBuildProvenance(projectRoot = process.cwd()) {
  const markerPath = resolve(projectRoot, NEXT_BUILD_DIR, PROVENANCE_FILE);
  return JSON.parse(await readFile(markerPath, "utf8"));
}
