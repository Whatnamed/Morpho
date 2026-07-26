import type { AssetId, ImageObject, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import {
  createBlankWorkspace,
  createCurrentCaseStudyWorkspace,
  serializeWorkspace,
  setDefaultReference
} from "@/domain/morpho/workspace";
import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudy";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";

/**
 * Seed data for the browser acceptance suite.
 *
 * This module is loaded through Vite by `e2e/globalSetup.ts` and its output is
 * written to `e2e/.seed/seed.json`. The specs read that file instead of
 * importing the domain layer, because Playwright's loader cannot resolve the
 * bare JSON imports the case-study fixture relies on. Regenerating on every run
 * keeps the seed in lockstep with the domain code rather than drifting as a
 * committed snapshot would.
 *
 * The seed is carved out of the deployable case study so object payloads are real,
 * but it keeps only five objects: no test then depends on the 40 MB case-study
 * asset install, and every object sits inside the initial viewport so canvas
 * interaction needs no camera nudging. References into dropped records are
 * stripped rather than left dangling — except one deliberate link, `derivedImage`,
 * which is generated from the default reference so the anchor-replacement flow has
 * something real to offer as "mark for review".
 */

export const SEED_PROJECT_ID = "project-e2e-seed";
export const BLANK_PROJECT_ID = "project-e2e-blank";
export const TEXT_ONLY_PROJECT_ID = "project-e2e-text-only";

/**
 * Positions are chosen against the 1440x900 acceptance viewport so that every
 * object is on screen and its selection toolbar has room to open without hitting
 * the AI panel (x >= 986) or the left rail. The toolbar legitimately hides when it
 * would collide, so a badly placed fixture would look like a product failure.
 */
const SEED_POSITIONS = [
  { x: 140, y: 140, w: 240, h: 190 },
  { x: 430, y: 140, w: 240, h: 190 },
  { x: 140, y: 400, w: 280, h: 150 },
  { x: 460, y: 400, w: 280, h: 150 },
  { x: 140, y: 620, w: 240, h: 180 }
];

export type SeedPayload = {
  caseStudyProjectId: string;
  blankProjectId: string;
  seedProjectId: string;
  seedProjectTitle: string;
  catalogKey: string;
  catalogValue: string;
  workspaceKey: string;
  workspaceValue: string;
  /**
   * A project with no image assets. Exporting an editable backup embeds every
   * asset binary, and the seed's images point at case-study blobs this project
   * never installed — which correctly blocks the export. Backup round-trip tests
   * therefore use this project instead of weakening the integrity check.
   */
  textOnly: {
    projectId: string;
    catalogValue: string;
    workspaceKey: string;
    workspaceValue: string;
    objectIds: { keyConclusion: string; research: string };
  };
  objectIds: {
    defaultReferenceImage: string;
    otherImage: string;
    keyConclusion: string;
    research: string;
    derivedImage: string;
  };
  objectTitles: {
    defaultReferenceImage: string;
    otherImage: string;
    keyConclusion: string;
    research: string;
    derivedImage: string;
  };
  canvasInstanceIds: Record<string, string>;
};

/** Drops references to records the seed does not carry, so the workspace stays consistent. */
function detach(object: MorphoObject): MorphoObject {
  const detached = structuredClone(object);
  if (detached.type === "image") {
    delete detached.directionId;
    delete detached.visualBranchId;
    detached.isDefaultReference = false;
    delete detached.pendingReview;
    if (detached.generation) {
      detached.generation = { ...detached.generation, referenceObjectIds: [] };
    }
  }
  if ("sourceObjectIds" in detached) {
    (detached as unknown as { sourceObjectIds: string[] }).sourceObjectIds = [];
  }
  if ("citationIds" in detached) {
    (detached as unknown as { citationIds: string[] }).citationIds = [];
  }
  return detached;
}

export function buildSeedPayload(): SeedPayload {
  const caseStudy = createCurrentCaseStudyWorkspace();
  const active = Object.values(caseStudy.objects).filter((object) => object.visibility === "active");
  const images = active.filter((object): object is ImageObject => object.type === "image");
  const keyConclusion = active.find((object) => object.type === "keyConclusion");
  const research = active.find((object) => object.type === "research");
  const [defaultReferenceImage, otherImage] = images;
  const derivedImageSource = images.find(
    (image) => image.generation && image.id !== defaultReferenceImage?.id && image.id !== otherImage?.id
  );

  if (!defaultReferenceImage || !otherImage || !keyConclusion || !research || !derivedImageSource) {
    throw new Error("Case study fixture no longer has the objects the e2e seed needs.");
  }

  const ordered = [defaultReferenceImage, otherImage, keyConclusion, research, derivedImageSource];
  const base = createBlankWorkspace(SEED_PROJECT_ID);
  base.project.title = "验收样本项目";
  base.canvas.view = { x: 0, y: 0, zoom: 1 };
  base.ui.canvasView = { x: 0, y: 0, zoom: 1 };

  const canvasInstanceIds: Record<string, string> = {};
  for (const [index, object] of ordered.entries()) {
    const detached = detach(object);
    base.objects[detached.id] = detached;
    const slot = SEED_POSITIONS[index] as (typeof SEED_POSITIONS)[number];
    const instanceId = `canvas-e2e-${index}`;
    canvasInstanceIds[detached.id] = instanceId;
    base.canvas.instances.push({
      id: instanceId,
      objectId: detached.id,
      position: { x: slot.x, y: slot.y },
      size: { w: slot.w, h: slot.h }
    });
  }

  const referencedAssetIds = new Set(
    ordered
      .map((object) => (object.type === "image" ? object.assetId : undefined))
      .filter((assetId): assetId is AssetId => Boolean(assetId))
  );
  for (const assetId of referencedAssetIds) {
    const asset = caseStudy.assets[assetId];
    if (asset) {
      base.assets[assetId] = structuredClone(asset);
    }
  }

  // One image is deliberately left generated from the default reference, so that
  // replacing the anchor really has derived material to offer for review.
  const derived = base.objects[derivedImageSource.id];
  if (derived?.type !== "image") {
    throw new Error("Seed lost its derived image object.");
  }
  if (!derived.generation) {
    throw new Error("Seed derived image lost its generation record.");
  }
  derived.role = "conceptImage";
  derived.generation = { ...derived.generation, referenceObjectIds: [defaultReferenceImage.id] };

  const workspace: MorphoWorkspace = setDefaultReference(base, defaultReferenceImage.id, {
    reason: "验收样本：预置后续默认参考。"
  });

  const textOnly = createBlankWorkspace(TEXT_ONLY_PROJECT_ID);
  textOnly.project.title = "纯文本样本项目";
  textOnly.canvas.view = { x: 0, y: 0, zoom: 1 };
  textOnly.ui.canvasView = { x: 0, y: 0, zoom: 1 };
  for (const [index, object] of [keyConclusion, research].entries()) {
    const detached = detach(object);
    textOnly.objects[detached.id] = detached;
    const slot = SEED_POSITIONS[index] as (typeof SEED_POSITIONS)[number];
    textOnly.canvas.instances.push({
      id: `canvas-e2e-text-${index}`,
      objectId: detached.id,
      position: { x: slot.x, y: slot.y },
      size: { w: slot.w, h: slot.h }
    });
  }

  return {
    caseStudyProjectId: CURRENT_CASE_STUDY_ID,
    blankProjectId: BLANK_PROJECT_ID,
    seedProjectId: SEED_PROJECT_ID,
    seedProjectTitle: workspace.project.title,
    catalogKey: CATALOG_STORAGE_KEY,
    catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)], SEED_PROJECT_ID)),
    workspaceKey: getProjectWorkspaceStorageKey(SEED_PROJECT_ID),
    workspaceValue: serializeWorkspace(workspace),
    textOnly: {
      projectId: TEXT_ONLY_PROJECT_ID,
      catalogValue: JSON.stringify(createCatalog([summarizeProject(textOnly)], TEXT_ONLY_PROJECT_ID)),
      workspaceKey: getProjectWorkspaceStorageKey(TEXT_ONLY_PROJECT_ID),
      workspaceValue: serializeWorkspace(textOnly),
      objectIds: { keyConclusion: keyConclusion.id, research: research.id }
    },
    objectIds: {
      defaultReferenceImage: defaultReferenceImage.id,
      otherImage: otherImage.id,
      keyConclusion: keyConclusion.id,
      research: research.id,
      derivedImage: derivedImageSource.id
    },
    objectTitles: {
      defaultReferenceImage: defaultReferenceImage.title,
      otherImage: otherImage.title,
      keyConclusion: keyConclusion.title,
      research: research.title,
      derivedImage: derivedImageSource.title
    },
    canvasInstanceIds
  };
}
