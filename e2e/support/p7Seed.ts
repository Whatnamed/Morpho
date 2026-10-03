import { createCurrentCaseStudyWorkspace, serializeWorkspace, setDefaultReference } from "@/domain/morpho/workspace";
import { currentCaseStudyAssetManifest } from "@/domain/morpho/caseStudy/currentCaseStudy";
import { CATALOG_STORAGE_KEY, createCatalog, getProjectWorkspaceStorageKey, summarizeProject } from "@/infrastructure/persistence/localProjectStore";

/** Fixture setup only. Domain constructors are not imported by the independent oracle. */
export function buildP7Seed() {
  let workspace = createCurrentCaseStudyWorkspace();
  const direction = "direction-proposal-direction-1783671299082-1";
  const parent = "image-generated-asset-grs-result-1783682204066-jpg-cabf128b-b221-4eb1-b7c1-cfe9a515d195";
  const material = "image-generated-asset-grs-result-1783686487536-jpg-b2c5686a-cacc-45ab-981b-d63ea576c131";
  const excluded = "image-generated-asset-grs-result-1783682264701-jpg-4fe27c5d-c793-4281-97a2-012ba3dcb095";
  const defaultReference = "image-generated-asset-grs-result-1783855434681-png-4d1a8182-06ea-4bdc-a70e-7a4fe936232b";
  if (workspace.objects[direction]?.type !== "conceptDirection" || workspace.objects[direction].status !== "primary") throw new Error("P7 frozen case primary changed");
  workspace.project = { ...workspace.project, id: "project-p7-buoy-copy", title: "P7 守望塔隔离副本" };
  const aliases = { parent, material, excluded, defaultReference, direction, branch: "p7-a-branch" };
  const ids = [parent, material, excluded, defaultReference];
  const names = ["A", "M", "X", "E"];
  ids.forEach((id, index) => {
    const image = workspace.objects[id];
    if (image?.type !== "image") throw new Error(`Missing P7 case image ${id}`);
    workspace.objects[id] = { ...image, title: names[index], visualBranchId: index === 0 ? aliases.branch : image.visualBranchId };
  });
  workspace.visualBranches[aliases.branch] = { id: aliases.branch, directionId: direction, label: "守望塔 A 历史路线", rootObjectId: parent, createdAt: "2026-10-03T00:00:00Z" };
  workspace = setDefaultReference(workspace, defaultReference, { reason: "P7 fixture: E 是默认，A 是用户要继续的旧版本。" });
  // Preserve all case semantic/history records. Layout is only a test convenience.
  workspace.canvas.instances = ids.map((id, index) => ({ id: `p7-canvas-${index}`, objectId: id,
    position: { x: 140 + (index % 2) * 310, y: 140 + Math.floor(index / 2) * 300 }, size: { w: 240, h: 200 } }));
  workspace.canvas.view = { x: 0, y: 0, zoom: 1 };
  workspace.ui.canvasView = workspace.canvas.view;
  workspace.ui.lastSelectionIds = [];
  workspace.ai.messages.push({ id: "p7-history-noise", role: "assistant", body: "历史噪声：夜间柔光扶手只是旧探索，不是当前浮标路线。", createdAt: "2026-10-03T00:00:00Z", status: "done" });
  return { version: "p7-buoy-copy-1", projectId: workspace.project.id, aliases,
    workspaceKey: getProjectWorkspaceStorageKey(workspace.project.id), workspaceValue: serializeWorkspace(workspace),
    catalogKey: CATALOG_STORAGE_KEY, catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)], workspace.project.id)), assets: currentCaseStudyAssetManifest.assets };
}
