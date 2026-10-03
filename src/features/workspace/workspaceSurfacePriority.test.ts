// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { getTopWorkspaceSurfaceElement } from "./workspaceSurfacePriority";
afterEach(() => document.body.replaceChildren());
function surface(id: string, z: number, parent = document.body) {
  const node = document.createElement("section"); node.dataset.workspaceSurface = id;
  node.style.position = "fixed"; node.style.zIndex = String(z);
  node.getClientRects = () => [{ width: 1 }] as unknown as DOMRectList;
  parent.append(node); return node;
}
it("uses real stacking levels and later DOM order, skipping hidden surfaces", () => {
  const research = surface("researchDetail", 58), proposal = surface("proposalDetail", 65), archive = surface("projectBundle", 45);
  expect(getTopWorkspaceSurfaceElement()).toBe(proposal);
  proposal.hidden = true; expect(getTopWorkspaceSurfaceElement()).toBe(research);
  const reader = surface("documentReader", 58); expect(getTopWorkspaceSurfaceElement()).toBe(reader);
  reader.style.display = "none"; expect(getTopWorkspaceSurfaceElement()).toBe(research);
  research.remove(); expect(getTopWorkspaceSurfaceElement()).toBe(archive);
});
it("does not mistake a high child z-index for its lower ancestor stacking context", () => {
  const parent = surface("drawer", 45); surface("projectMenu", 999, parent);
  const reader = surface("documentReader", 58); expect(getTopWorkspaceSurfaceElement()).toBe(reader);
});
