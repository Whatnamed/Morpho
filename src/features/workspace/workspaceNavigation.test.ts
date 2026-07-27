import { describe, expect, it } from "vitest";

import {
  popDetailNavigation,
  pushDetailNavigation,
  shouldAcceptCanvasSelection,
  shouldHydratePersistedSelection
} from "./workspaceNavigation";

describe("workspace detail navigation", () => {
  it("restores the exact prior view and selection in last-in-first-out order", () => {
    const first = {
      view: { x: 120, y: 240, zoom: 0.72 },
      selectedObjectIds: ["image-a", "image-b"]
    };
    const second = {
      view: { x: 360, y: 480, zoom: 1.1 },
      selectedObjectIds: ["image-c"]
    };

    const history = pushDetailNavigation(pushDetailNavigation([], first), second);
    const restored = popDetailNavigation(history);

    expect(restored).toEqual({ snapshot: second, history: [first] });
  });

  it("waits for a loaded project before hydrating persisted selection", () => {
    expect(
      shouldHydratePersistedSelection({
        hydratedProjectId: null,
        projectId: "project-a",
        workspaceLoaded: false
      })
    ).toBe(false);
    expect(
      shouldHydratePersistedSelection({
        hydratedProjectId: null,
        projectId: "project-a",
        workspaceLoaded: true
      })
    ).toBe(true);
  });

  it("hydrates once per loaded project and does not inherit the previous project", () => {
    expect(
      shouldHydratePersistedSelection({
        hydratedProjectId: "project-a",
        projectId: "project-a",
        workspaceLoaded: true
      })
    ).toBe(false);
    expect(
      shouldHydratePersistedSelection({
        hydratedProjectId: "project-a",
        projectId: "project-b",
        workspaceLoaded: true
      })
    ).toBe(true);
  });

  it("ignores transient canvas selection updates while the window is not active", () => {
    expect(shouldAcceptCanvasSelection({ documentVisible: false, windowFocused: true })).toBe(false);
    expect(shouldAcceptCanvasSelection({ documentVisible: true, windowFocused: false })).toBe(false);
    expect(shouldAcceptCanvasSelection({ documentVisible: true, windowFocused: true })).toBe(true);
  });
});
