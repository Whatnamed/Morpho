import type {
  CanvasInstance,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  StageRegionBorderStyle,
  StageRegionColorKey,
  StageRegionKey,
  StageRegionRecord
} from "./types";

export type { StageRegionBorderStyle, StageRegionColorKey, StageRegionKey, StageRegionRecord };

export type StageRegionStyle = Required<
  Pick<StageRegionRecord, "colorKey" | "fillOpacity" | "backgroundVisible" | "borderStyle" | "locked" | "isActivated">
>;

export type StageRegionColorPreset = {
  key: StageRegionColorKey;
  label: string;
  fill: string;
  border: string;
  title: string;
};

export const STAGE_REGION_COLOR_PRESETS: readonly StageRegionColorPreset[] = [
  { key: "warmSand", label: "暖米色", fill: "rgb(238 224 201)", border: "rgb(174 143 101)", title: "rgb(122 91 57)" },
  { key: "mistBlue", label: "雾蓝", fill: "rgb(213 227 234)", border: "rgb(117 148 164)", title: "rgb(73 107 125)" },
  { key: "sage", label: "浅灰绿", fill: "rgb(218 230 218)", border: "rgb(125 151 128)", title: "rgb(79 110 84)" },
  { key: "violetGray", label: "淡紫灰", fill: "rgb(226 221 235)", border: "rgb(143 128 163)", title: "rgb(99 82 123)" },
  { key: "clay", label: "浅陶色", fill: "rgb(238 218 206)", border: "rgb(174 126 102)", title: "rgb(128 82 61)" },
  { key: "warmGray", label: "中性暖灰", fill: "rgb(228 225 219)", border: "rgb(143 134 122)", title: "rgb(97 89 79)" }
] as const;

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

const DEFAULT_COLOR_BY_STAGE: Record<StageRegionKey, StageRegionColorKey> = {
  research: "warmSand",
  definition: "mistBlue",
  visual: "violetGray",
  delivery: "sage"
};

const COLOR_KEYS = new Set<StageRegionColorKey>(STAGE_REGION_COLOR_PRESETS.map((preset) => preset.key));
const BORDER_STYLES = new Set<StageRegionBorderStyle>(["none", "solid", "dashed"]);

export function getStageRegionColorPreset(colorKey: StageRegionColorKey): StageRegionColorPreset {
  return STAGE_REGION_COLOR_PRESETS.find((preset) => preset.key === colorKey) ?? STAGE_REGION_COLOR_PRESETS[0];
}

export function getDefaultStageRegionStyle(key: StageRegionKey): StageRegionStyle {
  return {
    colorKey: DEFAULT_COLOR_BY_STAGE[key],
    fillOpacity: 16,
    backgroundVisible: true,
    borderStyle: "solid",
    locked: false,
    isActivated: false
  };
}

export function normalizeStageRegionRecord(record: StageRegionRecord): StageRegionRecord & StageRegionStyle {
  const defaults = getDefaultStageRegionStyle(record.key);
  const colorKey = record.colorKey && COLOR_KEYS.has(record.colorKey) ? record.colorKey : defaults.colorKey;
  const borderStyle = record.borderStyle && BORDER_STYLES.has(record.borderStyle) ? record.borderStyle : defaults.borderStyle;
  return {
    ...record,
    colorKey,
    fillOpacity: clampStageOpacity(record.fillOpacity ?? defaults.fillOpacity),
    backgroundVisible: record.backgroundVisible ?? defaults.backgroundVisible,
    borderStyle,
    locked: record.locked ?? defaults.locked,
    // Old projects with members are already active; empty projects stay quiet.
    isActivated: record.isActivated ?? record.memberObjectIds.length > 0
  };
}

/**
 * Semantic home for a canvas object. Canvas coordinates never decide membership.
 */
export function resolveStageRegionForObject(object: MorphoObject): StageRegionKey | null {
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
      return "definition";
    case "proposalDraft":
      switch (object.proposalType) {
        case "researchAnalysis":
          return "research";
        case "conceptDirection":
          return "visual";
        case "deliveryPlan":
          return "delivery";
        case "designDefinition":
        default:
          return "definition";
      }
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

/** @deprecated Prefer resolveStageRegionForObject for new callers. */
export const classifyStageRegionKey = resolveStageRegionForObject;

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

export function buildInitialStageRegions(workspace: MorphoWorkspace): Array<StageRegionRecord & StageRegionStyle> {
  const membersByKey: Record<StageRegionKey, MorphoObjectId[]> = {
    research: [],
    definition: [],
    visual: [],
    delivery: []
  };

  for (const object of Object.values(workspace.objects)) {
    const key = resolveStageRegionForObject(object);
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
      memberObjectIds,
      ...getDefaultStageRegionStyle(def.key),
      isActivated: memberObjectIds.length > 0
    };
  });
}

export function getStageRegions(workspace: MorphoWorkspace): Array<StageRegionRecord & StageRegionStyle> {
  const existing = workspace.canvas.stageRegions;
  if (existing && existing.length === STAGE_REGION_DEFS.length) {
    return existing.map(normalizeStageRegionRecord);
  }
  return buildInitialStageRegions(workspace);
}

/**
 * Ensure four stage records exist. New objects join their semantic home once;
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

  const normalizedCurrent = current.map(normalizeStageRegionRecord);
  const assigned = new Set<MorphoObjectId>();
  for (const region of normalizedCurrent) {
    for (const id of region.memberObjectIds) {
      assigned.add(id);
    }
  }

  let changed = !areStageRegionRecordsEqual(current, normalizedCurrent);
  const nextRegions = normalizedCurrent.map((region) => {
    const additions: MorphoObjectId[] = [];
    for (const object of Object.values(workspace.objects)) {
      if (assigned.has(object.id)) {
        continue;
      }
      if (resolveStageRegionForObject(object) !== region.key) {
        continue;
      }
      additions.push(object.id);
      assigned.add(object.id);
    }

    // Hidden objects remain members. Missing objects are deleted and cleaned up.
    const kept = region.memberObjectIds.filter((id) => {
      const object = workspace.objects[id];
      return Boolean(object);
    });
    const dropped = kept.length !== region.memberObjectIds.length;
    const isActivated = region.isActivated || additions.length > 0;
    if (additions.length === 0 && !dropped && isActivated === region.isActivated) {
      return region;
    }
    changed = true;
    return {
      ...region,
      memberObjectIds: [...kept, ...additions],
      isActivated
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

export function hasVisibleStageRegionMembers(workspace: MorphoWorkspace, stageId: string): boolean {
  const region = getStageRegions(workspace).find((item) => item.id === stageId);
  if (!region) {
    return false;
  }
  return region.memberObjectIds.some((id) => workspace.objects[id]?.visibility === "active");
}

/** Explicit action only — normal object movement never changes region bounds. */
export function fitStageRegionToVisibleMembers(workspace: MorphoWorkspace, stageId: string): MorphoWorkspace {
  const region = getStageRegions(workspace).find((item) => item.id === stageId);
  if (!region || region.locked || !hasVisibleStageRegionMembers(workspace, stageId)) {
    return workspace;
  }
  const nextBounds = computeStageBoundsFromMembers(workspace, region.key, region.memberObjectIds);
  if (
    Math.abs(nextBounds.x - region.x) < 0.001 &&
    Math.abs(nextBounds.y - region.y) < 0.001 &&
    Math.abs(nextBounds.w - region.w) < 0.001 &&
    Math.abs(nextBounds.h - region.h) < 0.001
  ) {
    return workspace;
  }
  return updateStageRegionLayout(workspace, [{ id: region.id, ...nextBounds }]);
}

export function updateStageRegionStyle(
  workspace: MorphoWorkspace,
  stageId: string,
  patch: Partial<Pick<StageRegionRecord, "colorKey" | "fillOpacity" | "backgroundVisible" | "borderStyle" | "locked">>
): MorphoWorkspace {
  const regions = getStageRegions(workspace);
  const nextRegions = regions.map((region) =>
    region.id === stageId
      ? normalizeStageRegionRecord({
          ...region,
          ...patch
        })
      : region
  );
  if (areStageRegionRecordsEqual(workspace.canvas.stageRegions, nextRegions)) {
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

export function resetStageRegionStyle(workspace: MorphoWorkspace, stageId: string): MorphoWorkspace {
  const regions = getStageRegions(workspace);
  const nextRegions = regions.map((region) => {
    if (region.id !== stageId) {
      return region;
    }
    const defaults = getDefaultStageRegionStyle(region.key);
    return {
      ...region,
      colorKey: defaults.colorKey,
      fillOpacity: defaults.fillOpacity,
      backgroundVisible: defaults.backgroundVisible,
      borderStyle: defaults.borderStyle
    };
  });
  if (areStageRegionRecordsEqual(workspace.canvas.stageRegions, nextRegions)) {
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
      a.colorKey !== b.colorKey ||
      a.fillOpacity !== b.fillOpacity ||
      a.backgroundVisible !== b.backgroundVisible ||
      a.borderStyle !== b.borderStyle ||
      a.locked !== b.locked ||
      a.isActivated !== b.isActivated ||
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
  layouts: Array<
    Pick<StageRegionRecord, "id" | "x" | "y" | "w" | "h"> &
      Partial<Pick<StageRegionRecord, "memberObjectIds" | "colorKey" | "fillOpacity" | "backgroundVisible" | "borderStyle" | "locked">>
  >
): StageRegionRecord[] {
  const byId = new Map(layouts.map((item) => [item.id, item]));
  return base.map((region) => {
    const layout = byId.get(region.id);
    if (!layout) {
      return region;
    }
    return normalizeStageRegionRecord({
      ...region,
      x: layout.x,
      y: layout.y,
      w: layout.w,
      h: layout.h,
      memberObjectIds: layout.memberObjectIds ? [...layout.memberObjectIds] : region.memberObjectIds,
      colorKey: layout.colorKey ?? region.colorKey,
      fillOpacity: layout.fillOpacity ?? region.fillOpacity,
      backgroundVisible: layout.backgroundVisible ?? region.backgroundVisible,
      borderStyle: layout.borderStyle ?? region.borderStyle,
      locked: layout.locked ?? region.locked,
      // Activation is semantic: only ensureStageRegions may turn a stage on.
      isActivated: region.isActivated
    });
  });
}

function clampStageOpacity(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
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
