import { createInitialWorkspace, parseWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";

const STORAGE_KEY = "morpho.workspace.nightrail.v1";

export type WorkspaceLoadResult = {
  workspace: MorphoWorkspace;
  migrationError?: string;
};

export function loadWorkspaceFromLocalStorage(): WorkspaceLoadResult {
  if (typeof window === "undefined") {
    return { workspace: createInitialWorkspace() };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { workspace: createInitialWorkspace() };
  }

  const result = parseWorkspace(raw);

  if (result.status === "ok") {
    if (result.didMigrate) {
      window.localStorage.setItem(STORAGE_KEY, serializeWorkspace(result.workspace));
    }

    return { workspace: result.workspace };
  }

  return {
    workspace: createInitialWorkspace(),
    migrationError: result.reason
  };
}

export function saveWorkspaceToLocalStorage(workspace: MorphoWorkspace): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, serializeWorkspace(workspace));
}
