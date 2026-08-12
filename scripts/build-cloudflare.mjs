import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const NEXT_BUILD_DIR = ".next";
const PRESERVED_BUILD_DIR = ".next.morpho-standard-backup";

export async function withPreservedNextBuildDirectory(projectRoot, build) {
  const nextBuildPath = resolve(projectRoot, NEXT_BUILD_DIR);
  const preservedBuildPath = resolve(projectRoot, PRESERVED_BUILD_DIR);
  if (existsSync(preservedBuildPath)) {
    throw new Error(
      `${PRESERVED_BUILD_DIR} already exists. Restore or remove that interrupted-build backup before retrying.`
    );
  }

  const hadStandardBuild = existsSync(nextBuildPath);
  if (hadStandardBuild) renameSync(nextBuildPath, preservedBuildPath);

  try {
    await build();
  } finally {
    rmSync(nextBuildPath, { recursive: true, force: true });
    if (hadStandardBuild) renameSync(preservedBuildPath, nextBuildPath);
  }
}

async function main() {
  const projectRoot = process.cwd();
  const environment = {
    ...process.env,
    NEXT_PRIVATE_STANDALONE: "true"
  };

  await withPreservedNextBuildDirectory(projectRoot, () => {
    run(resolve("node_modules", "next", "dist", "bin", "next"), ["build", "--webpack"], environment);
    run(
      resolve("node_modules", "@opennextjs", "cloudflare", "dist", "cli", "index.js"),
      ["build", "--skipNextBuild"],
      environment
    );
  });
}

function run(script, args, environment) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${script} exited with status ${result.status ?? 1}.`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = typeof error?.exitCode === "number" ? error.exitCode : 1;
  });
}
