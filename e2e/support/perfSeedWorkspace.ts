import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createCurrentCaseStudyWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";
import {
  buildScaledWorkspace,
  type WorkspaceScaleSpec
} from "@/features/workspace/workspaceScaleFixtures";

/**
 * Seed payloads for the browser performance baseline.
 *
 * Built through Vite by `e2e/globalSetup.ts` and written to `e2e/.seed/perf-seed.json`,
 * the same mechanism the acceptance seed uses — Playwright's loader cannot resolve the
 * bare JSON imports the case-study fixture relies on.
 *
 * Two deliberate departures from a real project, both of which bound what the numbers
 * may be read to mean:
 *
 * 1. **No image binaries.** Every `assetId` is stripped and `assets` is emptied. The
 *    scaled objects are cloned from the case study and would otherwise point at blobs
 *    this project never installed, turning each render into a failed IndexedDB lookup —
 *    hundreds of misses that are neither representative nor interesting. Installing 500
 *    real blobs would take minutes and exceed the storage quota. So these tiers measure
 *    the canvas, React and persistence paths WITHOUT image decode, and the report must
 *    say so rather than implying a fully loaded project.
 *
 * 2. **Grid layout, not the case study's positions.** Cloned instances would otherwise
 *    stack on 42 repeated coordinates. A grid keeps a realistic subset inside the
 *    viewport at zoom 1 while the full instance count still drives the O(N) paths —
 *    `syncShapesFromEditor` rebuilds every instance on any shape change, and
 *    `syncWorkspaceToEditor` recomputes props for every renderable instance, neither of
 *    which is bounded by what is visible.
 */

const GRID = { startX: 160, startY: 160, stepX: 260, stepY: 210, perRow: 20 };

export type PerfSeedScale = {
  objects: number;
  messages: number;
  contextFrames: number;
  memoryRevisions: number;
  continuityEntries: number;
};

export type PerfSeedTier = {
  key: string;
  label: string;
  projectId: string;
  catalogValue: string;
  workspaceKey: string;
  workspaceValue: string;
  /** UTF-16 length, so a spec can prove the write landed instead of assuming it. */
  workspaceValueLength: number;
  scale: PerfSeedScale;
  /** Grid order. Index 0 is top-left and inside the initial viewport. */
  canvasInstanceIds: string[];
};

export type PerfSeedPayload = {
  catalogKey: string;
  tiers: PerfSeedTier[];
};

const TIERS: { key: string; label: string; spec: WorkspaceScaleSpec }[] = [
  {
    key: "objects100",
    label: "100 个对象",
    spec: { objects: 100, messages: 40, tracedTurns: 6, contextFrames: 12, memoryRevisions: 20, decisionRecords: 32, continuityEntries: 32, rewireRefs: true }
  },
  {
    key: "objects300",
    label: "300 个对象",
    spec: { objects: 300, messages: 40, tracedTurns: 6, contextFrames: 12, memoryRevisions: 20, decisionRecords: 32, continuityEntries: 32, rewireRefs: true }
  },
  {
    key: "objects500",
    label: "500 个对象",
    spec: { objects: 500, messages: 40, tracedTurns: 6, contextFrames: 12, memoryRevisions: 20, decisionRecords: 32, continuityEntries: 32, rewireRefs: true }
  },
  {
    key: "compound500",
    label: "复合最坏情况（500 对象 + 560 消息 + 120 Frame）",
    spec: { objects: 500, messages: 500, tracedTurns: 60, contextFrames: 120, memoryRevisions: 60, decisionRecords: 200, continuityEntries: 200, rewireRefs: true }
  }
];

/** Removes asset references so no render triggers a lookup for a blob that is absent. */
function stripAssets(workspace: MorphoWorkspace): void {
  workspace.assets = {};
  delete workspace.project.coverAssetId;
  for (const object of Object.values(workspace.objects)) {
    const mutable = object as { assetId?: string; extractedAssetId?: string };
    delete mutable.assetId;
    delete mutable.extractedAssetId;
  }
}

/** Lays instances out so the count is real and a realistic subset is on screen. */
function layOutGrid(workspace: MorphoWorkspace): string[] {
  workspace.canvas.view = { x: 0, y: 0, zoom: 1 };
  return workspace.canvas.instances.map((instance, index) => {
    const column = index % GRID.perRow;
    const row = Math.floor(index / GRID.perRow);
    instance.position = {
      x: GRID.startX + column * GRID.stepX,
      y: GRID.startY + row * GRID.stepY
    };
    instance.size = { w: 200, h: 150 };
    return instance.id;
  });
}

export function buildPerfSeedPayload(): PerfSeedPayload {
  const caseStudy = createCurrentCaseStudyWorkspace();

  const tiers = TIERS.map(({ key, label, spec }) => {
    const projectId = `project-perf-${key}`;
    const workspace = buildScaledWorkspace(caseStudy, { ...spec, projectId });
    workspace.project.title = `性能基线 ${label}`;
    stripAssets(workspace);
    const canvasInstanceIds = layOutGrid(workspace);
    const workspaceValue = serializeWorkspace(workspace);

    return {
      key,
      label,
      projectId,
      catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)], projectId)),
      workspaceKey: getProjectWorkspaceStorageKey(projectId),
      workspaceValue,
      workspaceValueLength: workspaceValue.length,
      scale: {
        objects: Object.keys(workspace.objects).length,
        messages: workspace.ai.messages.length,
        contextFrames: workspace.ai.providerContextFrames?.length ?? 0,
        memoryRevisions: Object.keys(workspace.projectMemory.revisions).length,
        continuityEntries: workspace.projectContinuity.recordEntries.length
      },
      canvasInstanceIds
    };
  });

  return { catalogKey: CATALOG_STORAGE_KEY, tiers };
}
