import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: "string", default: "scripts/agent-lab/baseline.json" },
    task: { type: "string", default: "scripts/agent-lab/selected-source.json" },
    server: { type: "string" },
    "storage-state": { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});
const [mode = "scripted"] = positionals;
if (values.help || positionals.length > 1 || !["scripted", "preview", "live"].includes(mode) ||
  (mode === "live" ? !values.server || !values["storage-state"] : values.server || values["storage-state"])) {
  console.log("npm run agent:lab -- [scripted|preview|live] [--profile file.json] [--task file.json]");
  console.log("live requires --server http://127.0.0.1:3000 --storage-state file.json");
  process.exit(values.help ? 0 : 2);
}

const environment = { ...process.env, MORPHO_AGENT_LAB_RUN: JSON.stringify({ mode, ...values }) };
if (mode !== "live") {
  const { combinedEnv } = nextEnv.loadEnvConfig(process.cwd(), true);
  for (const key of [
    "MORPHO_AI_MODEL", "AIJWS_MODEL", "MORPHO_AI_REASONING_EFFORT",
    "MORPHO_AI_SUPPORTS_PROMPT_CACHE_KEY", "MORPHO_AI_SUPPORTS_PROMPT_CACHE_RETENTION",
    "MORPHO_AI_PROMPT_CACHE_KEY_ENABLED", "MORPHO_AI_PROMPT_CACHE_RETENTION"
  ]) {
    if (combinedEnv[key] !== undefined) environment[key] = combinedEnv[key];
  }
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "scripts/agent-lab/vitest.config.ts"], {
  stdio: "inherit",
  env: environment
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
