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

/**
 * Hashes the exact tracked + untracked, non-ignored source tree that a local
 * build can read. Local evidence output is excluded because it is produced by
 * measurement and is never a build input.
 */
export async function worktreeSourceDigest(projectRoot = process.cwd()) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: projectRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
  );
  const files = listed
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !path.startsWith("output/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path);
    hash.update("\0");
    try {
      hash.update(await readFile(resolve(projectRoot, path)));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        hash.update("<deleted>");
      } else {
        throw error;
      }
    }
    hash.update("\0");
  }
  return { digest: hash.digest("hex"), fileCount: files.length };
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
