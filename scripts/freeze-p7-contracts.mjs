import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
// Explicit local freeze, never automatically rewrite the oracle after a run.
if (!process.argv.includes("--freeze")) throw new Error("Use --freeze only when intentionally versioning the pre-run P7 contract.");
const files = [
  "e2e/eval/contracts.ts", "e2e/eval/kitchen-materials.json", "e2e/support/p7Seed.ts",
  "src/domain/morpho/caseStudy/currentCaseWorkspace.generated.json", "src/domain/morpho/caseStudy/currentCaseAssets.generated.json"
];
writeFileSync("e2e/eval/contract-lock.json", `${JSON.stringify({ version: "p7-trajectories-1", encoding: "utf8-LF", files: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).digest("hex")])) }, null, 2)}\n`);
