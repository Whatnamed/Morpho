import { createInitialWorkspace, parseWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";

const STORAGE_KEY = "morpho.workspace.nightrail.v1";

export function loadWorkspaceFromLocalStorage(): MorphoWorkspace {
  if (typeof window === "undefined") {
    return createInitialWorkspace();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialWorkspace();
  }

  try {
    return parseWorkspace(raw);
  } catch {
    return createInitialWorkspace();
  }
}

export function saveWorkspaceToLocalStorage(workspace: MorphoWorkspace): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, serializeWorkspace(workspace));
}
