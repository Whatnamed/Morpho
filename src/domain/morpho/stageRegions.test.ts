import { describe, expect, it } from "vitest";

import {
  applyStageRegionDeltaToInstances,
  areStageRegionRecordsEqual,
  buildInitialStageRegions,
  buildStageDragUpdatePayload,
  classifyStageRegionKey,
  ensureStageRegions,
  fitStageRegionToVisibleMembers,
  getDefaultStageRegionStyle,
  getStageRegions,
  mergeStageShapeLayoutsIntoRecords,
  resetStageRegionStyle,
  resolveStageRegionForObject,
  updateStageRegionStyle,
  updateStageRegionLayout
} from "./stageRegions";
import { createInitialWorkspace } from "./workspace";
import type { MorphoObject, MorphoWorkspace } from "./types";

describe("stage region membership", () => {
  it("classifies objects by semantic type, not coordinates", () => {
    const workspace = createInitialWorkspace();
    expect(classifyStageRegionKey(workspace.objects["research-night-path"]!)).toBe("research");
    expect(classifyStageRegionKey(workspace.objects["definition-current"]!)).toBe("definition");
    expect(classifyStageRegionKey(workspace.objects["direction-soft-rail"]!)).toBe("visual");
    expect(classifyStageRegionKey(workspace.objects["image-soft-rail-preview"]!)).toBe("visual");
    expect(classifyStageRegionKey(workspace.objects["image-path-ref"] ?? asResearchImage())).toBe("research");
  });

  it("builds four initial regions with members and bounds", () => {
    const workspace = createInitialWorkspace();
    const regions = buildInitialStageRegions(workspace);
    expect(regions).toHaveLength(4);
    expect(regions.map((region) => region.key)).toEqual(["research", "definition", "visual", "delivery"]);
    const research = regions.find((region) => region.key === "research");
    expect(research?.memberObjectIds).toEqual(expect.arrayContaining(["research-night-path"]));
    expect(research!.w).toBeGreaterThan(100);
    expect(research!.h).toBeGreaterThan(100);
  });

  it("initializes missing stage records without changing schemaVersion", () => {
    const workspace = createInitialWorkspace();
    const withoutRegions: MorphoWorkspace = {
      ...workspace,
      canvas: { ...workspace.canvas, stageRegions: undefined }
    };
    const ensured = ensureStageRegions(withoutRegions);
    expect(ensured.schemaVersion).toBe(17);
    expect(ensured.canvas.stageRegions).toHaveLength(4);
  });

  it("normalizes old stage records with persistent visual defaults", () => {
    const workspace = createInitialWorkspace();
    const oldStyleWorkspace: MorphoWorkspace = {
      ...workspace,
      canvas: {
        ...workspace.canvas,
        stageRegions: buildInitialStageRegions(workspace).map((region) => ({
          id: region.id,
          key: region.key,
          title: region.title,
          x: region.x,
          y: region.y,
          w: region.w,
          h: region.h,
          memberObjectIds: region.memberObjectIds
        }))
      }
    };
    const normalized = ensureStageRegions(oldStyleWorkspace);
    const research = getStageRegions(normalized).find((region) => region.key === "research")!;
    expect(research).toMatchObject({ ...getDefaultStageRegionStyle("research"), isActivated: true });
  });

  it("persists 0 and 100 fill opacity without changing unrelated fields", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0];
    const transparent = updateStageRegionStyle(workspace, region.id, { fillOpacity: 0, backgroundVisible: false });
    const opaque = updateStageRegionStyle(transparent, region.id, { fillOpacity: 100, backgroundVisible: true });
    expect(getStageRegions(transparent)[0]).toMatchObject({ fillOpacity: 0, backgroundVisible: false });
    expect(getStageRegions(opaque)[0]).toMatchObject({ fillOpacity: 100, backgroundVisible: true });
    expect(getStageRegions(opaque)[0].memberObjectIds).toEqual(region.memberObjectIds);
  });

  it("resets style without moving, unlocking, or changing members", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0];
    const styled = updateStageRegionStyle(workspace, region.id, {
      colorKey: "clay",
      fillOpacity: 87,
      backgroundVisible: false,
      borderStyle: "dashed",
      locked: true
    });
    const reset = resetStageRegionStyle(styled, region.id);
    const actual = getStageRegions(reset)[0];
    expect(actual).toMatchObject({
      ...getDefaultStageRegionStyle(region.key),
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      locked: true,
      isActivated: region.isActivated
    });
    expect(actual.memberObjectIds).toEqual(region.memberObjectIds);
  });

  it("keeps a hidden object as a member but excludes it from fit bounds", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const research = getStageRegions(workspace).find((region) => region.key === "research")!;
    const hiddenMemberId = research.memberObjectIds[0];
    const withHiddenMember: MorphoWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [hiddenMemberId]: { ...workspace.objects[hiddenMemberId]!, visibility: "hidden" }
      }
    };
    const ensured = ensureStageRegions(withHiddenMember);
    expect(getStageRegions(ensured).find((region) => region.id === research.id)?.memberObjectIds).toContain(hiddenMemberId);
    const movedHidden: MorphoWorkspace = {
      ...ensured,
      canvas: {
        ...ensured.canvas,
        instances: ensured.canvas.instances.map((instance) =>
          instance.objectId === hiddenMemberId
            ? { ...instance, position: { x: instance.position.x + 4000, y: instance.position.y + 4000 } }
            : instance
        )
      }
    };
    const firstFit = getStageRegions(fitStageRegionToVisibleMembers(ensured, research.id)).find((region) => region.id === research.id)!;
    const movedFit = getStageRegions(fitStageRegionToVisibleMembers(movedHidden, research.id)).find((region) => region.id === research.id)!;
    expect(movedFit).toMatchObject({ x: firstFit.x, y: firstFit.y, w: firstFit.w, h: firstFit.h });
  });

  it("does not fit a locked region even when it has visible members", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0]!;
    const locked = updateStageRegionStyle(workspace, region.id, { locked: true });
    expect(fitStageRegionToVisibleMembers(locked, region.id)).toBe(locked);
  });

  it("routes proposal drafts by proposal type instead of treating every draft as a definition", () => {
    const base = createInitialWorkspace().objects["definition-current"]!;
    const proposal = (proposalType: "researchAnalysis" | "designDefinition" | "conceptDirection" | "deliveryPlan") => ({
      ...base,
      id: `proposal-${proposalType}`,
      type: "proposalDraft" as const,
      proposalId: `proposal-${proposalType}`,
      proposalType
    });
    expect(resolveStageRegionForObject(proposal("researchAnalysis"))).toBe("research");
    expect(resolveStageRegionForObject(proposal("designDefinition"))).toBe("definition");
    expect(resolveStageRegionForObject(proposal("conceptDirection"))).toBe("visual");
    expect(resolveStageRegionForObject(proposal("deliveryPlan"))).toBe("delivery");
  });

  it("keeps empty projects quiet until a stage receives an object", () => {
    const workspace = createInitialWorkspace();
    const empty: MorphoWorkspace = {
      ...workspace,
      objects: {},
      canvas: { ...workspace.canvas, instances: [], stageRegions: undefined }
    };
    expect(getStageRegions(ensureStageRegions(empty)).every((region) => !region.isActivated)).toBe(true);
  });

  it("keeps an activated stage visible after its last member is deleted", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const delivery = getStageRegions(workspace).find((region) => region.key === "delivery")!;
    const objects = { ...workspace.objects };
    for (const objectId of delivery.memberObjectIds) {
      delete objects[objectId];
    }
    const afterDelete = ensureStageRegions({ ...workspace, objects });
    const actual = getStageRegions(afterDelete).find((region) => region.id === delivery.id)!;
    expect(actual.memberObjectIds).toEqual([]);
    expect(actual.isActivated).toBe(true);
  });

  it("adds new active objects to semantic home but does not drop members when instances move", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regionsBefore = getStageRegions(workspace);
    const visual = regionsBefore.find((region) => region.key === "visual")!;
    const memberId = visual.memberObjectIds[0];
    const movedInstances = workspace.canvas.instances.map((instance) =>
      instance.objectId === memberId
        ? { ...instance, position: { x: instance.position.x + 4000, y: instance.position.y + 4000 } }
        : instance
    );
    const afterMove = ensureStageRegions({
      ...workspace,
      canvas: { ...workspace.canvas, instances: movedInstances, stageRegions: regionsBefore }
    });
    const visualAfter = getStageRegions(afterMove).find((region) => region.key === "visual")!;
    expect(visualAfter.memberObjectIds).toContain(memberId);
    expect(visualAfter.x).toBe(visual.x);
    expect(visualAfter.y).toBe(visual.y);
    expect(visualAfter.w).toBe(visual.w);
    expect(visualAfter.h).toBe(visual.h);
  });

  it("updates layout only through explicit layout writes", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const region = getStageRegions(workspace)[0];
    const next = updateStageRegionLayout(workspace, [{ id: region.id, x: 10, y: 20, w: 400, h: 300 }]);
    const updated = getStageRegions(next).find((item) => item.id === region.id)!;
    expect(updated).toMatchObject({ x: 10, y: 20, w: 400, h: 300 });
  });

  it("applies stage drag delta to member instances only", () => {
    const workspace = createInitialWorkspace();
    const memberId = "direction-soft-rail";
    const before = workspace.canvas.instances.find((instance) => instance.objectId === memberId)!;
    const other = workspace.canvas.instances.find((instance) => instance.objectId !== memberId)!;
    const next = applyStageRegionDeltaToInstances(workspace.canvas.instances, [memberId], { x: 40, y: -15 });
    const moved = next.find((instance) => instance.objectId === memberId)!;
    const untouched = next.find((instance) => instance.id === other.id)!;
    expect(moved.position).toEqual({ x: before.position.x + 40, y: before.position.y - 15 });
    expect(untouched.position).toEqual(other.position);
  });

  it("treats equal stage layouts as no-op for persistence", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regions = getStageRegions(workspace);
    expect(areStageRegionRecordsEqual(regions, regions.map((region) => ({ ...region })))).toBe(true);
    expect(
      areStageRegionRecordsEqual(regions, regions.map((region, index) => (index === 0 ? { ...region, x: region.x + 1 } : region)))
    ).toBe(false);
  });

  it("only merges layouts that actually changed when building the persist payload", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regions = getStageRegions(workspace);
    const same = mergeStageShapeLayoutsIntoRecords(regions, regions.map((region) => ({ ...region })));
    expect(areStageRegionRecordsEqual(regions, same)).toBe(true);
    const moved = mergeStageShapeLayoutsIntoRecords(regions, [
      { id: regions[0].id, x: regions[0].x + 12, y: regions[0].y, w: regions[0].w, h: regions[0].h }
    ]);
    expect(areStageRegionRecordsEqual(regions, moved)).toBe(false);
    expect(moved[0].x).toBe(regions[0].x + 12);
  });

  it("never lets a shape layout activate an inactive stage", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regions = getStageRegions(workspace).map((region, index) => (index === 0 ? { ...region, isActivated: false } : region));
    const merged = mergeStageShapeLayoutsIntoRecords(regions, [
      { id: regions[0].id, x: regions[0].x + 1, y: regions[0].y, w: regions[0].w, h: regions[0].h }
    ]);
    expect(merged[0].isActivated).toBe(false);
  });

  it("builds an atomic stage-drag payload for stage + members (undo-friendly unit)", () => {
    const workspace = ensureStageRegions(createInitialWorkspace());
    const regions = getStageRegions(workspace);
    const visual = regions.find((region) => region.key === "visual")!;
    const memberId = visual.memberObjectIds[0];
    const before = workspace.canvas.instances.find((instance) => instance.objectId === memberId)!;
    const payload = buildStageDragUpdatePayload({
      regions,
      stageId: visual.id,
      delta: { x: 30, y: 18 },
      instances: workspace.canvas.instances
    });
    const afterRegion = payload.regions.find((region) => region.id === visual.id)!;
    const afterMember = payload.instances.find((instance) => instance.objectId === memberId)!;
    expect(afterRegion.x).toBe(visual.x + 30);
    expect(afterRegion.y).toBe(visual.y + 18);
    expect(afterMember.position).toEqual({ x: before.position.x + 30, y: before.position.y + 18 });
    // Reversing the same payload restores the prior state (single-step undo model).
    const undone = buildStageDragUpdatePayload({
      regions: payload.regions,
      stageId: visual.id,
      delta: { x: -30, y: -18 },
      instances: payload.instances
    });
    expect(undone.regions.find((region) => region.id === visual.id)).toMatchObject({ x: visual.x, y: visual.y });
    expect(undone.instances.find((instance) => instance.objectId === memberId)?.position).toEqual(before.position);
  });
});

function asResearchImage(): MorphoObject {
  return {
    id: "image-path-ref",
    type: "image",
    title: "参考",
    summary: "",
    createdBy: "user",
    visibility: "active",
    role: "reference",
  };
}
