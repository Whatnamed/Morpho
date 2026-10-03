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

export const WORKSPACE_SURFACE_CLOSE_EVENT = "morpho:close-surface";

/** Explicit DOM ownership: CSS stacking contexts and DOM order are the visual authority. */
export function getTopWorkspaceSurfaceElement(root: Document = document): HTMLElement | null {
  const nodes = [...root.querySelectorAll<HTMLElement>("[data-workspace-surface]")].filter((node) => {
    const style = getComputedStyle(node);
    return !(node instanceof HTMLDetailsElement && !node.open) && !node.hidden && style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  });
  const stack = (node: HTMLElement): number[] => {
    const levels: number[] = [];
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      const indexed = style.zIndex !== "auto" && style.zIndex !== "" && style.position !== "static";
      const isolates = style.position === "fixed" || style.position === "sticky" || style.isolation === "isolate" || (style.transform && style.transform !== "none") || (style.opacity && Number(style.opacity) < 1);
      if (indexed || isolates) levels.unshift(indexed ? Number(style.zIndex) || 0 : 0);
    }
    return levels;
  };
  return nodes.reduce<HTMLElement | null>((top, node) => {
    if (!top) return node;
    const left = stack(top), right = stack(node);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      if ((left[index] ?? 0) !== (right[index] ?? 0)) return (right[index] ?? 0) > (left[index] ?? 0) ? node : top;
    }
    return node; // Equal stacking level: later DOM paints above earlier DOM.
  }, null);
}

/** After dismissal, the remaining surface owns keyboard focus; otherwise return to Canvas. */
export function focusRemainingWorkspaceSurface() {
  requestAnimationFrame(() => {
    const surface = getTopWorkspaceSurfaceElement();
    const target = surface?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]") ?? document.querySelector<HTMLElement>(".tl-container");
    target?.focus({ preventScroll: true });
  });
}
