import type { MorphoWorkspace } from "@/domain/morpho/types";
import { ensureStageRegions } from "@/domain/morpho/stageRegions";

/**
 * Read-only sessions may inspect legacy workspace data, but only a writable
 * session may materialize derived stage-region state into the Workspace.
 */
export function ensureWorkspaceStageRegionsIfWritable(
  workspace: MorphoWorkspace,
  canMutateWorkspace: boolean
): MorphoWorkspace {
  return canMutateWorkspace ? ensureStageRegions(workspace) : workspace;
}
