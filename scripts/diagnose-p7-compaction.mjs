import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const server = await createServer({ appType: "custom", configFile: resolve("vitest.config.ts"), server: { middlewareMode: true } });
try {
  const diagnosisModule = await server.ssrLoadModule("/e2e/support/p7CompactionDiagnosis.ts");
  const evidence = diagnosisModule.diagnoseP7Compaction();
  await mkdir("output/playwright/p7-diagnosis", { recursive: true });
  await writeFile("output/playwright/p7-diagnosis/compaction-base.json", `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.immutableWorkspace || !evidence.currentRevisionExists || evidence.boundaryWouldMatch) throw new Error("The recorded baseline divergence did not reproduce.");
} finally { await server.close(); }
