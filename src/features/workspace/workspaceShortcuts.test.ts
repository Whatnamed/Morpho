import { describe, expect, it } from "vitest";

import { resolveWorkspaceShortcut } from "./workspaceShortcuts";

describe("workspace shortcuts", () => {
  it("maps Delete and Backspace to canvas deletion from the canvas surface", () => {
    const canvas = makeTarget({ className: "workspace-canvas" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("Delete"), canvas)).toBe("deleteSelection");
    expect(resolveWorkspaceShortcut(makeKeyEvent("Backspace"), canvas)).toBe("deleteSelection");
  });

  it("does not let destructive canvas shortcuts pass through editable text", () => {
    const textarea = makeTarget({ tagName: "TEXTAREA" });
    const input = makeTarget({ tagName: "INPUT" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("Backspace"), textarea)).toBeNull();
    expect(resolveWorkspaceShortcut(makeKeyEvent("Delete"), input)).toBeNull();
    expect(resolveWorkspaceShortcut(makeKeyEvent("a", { ctrlKey: true }), textarea)).toBeNull();
  });

  it("keeps global save available while text is focused", () => {
    const textarea = makeTarget({ tagName: "TEXTAREA" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("s", { ctrlKey: true }), textarea)).toBe("manualSave");
  });

  it("opens the AI input and selects canvas content only from non-editing surfaces", () => {
    const canvas = makeTarget({ className: "workspace-canvas" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("k", { ctrlKey: true }), canvas)).toBe("focusAiInput");
    expect(resolveWorkspaceShortcut(makeKeyEvent("a", { ctrlKey: true }), canvas)).toBe("selectAllCanvas");
  });

  it("treats Escape as a UI close action from the workspace surface", () => {
    const workspace = makeTarget({ className: "workspace" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("Escape"), workspace)).toBe("closeOrClearSelection");
  });

  it("does not close workspace surfaces while the user is editing text", () => {
    const textarea = makeTarget({ tagName: "TEXTAREA" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("Escape"), textarea)).toBeNull();
  });

  it("suspends canvas shortcuts inside floating editing surfaces", () => {
    const dialog = makeTarget({ className: "proposal-detail-dialog" });

    expect(resolveWorkspaceShortcut(makeKeyEvent("Delete"), dialog)).toBeNull();
    expect(resolveWorkspaceShortcut(makeKeyEvent("a", { ctrlKey: true }), dialog)).toBeNull();
  });
});

function makeKeyEvent(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}
): KeyboardEvent {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false
  } as KeyboardEvent;
}

function makeTarget(input: { tagName?: string; className?: string; isContentEditable?: boolean }): EventTarget {
  const tagName = input.tagName?.toUpperCase() ?? "DIV";
  const classNames = new Set((input.className ?? "").split(/\s+/).filter(Boolean));
  return {
    tagName,
    isContentEditable: input.isContentEditable ?? false,
    closest(selector: string) {
      const selectors = selector.split(",").map((item) => item.trim());
      for (const item of selectors) {
        if (item === tagName.toLowerCase() || item === tagName) {
          return this;
        }
        if (item === "[contenteditable='true']" && input.isContentEditable) {
          return this;
        }
        if (item.startsWith(".") && classNames.has(item.slice(1))) {
          return this;
        }
      }
      return null;
    }
  } as unknown as EventTarget;
}
