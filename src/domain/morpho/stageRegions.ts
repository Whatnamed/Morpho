import type {
  CanvasInstance,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  StageRegionKey,
  StageRegionRecord
} from "./types";

export type { StageRegionKey, StageRegionRecord };

export const STAGE_REGION_DEFS: ReadonlyArray<{ key: StageRegionKey; title: string; id: string }> = [
  { key: "research", title: "资料与研究", id: "stage-research" },
  { key: "definition", title: "设计定义", id: "stage-definition" },
  { key: "visual", title: "方向与视觉", id: "stage-visual" },
  { key: "delivery", title: "交付整理", id: "stage-delivery" }
] as const;

const DEFAULT_BOUNDS: Record<StageRegionKey, { x: number; y: number; w: number; h: number }> = {
  research: { x: 0, y: 80, w: 980, h: 820 },
  definition: { x: 720, y: 100, w: 560, h: 620 },
  visual: { x: 1080, y: 60, w: 1480, h: 860 },
  delivery: { x: 2480, y: 120, w: 560, h: 820 }
};

const MEMBER_PADDING = 72;
const MIN_REGION_W = 360;
const MIN_REGION_H = 280;

/**
 * Semantic home for a canvas object. Canvas coordinates never decide membership.
 */
export function classifyStageRegionKey(object: MorphoObject): StageRegionKey | null {
  switch (object.type) {
    case "file":
    case "text":
    case "link":
    case "imageCollection":
    case "documentFragment":
    case "research":
    case "keyConclusion":
      return "research";
    case "designDefinition":
    case "proposalDraft":
      return "definition";
    case "conceptDirection":
      return "visual";
    case "delivery":
      return "delivery";
    case "image":
      if (object.directionId || object.visualBranchId) {
        return "visual";
      }
      if (
        object.role === "preview" ||
        object.role === "conceptImage" ||
        object.role === "primaryVisual" ||
        object.role === "sceneVisual" ||
        object.role === "cmfStudy" ||
        object.role === "detailStudy" ||
        object.role === "structureDiagram" ||
        object.role === "interactionDiagram"
      ) {
        return "visual";
      }
      // Source / reference photos stay with research materials.
      return "research";
    default:
      return null;
  }
}

export function computeStageBoundsFromMembers(
  workspace: MorphoWorkspace,
  key: StageRegionKey,
  memberObjectIds: MorphoObjectId[]
): { x: number; y: number; w: number; h: number } {
  const members = new Set(memberObjectIds);
  const instances = workspace.canvas.instances.filter(
    (instance) => members.has(instance.objectId) && workspace.objects[instance.objectId]?.visibility === "active"
  );
  if (instances.length === 0) {
    return { ...DEFAULT_BOUNDS[key] };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const instance of instances) {
    minX = Math.min(minX, instance.position.x);
    minY = Math.min(minY, instance.position.y);
    maxX = Math.max(maxX, instance.position.x + instance.size.w);
    maxY = Math.max(maxY, instance.position.y + instance.size.h);
  }

  const x = minX - MEMBER_PADDING;
  const y = minY - MEMBER_PADDING;
  const w = Math.max(MIN_REGION_W, maxX - minX + MEMBER_PADDING * 2);
  const h = Math.max(MIN_REGION_H, maxY - minY + MEMBER_PADDING * 2);
  return { x, y, w, h };
}

export function buildInitialStageRegions(workspace: MorphoWorkspace): StageRegionRecord[] {
  const membersByKey: Record<StageRegionKey, MorphoObjectId[]> = {
    research: [],
    definition: [],
    visual: [],
    delivery: []
  };

  for (const object of Object.values(workspace.objects)) {
    if (object.visibility !== "active") {
      continue;
    }
    const key = classifyStageRegionKey(object);
    if (!key) {
      continue;
    }
    membersByKey[key].push(object.id);
  }

  return STAGE_REGION_DEFS.map((def) => {
    const memberObjectIds = membersByKey[def.key];
    const bounds = computeStageBoundsFromMembers(workspace, def.key, memberObjectIds);
    return {
      id: def.id,
      key: def.key,
      title: def.title,
      ...bounds,
      memberObjectIds
    };
  });
}

export function getStageRegions(workspace: MorphoWorkspace): StageRegionRecord[] {
  const existing = workspace.canvas.stageRegions;
  if (existing && existing.length === STAGE_REGION_DEFS.length) {
    return existing;
  }
  return buildInitialStageRegions(workspace);
}

/**
 * Ensure four stage records exist. New active objects join their semantic home once;
 * dragging off a region never removes membership. Bounds only change when caller
 * updates them (user resize/drag), not when object positions change.
 */
export function ensureStageRegions(workspace: MorphoWorkspace): MorphoWorkspace {
  const current = workspace.canvas.stageRegions;
  if (!current || current.length !== STAGE_REGION_DEFS.length) {
    return {
      ...workspace,
      canvas: {
        ...workspace.canvas,
        stageRegions: buildInitialStageRegions(workspace)
      }
    };
  }

  const assigned = new Set<MorphoObjectId>();
  for (const region of current) {
    for (const id of region.memberObjectIds) {
      assigned.add(id);
    }
  }

  let changed = false;
  const nextRegions = current.map((region) => {
    const additions: MorphoObjectId[] = [];
    for (const object of Object.values(workspace.objects)) {
      if (object.visibility !== "active" || assigned.has(object.id)) {
        continue;
      }
      if (classifyStageRegionKey(object) !== region.key) {
        continue;
      }
      additions.push(object.id);
      assigned.add(object.id);
    }

    // Drop deleted / non-active members only.
    const kept = region.memberObjectIds.filter((id) => {
      const object = workspace.objects[id];
      return Boolean(object && object.visibility === "active");
    });
    const dropped = kept.length !== region.memberObjectIds.length;
    if (additions.length === 0 && !dropped) {
      return region;
    }
    changed = true;
    return {
      ...region,
      memberObjectIds: [...kept, ...additions]
    };
  });

  if (!changed) {
    return workspace;
  }

  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      stageRegions: nextRegions
    }
  };
}

export function updateStageRegionLayout(
  workspace: MorphoWorkspace,
  updates: Array<Pick<StageRegionRecord, "id" | "x" | "y" | "w" | "h">>
): MorphoWorkspace {
  const regions = getStageRegions(workspace);
  const byId = new Map(updates.map((item) => [item.id, item]));
  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      stageRegions: regions.map((region) => {
        const next = byId.get(region.id);
        if (!next) {
          return region;
        }
        return {
          ...region,
          x: next.x,
          y: next.y,
          w: Math.max(MIN_REGION_W, next.w),
          h: Math.max(MIN_REGION_H, next.h)
        };
      })
    }
  };
}

export function applyStageRegionDeltaToInstances(
  instances: CanvasInstance[],
  memberObjectIds: MorphoObjectId[],
  delta: { x: number; y: number }
): CanvasInstance[] {
  if (delta.x === 0 && delta.y === 0) {
    return instances;
  }
  const members = new Set(memberObjectIds);
  return instances.map((instance) => {
    if (!members.has(instance.objectId)) {
      return instance;
    }
    return {
      ...instance,
      position: {
        x: instance.position.x + delta.x,
        y: instance.position.y + delta.y
      }
    };
  });
}

export function areStageRegionRecordsEqual(
  left: StageRegionRecord[] | undefined,
  right: StageRegionRecord[] | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      a.key !== b.key ||
      a.title !== b.title ||
      Math.abs(a.x - b.x) > 0.001 ||
      Math.abs(a.y - b.y) > 0.001 ||
      Math.abs(a.w - b.w) > 0.001 ||
      Math.abs(a.h - b.h) > 0.001 ||
      a.memberObjectIds.length !== b.memberObjectIds.length ||
      a.memberObjectIds.some((id, memberIndex) => id !== b.memberObjectIds[memberIndex])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Merge editor stage geometry into presentation records. Pure helper so MorphoCanvas
 * only persists when layout/members actually changed.
 */
export function mergeStageShapeLayoutsIntoRecords(
  base: StageRegionRecord[],
  layouts: Array<{ id: string; x: number; y: number; w: number; h: number; memberObjectIds?: MorphoObjectId[] }>
): StageRegionRecord[] {
  const byId = new Map(layouts.map((item) => [item.id, item]));
  return base.map((region) => {
    const layout = byId.get(region.id);
    if (!layout) {
      return region;
    }
    return {
      ...region,
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: layout.h,
      memberObjectIds: layout.memberObjectIds ? [...layout.memberObjectIds] : region.memberObjectIds
    };
  });
}

/**
 * Payload for one stage-drag history step: stage layout + member instance positions.
 * Used by tests to assert undo-friendly atomic updates without a full tldraw editor.
 */
export function buildStageDragUpdatePayload(input: {
  regions: StageRegionRecord[];
  stageId: string;
  delta: { x: number; y: number };
  instances: CanvasInstance[];
}): { regions: StageRegionRecord[]; instances: CanvasInstance[] } {
  const stage = input.regions.find((region) => region.id === input.stageId);
  if (!stage) {
    return { regions: input.regions, instances: input.instances };
  }
  const regions = input.regions.map((region) =>
    region.id === input.stageId
      ? {
          ...region,
          x: region.x + input.delta.x,
          y: region.y + input.delta.y
        }
      : region
  );
  const instances = applyStageRegionDeltaToInstances(input.instances, stage.memberObjectIds, input.delta);
  return { regions, instances };
}
