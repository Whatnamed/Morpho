import { createServer } from "vite";
import { resolve } from "node:path";

const backupPath = process.argv[2];

if (!backupPath) {
  console.error("Usage: npm run case-study:import -- <editable-backup.zip>");
  process.exitCode = 1;
} else {
  const projectRoot = process.cwd();
  const server = await createServer({
    appType: "custom",
    configFile: resolve(projectRoot, "vitest.config.ts"),
    server: { middlewareMode: true }
  });

  try {
    const importer = await server.ssrLoadModule("/src/domain/morpho/caseStudy/importCaseStudyBackup.ts");
    const report = await importer.importCurrentCaseStudyBackup({
      backupPath: resolve(projectRoot, backupPath),
      projectRoot
    });
    console.log(
      JSON.stringify(
        {
          caseStudyVersion: report.caseStudyVersion,
          project: report.project,
          objectTypes: report.objectTypes,
          chat: report.chat,
          assetCount: report.assetCount,
          embeddedAssetCount: report.embeddedAssetCount,
          missingAssetCount: report.missingAssetCount,
          referenceOnlyAssetCount: report.referenceOnlyAssetCount,
          resourceBytes: report.resourceBytes,
          cleanedCategories: report.cleanedCategories
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Case study import failed.";
    const diagnostics =
      error && typeof error === "object" && "diagnostics" in error && Array.isArray(error.diagnostics)
        ? error.diagnostics
        : [];
    console.error(JSON.stringify({ message, diagnostics }, null, 2));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}
