import { createBlankWorkspace, createTestWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "@/domain/operations/operations";
import { importTextObject } from "@/domain/morpho/imports";
import { ensureStageRegions } from "@/domain/morpho/stageRegions";
import { CATALOG_STORAGE_KEY, createCatalog, getProjectWorkspaceStorageKey, summarizeProject } from "@/infrastructure/persistence/localProjectStore";

export function buildInteractionSeed() {
  let workspace = createBlankWorkspace("project-p6i-browser");
  const imported = importTextObject(workspace, { text: "P6I ordinary editable note", position: { x: 560, y: 170 } }); workspace = imported.workspace;
  const noteId = imported.objectIds[0];
  workspace.objects.research = { id: "research", incarnationId: "p6i-research", type: "research", title: "P6I research", summary: "候选研究", findings: ["候选一", "候选二", "候选三", "候选四", "候选五", "候选六", "候选七", "此前保留第八条"], opportunities: [], constraints: [], openQuestions: [], evidence: [], createdBy: "ai", visibility: "active" };
  workspace.canvas.instances.push({ id: "canvas-research", objectId: "research", position: { x: 180, y: 180 }, size: { w: 280, h: 160 } });
  const proposed = recordDesignDefinitionProposal(workspace, { proposalId: "p6i-proposal", title: "P6I pending proposal", summary: "未应用草案", projectGoal: "goal", targetUsers: [], primaryScenarios: [], coreProblem: "problem", designPrinciples: [], constraints: [], avoidDirections: [], opportunities: [], openQuestions: [], sourceObjectIds: [], citations: [], position: { x: 560, y: 470 } }); workspace = proposed.workspace;
  const fileId = "p6i-file";
  workspace.objects[fileId] = { id: fileId, incarnationId: "p6i-file-id", type: "file", title: "P6I readable document", summary: "文档阅读", fileKind: "document", fileName: "p6i.txt", sourceLabel: "本地测试", assetId: "p6i-original", extractedAssetId: "p6i-extract", extractedCharCount: 24, parseStatus: "parsed", visibility: "active", createdBy: "user" };
  for (const [id, sourceType] of [["p6i-original", "originalFile"], ["p6i-extract", "documentExtract"]] as const) workspace.assets[id] = { id, fileName: "p6i.txt", mimeType: "text/plain", size: 24, storageKey: id, sourceType, createdAt: "2026-10-03T00:00:00.000Z" };
  workspace.canvas.instances.push({ id: "canvas-file", objectId: fileId, position: { x: 180, y: 480 }, size: { w: 240, h: 170 } });
  workspace.relations.push({ id: "p6i-source", fromObjectId: noteId, toObjectId: "research", kind: "source", note: "P6I direct source" });
  workspace = ensureStageRegions(workspace);
  workspace.canvas.stageRegions = workspace.canvas.stageRegions?.map((region) => region.key === "research" ? { ...region, x: 110, y: 110, w: 770, h: 590 } : region);
  workspace.canvas.view = workspace.ui.canvasView = { x: 0, y: 0, zoom: 1 };
  const core = serializeWorkspace(workspace);
  // History reading uses immutable revisions of an existing Definition fixture.
  const historyWorkspace = createBlankWorkspace(workspace.project.id);
  const initial = createTestWorkspace(); const definition = initial.objects["definition-current"];
  if (definition?.type !== "designDefinition") throw new Error("Definition fixture changed");
  const revision = initial.designDefinitionRevisions[definition.currentRevisionId];
  historyWorkspace.objects[definition.id] = { ...definition, revisionIds: ["p6i-history-r1", "p6i-history-r2"], currentRevisionId: "p6i-history-r2" };
  historyWorkspace.designDefinitionRevisions["p6i-history-r1"] = { ...revision, id: "p6i-history-r1", sourceObjectIds: [], citationIds: [], revisionNumber: 1, isCurrent: false, projectGoal: "P6I historical goal body", summary: "P6I historical summary" };
  historyWorkspace.designDefinitionRevisions["p6i-history-r2"] = { ...revision, id: "p6i-history-r2", sourceObjectIds: [], citationIds: [], revisionNumber: 2, isCurrent: true, projectGoal: "P6I current goal" };
  historyWorkspace.canvas.instances = [{ id: "canvas-history-definition", objectId: definition.id, position: { x: 180, y: 180 }, size: { w: 340, h: 230 } }];
  historyWorkspace.canvas.view = historyWorkspace.ui.canvasView = { x: 0, y: 0, zoom: 1 };
  return { projectId: workspace.project.id, workspaceKey: getProjectWorkspaceStorageKey(workspace.project.id), catalogKey: CATALOG_STORAGE_KEY, catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)])), core, history: serializeWorkspace(historyWorkspace), noteId, fileId, proposalId: proposed.proposal.id, definitionId: definition.id };
}
