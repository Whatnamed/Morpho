import { createBlankWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import { addDeliveryGap, addObjectsToDeliverySection, createDeliveryPreparation, createDeliverySectionDraft, refreshDeliveryReferenceSnapshot, updateDeliveryReferenceEditorial } from "@/domain/morpho/deliveryPreparation";
import { captureDeliveryGenerationBaseline } from "@/domain/morpho/deliveryInspection";
import { CATALOG_STORAGE_KEY, createCatalog, getProjectWorkspaceStorageKey, summarizeProject } from "@/infrastructure/persistence/localProjectStore";
import type { DeliveryObject, MorphoWorkspace } from "@/domain/morpho/types";

function must<T extends { status: string; workspace: MorphoWorkspace }>(result: T): T { if (result.status !== "updated") throw new Error(JSON.stringify(result)); return result; }
export function buildDeliveryHandoffSeed() {
  let workspace = createBlankWorkspace("project-p5-browser");
  for (const id of ["a", "b", "c", "d"]) workspace.objects[id] = { id, incarnationId: `p5-${id}`, type: "text", title: `P5 material ${id}`, summary: `P5 summary ${id}`, body: `P5 body ${id}`, createdBy: "user", visibility: "active" };
  const created = createDeliveryPreparation(workspace, { title: "P5 handoff", format: "presentation", position: { x: 150, y: 150 } });
  if (created.status !== "updated") throw new Error(created.reason);
  workspace = created.workspace;
  const deliveryId = created.deliveryObjectId, sectionId = (workspace.objects[deliveryId] as DeliveryObject).sections[0].id;
  const added = addObjectsToDeliverySection(workspace, { deliveryObjectId: deliveryId, sectionId, sourceObjectIds: ["a", "b", "c"] });
  if (added.status !== "updated") throw new Error(added.reason);
  workspace = added.workspace;
  const baseline = captureDeliveryGenerationBaseline(workspace, deliveryId, sectionId)!;
  const normal = serializeWorkspace(workspace);
  const legacyDraft = createDeliverySectionDraft(workspace, { deliveryObjectId: deliveryId, sectionId, userMessageId: "legacy-u", assistantMessageId: "legacy-a", narrative: "Legacy narrative", captions: [{ referenceId: added.createdReferenceIds[0], caption: "Actual proposed caption" }], suggestedGaps: [] });
  if (legacyDraft.status !== "updated") throw new Error(legacyDraft.reason);
  const legacy = serializeWorkspace(legacyDraft.workspace);
  const sourceA = workspace.objects.a; if (sourceA.type !== "text") throw new Error("text");
  workspace = must(updateDeliveryReferenceEditorial(workspace, { deliveryObjectId: deliveryId, referenceId: added.createdReferenceIds[0], caption: "Preserved caption", note: "Preserved note" })).workspace;
  workspace = { ...workspace, objects: { ...workspace.objects, a: { ...sourceA, body: "snapshot B" } } };
  workspace = must(refreshDeliveryReferenceSnapshot(workspace, { deliveryObjectId: deliveryId, referenceId: added.createdReferenceIds[0], reason: "P5 refresh fixture" })).workspace;
  const refresh = serializeWorkspace(workspace);
  workspace = { ...workspace, objects: { ...workspace.objects, a: { ...workspace.objects.a, title: "Source updated again" }, b: { ...workspace.objects.b, visibility: "hidden" }, image: { id: "image", incarnationId: "p5-image", type: "image", title: "P5 missing image", summary: "Missing asset metadata", role: "reference", createdBy: "ai", visibility: "active", assetId: "p5-missing-asset" } } };
  delete workspace.objects.c;
  workspace = must(addObjectsToDeliverySection(workspace, { deliveryObjectId: deliveryId, sectionId, sourceObjectIds: ["image"] })).workspace;
  workspace = must(addDeliveryGap(workspace, { deliveryObjectId: deliveryId, sectionId, label: "P5 open handoff gap", origin: "manual" })).workspace;
  workspace = { ...workspace, deliverySectionDrafts: legacyDraft.workspace.deliverySectionDrafts };
  const diagnostics = serializeWorkspace(workspace);
  return { projectId: workspace.project.id, workspaceKey: getProjectWorkspaceStorageKey(workspace.project.id), catalogKey: CATALOG_STORAGE_KEY, catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)])), deliveryId, sectionId, referenceIds: added.createdReferenceIds, baseline, normal, legacy, refresh, diagnostics };
}
