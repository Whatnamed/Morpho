import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const projectRoot = process.cwd();
const generatedRoot = resolve(projectRoot, "src/domain/morpho/caseStudy");
const workspacePath = resolve(generatedRoot, "currentCaseWorkspace.generated.json");
const diagnosticsPath = resolve(generatedRoot, "currentCaseDiagnostics.generated.json");
const server = await createServer({
  appType: "custom",
  configFile: resolve(projectRoot, "vitest.config.ts"),
  server: { middlewareMode: true }
});

try {
  const currentCase = await server.ssrLoadModule("/src/domain/morpho/caseStudy/currentCaseStudy.ts");
  const workspace = currentCase.currentCaseStudyWorkspace;
  const diagnostics = JSON.parse(await readFile(diagnosticsPath, "utf8"));
  const memoryDocuments = Object.values(workspace.projectMemory.documents).filter((document) => document.currentRevisionId);
  const stageRecords = Object.values(workspace.projectMemory.stageRecords).filter((record) => record.currentRevisionId);

  diagnostics.project.workspaceSchemaVersion = workspace.schemaVersion;
  diagnostics.workspaceFingerprint = currentCase.CURRENT_CASE_STUDY_FINGERPRINT;
  diagnostics.chat.summaryRevisionCount = Object.keys(workspace.ai.conversationSummaryRevisions).length;
  diagnostics.projectMemory = {
    currentDocumentCount: memoryDocuments.length,
    currentStageRecordCount: stageRecords.length,
    revisionCount: Object.keys(workspace.projectMemory.revisions).length,
    stageRevisionCount: Object.keys(workspace.projectMemory.stageRevisions).length
  };

  await Promise.all([
    writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8"),
    writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8")
  ]);
  console.log(JSON.stringify({ schemaVersion: workspace.schemaVersion, projectMemory: diagnostics.projectMemory }, null, 2));
} finally {
  await server.close();
}
