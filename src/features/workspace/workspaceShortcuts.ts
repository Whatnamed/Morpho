export type WorkspaceShortcut =
  | "deleteSelection"
  | "selectAllCanvas"
  | "closeOrClearSelection"
  | "focusAiInput"
  | "manualSave";

const FLOATING_EDITING_SURFACE_SELECTOR = [
  ".proposal-detail-dialog",
  ".research-detail-panel",
  ".document-reader-panel",
  ".delivery-preparation-panel",
  ".delivery-output-panel",
  ".project-bundle-panel",
  ".project-menu",
  ".side-drawer",
  ".search-layer"
].join(", ");

export function resolveWorkspaceShortcut(event: KeyboardEvent, target: EventTarget | null): WorkspaceShortcut | null {
  const key = event.key.toLowerCase();
  const isCommand = event.ctrlKey || event.metaKey;

  if (isCommand && !event.altKey && key === "s") {
    return "manualSave";
  }

  if (isEditableShortcutTarget(target)) {
    return null;
  }

  if (event.key === "Escape") {
    return "closeOrClearSelection";
  }

  if (isInsideFloatingEditingSurface(target)) {
    return null;
  }

  if ((event.key === "Delete" || event.key === "Backspace") && !isCommand && !event.altKey && !event.shiftKey) {
    return "deleteSelection";
  }

  if (isCommand && !event.altKey && !event.shiftKey && key === "k") {
    return "focusAiInput";
  }

  if (isCommand && !event.altKey && !event.shiftKey && key === "a") {
    return "selectAllCanvas";
  }

  return null;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = toElementLike(target);
  if (!element) {
    return false;
  }

  return Boolean(element.closest("textarea, input, select, [contenteditable='true']"));
}

function isInsideFloatingEditingSurface(target: EventTarget | null): boolean {
  const element = toElementLike(target);
  return Boolean(element?.closest(FLOATING_EDITING_SURFACE_SELECTOR));
}

type ElementLike = {
  closest(selector: string): unknown;
};

function toElementLike(target: EventTarget | null): ElementLike | null {
  return target && typeof (target as Partial<ElementLike>).closest === "function"
    ? (target as unknown as ElementLike)
    : null;
}
