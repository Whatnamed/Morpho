import { describe, expect, it } from "vitest";

import { createInitialWorkspace, getRenderableCanvasInstances } from "@/domain/morpho/workspace";
import { recordDesignDefinitionProposal } from "@/domain/operations/operations";
import {
  MORPHO_EDITOR_SYNC_RUN_OPTIONS,
  areMorphoShapePropsEqual,
  getSelectedMorphoShapeIds,
  isMorphoShapeActiveInWorkspace,
  resolveInstanceForEditorSync,
  shouldReplaceSelectionForContextMenuTarget,
  shouldApplyFocusRequest,
  resolveFocusBounds,
  shouldOpenCanvasContextMenuFromPointerDown
} from "./MorphoCanvas";

describe("MorphoCanvas focus navigation", () => {
  it("keeps workspace-driven shape sync out of tldraw undo history", () => {
    expect(MORPHO_EDITOR_SYNC_RUN_OPTIONS).toEqual({ history: "ignore" });
  });

  it("uses real canvas instance positions before falling back to fixed landmarks", () => {
    const workspace = createInitialWorkspace();
    const movedWorkspace = {
      ...workspace,
      canvas: {
        ...workspace.canvas,
        instances: workspace.canvas.instances.map((instance) =>
          instance.objectId === "definition-current"
            ? {
                ...instance,
                position: { x: 5200, y: 3400 }
              }
            : instance
        )
      }
    };

    const bounds = resolveFocusBounds(movedWorkspace, "definition");

    expect(bounds.x).toBeGreaterThan(5000);
    expect(bounds.y).toBeGreaterThan(3200);
  });

  it("consumes each focus request nonce only once so user pan and zoom are not reset", () => {
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 4 }, null)).toBe(true);
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 4 }, 4)).toBe(false);
    expect(shouldApplyFocusRequest({ area: "visual", nonce: 5 }, 4)).toBe(true);
    expect(shouldApplyFocusRequest({ nonce: 0 }, null)).toBe(false);
  });

  it("opens the Morpho context menu on right button press instead of waiting for a drag contextmenu", () => {
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 2 })).toBe(true);
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 0 })).toBe(false);
    expect(shouldOpenCanvasContextMenuFromPointerDown({ button: 1 })).toBe(false);
  });

  it("preserves a multi-selection when right-clicking an already selected shape", () => {
    expect(shouldReplaceSelectionForContextMenuTarget("shape:a", ["shape:a", "shape:b"])).toBe(false);
    expect(shouldReplaceSelectionForContextMenuTarget("shape:c", ["shape:a", "shape:b"])).toBe(true);
  });

  it("treats newly imported object shapes as active when the latest workspace contains them", () => {
    const workspace = createInitialWorkspace();
    const importedObject = {
      id: "imported-text-object",
      type: "text" as const,
      title: "Imported note",
      summary: "Dropped text",
      body: "Dropped text",
      createdBy: "user" as const,
      visibility: "active" as const
    };
    const shape = {
      props: {
        objectId: importedObject.id
      }
    };

    expect(isMorphoShapeActiveInWorkspace(shape, workspace)).toBe(false);
    expect(
      isMorphoShapeActiveInWorkspace(shape, {
        ...workspace,
        objects: {
          ...workspace.objects,
          [importedObject.id]: importedObject
        }
      })
    ).toBe(true);
  });

  it("renders pending design definition proposals through real workspace canvas objects", () => {
    const workspace = createInitialWorkspace();
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-on-tldraw-canvas",
      title: "Definition draft A",
      summary: "A concise draft summary.",
      projectGoal: "Create a clear product definition.",
      targetUsers: ["Student"],
      primaryScenarios: ["Course review"],
      coreProblem: "The problem is unclear.",
      designPrinciples: ["Clear boundary"],
      constraints: ["Limited material"],
      avoidDirections: ["Vague installation"],
      opportunities: ["Translate issues into design actions"],
      openQuestions: ["What should be verified next?"],
      sourceObjectIds: [],
      citations: [],
      position: { x: 640, y: 360 }
    });

    expect(proposed.workspace.objects[proposed.proposal.id]).toMatchObject({
      id: proposed.proposal.id,
      type: "proposalDraft",
      proposalId: proposed.proposal.id,
      proposalType: "designDefinition"
    });
    expect(getRenderableCanvasInstances(proposed.workspace)).toContainEqual(
      expect.objectContaining({
        objectId: proposed.proposal.id,
        position: { x: 640, y: 360 }
      })
    );
  });

  it("keeps pending proposal shapes active while their proposal is pending", () => {
    const workspace = createInitialWorkspace();
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-active-shape",
      title: "Definition proposal",
      summary: "Summary.",
      projectGoal: "Goal.",
      targetUsers: ["User"],
      primaryScenarios: ["Scenario"],
      coreProblem: "Problem.",
      designPrinciples: ["Principle"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      position: { x: 420, y: 260 }
    });
    const shape = {
      props: {
        objectId: proposed.proposal.id,
        morphoType: "proposalDraft"
      }
    };

    expect(isMorphoShapeActiveInWorkspace(shape, proposed.workspace)).toBe(true);
    expect(isMorphoShapeActiveInWorkspace(shape, workspace)).toBe(false);
  });

  it("keeps selected proposal drafts in the normal selected object ids", () => {
    const selection = getSelectedMorphoShapeIds([
      {
        props: {
          objectId: "image-a",
          morphoType: "image"
        }
      },
      {
        props: {
          objectId: "proposal-a",
          morphoType: "proposalDraft"
        }
      }
    ]);

    expect(selection.objectIds).toEqual(["image-a", "proposal-a"]);
    expect(selection.proposalIds).toEqual(["proposal-a"]);
  });


  it("keeps pending editor geometry ahead of stale workspace geometry while syncing back to tldraw", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances.find((item) => item.objectId === "image-soft-rail-v2");

    if (!instance) {
      throw new Error("Expected seed workspace to include an image canvas instance.");
    }

    const pending = {
      ...instance,
      size: { w: instance.size.w + 80, h: instance.size.h + 80 }
    };

    expect(resolveInstanceForEditorSync(instance, [pending])).toBe(pending);
    expect(resolveInstanceForEditorSync(instance, null)).toBe(instance);
  });


  it("compares Morpho shape props before writing redundant tldraw updates", () => {
    const props = {
      w: 240,
      h: 180,
      objectId: "object-a",
      instanceId: "instance-a",
      morphoType: "image" as const,
      title: "Image",
      summary: "Summary",
      label: "鍙傝€冨浘",
      details: [],
      imageVariant: "rail",
      isDefaultReference: true,
      isBeingLocallyEdited: false,
      isInDesignTrace: false,
      assetUrl: "blob:asset"
    };

    expect(areMorphoShapePropsEqual(props, { ...props })).toBe(true);
    expect(areMorphoShapePropsEqual(props, { ...props, w: 300 })).toBe(false);
    expect(areMorphoShapePropsEqual(props, { ...props, details: ["source"] })).toBe(false);
    expect(areMorphoShapePropsEqual(props, { ...props, morphoType: "proposalDraft" })).toBe(false);
  });
});
