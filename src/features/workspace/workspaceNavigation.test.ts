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

  it("hydrates persisted selection only when the current project has not been hydrated", () => {
    expect(shouldHydratePersistedSelection(null, "project-a")).toBe(true);
    expect(shouldHydratePersistedSelection("project-a", "project-a")).toBe(false);
    expect(shouldHydratePersistedSelection("project-a", "project-b")).toBe(true);
  });

  it("ignores transient canvas selection updates while the window is not active", () => {
    expect(shouldAcceptCanvasSelection({ documentVisible: false, windowFocused: true })).toBe(false);
    expect(shouldAcceptCanvasSelection({ documentVisible: true, windowFocused: false })).toBe(false);
    expect(shouldAcceptCanvasSelection({ documentVisible: true, windowFocused: true })).toBe(true);
  });
});
