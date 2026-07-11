import { describe, expect, it } from "vitest";

import {
  applyStageRegionDeltaToInstances,
  areStageRegionRecordsEqual,
  buildInitialStageRegions,
  buildStageDragUpdatePayload,
  classifyStageRegionKey,
  ensureStageRegions,
  getStageRegions,
  mergeStageShapeLayoutsIntoRecords,
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
    expect(ensured.schemaVersion).toBe(13);
    expect(ensured.canvas.stageRegions).toHaveLength(4);
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
    imageVariant: "path"
  };
}
