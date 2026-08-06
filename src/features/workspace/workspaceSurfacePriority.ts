export type WorkspaceSurfacePriorityState = {
  canvasContextMenuOpen: boolean;
  proposalDetailOpen: boolean;
  designDefinitionDetailOpen: boolean;
  conceptDirectionDetailOpen: boolean;
  researchDetailOpen: boolean;
  documentReaderOpen: boolean;
  deliveryPreparationOpen: boolean;
  deliveryOutputOpen: boolean;
  projectBundleOpen: boolean;
  projectMenuOpen: boolean;
  drawerOpen: boolean;
};

export type WorkspaceSurfaceCloseTarget =
  | "canvasContextMenu"
  | "proposalDetail"
  | "designDefinitionDetail"
  | "conceptDirectionDetail"
  | "researchDetail"
  | "documentReader"
  | "deliveryPreparation"
  | "deliveryOutput"
  | "projectBundle"
  | "projectMenu"
  | "drawer"
  | "canvasSelection";

export function resolveTopWorkspaceSurface(input: WorkspaceSurfacePriorityState): WorkspaceSurfaceCloseTarget {
  if (input.canvasContextMenuOpen) {
    return "canvasContextMenu";
  }
  if (input.proposalDetailOpen) {
    return "proposalDetail";
  }
  if (input.designDefinitionDetailOpen) {
    return "designDefinitionDetail";
  }
  if (input.conceptDirectionDetailOpen) {
    return "conceptDirectionDetail";
  }
  if (input.researchDetailOpen) {
    return "researchDetail";
  }
  if (input.documentReaderOpen) {
    return "documentReader";
  }
  if (input.deliveryPreparationOpen) {
    return "deliveryPreparation";
  }
  if (input.deliveryOutputOpen) {
    return "deliveryOutput";
  }
  if (input.projectBundleOpen) {
    return "projectBundle";
  }
  if (input.projectMenuOpen) {
    return "projectMenu";
  }
  if (input.drawerOpen) {
    return "drawer";
  }
  return "canvasSelection";
}
