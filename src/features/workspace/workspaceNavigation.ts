import type { CanvasView } from "../../domain/morpho/types";

export type DetailNavigationSnapshot = {
  view: CanvasView;
  selectedObjectIds: string[];
};

export function pushDetailNavigation(
  history: DetailNavigationSnapshot[],
  snapshot: DetailNavigationSnapshot
): DetailNavigationSnapshot[] {
  return [...history.slice(-19), { view: { ...snapshot.view }, selectedObjectIds: [...snapshot.selectedObjectIds] }];
}

export function popDetailNavigation(
  history: DetailNavigationSnapshot[]
): { snapshot: DetailNavigationSnapshot; history: DetailNavigationSnapshot[] } | null {
  const snapshot = history.at(-1);
  if (!snapshot) {
    return null;
  }

  return {
    snapshot,
    history: history.slice(0, -1)
  };
}

export function shouldHydratePersistedSelection(input: {
  hydratedProjectId: string | null;
  projectId: string;
  workspaceLoaded: boolean;
}): boolean {
  return input.workspaceLoaded && input.hydratedProjectId !== input.projectId;
}

export function shouldAcceptCanvasSelection(input: { documentVisible: boolean; windowFocused: boolean }): boolean {
  return input.documentVisible && input.windowFocused;
}
