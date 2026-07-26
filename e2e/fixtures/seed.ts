import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import type { SeedPayload } from "../support/seedWorkspace";

const SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/seed.json");

let cached: SeedPayload | undefined;

/** Written by `e2e/globalSetup.ts` from the real domain code on every run. */
export function seedPayload(): SeedPayload {
  if (!cached) {
    cached = JSON.parse(readFileSync(SEED_PAYLOAD_PATH, "utf8")) as SeedPayload;
  }
  return cached;
}

/**
 * Installs the seed before any app script runs, so the project loads from a known
 * state. Init scripts re-run on every navigation, so the write is once-only:
 * re-seeding on reload would silently discard whatever the test just did and make
 * a passing reload assertion meaningless.
 */
export async function seedProject(page: Page): Promise<SeedPayload> {
  const payload = seedPayload();
  await page.addInitScript((seed: SeedPayload) => {
    if (window.localStorage.getItem(seed.workspaceKey) === null) {
      window.localStorage.setItem(seed.catalogKey, seed.catalogValue);
      window.localStorage.setItem(seed.workspaceKey, seed.workspaceValue);
    }
  }, payload);
  return payload;
}

/** Installs the asset-free project used by the backup round trip. */
export async function seedTextOnlyProject(page: Page): Promise<SeedPayload> {
  const payload = seedPayload();
  await page.addInitScript((seed: SeedPayload) => {
    if (window.localStorage.getItem(seed.textOnly.workspaceKey) === null) {
      window.localStorage.setItem(seed.catalogKey, seed.textOnly.catalogValue);
      window.localStorage.setItem(seed.textOnly.workspaceKey, seed.textOnly.workspaceValue);
    }
  }, payload);
  return payload;
}

/** Shape ids are derived from the canvas instance id, so seeded ids give stable canvas selectors. */
export function shapeSelector(objectId: string): string {
  const instanceId = seedPayload().canvasInstanceIds[objectId];
  if (!instanceId) {
    throw new Error(`Seed has no canvas instance for ${objectId}.`);
  }
  return `.tl-shape[data-shape-id="shape:${instanceId}"]`;
}

export async function readStoredWorkspace(page: Page, projectId?: string): Promise<StoredWorkspace> {
  const payload = seedPayload();
  const key = projectId ? payload.workspaceKey.replace(payload.seedProjectId, projectId) : payload.workspaceKey;
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  if (!raw) {
    throw new Error(`No stored workspace at ${key}.`);
  }
  return JSON.parse(raw) as StoredWorkspace;
}

/**
 * Only the slice of the workspace the acceptance assertions read. Importing the
 * full domain type here would drag the JSON-importing domain modules into
 * Playwright's loader.
 */
export type StoredWorkspace = {
  project: { id: string; title: string };
  objects: Record<
    string,
    {
      id: string;
      type: string;
      title: string;
      visibility: string;
      isDefaultReference?: boolean;
      pendingReview?: { reason: string };
    }
  >;
  workingState: { currentDefaultReferenceId?: string };
  canvas: { view: { x: number; y: number; zoom: number }; instances: Array<{ id: string; objectId: string }> };
  ai: { messages: Array<{ id: string; role: string; body: string; status?: string; agentTurnOutcome?: string }> };
  ui: { lastSelectionIds: string[] };
};
