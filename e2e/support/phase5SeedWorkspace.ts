import type {
  AssetRecord,
  CanvasInstance,
  ImageObject,
  MorphoObject,
  MorphoWorkspace
} from "@/domain/morpho/types";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace, serializeWorkspace } from "@/domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";
import {
  buildMessages,
  buildScaledWorkspace,
  cloneJson,
  type WorkspaceScaleSpec
} from "@/features/workspace/workspaceScaleFixtures";

/**
 * Phase 5 seed payloads — real interaction latency atlas.
 *
 * Departures from the phase 4A tiers, each bounding what its numbers mean:
 *
 * 1. **Asset tiers carry REAL binaries.** The 4A fixture stripped every `assetId`
 *    because installing hundreds of blobs was out of scope. Phase 5 exists to close
 *    that gap: `assets10/30/80` ship AssetRecords plus a deterministic manifest; the
 *    browser regenerates identical PNGs from the manifest (seeded PRNG + OffscreenCanvas)
 *    and writes them into IndexedDB before the app loads. No binary is committed;
 *    the same seed always produces the same bytes.
 * 2. **`caseStudy`/`chatLong`/`objects500` stay binary-free** so their numbers remain
 *    comparable with the 4A baseline rows for the same paths.
 * 3. **Dedicated `switchA`/`switchB`/`importBase` projects** exist because project
 *    switching and import are first-class interactions in Phase 5, not side effects
 *    of reusing a canvas tier.
 */

export type Phase5AssetManifestEntry = {
  assetId: string;
  storageKey: string;
  width: number;
  height: number;
  seed: number;
};

export type Phase5SeedProject = {
  key: string;
  projectId: string;
  workspaceKey: string;
  workspaceValue: string;
  workspaceValueLength: number;
  scale: Record<string, number>;
  assets: Phase5AssetManifestEntry[];
};

export type Phase5SeedPayload = {
  catalogKey: string;
  catalogValue: string;
  projects: Phase5SeedProject[];
};

const GRID = { startX: 160, startY: 160, stepX: 300, stepY: 260, perRow: 6 };
const ASSET_IMAGE_SIZE = { width: 640, height: 480 };

/** Removes dangling asset references from cloned-from-case-study objects. */
function stripAssets(workspace: MorphoWorkspace): void {
  workspace.assets = {};
  delete workspace.project.coverAssetId;
  for (const object of Object.values(workspace.objects)) {
    const mutable = object as { assetId?: string; extractedAssetId?: string };
    delete mutable.assetId;
    delete mutable.extractedAssetId;
  }
}

function layOutGrid(workspace: MorphoWorkspace): void {
  workspace.canvas.view = { x: 0, y: 0, zoom: 1 };
  workspace.canvas.instances.forEach((instance, index) => {
    const column = index % GRID.perRow;
    const row = Math.floor(index / GRID.perRow);
    instance.position = {
      x: GRID.startX + column * GRID.stepX,
      y: GRID.startY + row * GRID.stepY
    };
    instance.size = { w: 240, h: 180 };
  });
}

function scaleOf(workspace: MorphoWorkspace): Record<string, number> {
  return {
    objects: Object.keys(workspace.objects).length,
    messages: workspace.ai.messages.length,
    assets: Object.keys(workspace.assets).length,
    contextFrames: workspace.ai.providerContextFrames?.length ?? 0,
    continuityEntries: workspace.projectContinuity.recordEntries.length
  };
}

function tieredProject(
  key: string,
  caseStudy: MorphoWorkspace,
  spec: WorkspaceScaleSpec
): Phase5SeedProject {
  const projectId = `project-p5-${key}`;
  const workspace = buildScaledWorkspace(caseStudy, { ...spec, projectId });
  stripAssets(workspace);
  layOutGrid(workspace);
  workspace.project.title = `P5 ${key}`;
  const workspaceValue = serializeWorkspace(workspace);
  return {
    key,
    projectId,
    workspaceKey: getProjectWorkspaceStorageKey(projectId),
    workspaceValue,
    workspaceValueLength: workspaceValue.length,
    scale: scaleOf(workspace),
    assets: []
  };
}

/**
 * An image-heavy project whose every image resolves to a real regenerated PNG in
 * IndexedDB. Plus a small base of non-image objects so the workspace is not a
 * pure image wall (real projects mix types).
 */
function assetProject(key: string, caseStudy: MorphoWorkspace, imageCount: number): Phase5SeedProject {
  const projectId = `project-p5-${key}`;
  const workspace = createBlankWorkspace(projectId);
  workspace.project.title = `P5 ${key}`;

  const imageSources = Object.values(caseStudy.objects).filter((object) => object.type === "image");
  const otherSources = Object.values(caseStudy.objects).filter((object) => object.type !== "image").slice(0, 10);
  if (imageSources.length === 0) {
    throw new Error("Case study has no image objects; regenerate the fixture.");
  }

  const instances: CanvasInstance[] = [];
  const addInstance = (objectId: string, index: number) => {
    const column = index % GRID.perRow;
    const row = Math.floor(index / GRID.perRow);
    instances.push({
      id: `instance-p5-${index}`,
      objectId,
      position: { x: GRID.startX + column * GRID.stepX, y: GRID.startY + row * GRID.stepY },
      size: { w: 240, h: 180 }
    });
  };

  let slot = 0;
  for (let index = 0; index < imageCount; index += 1) {
    const source = imageSources[index % imageSources.length] as Extract<MorphoObject, { type: "image" }>;
    const objectId = `object-p5-img-${index}`;
    const assetId = `asset-p5-${index}`;
    const object = cloneJson(source);
    object.id = objectId as MorphoObject["id"];
    object.title = `合成图片 ${index + 1}`;
    object.assetId = assetId as ImageObject["assetId"];
    delete object.directionId;
    delete object.visualBranchId;
    delete object.isDefaultReference;
    delete object.pendingReview;
    delete object.generation;
    workspace.objects[objectId] = object;

    const record: AssetRecord = {
      id: assetId as AssetRecord["id"],
      fileName: `p5-synthetic-${index + 1}.png`,
      mimeType: "image/png",
      size: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      storageKey: `blob:${assetId}`,
      sourceType: index % 4 === 3 ? "aiGeneratedImage" : "originalImage",
      width: ASSET_IMAGE_SIZE.width,
      height: ASSET_IMAGE_SIZE.height,
      aspectRatio: ASSET_IMAGE_SIZE.width / ASSET_IMAGE_SIZE.height
    };
    workspace.assets[assetId] = record;
    addInstance(objectId, slot);
    slot += 1;
  }

  otherSources.forEach((source, index) => {
    const objectId = `object-p5-other-${index}`;
    const object = cloneJson(source);
    object.id = objectId as MorphoObject["id"];
    workspace.objects[objectId] = object;
    addInstance(objectId, slot);
    slot += 1;
  });

  workspace.canvas.instances = instances;
  workspace.canvas.view = { x: 0, y: 0, zoom: 1 };
  workspace.ai.messages = buildMessages(caseStudy.ai.messages, 40);

  const workspaceValue = serializeWorkspace(workspace);
  return {
    key,
    projectId,
    workspaceKey: getProjectWorkspaceStorageKey(projectId),
    workspaceValue,
    workspaceValueLength: workspaceValue.length,
    scale: scaleOf(workspace),
    assets: Array.from({ length: imageCount }, (_, index) => ({
      assetId: `asset-p5-${index}`,
      storageKey: `blob:asset-p5-${index}`,
      width: ASSET_IMAGE_SIZE.width,
      height: ASSET_IMAGE_SIZE.height,
      seed: 0x5eed0000 + index
    }))
  };
}

export function buildPhase5SeedPayload(): Phase5SeedPayload {
  const caseStudy = createCurrentCaseStudyWorkspace();

  const projects: Phase5SeedProject[] = [
    tieredProject("objects500", caseStudy, {
      objects: 500,
      messages: 40,
      tracedTurns: 6,
      contextFrames: 12,
      memoryRevisions: 20,
      decisionRecords: 32,
      continuityEntries: 32,
      rewireRefs: true
    }),
    tieredProject("chatLong", caseStudy, {
      objects: 40,
      messages: 500,
      tracedTurns: 60,
      contextFrames: 12,
      memoryRevisions: 20,
      decisionRecords: 32,
      continuityEntries: 32,
      rewireRefs: true
    }),
    tieredProject("switchA", caseStudy, {
      objects: 60,
      messages: 40,
      tracedTurns: 4,
      contextFrames: 8,
      memoryRevisions: 12,
      decisionRecords: 16,
      continuityEntries: 16,
      rewireRefs: true
    }),
    tieredProject("switchB", caseStudy, {
      objects: 60,
      messages: 40,
      tracedTurns: 4,
      contextFrames: 8,
      memoryRevisions: 12,
      decisionRecords: 16,
      continuityEntries: 16,
      rewireRefs: true
    }),
    tieredProject("importBase", caseStudy, {
      objects: 30,
      messages: 30,
      tracedTurns: 4,
      contextFrames: 6,
      memoryRevisions: 10,
      decisionRecords: 12,
      continuityEntries: 12,
      rewireRefs: true
    }),
    assetProject("assets10", caseStudy, 10),
    assetProject("assets30", caseStudy, 30),
    assetProject("assets80", caseStudy, 80)
  ];

  // The case study is seeded as its own project (id rebased) so the AI tiers have a
  // real ~184-message history, but with binaries stripped for comparability with 4A.
  const caseStudyClone = cloneJson(caseStudy);
  caseStudyClone.project = { ...caseStudyClone.project, id: "project-p5-casestudy", title: "P5 案例研究" };
  stripAssets(caseStudyClone);
  const caseStudyValue = serializeWorkspace(caseStudyClone);
  projects.push({
    key: "caseStudy",
    projectId: "project-p5-casestudy",
    workspaceKey: getProjectWorkspaceStorageKey("project-p5-casestudy"),
    workspaceValue: caseStudyValue,
    workspaceValueLength: caseStudyValue.length,
    scale: scaleOf(caseStudyClone),
    assets: []
  });

  const summaries = projects.map((project) => {
    const parsed = JSON.parse(project.workspaceValue) as MorphoWorkspace;
    return summarizeProject(parsed);
  });

  return {
    catalogKey: CATALOG_STORAGE_KEY,
    catalogValue: JSON.stringify(createCatalog(summaries, "project-p5-objects500")),
    projects
  };
}
