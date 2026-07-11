import { describe, expect, it } from "vitest";

import {
  applyStageRegionDeltaToInstances,
  buildInitialStageRegions,
  buildStageDragUpdatePayload,
  ensureStageRegions
} from "@/domain/morpho/stageRegions";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { getSelectedMorphoShapeIds } from "./MorphoCanvas";
import { createStageRegionShapePartial, isStageRegionShape, STAGE_REGION_SHAPE_TYPE } from "./StageRegionShapeUtil";

describe("StageRegionShapeUtil helpers", () => {
  it("creates non-morpho stage shapes from presentation records", () => {
    const workspace = createInitialWorkspace();
    const regions = buildInitialStageRegions(workspace);
    const partial = createStageRegionShapePartial(regions[0]);
    expect(partial.type).toBe(STAGE_REGION_SHAPE_TYPE);
    expect(partial.props?.title).toBe("资料与研究");
    expect(partial.props?.memberObjectIds?.length).toBeGreaterThan(0);
  });

  it("type-guards stage shapes without treating them as morpho objects", () => {
    expect(
      isStageRegionShape({
        type: STAGE_REGION_SHAPE_TYPE,
        id: "shape:stage-research",
        x: 0,
        y: 0,
        rotation: 0,
        index: "a1",
        parentId: "page:page",
        isLocked: false,
        opacity: 1,
        props: {
          w: 100,
          h: 100,
          stageKey: "research",
          title: "资料与研究",
          memberObjectIds: []
        },
        meta: {},
        typeName: "shape"
      } as never)
    ).toBe(true);
    expect(isStageRegionShape({ type: "morpho-object" } as never)).toBe(false);
  });

  it("keeps stage-only selection out of object toolbar payload while morpho selection remains", () => {
    const stageOnly = getSelectedMorphoShapeIds([]);
    expect(stageOnly.objectIds).toEqual([]);
    const withObject = getSelectedMorphoShapeIds([
      { props: { objectId: "direction-soft-rail", instanceId: "canvas-direction-soft-rail" } } as never
    ]);
    expect(withObject.objectIds).toEqual(["direction-soft-rail"]);
  });

  it("stage drag payload moves members with the region and supports reverse undo step", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regions = workspace.canvas.stageRegions!;
    const visual = regions.find((region) => region.key === "visual")!;
    const memberIds = visual.memberObjectIds;
    expect(memberIds.length).toBeGreaterThan(0);
    const before = workspace.canvas.instances.filter((instance) => memberIds.includes(instance.objectId));
    const payload = buildStageDragUpdatePayload({
      regions,
      stageId: visual.id,
      delta: { x: 25, y: -10 },
      instances: workspace.canvas.instances
    });
    for (const member of before) {
      const after = payload.instances.find((instance) => instance.id === member.id)!;
      expect(after.position).toEqual({ x: member.position.x + 25, y: member.position.y - 10 });
    }
    const nonMembers = payload.instances.filter((instance) => !memberIds.includes(instance.objectId));
    for (const instance of nonMembers) {
      const original = workspace.canvas.instances.find((item) => item.id === instance.id)!;
      expect(instance.position).toEqual(original.position);
    }
    // Solo object move path still leaves stage bounds untouched.
    const solo = applyStageRegionDeltaToInstances(workspace.canvas.instances, [], { x: 100, y: 100 });
    expect(solo).toEqual(workspace.canvas.instances);
  });
});
