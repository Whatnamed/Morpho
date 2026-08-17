import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import {
  installAgentMock,
  releaseAgentStream,
  setAgentRequestScript,
  setAgentResponse,
  agentCalls,
  agentRequestScriptState
} from "./fixtures/agentMock";
import {
  armFeedback,
  beginPerfPhase,
  collectIoStats,
  endPerfPhase,
  installPerfProbe,
  readFeedback,
  readProbeSupport,
  type PerfIoStats,
  type PerfPhaseSamples,
  type FeedbackResult
} from "./fixtures/perfProbe";
import { phase5Project, seedPhase5AssetBlobs, seedPhase5Projects } from "./fixtures/phase5Seed";
import { textAnswerScript, toolCallTurnScript } from "./support/agentSse";
import { buildPdf, buildPng, buildPptx, buildTextFile } from "./support/importFiles";

/**
 * Phase 5 browser half: the real-interaction latency atlas.
 *
 * Like `performance-baseline.spec.ts` this spec MEASURES and does not judge; the
 * three kinds of assertion are the same anti-fake guards (seed wrote, canvas
 * mounted, probes produced data), plus behavioural safety checks the task asks to
 * keep true while measuring (streaming auto-scroll, scroll-up not forced back).
 *
 * What is new in Phase 5, and why:
 * - operation windows open at the input handoff (`armFeedback`) and close at the
 *   first DOM change, so first-feedback latency is measured in page time, not CDP
 *   round-trip time;
 * - browser-API IO attribution (localStorage / IndexedDB / object URLs) is enabled
 *   for every project here, so a phase can say which side of the fence the time
 *   went to;
 * - asset tiers carry real regenerated PNG binaries in the real BlobStore;
 * - import phases drive the real file-chooser handoff with generated PDF/PPTX/PNG;
 * - project switch, asset drawer, search, records, archive export are first-class
 *   phases.
 *
 * Never runs in CI (config excludes it from the chromium project).
 */

const REPORT_PATH = resolve(process.cwd(), "docs/operations/performance-phase5.generated.json");

const DRAG_STEPS = 60;
const DRAG_INTERVAL_MS = 16;
const TYPING_TEXT = "把这个方向再往结构化收一收，重点说明它和现有设计定义之间的关系，并给出可以继续展开的角度。";

type AtlasEntry = {
  area: string;
  project: string;
  phase: string;
  /** Absent when the phase itself carries the scale (e.g. click counts in extra). */
  scale?: Record<string, number>;
  samples: PerfPhaseSamples;
  io?: PerfIoStats;
  feedback?: FeedbackResult | null;
  extra?: Record<string, unknown>;
};

type PersistedWorkspaceSnapshot = {
  objects: Record<string, {
    type: string;
    assetId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    parseStatus?: string;
    parseError?: string;
    parsedAt?: string;
    extractedAssetId?: string;
    extractedCharCount?: number;
    extractedPageCount?: number;
    sourcePageCount?: number;
    extractionTruncated?: boolean;
  }>;
  assets: Record<string, {
    id?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    sourceType?: string;
  }>;
};

type BuildIdentity = {
  sourceSha: string | null;
  buildId: string | null;
  artifactSha256: string | null;
};

type ImportedFileEvidence = {
  fileName: string;
  objectId: string;
  assetId: string;
  mimeType: string | null;
  size: number | null;
  parseStatus: string | null;
  parsedAt: string | null;
  parseError: string | null;
  extractedAssetId: string | null;
  extractedCharCount: number | null;
  extractedPageCount: number | null;
  sourcePageCount: number | null;
  extractionTruncated: boolean | null;
  extractedAssetSourceType: string | null;
};

const PARSEABLE_IMPORT_FILENAMES = [
  "p5-fixture-30p.pdf",
  "p5-fixture-40slides.pptx",
  "p5-fixture-150p.pdf",
  "p5-mixed-notes.md",
  "p5-mixed-8p.pdf"
] as const;

const collected: AtlasEntry[] = [];
const importedFileEvidence = new Map<string, ImportedFileEvidence>();
let buildIdentity: BuildIdentity | null = null;

const MANDATORY_PHASE_KEYS = new Set([
  "lifecycle/objects500/openProject(load)",
  "lifecycle/objects500/backToProjectList",
  "lifecycle/switchB/openFromList",
  "lifecycle/switchA/directSwitchBtoA",
  ...[
    "selection", "drag", "boxSelect", "selectAll", "pan", "zoomSingle", "zoomContinuous",
    "addObjectPasteText", "deleteObject", "toolbarHideObject"
  ].map((phase) => `canvas/objects500/${phase}`),
  ...["caseStudy", "chatLong", "objects500"].flatMap((project) =>
    ["typing", "sendAndStream", "autoScrollAtRest", "toolCallTurn", "scrollUpDuringStream"]
      .map((phase) => `ai/${project}/${phase}`)
  ),
  ...["assets10", "assets30", "assets80"].flatMap((project) =>
    ["openWithBinaries", "assetDrawerFirstOpen", "assetFilter", "assetDrawerReopen", "selectImageDetail"]
      .map((phase) => `assets/${project}/${phase}`)
  ),
  "assets/assets30/assetDrawerShowAll",
  "assets/assets80/assetDrawerShowAll",
  ...["imagePng", "pdf30p", "pptx40", "pdf150p", "mixedBatch"]
    .map((phase) => `import/importBase/${phase}`),
  ...["searchDrawerOpen", "searchQuery", "recordsDrawerOpen", "deliveryPrepOpen"]
    .map((phase) => `surfaces/caseStudy/${phase}`),
  ...["archivePanelOpen", "archiveExportBackupZip", "archiveExportHumanZip", "defaultReferenceConfirm", "deletionPreview"]
    .map((phase) => `surfaces/builtinCaseStudy/${phase}`)
]);

const OPTIONAL_PHASE_KEYS = new Set(["assets/assets10/assetDrawerShowAll"]);

function readGitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Placeholder samples for behavioural-only entries (no window was measured). */
function zeroSamples(): PerfPhaseSamples {
  return {
    commitCount: 0, commitTimestamps: [], loafCount: 0, longestLoafMs: 0, longestBlockingMs: 0,
    totalLoafMs: 0, totalBlockingMs: 0, slowEventCount: 0, slowEventProcessingP95Ms: 0,
    slowEventProcessingMaxMs: 0, slowEventTotalProcessingMs: 0, firstSlowEventMs: null,
    lastSlowEventMs: null, pointerMoveCount: 0, keyPressCount: 0, pointerRateHz: null,
    frameCount: 0, windowMs: 0
  };
}

function phaseKey(entry: Pick<AtlasEntry, "area" | "project" | "phase">): string {
  return `${entry.area}/${entry.project}/${entry.phase}`;
}

function record(entry: AtlasEntry): void {
  const key = phaseKey(entry);
  if (collected.some((existing) => phaseKey(existing) === key)) {
    throw new Error(`Phase 5 phase key was recorded twice: ${key}`);
  }
  collected.push(entry);
  const { samples, feedback, extra } = entry;
  const first =
    feedback && feedback.firstChangeAt !== null && feedback.firstInputAt !== null
      ? (feedback.firstChangeAt - feedback.firstInputAt).toFixed(1)
      : "—";
  console.log(
    `   [${entry.area}/${entry.project}] ${entry.phase.padEnd(22)} commit ${String(samples.commitCount).padStart(4)} · ` +
      `最长阻塞 ${samples.longestBlockingMs.toFixed(1).padStart(7)} ms · 累计阻塞 ${samples.totalBlockingMs.toFixed(1).padStart(8)} ms · ` +
      `慢事件p95 ${samples.slowEventProcessingP95Ms.toFixed(1).padStart(6)} ms · 首反馈 ${first} ms` +
      (extra && Object.keys(extra).length > 0 ? ` · ${JSON.stringify(extra)}` : "")
  );
}

async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Compressed size of a produced archive download, for the zip crossover story. */
async function downloadBytes(download: Download): Promise<number | null> {
  try {
    const path = await download.path();
    if (!path) {
      return null;
    }
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function markNow(page: Page, name: string): Promise<void> {
  await page.evaluate((markName) => window.__morphoPerfMark?.(markName), name);
}

/** In-page wait until more morpho shapes exist than `previous`; returns page time. */
async function waitForShapeCountAbove(page: Page, previous: number): Promise<number> {
  await page.waitForFunction(
    (prev) => document.querySelectorAll(".morpho-shape-host").length > prev,
    previous
  );
  return pageNow(page);
}

async function shapeCentres(page: Page, count: number): Promise<{ x: number; y: number }[]> {
  return page.evaluate((wanted: number) => {
    const centres: { x: number; y: number }[] = [];
    for (const host of Array.from(document.querySelectorAll(".morpho-shape-host"))) {
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.top > 80 && rect.bottom < window.innerHeight - 80 && rect.right < 960) {
        centres.push({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      }
      if (centres.length >= wanted) {
        break;
      }
    }
    return centres;
  }, count);
}

type ImageShapeTarget = {
  objectId: string;
  x: number;
  y: number;
};

async function imageShapeTargets(page: Page, excludedObjectIds: readonly string[] = []): Promise<ImageShapeTarget[]> {
  return page.evaluate((excluded) => {
    const workspaceKey = "morpho.project.project-morpho-case-study.workspace.v1";
    const raw = window.localStorage.getItem(workspaceKey);
    if (!raw) {
      return [];
    }
    const workspace = JSON.parse(raw) as {
      canvas?: { instances?: Array<{ id?: string; objectId?: string }> };
    };
    const objectByInstanceId = new Map(
      (workspace.canvas?.instances ?? [])
        .filter((instance): instance is { id: string; objectId: string } => Boolean(instance.id && instance.objectId))
        .map((instance) => [instance.id, instance.objectId])
    );
    const excludedIds = new Set(excluded);
    const aiPanel = document.querySelector(".ai-panel")?.getBoundingClientRect();
    const rightBoundary = Math.min(
      window.innerWidth - 12,
      aiPanel && aiPanel.left > 0 ? aiPanel.left - 16 : window.innerWidth - 12
    );
    const targets: ImageShapeTarget[] = [];
    for (const shape of Array.from(document.querySelectorAll<HTMLElement>(".tl-shape"))) {
      if (!shape.querySelector(".morpho-object-image")) {
        continue;
      }
      const shapeId = shape.getAttribute("data-shape-id");
      const instanceId = shapeId?.replace(/^shape:/, "");
      const objectId = instanceId ? objectByInstanceId.get(instanceId) : undefined;
      if (!objectId || excludedIds.has(objectId)) {
        continue;
      }
      const rect = shape.getBoundingClientRect();
      const left = Math.max(rect.left + 12, 12);
      const right = Math.min(rect.right - 12, rightBoundary);
      const top = Math.max(rect.top + 12, 80);
      const bottom = Math.min(rect.bottom - 12, window.innerHeight - 80);
      if (right - left < 24 || bottom - top < 24) {
        continue;
      }
      targets.push({
        objectId,
        x: Math.round((left + right) / 2),
        y: Math.round((top + bottom) / 2)
      });
    }
    return targets;
  }, [...excludedObjectIds]);
}

async function canvasObjectCentre(page: Page, objectId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((targetObjectId) => {
    const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
    if (!raw) {
      return null;
    }
    const workspace = JSON.parse(raw) as {
      canvas?: { instances?: Array<{ id?: string; objectId?: string }> };
    };
    const instanceIds = new Set(
      (workspace.canvas?.instances ?? [])
        .filter((instance) => instance.objectId === targetObjectId && instance.id)
        .map((instance) => instance.id)
    );
    for (const shape of Array.from(document.querySelectorAll<HTMLElement>(".tl-shape"))) {
      const instanceId = shape.getAttribute("data-shape-id")?.replace(/^shape:/, "");
      if (!instanceId || !instanceIds.has(instanceId)) {
        continue;
      }
      const rect = shape.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, objectId);
}

async function panCanvasBy(page: Page, delta: { x: number; y: number }): Promise<void> {
  const start = { x: 820, y: 440 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 20 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(500);
}

async function moveCanvasObjectTowardCentre(page: Page, objectId: string): Promise<void> {
  const desired = { x: 480, y: 360 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await canvasObjectCentre(page, objectId);
    if (!before) {
      return;
    }
    const requested = {
      x: Math.max(-260, Math.min(260, desired.x - before.x)),
      y: Math.max(-260, Math.min(260, desired.y - before.y))
    };
    if (Math.abs(requested.x) < 20 && Math.abs(requested.y) < 20) {
      return;
    }
    await panCanvasBy(page, requested);
    const after = await canvasObjectCentre(page, objectId);
    if (!after) {
      return;
    }
    const beforeDistance = Math.hypot(before.x - desired.x, before.y - desired.y);
    const afterDistance = Math.hypot(after.x - desired.x, after.y - desired.y);
    if (afterDistance > beforeDistance) {
      await panCanvasBy(page, { x: -requested.x * 2, y: -requested.y * 2 });
    }
  }
}

async function findReviewableImagePair(page: Page): Promise<{
  previousObjectId: string;
  nextObjectId: string;
}> {
  const pair = await page.evaluate(() => {
    type PersistedImage = {
      type?: string;
      visibility?: string;
      role?: string;
      title?: string;
      generation?: { referenceObjectIds?: string[] };
    };
    type PersistedRelation = {
      kind?: string;
      fromObjectId?: string;
      toObjectId?: string;
    };
    const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
    if (!raw) {
      throw new Error("Built-in case study workspace is not persisted.");
    }
    const workspace = JSON.parse(raw) as {
      objects?: Record<string, PersistedImage>;
      relations?: PersistedRelation[];
      canvas?: { instances?: Array<{ objectId?: string }> };
    };
    const directDerivativeRoles = new Set([
      "conceptImage",
      "primaryVisual",
      "sceneVisual",
      "cmfStudy",
      "detailStudy",
      "structureDiagram",
      "interactionDiagram"
    ]);
    const derivativeRelationKinds = new Set(["source", "usesReference", "version"]);
    const canvasOrder = new Map<string, number>();
    for (const [index, instance] of (workspace.canvas?.instances ?? []).entries()) {
      if (instance.objectId) {
        canvasOrder.set(instance.objectId, index);
      }
    }
    const images = Object.entries(workspace.objects ?? {})
      .map(([id, object]) => ({ id, ...object }))
      .filter(
        (object): object is PersistedImage & { id: string; title: string } =>
          object.type === "image" &&
          object.visibility === "active" &&
          Boolean(object.title?.trim()) &&
          canvasOrder.has(object.id)
      );
    const relations = workspace.relations ?? [];
    const candidates = images
      .map((previous) => {
        const children = images.filter(
          (next) =>
            next.id !== previous.id &&
            directDerivativeRoles.has(next.role ?? "") &&
            ((next.generation?.referenceObjectIds ?? []).includes(previous.id) ||
              relations.some(
                (relation) =>
                  derivativeRelationKinds.has(relation.kind ?? "") &&
                  relation.fromObjectId === previous.id &&
                  relation.toObjectId === next.id
              ))
        );
        return { previous, children };
      })
      .filter((candidate) => candidate.children.length > 0)
      .sort(
        (left, right) =>
          right.children.length - left.children.length ||
          (canvasOrder.get(left.previous.id) ?? Number.MAX_SAFE_INTEGER) -
            (canvasOrder.get(right.previous.id) ?? Number.MAX_SAFE_INTEGER)
      );
    const selected = candidates[0];
    const next = selected?.children[0];
    return selected && next
      ? { previousObjectId: selected.previous.id, nextObjectId: next.id }
      : null;
  });
  if (!pair) {
    throw new Error("Built-in case study has no canvas image pair with direct derivative material.");
  }
  return pair;
}

async function selectImageObject(
  page: Page,
  excludedObjectIds: readonly string[] = [],
  preferredObjectId?: string
): Promise<string> {
  const target = await page.evaluate(({ excluded, preferred }) => {
    const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
    if (!raw) {
      throw new Error("Built-in case study workspace is not persisted.");
    }
    const workspace = JSON.parse(raw) as {
      objects?: Record<string, { type?: string; visibility?: string; title?: string }>;
      canvas?: { instances?: Array<{ objectId?: string }> };
    };
    const excludedIds = new Set(excluded);
    const candidates = (workspace.canvas?.instances ?? [])
      .map((instance) => {
        const objectId = instance.objectId;
        const object = objectId ? workspace.objects?.[objectId] : undefined;
        return objectId && object?.type === "image" && object.visibility === "active" && object.title?.trim()
          ? { objectId, title: object.title.trim() }
          : null;
      })
      .filter((candidate): candidate is { objectId: string; title: string } => candidate !== null)
      .filter((candidate) => !excludedIds.has(candidate.objectId));
    const titleCounts = new Map<string, number>();
    for (const candidate of candidates) {
      titleCounts.set(candidate.title, (titleCounts.get(candidate.title) ?? 0) + 1);
    }
    return candidates.find((candidate) => candidate.objectId === preferred) ??
      candidates.find((candidate) => titleCounts.get(candidate.title) === 1) ??
      candidates[0] ??
      null;
  }, { excluded: [...excludedObjectIds], preferred: preferredObjectId });
  if (!target) {
    throw new Error("Workspace has no eligible active image object.");
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  const collapseAi = page.locator('[aria-label="收起 AI 面板"]');
  if (await collapseAi.isVisible()) {
    await collapseAi.click();
  }
  const dismissStorageNotice = page.getByRole("button", { name: "知道了", exact: true });
  if (await dismissStorageNotice.isVisible()) {
    await dismissStorageNotice.click();
  }
  const openSearch = page.locator('[aria-label="项目内搜索"]');
  const search = page.locator('section[aria-label="项目内搜索"]');
  if (await search.isVisible()) {
    await search.locator('[aria-label="关闭搜索"]').click();
    await expect(search).toBeHidden({ timeout: 10_000 });
  }
  await openSearch.click();
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.locator('[aria-label="搜索关键词"]').fill(target.title);
  const result = search.locator(".result-row").first();
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.getByRole("button", { name: "定位", exact: true }).click();
  await expect(search).toBeHidden({ timeout: 10_000 });

  await expect.poll(async () => page.evaluate((targetObjectId) => {
    const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
    if (!raw) {
      return null;
    }
    const workspace = JSON.parse(raw) as { ui?: { lastSelectionIds?: string[] } };
    const selectedIds = workspace.ui?.lastSelectionIds ?? [];
    return selectedIds.length === 1 ? selectedIds[0] : null;
  }, target.objectId), { timeout: 10_000 }).toBe(target.objectId);

  await moveCanvasObjectTowardCentre(page, target.objectId);
  const toolbar = page.locator('[aria-label="选中对象工具"]');
  for (let zoomAttempt = 0; zoomAttempt < 5 && !(await toolbar.isVisible()); zoomAttempt += 1) {
    const visibleTarget = (await imageShapeTargets(page)).find((item) => item.objectId === target.objectId);
    await page.mouse.move(visibleTarget?.x ?? 480, visibleTarget?.y ?? 420);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(350);
  }
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[aria-label="设为后续默认参考"]')).toBeVisible({ timeout: 10_000 });
  return target.objectId;
}

async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".tl-container");
    if (!canvas) {
      throw new Error("tldraw container is not mounted.");
    }
    const canvasRect = canvas.getBoundingClientRect();
    const blocked = Array.from(
      document.querySelectorAll(
        ".tl-shape, .ai-panel, .ai-toggle, .floating-cluster, .rail, .selection-toolbar, .detail-popover, .workspace-banner"
      )
    ).map((node) => node.getBoundingClientRect());
    for (let y = canvasRect.bottom - 24; y > canvasRect.top + 24; y -= 12) {
      for (let x = canvasRect.right - 24; x > canvasRect.left + 24; x -= 12) {
        const clear = blocked.every(
          (rect) => x < rect.left - 12 || x > rect.right + 12 || y < rect.top - 12 || y > rect.bottom + 12
        );
        if (clear) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    throw new Error("No empty canvas point reachable.");
  });
}

/**
 * Uses the real project-search locate path to select and focus an active canvas
 * image. Fixed-size image cards remain suitable for toolbar actions after focus;
 * content-adaptive file cards can fill the viewport and leave no legal toolbar
 * placement. The preceding pan/zoom phases can leave a 500-object overview below the
 * toolbar's minimum visible size, so a raw screen-coordinate click is not a stable
 * setup action. Search locate drives the production focus request, zoom-to-selection,
 * editor selection, and persisted `lastSelectionIds` path before the measured action.
 */
async function focusFirstShapeSelected(page: Page, workspaceKey: string): Promise<string> {
  await page.keyboard.press("Escape").catch(() => undefined);
  const collapseAi = page.locator('[aria-label="收起 AI 面板"]');
  if (await collapseAi.isVisible()) {
    await collapseAi.click();
  }
  const dismissStorageNotice = page.getByRole("button", { name: "知道了", exact: true });
  if (await dismissStorageNotice.isVisible()) {
    await dismissStorageNotice.click();
  }

  const targetTitle = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error(`Workspace not found at ${storageKey}.`);
    }
    const workspace = JSON.parse(raw) as {
      objects?: Record<string, { title?: string; type?: string; visibility?: string }>;
      canvas?: { instances?: Array<{ objectId?: string }> };
    };
    for (const instance of workspace.canvas?.instances ?? []) {
      const object = instance.objectId ? workspace.objects?.[instance.objectId] : undefined;
      if (object?.type === "image" && object.visibility === "active" && object.title?.trim()) {
        return object.title;
      }
    }
    throw new Error("Workspace has no searchable active canvas image.");
  }, workspaceKey);

  await page.locator('[aria-label="项目内搜索"]').click();
  const search = page.locator('section[aria-label="项目内搜索"]');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.locator('[aria-label="搜索关键词"]').fill(targetTitle);
  const result = search.locator(".result-row").first();
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.getByRole("button", { name: "定位", exact: true }).click();

  await expect.poll(async () => page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const workspace = JSON.parse(raw) as {
      objects?: Record<string, { type?: string; visibility?: string }>;
      canvas?: { instances?: Array<{ objectId?: string }> };
      ui?: { lastSelectionIds?: string[] };
    };
    const selectedIds = workspace.ui?.lastSelectionIds ?? [];
    const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
    return selectedId &&
      workspace.objects?.[selectedId]?.type === "image" &&
      workspace.objects[selectedId]?.visibility === "active" &&
      workspace.canvas?.instances?.some((instance) => instance.objectId === selectedId)
      ? selectedId
      : null;
  }, workspaceKey), { timeout: 10_000 }).not.toBeNull();

  const selectedObjectId = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error(`Workspace not found at ${storageKey}.`);
    }
    const workspace = JSON.parse(raw) as { ui?: { lastSelectionIds?: string[] } };
    const selectedObjectId = workspace.ui?.lastSelectionIds?.[0];
    if (!selectedObjectId) {
      throw new Error("Located object was not persisted as the canvas selection.");
    }
    return selectedObjectId;
  }, workspaceKey);

  const closeSearch = search.locator('[aria-label="关闭搜索"]');
  if (await closeSearch.isVisible()) {
    await closeSearch.click();
  }
  await expect(search).toBeHidden({ timeout: 10_000 });
  const toolbar = page.locator('[aria-label="选中对象工具"]');
  for (let attempt = 0; attempt < 5 && !(await toolbar.isVisible()); attempt += 1) {
    // Search locate zooms the target into view. Reduce that visual zoom in setup
    // only; the measured hide/delete action still starts from a stable selection.
    await page.mouse.move(480, 420);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(350);
  }
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  return selectedObjectId;
}

/** Loads a seeded project and waits for first shape + settle. Returns load-phase entry data. */
async function openProjectAndMeasureLoad(page: Page, key: string, area: string): Promise<void> {
  const project = phase5Project(key);
  await page.goto(`/projects/${project.projectId}`);
  await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1_500);

  const support = await readProbeSupport(page);
  expect(support.injected, "React DevTools hook never received a renderer").toBeGreaterThan(0);
  expect(support.loaf, "此浏览器不支持 long-animation-frame").toBe(true);
  expect(support.event, "此浏览器不支持 Event Timing").toBe(true);
  expect(support.firstShapeAtMs, "首个 shape 从未出现").not.toBeNull();

  const samples = await endPerfPhase(page);
  const io = await collectIoStats(page);
  record({
    area,
    project: key,
    phase: "openProject(load)",
    scale: project.scale,
    samples,
    io,
    extra: { firstShapeAtMs: support.firstShapeAtMs }
  });
}

test.describe("Phase 5 真实交互延迟图谱（记录，不断言阈值）", () => {
  test.describe.configure({ mode: "serial" });

  // ------------------------------------------------------------------ 1. lifecycle
  test("1 生命周期：打开大项目、切回列表、打开项目 B、A→B 直切", async ({ page }) => {
    test.setTimeout(420_000);
    await installPerfProbe(page, { io: true });
    await installAgentMock(page);

    await page.goto("/");
    buildIdentity = await page.evaluate(async () => {
      const response = await fetch("/api/build-provenance");
      if (!response.ok) throw new Error(`Build provenance endpoint unavailable: ${response.status}`);
      return response.json() as Promise<BuildIdentity>;
    });
    expect(buildIdentity.sourceSha, "served build missing source SHA").toBe(readGitCommit());
    expect(buildIdentity.buildId, "served build missing build ID").toBeTruthy();
    expect(buildIdentity.artifactSha256, "served build missing artifact digest").toMatch(/^[a-f0-9]{64}$/);
    await seedPhase5Projects(page, ["objects500", "switchA", "switchB"]);

    await openProjectAndMeasureLoad(page, "objects500", "lifecycle");

    const shapeCount = await page.locator(".morpho-shape-host").count();
    expect(shapeCount, "画布没有挂载任何 shape").toBeGreaterThan(0);

    // --- big project -> project home --------------------------------------
    await beginPerfPhase(page);
    await armFeedback(page, "main");
    await page.locator("button.project-name").click();
    await page.locator('[aria-label="项目操作"] button', { hasText: "返回项目首页" }).click();
    await expect(page.locator(".phome-shelf", { hasText: "全部项目" })).toBeVisible({ timeout: 30_000 });
    const backSamples = await endPerfPhase(page);
    const backFeedback = await readFeedback(page);
    record({
      area: "lifecycle",
      project: "objects500",
      phase: "backToProjectList",
      scale: { objects: 500 },
      samples: backSamples,
      feedback: backFeedback
    });

    // --- from list -> open project B ---------------------------------------
    const switchB = phase5Project("switchB");
    await beginPerfPhase(page);
    await armFeedback(page, "main");
    await page.locator(".phome-grid").getByText("P5 switchB").first().click();
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 60_000 });
    const openBSamples = await endPerfPhase(page);
    const openBFeedback = await readFeedback(page);
    record({
      area: "lifecycle",
      project: "switchB",
      phase: "openFromList",
      scale: { objects: 60 },
      samples: openBSamples,
      feedback: openBFeedback
    });

    // --- direct URL switch B -> A (same component tree, no remount) --------
    const switchA = phase5Project("switchA");
    await beginPerfPhase(page);
    await page.goto(`/projects/${switchA.projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const switchSamples = await endPerfPhase(page);
    const switchIo = await collectIoStats(page);
    record({
      area: "lifecycle",
      project: "switchA",
      phase: "directSwitchBtoA",
      scale: { objects: 60 },
      samples: switchSamples,
      io: switchIo
    });
    const shapesA = await page.locator(".morpho-shape-host").count();
    expect(shapesA, "切换后画布为空").toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------ 2. canvas
  test("2 画布：选择/拖动/框选/pan/zoom/新增/删除/工具栏", async ({ page }) => {
    test.setTimeout(420_000);
    await installPerfProbe(page, { io: true });
    await installAgentMock(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await seedPhase5Projects(page, ["objects500"]);
    await page.goto(`/projects/${phase5Project("objects500").projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1_500);

    const centres = await shapeCentres(page, 20);
    expect(centres.length, "视口内没有可点击的 shape").toBeGreaterThan(0);
    const origin = centres[0]!;
    const empty = await emptyPoint(page);

    // --- continuous selection ----------------------------------------------
    await beginPerfPhase(page);
    for (const centre of centres) {
      await page.mouse.click(centre.x, centre.y);
      await page
        .locator('[aria-label="选中对象工具"]')
        .waitFor({ state: "visible", timeout: 4_000 })
        .catch(() => undefined);
    }
    record({
      area: "canvas",
      project: "objects500",
      phase: "selection",
      scale: { clicks: centres.length },
      samples: await endPerfPhase(page)
    });

    // --- high-frequency drag ------------------------------------------------
    await beginPerfPhase(page);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    for (let step = 1; step <= DRAG_STEPS; step += 1) {
      await page.mouse.move(origin.x + step * 4, origin.y + step * 2);
      await page.waitForTimeout(DRAG_INTERVAL_MS);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const dragSamples = await endPerfPhase(page);
    record({
      area: "canvas",
      project: "objects500",
      phase: "drag",
      scale: { steps: DRAG_STEPS },
      samples: dragSamples,
      extra: { achievedPointerRateHz: dragSamples.pointerRateHz === null ? null : Math.round(dragSamples.pointerRateHz) }
    });

    // --- box multi-select ---------------------------------------------------
    await beginPerfPhase(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(empty.x - step * 40, empty.y - step * 25);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    record({
      area: "canvas",
      project: "objects500",
      phase: "boxSelect",
      samples: await endPerfPhase(page)
    });

    // --- select all (ctrl+a) -------------------------------------------------
    await beginPerfPhase(page);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(800);
    record({
      area: "canvas",
      project: "objects500",
      phase: "selectAll",
      samples: await endPerfPhase(page)
    });
    await page.keyboard.press("Escape");

    // --- pan (middle drag) ---------------------------------------------------
    await beginPerfPhase(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down({ button: "middle" });
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(empty.x - step * 8, empty.y - step * 5);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(600);
    const panSamples = await endPerfPhase(page);
    record({
      area: "canvas",
      project: "objects500",
      phase: "pan",
      samples: panSamples,
      extra: { achievedPointerRateHz: panSamples.pointerRateHz === null ? null : Math.round(panSamples.pointerRateHz) }
    });

    // --- zoom (wheel), single then continuous --------------------------------
    await beginPerfPhase(page);
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(600);
    record({
      area: "canvas",
      project: "objects500",
      phase: "zoomSingle",
      samples: await endPerfPhase(page)
    });

    await beginPerfPhase(page);
    for (let step = 0; step < 12; step += 1) {
      await page.mouse.wheel(0, step % 2 === 0 ? -220 : 220);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(600);
    record({
      area: "canvas",
      project: "objects500",
      phase: "zoomContinuous",
      samples: await endPerfPhase(page)
    });

    // --- add object via paste (real paste handoff) ----------------------------
    const beforeCount = await page.locator(".morpho-shape-host").count();
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "性能测量：这是一段通过真实粘贴事件导入的文本对象内容。".repeat(3));
      const container = document.querySelector(".tl-container");
      if (!container) {
        throw new Error("tldraw container missing for paste.");
      }
      container.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    const addVisibleAt = await waitForShapeCountAbove(page, beforeCount);
    const addSamples = await endPerfPhase(page);
    const addFeedback = await readFeedback(page);
    const addIo = await collectIoStats(page);
    record({
      area: "canvas",
      project: "objects500",
      phase: "addObjectPasteText",
      scale: { shapesBefore: beforeCount },
      samples: addSamples,
      io: addIo,
      feedback: addFeedback,
      extra: { objectVisibleAtMs: Number(addVisibleAt.toFixed(1)) }
    });

    // --- delete object (Delete key on selection) ------------------------------
    await focusFirstShapeSelected(page, phase5Project("objects500").workspaceKey);
    const countAfterAdd = await page.locator(".morpho-shape-host").count();
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(1_200);
    const deleteSamples = await endPerfPhase(page);
    const deleteFeedback = await readFeedback(page);
    record({
      area: "canvas",
      project: "objects500",
      phase: "deleteObject",
      scale: { shapesBefore: countAfterAdd },
      samples: deleteSamples,
      feedback: deleteFeedback
    });

    // --- toolbar hide action ---------------------------------------------------
    await focusFirstShapeSelected(page, phase5Project("objects500").workspaceKey);
    const hideBefore = await page.locator(".morpho-shape-host").count();
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.locator('[aria-label="隐藏对象"]').click();
    await page.waitForFunction(
      (prev) => document.querySelectorAll(".morpho-shape-host").length < prev,
      hideBefore,
      { timeout: 10_000 }
    );
    record({
      area: "canvas",
      project: "objects500",
      phase: "toolbarHideObject",
      samples: await endPerfPhase(page),
      feedback: await readFeedback(page)
    });
    expect(pageErrors, "画布阶段页面抛出了未捕获错误").toEqual([]);
  });

  // ------------------------------------------------------------------ 3. AI conversation
  for (const tierKey of ["caseStudy", "chatLong", "objects500"] as const) {
    test(`3 AI 对话：${tierKey}`, async ({ page }) => {
      test.setTimeout(420_000);
      await installPerfProbe(page, { io: true });
      await installAgentMock(page);

      await page.goto("/");
      await seedPhase5Projects(page, [tierKey]);
      await page.goto(`/projects/${phase5Project(tierKey).projectId}`);
      await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(1_000);

      const project = phase5Project(tierKey);
      const scale = { messages: project.scale.messages ?? 0, objects: project.scale.objects ?? 0 };

      // --- typing ------------------------------------------------------------
      const input = page.locator('.ai-panel textarea');
      await input.click();
      await beginPerfPhase(page);
      await input.type(TYPING_TEXT, { delay: 30 });
      await page.waitForTimeout(500);
      record({
        area: "ai",
        project: tierKey,
        phase: "typing",
        scale,
        samples: await endPerfPhase(page),
        extra: { characters: TYPING_TEXT.length }
      });

      // --- send -> first feedback -> streaming -------------------------------
      await setAgentResponse(page, {
        kind: "stream",
        chunks: textAnswerScript({ text: "已经理解，这里是回应。" }).chunks,
        chunkDelayMs: 20,
        holdAfterChunks: 1
      });
      await beginPerfPhase(page);
      await armFeedback(page, ".ai-panel");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1_200);
      await releaseAgentStream(page);
      await page.waitForTimeout(2_500);
      const streamSamples = await endPerfPhase(page);
      const streamFeedback = await readFeedback(page);
      const calls = await agentCalls(page);
      const turnPost = calls.find((call) => call.url.includes("/api/ai/agent/turns") && call.method === "POST");
      record({
        area: "ai",
        project: tierKey,
        phase: "sendAndStream",
        scale,
        samples: streamSamples,
        feedback: streamFeedback,
        extra: turnPost
          ? { requestDispatchedAtMs: Number(turnPost.at.toFixed(1)) }
          : {}
      });
      await expect(page.locator(".ai-panel")).toContainText("已经理解，这里是回应。", { timeout: 20_000 });

      // --- auto-scroll behaviour: at rest after stream, near bottom -----------
      const nearBottom = await page.evaluate(() => {
        const scroller = document.querySelector(".ai-scroll");
        if (!scroller) {
          return null;
        }
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
      });
      record({
        area: "ai",
        project: tierKey,
        phase: "autoScrollAtRest",
        scale,
        samples: zeroSamples(),
        extra: { pinnedToBottom: nearBottom }
      });

      // --- tool call turn: request1 tool -> local effect -> continuation -----
      await setAgentRequestScript(page, [
        { kind: "stream", chunks: toolCallTurnScript().first, chunkDelayMs: 15 },
        { kind: "stream", chunks: toolCallTurnScript().second, chunkDelayMs: 15 }
      ]);
      const callsBeforeTool = (await agentCalls(page)).length;
      await input.fill("请读取项目记忆并总结当前重点。");
      await beginPerfPhase(page);
      await armFeedback(page, ".ai-panel");
      await page.keyboard.press("Enter");
      await expect(page.locator(".ai-panel")).toContainText("工具结果已读取", { timeout: 30_000 });
      await page.waitForTimeout(1_000);
      const toolSamples = await endPerfPhase(page);
      const toolFeedback = await readFeedback(page);
      const allCalls = await agentCalls(page);
      const newCalls = allCalls.slice(callsBeforeTool);
      const requestPosts = newCalls.filter(
        (call) => new URL(call.url, "http://localhost").pathname.endsWith("/requests") && call.method === "POST"
      );
      const scriptState = await agentRequestScriptState(page);
      expect(requestPosts.length, "tool-call turn 必须精确产生两次 provider request").toBe(2);
      expect(scriptState).toMatchObject({ total: 2, consumed: 2, remaining: 0, overrun: 0 });
      record({
        area: "ai",
        project: tierKey,
        phase: "toolCallTurn",
        scale,
        samples: toolSamples,
        feedback: toolFeedback,
        extra: {
          requestCount: requestPosts.length,
          requestGapMs: Number((requestPosts[1]!.at - requestPosts[0]!.at).toFixed(1)),
          requestScript: scriptState
        }
      });

      // --- scroll up during stream, then delta: must not be yanked back ------
      await setAgentResponse(page, {
        kind: "stream",
        chunks: textAnswerScript({ text: "第二条流式回应，用于检验用户翻阅旧消息时的滚动语义。" }).chunks,
        chunkDelayMs: 20,
        holdAfterChunks: 1
      });
      await input.fill("再来一条会边流边翻旧消息的回应。");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const scroller = document.querySelector(".ai-scroll");
        if (scroller) {
          scroller.scrollTop = 0;
        }
      });
      await page.waitForTimeout(400);
      const scrollWhileHeld = await page.evaluate(() => {
        const scroller = document.querySelector(".ai-scroll");
        return scroller ? scroller.scrollTop : null;
      });
      await releaseAgentStream(page);
      await expect(page.locator(".ai-panel")).toContainText("第二条流式回应", { timeout: 20_000 });
      const scrollAfter = await page.evaluate(() => {
        const scroller = document.querySelector(".ai-scroll");
        return scroller ? scroller.scrollTop : null;
      });
      record({
        area: "ai",
        project: tierKey,
        phase: "scrollUpDuringStream",
        scale,
        samples: zeroSamples(),
        extra: {
          scrollTopWhileHeld: scrollWhileHeld,
          scrollTopAfterStream: scrollAfter,
          userNotYankedBack: scrollAfter !== null && scrollAfter < 400
        }
      });
      expect(scrollAfter, "流式期间用户翻到顶部后被强拉回底部（滚动语义被破坏）").toBeLessThan(400);
    });
  }

  // ------------------------------------------------------------------ 4. assets
  for (const tierKey of ["assets10", "assets30", "assets80"] as const) {
    test(`4 资产：${tierKey}`, async ({ page }) => {
      test.setTimeout(420_000);
      await installPerfProbe(page, { io: true });
      await installAgentMock(page);

      const project = phase5Project(tierKey);
      await page.goto("/");
      await seedPhase5Projects(page, [tierKey]);
      const seededAssets = await seedPhase5AssetBlobs(page, project);
      await markNow(page, "blobsSeeded");

      // --- open with real binaries -------------------------------------------
      await page.goto(`/projects/${project.projectId}`);
      await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
      const support = await readProbeSupport(page);
      const imagesSettledAt = await page.evaluate(async () => {
        const started = performance.now();
        const deadline = started + 60_000;
        while (performance.now() < deadline) {
          const images = Array.from(document.querySelectorAll(".morpho-shape-host img"));
          if (images.length > 0 && images.every((img) => (img as HTMLImageElement).complete)) {
            return performance.now();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        return null;
      });
      await page.waitForTimeout(500);
      const loadSamples = await endPerfPhase(page);
      const loadIo = await collectIoStats(page);
      record({
        area: "assets",
        project: tierKey,
        phase: "openWithBinaries",
        scale: project.scale,
        samples: loadSamples,
        io: loadIo,
        extra: {
          firstShapeAtMs: support.firstShapeAtMs,
          seededAssetBytes: seededAssets,
          imagesSettledAtMs: imagesSettledAt === null ? null : Number(imagesSettledAt.toFixed(1)),
          imagesSettledAfterFirstShapeMs:
            imagesSettledAt === null || support.firstShapeAtMs === null
              ? null
              : Number((imagesSettledAt - support.firstShapeAtMs).toFixed(1))
        }
      });
      expect(imagesSettledAt, "图片没有全部完成解码").not.toBe(null);

      // --- asset drawer: first open -------------------------------------------
      await beginPerfPhase(page);
      await armFeedback(page, "body");
      await page.locator('[aria-label="资产"]').click();
      await expect(page.locator('section[aria-label="资产"]')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(600);
      record({
        area: "assets",
        project: tierKey,
        phase: "assetDrawerFirstOpen",
        scale: project.scale,
        samples: await endPerfPhase(page),
        feedback: await readFeedback(page)
      });

      // --- show-all expansion (only exists when >10 assets) --------------------
      const showAll = page.locator("button.drawer-more-button", { hasText: "显示全部" });
      const showAllAvailable = await showAll.count() > 0;
      if (tierKey !== "assets10") {
        expect(showAllAvailable, `${tierKey} 应提供显示全部入口`).toBe(true);
      }
      if (showAllAvailable) {
        await beginPerfPhase(page);
        await armFeedback(page, 'section[aria-label="资产"]');
        await showAll.click();
        await page.locator(".asset-row").nth(20).waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForTimeout(500);
        record({
          area: "assets",
          project: tierKey,
          phase: "assetDrawerShowAll",
          scale: project.scale,
          samples: await endPerfPhase(page),
          feedback: await readFeedback(page),
          extra: { assetRows: await page.locator(".asset-row").count() }
        });
      }

      // --- asset filter chip ------------------------------------------------------
      await beginPerfPhase(page);
      await armFeedback(page, 'section[aria-label="资产"]');
      await page.locator('[aria-label="资产筛选"] button', { hasText: "原始资料" }).click();
      await page.waitForTimeout(600);
      record({
        area: "assets",
        project: tierKey,
        phase: "assetFilter",
        scale: project.scale,
        samples: await endPerfPhase(page),
        feedback: await readFeedback(page)
      });

      // --- asset drawer: reopen -------------------------------------------------
      await page.locator('[aria-label="关闭资产"]').click();
      await page.waitForTimeout(400);
      await beginPerfPhase(page);
      await armFeedback(page, "body");
      await page.locator('[aria-label="资产"]').click();
      await expect(page.locator('section[aria-label="资产"]')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(600);
      record({
        area: "assets",
        project: tierKey,
        phase: "assetDrawerReopen",
        scale: project.scale,
        samples: await endPerfPhase(page),
        feedback: await readFeedback(page)
      });
      await page.locator('[aria-label="关闭资产"]').click();
      await page.waitForTimeout(300);

      // --- select an image -> bottom detail ------------------------------------
      const centre = (await shapeCentres(page, 1))[0];
      expect(centre, `${tierKey} 没有可选图片`).toBeDefined();
      await beginPerfPhase(page);
      await armFeedback(page, "body");
      await page.mouse.click(centre!.x, centre!.y);
      await expect(page.locator('[aria-label="选中对象工具"]')).toBeVisible({ timeout: 8_000 });
      record({
        area: "assets",
        project: tierKey,
        phase: "selectImageDetail",
        scale: project.scale,
        samples: await endPerfPhase(page),
        feedback: await readFeedback(page)
      });
    });
  }

  // ------------------------------------------------------------------ 5. import
  test("5 导入：文本/图片/PDF/PPTX/混合批次", async ({ page }) => {
    test.setTimeout(420_000);
    await installPerfProbe(page, { io: true });
    await installAgentMock(page);

    const project = phase5Project("importBase");
    await page.goto("/");
    await seedPhase5Projects(page, ["importBase"]);
    await page.goto(`/projects/${project.projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);

    const importButton = page.locator('.toolbar-group[aria-label="资料与交付"] button', { hasText: "导入" });

    async function readPersistedWorkspace(): Promise<PersistedWorkspaceSnapshot> {
      const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), project.workspaceKey);
      if (!raw) {
        throw new Error(`导入阶段找不到工作区 ${project.workspaceKey}`);
      }
      return JSON.parse(raw) as PersistedWorkspaceSnapshot;
    }

    async function waitForImportedFiles(
      fileNames: readonly string[],
      beforeObjectIds: ReadonlySet<string>,
      beforeAssetIds: ReadonlySet<string>
    ): Promise<ImportedFileEvidence[]> {
      await expect.poll(async () => {
        const snapshot = await readPersistedWorkspace();
        return fileNames.every((fileName) => {
          const candidates = Object.entries(snapshot.objects).filter(([objectId, object]) =>
            object.type === "file" &&
            object.fileName === fileName &&
            !beforeObjectIds.has(objectId) &&
            object.assetId !== undefined &&
            !beforeAssetIds.has(object.assetId)
          );
          return candidates.length === 1 &&
            (candidates[0]?.[1].parseStatus === "parsed" || candidates[0]?.[1].parseStatus === "failed");
        });
      }, { timeout: 120_000, message: `等待本轮导入文档进入 terminal parse state：${fileNames.join(", ")}` }).toBe(true);

      const snapshot = await readPersistedWorkspace();
      const evidence = fileNames.map((fileName) => {
        const matchingObjects = Object.entries(snapshot.objects).filter(([objectId, object]) =>
          object.type === "file" &&
          object.fileName === fileName &&
          !beforeObjectIds.has(objectId) &&
          object.assetId !== undefined &&
          !beforeAssetIds.has(object.assetId)
        );
        if (matchingObjects.length !== 1) {
          throw new Error(`本轮导入文件对象不唯一：${fileName}（${matchingObjects.length} 个）`);
        }
        const objectEntry = matchingObjects[0];
        if (!objectEntry) {
          throw new Error(`本轮导入未找到唯一文件对象：${fileName}`);
        }
        const [objectId, object] = objectEntry;
        const assetId = object.assetId!;
        const asset = snapshot.assets[assetId];
        return {
          fileName,
          objectId,
          assetId,
          mimeType: object.mimeType ?? asset?.mimeType ?? null,
          size: object.size ?? asset?.size ?? null,
          parseStatus: object.parseStatus ?? null,
          parsedAt: object.parsedAt ?? null,
          parseError: object.parseError ?? null,
          extractedAssetId: object.extractedAssetId ?? null,
          extractedCharCount: object.extractedCharCount ?? null,
          extractedPageCount: object.extractedPageCount ?? null,
          sourcePageCount: object.sourcePageCount ?? null,
          extractionTruncated: object.extractionTruncated ?? null,
          extractedAssetSourceType: object.extractedAssetId ? snapshot.assets[object.extractedAssetId]?.sourceType ?? null : null
        } satisfies ImportedFileEvidence;
      });
      return evidence;
    }

    async function runImport(
      phase: string,
      files: { name: string; mimeType: string; buffer: Buffer }[],
      settleMs = 4_000
    ): Promise<void> {
      const before = await page.locator(".morpho-shape-host").count();
      const beforeWorkspace = await readPersistedWorkspace();
      const beforeObjectIds = new Set(Object.keys(beforeWorkspace.objects));
      const beforeAssetIds = new Set(Object.keys(beforeWorkspace.assets));
      await beginPerfPhase(page);
      await armFeedback(page, "body");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        importButton.click()
      ]);
      await chooser.setFiles(files);
      const visibleAt = await waitForShapeCountAbove(page, before + files.length - 1);
      await page.waitForTimeout(settleMs);
      const samples = await endPerfPhase(page);
      const feedback = await readFeedback(page);
      const io = await collectIoStats(page);
      const importedDocuments = await waitForImportedFiles(
        files.map((file) => file.name).filter((name): name is typeof PARSEABLE_IMPORT_FILENAMES[number] =>
          (PARSEABLE_IMPORT_FILENAMES as readonly string[]).includes(name)
        ),
        beforeObjectIds,
        beforeAssetIds
      );
      for (const imported of importedDocuments) {
        importedFileEvidence.set(imported.fileName, imported);
      }
      const changeAt = io.inputEvents.find((event) => event.kind === "change")?.at ?? null;
      record({
        area: "import",
        project: "importBase",
        phase,
        scale: { files: files.length, bytes: files.reduce((total, file) => total + file.buffer.length, 0) },
        samples,
        io,
        feedback,
        extra: {
          objectsVisibleAtMs: Number(visibleAt.toFixed(1)),
          visibleAfterChangeMs: changeAt === null ? null : Number((visibleAt - changeAt).toFixed(1)),
          fileNames: files.map((file) => file.name),
          importedDocuments
        }
      });
    }

    await runImport("imagePng", [
      { name: "p5-import.png", mimeType: "image/png", buffer: buildPng(1280, 960) }
    ]);

    await runImport("pdf30p", [
      { name: "p5-fixture-30p.pdf", mimeType: "application/pdf", buffer: buildPdf(30) }
    ], 6_000);

    await runImport("pptx40", [
      {
        name: "p5-fixture-40slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: buildPptx(40)
      }
    ], 6_000);

    await runImport("pdf150p", [
      { name: "p5-fixture-150p.pdf", mimeType: "application/pdf", buffer: buildPdf(150) }
    ], 12_000);

    await runImport("mixedBatch", [
      { name: "p5-mixed-1.png", mimeType: "image/png", buffer: buildPng(800, 600, 11) },
      { name: "p5-mixed-2.png", mimeType: "image/png", buffer: buildPng(800, 600, 12) },
      { name: "p5-mixed-notes.md", mimeType: "text/markdown", buffer: buildTextFile(60) },
      { name: "p5-mixed-8p.pdf", mimeType: "application/pdf", buffer: buildPdf(8, 20) }
    ], 8_000);

    const parsedEvidence = PARSEABLE_IMPORT_FILENAMES.map((fileName) => importedFileEvidence.get(fileName));
    expect(parsedEvidence.every(Boolean), "五份本轮可解析文档没有全部建立精确证据").toBe(true);
    for (const evidence of parsedEvidence) {
      if (!evidence) {
        throw new Error("缺少本轮文档解析证据。");
      }
      expect(evidence.parseStatus, `${evidence.fileName} 未完成解析`).toBe("parsed");
      expect(evidence.parseError, `${evidence.fileName} 不应有 parseError`).toBeNull();
      expect(evidence.parsedAt, `${evidence.fileName} 缺少 parsedAt`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(evidence.extractedAssetId, `${evidence.fileName} 缺少 extractedAssetId`).not.toBeNull();
      expect(evidence.extractedAssetSourceType, `${evidence.fileName} extract 不是 documentExtract`).toBe("documentExtract");
      expect(evidence.extractedCharCount, `${evidence.fileName} 缺少 extractedCharCount`).toBeGreaterThan(0);
      expect(evidence.size, `${evidence.fileName} 缺少原文件 size`).toBeGreaterThan(0);
    }
    console.log(`   [import] 本轮文档 5/5 parsed：${JSON.stringify(parsedEvidence)}`);
  });

  // ------------------------------------------------------------------ 6. other surfaces
  test("6 其他交互：搜索/记录/交付准备/归档导出/默认参考确认", async ({ page }) => {
    test.setTimeout(420_000);
    await installPerfProbe(page, { io: true });
    await installAgentMock(page);

    const project = phase5Project("caseStudy");
    await page.goto("/");
    await seedPhase5Projects(page, ["caseStudy", "objects500"]);
    await page.goto(`/projects/${project.projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1_500);

    // --- search drawer ---------------------------------------------------------
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.locator('[aria-label="项目内搜索"]').click();
    await expect(page.locator('section[aria-label="项目内搜索"]')).toBeVisible({ timeout: 10_000 });
    record({
      area: "surfaces",
      project: "caseStudy",
      phase: "searchDrawerOpen",
      scale: project.scale,
      samples: await endPerfPhase(page),
      feedback: await readFeedback(page)
    });

    await beginPerfPhase(page);
    await page.locator('[aria-label="搜索关键词"]').fill("设计");
    await expect(page.locator('section[aria-label="项目内搜索"] .result-group-title').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    const searchSamples = await endPerfPhase(page);
    const searchResultRows = await page.locator('section[aria-label="项目内搜索"] .result-group-title').allInnerTexts();
    record({
      area: "surfaces",
      project: "caseStudy",
      phase: "searchQuery",
      scale: project.scale,
      samples: searchSamples,
      extra: { resultGroups: searchResultRows }
    });
    await page.locator('[aria-label="关闭搜索"]').click();
    await page.waitForTimeout(300);

    // --- records drawer ----------------------------------------------------------
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.locator('[aria-label="项目记录"]').click();
    await expect(page.locator("section.side-drawer").first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    record({
      area: "surfaces",
      project: "caseStudy",
      phase: "recordsDrawerOpen",
      scale: project.scale,
      samples: await endPerfPhase(page),
      feedback: await readFeedback(page)
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // --- delivery preparation panel ------------------------------------------------
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    await page.locator('button', { hasText: "交付准备" }).click();
    await page.waitForTimeout(900);
    record({
      area: "surfaces",
      project: "caseStudy",
      phase: "deliveryPrepOpen",
      scale: project.scale,
      samples: await endPerfPhase(page),
      feedback: await readFeedback(page)
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // --- archive: editable backup + human-readable export (zip on main thread) ----
    // Scaled fixtures keep dangling references by design, and a backup with
    // restore-critical integrity issues is blocked by design — so this phase runs
    // against the REAL built-in case study (fresh storage -> real first-open path
    // with real binaries), which is exactly the project a backup is for.
    await page.goto("/");
    await page.evaluate(async () => {
      window.localStorage.clear();
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("morpho-assets-v1");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.goto("/projects/project-morpho-case-study");
    // toBeAttached, not toBeVisible: the case study's first shape can sit outside
    // the viewport (acceptance specs wait the same way).
    await expect(page.locator(".morpho-shape-host").first()).toBeAttached({ timeout: 120_000 });
    await expect(page.locator(".morpho-shape-host img").first()).toBeAttached({ timeout: 60_000 });
    // Deterministic readiness: every storageKey the case-study WORKSPACE itself
    // declares must be present in the BlobStore before any export is measured.
    // A stability heuristic once let an export race a partial install and produced
    // a wrong "small backup bundle" conclusion; extra keys beyond the expected set
    // are tolerated, a missing expected key is not.
    const installCheck = await page.evaluate(async () => {
      const readExpectedKeys = (): string[] => {
        try {
          const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
          if (!raw) {
            return [];
          }
          const workspace = JSON.parse(raw) as { assets?: Record<string, { storageKey?: string }> };
          return Object.values(workspace.assets ?? {})
            .map((asset) => asset.storageKey)
            .filter((key): key is string => typeof key === "string");
        } catch {
          return [];
        }
      };

      const expected = readExpectedKeys();
      if (expected.length === 0) {
        return { ok: false, expectedCount: 0, presentCount: -1, missing: ["workspace-not-in-localStorage"] };
      }

      const presentKeys = (): Promise<Set<string>> =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("morpho-assets-v1", 1);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("asset-blobs", "readonly");
            const keys = tx.objectStore("asset-blobs").getAllKeys();
            keys.onsuccess = () => {
              db.close();
              resolve(new Set(keys.result.map(String)));
            };
            keys.onerror = () => {
              db.close();
              reject(keys.error);
            };
          };
          request.onerror = () => reject(request.error);
        });

      const deadline = performance.now() + 120_000;
      let present = new Set<string>();
      let missing: string[] = expected;
      while (performance.now() < deadline) {
        present = await presentKeys().catch(() => new Set<string>());
        missing = expected.filter((key) => !present.has(key));
        if (missing.length === 0) {
          return { ok: true, expectedCount: expected.length, presentCount: present.size, missing: [] };
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      return { ok: false, expectedCount: expected.length, presentCount: present.size, missing: missing.slice(0, 3) };
    });
    expect(
      installCheck.ok,
      `内置案例资产安装未完成（期望 ${installCheck.expectedCount} 个 storageKey，实际 ${installCheck.presentCount}，缺失示例 ${installCheck.missing.join(", ")}）——导出测量必须等待完整安装`
    ).toBe(true);
    await page.waitForTimeout(500);

    await beginPerfPhase(page);
    await page.locator('button', { hasText: "归档" }).click();
    await expect(page.locator('section[aria-label="项目归档与恢复"]')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    record({
      area: "surfaces",
      project: "builtinCaseStudy",
      phase: "archivePanelOpen",
      samples: await endPerfPhase(page)
    });

    await beginPerfPhase(page);
    const exportStartedAt = await pageNow(page);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.locator('button', { hasText: "导出备份" }).click()
    ]);
    const downloadAt = await pageNow(page);
    const exportSamples = await endPerfPhase(page);
    const backupZipBytes = await downloadBytes(download);
    record({
      area: "surfaces",
      project: "builtinCaseStudy",
      phase: "archiveExportBackupZip",
      samples: exportSamples,
      extra: {
        wallMs: Number((downloadAt - exportStartedAt).toFixed(1)),
        suggestedFilename: download.suggestedFilename(),
        zipBytes: backupZipBytes,
        installedAssetBlobs: installCheck.presentCount
      }
    });

    // Human-readable archive carries every readable local asset binary, so it is
    // the heavier zip of the two.
    await beginPerfPhase(page);
    const archiveStartedAt = await pageNow(page);
    const [archiveDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.locator('button', { hasText: "导出归档" }).click()
    ]);
    const archiveDownloadAt = await pageNow(page);
    const archiveSamples = await endPerfPhase(page);
    const humanZipBytes = await downloadBytes(archiveDownload);
    record({
      area: "surfaces",
      project: "builtinCaseStudy",
      phase: "archiveExportHumanZip",
      samples: archiveSamples,
      extra: {
        wallMs: Number((archiveDownloadAt - archiveStartedAt).toFixed(1)),
        suggestedFilename: archiveDownload.suggestedFilename(),
        zipBytes: humanZipBytes,
        installedAssetBlobs: installCheck.presentCount
      }
    });
    await page.locator('[aria-label="关闭归档面板"]').click();
    await page.waitForTimeout(300);

    // The built-in case study intentionally has no default reference. Select a real
    // generated-chain pair so replacement confirmation also exercises the direct
    // derivative review scope; search/locate still performs the actual UI setup.
    const reviewableImagePair = await findReviewableImagePair(page);
    const initialReferenceObjectId = await selectImageObject(
      page,
      [],
      reviewableImagePair.previousObjectId
    );
    const initialSetReference = page.locator('[aria-label="设为后续默认参考"]');
    await expect(initialSetReference, "内置案例没有可设为默认参考的图像").toHaveCount(1);
    await initialSetReference.click();
    await expect(page.locator('[aria-label="取消后续默认参考"]')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Control+s");
    await expect.poll(async () => {
      const raw = await page.evaluate(() => window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1"));
      return raw ? (JSON.parse(raw) as { workingState?: { currentDefaultReferenceId?: string } }).workingState?.currentDefaultReferenceId : undefined;
    }).toBe(initialReferenceObjectId);

    await selectImageObject(page, [initialReferenceObjectId], reviewableImagePair.nextObjectId);
    const setReference = page.locator('[aria-label="设为后续默认参考"]');
    await expect(setReference, "内置案例第二张图像缺少默认参考操作").toHaveCount(1);
    const builtinScale = await page.evaluate(() => {
      const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
      if (!raw) throw new Error("内置案例工作区未持久化");
      const workspace = JSON.parse(raw) as {
        objects?: Record<string, unknown>;
        assets?: Record<string, unknown>;
        ai?: { messages?: unknown[]; providerContextFrames?: unknown[] };
        canvas?: { instances?: unknown[] };
        decisionRecords?: Record<string, unknown>;
        projectContinuity?: { recordEntries?: unknown[] };
      };
      return {
        objects: Object.keys(workspace.objects ?? {}).length,
        assets: Object.keys(workspace.assets ?? {}).length,
        messages: workspace.ai?.messages?.length ?? 0,
        contextFrames: workspace.ai?.providerContextFrames?.length ?? 0,
        canvasInstances: workspace.canvas?.instances?.length ?? 0,
        decisionRecords: Object.keys(workspace.decisionRecords ?? {}).length,
        continuityEntries: workspace.projectContinuity?.recordEntries?.length ?? 0
      };
    });
    const beforeReference = await page.evaluate(() => {
      const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
      if (!raw) throw new Error("内置案例工作区未持久化");
      return JSON.parse(raw) as { workingState?: { currentDefaultReferenceId?: string } };
    });
    await beginPerfPhase(page);
    await armFeedback(page, "body");
    const replaceOnly = page.getByRole("button", { name: "只替换默认参考", exact: true });
    const replaceAndReview = page.getByRole("button", { name: "替换并标记相关素材待复核", exact: true });
    const confirmCard = replaceOnly.locator("xpath=ancestor::div[contains(@class, 'confirm-card')]");
    await setReference.click();
    await expect(replaceOnly).toBeVisible({ timeout: 10_000 });
    await expect(replaceAndReview).toBeVisible();
    const duringConfirmation = await page.evaluate(() => {
      const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
      return raw ? (JSON.parse(raw) as { workingState?: { currentDefaultReferenceId?: string } }) : null;
    });
    expect(duringConfirmation?.workingState?.currentDefaultReferenceId)
      .toBe(beforeReference.workingState?.currentDefaultReferenceId);
    record({
      area: "surfaces",
      project: "builtinCaseStudy",
      phase: "defaultReferenceConfirm",
      scale: builtinScale,
      samples: await endPerfPhase(page),
      feedback: await readFeedback(page),
      extra: {
        options: ["只替换默认参考", "替换并标记相关素材待复核"],
        stateUnchangedBeforeChoice: true
      }
    });
    await confirmCard.getByRole("button", { name: "取消", exact: true }).click();
    const afterCancel = await page.evaluate(() => {
      const raw = window.localStorage.getItem("morpho.project.project-morpho-case-study.workspace.v1");
      return raw ? (JSON.parse(raw) as { workingState?: { currentDefaultReferenceId?: string } }) : null;
    });
    expect(afterCancel?.workingState?.currentDefaultReferenceId)
      .toBe(beforeReference.workingState?.currentDefaultReferenceId);

    // --- project deletion preview (home page) ----------------------------------------
    await page.goto("/");
    await expect(page.locator(".phome-shelf")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("测试", { exact: true }).first()).toBeVisible();
    const deleteButton = page.locator(`[aria-label="删除项目：测试"]`);
    await expect(deleteButton, "内置案例项目删除预览入口缺失").toHaveCount(1);
    if (await deleteButton.count() > 0) {
      await beginPerfPhase(page);
      await armFeedback(page, "main");
      await deleteButton.click();
      await page.waitForTimeout(900);
      record({
        area: "surfaces",
        project: "builtinCaseStudy",
        phase: "deletionPreview",
        samples: await endPerfPhase(page),
        feedback: await readFeedback(page)
      });
      // Cancel: nothing is deleted.
      await page.getByRole("button", { name: /取消/ }).click().catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  });

  test.afterAll(async () => {
    if (collected.length === 0) {
      return;
    }
    const observedKeys = new Set(collected.map(phaseKey));
    const expectedKeys = new Set([...MANDATORY_PHASE_KEYS, ...OPTIONAL_PHASE_KEYS]);
    const missingMandatory = [...MANDATORY_PHASE_KEYS].filter((key) => !observedKeys.has(key));
    const missingOptional = [...OPTIONAL_PHASE_KEYS].filter((key) => !observedKeys.has(key));
    const unexpectedKeys = [...observedKeys].filter((key) => !expectedKeys.has(key));
    const completeness = {
      expectedCount: expectedKeys.size,
      observedCount: observedKeys.size,
      expectedKeys: [...expectedKeys].sort(),
      observedKeys: [...observedKeys].sort(),
      missingMandatory: missingMandatory.sort(),
      missingOptional: missingOptional.sort(),
      unexpectedKeys: unexpectedKeys.sort(),
      mandatoryPassed: missingMandatory.length === 0 && unexpectedKeys.length === 0
    };
    expect(missingMandatory, `Phase 5 mandatory phases missing: ${missingMandatory.join(", ")}`).toEqual([]);
    expect(unexpectedKeys, `Phase 5 unexpected phases recorded: ${unexpectedKeys.join(", ")}`).toEqual([]);
    const payloadProjects = phase5Project("objects500");
    expect(buildIdentity, "Phase 5 evidence missing served build provenance").not.toBeNull();
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          // Both fields mean "the code commit that was measured", captured at run
          // time. The commit that adds this generated file is a later evidence
          // commit and can never equal a hash of content that includes itself.
          gitCommit: readGitCommit(),
          measuredCodeCommit: readGitCommit(),
          note:
            "Phase 5 真实交互延迟图谱。插桩全部由测试注入（perfProbe 含可选 localStorage/IndexedDB/objectURL 归因），产品代码零改动。" +
            "资产档位带真实再生命周期的 PNG 二进制（确定性 PRNG + OffscreenCanvas，不入库）。" +
            "feedback 首反馈 = 输入事件时间到首个 DOM 变化，均为页内时间。" +
            "slowEvent* 只包含 >=16ms 事件（Event Timing 下限）。" +
            "mock Agent SSE 用于隔离 client/runtime 成本，不代表 provider 网络。",
          fixtureLimitations: [
            "objects500/chatLong/caseStudy 档位不含图片二进制（与 4A 基线可比）。",
            "assets 档位的 PNG 为合成渐变+噪声，解码成本接近照片但压缩特性不同。",
            "Agent 流为本地 mock SSE：网络/TTFT 不在本图谱内，只测 client 段。",
            "指针流为 Playwright 合成，快于真人；实际达成速率记录在 pointerRateHz。"
          ],
          seedProjects: payloadProjects.scale,
          buildIdentity,
          completeness,
          parseableImportEvidence: Object.fromEntries(importedFileEvidence.entries()),
          entries: collected
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    console.log(`\nPhase 5 报告已写入 ${REPORT_PATH}`);
  });
});
