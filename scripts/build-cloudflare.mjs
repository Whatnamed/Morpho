import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const environment = {
  ...process.env,
  NEXT_PRIVATE_STANDALONE: "true"
};

run(resolve("node_modules", "next", "dist", "bin", "next"), ["build", "--webpack"]);
run(resolve("node_modules", "@opennextjs", "cloudflare", "dist", "cli", "index.js"), ["build", "--skipNextBuild"]);

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
