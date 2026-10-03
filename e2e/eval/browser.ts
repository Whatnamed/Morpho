import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { buildP7Seed } from "../support/p7Seed";
import { installAgentMock } from "../fixtures/agentMock";
import { hash } from "./evidence";
export type P7Seed = ReturnType<typeof buildP7Seed>;
export async function readWorkspace(page: Page, seed: P7Seed): Promise<MorphoWorkspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), seed.workspaceKey);
}
export async function setupP7(page: Page) {
  const lock = JSON.parse(readFileSync(resolve("e2e/eval/contract-lock.json"), "utf8")) as { files: Record<string, string> };
  for (const [file, expected] of Object.entries(lock.files)) {
    if (hash(readFileSync(resolve(file), "utf8").replaceAll("\r\n", "\n")) !== expected) throw new Error(`invalid_run: frozen contract/fixture changed ${file}`);
  }
  const seed = JSON.parse(readFileSync(resolve("e2e/.seed/p7.json"), "utf8")) as P7Seed;
  await page.addInitScript((s) => {
    // Once-only; reload and T4 must consume this run's persisted state.
    if (localStorage.getItem(s.workspaceKey) === null) {
      localStorage.setItem(s.catalogKey, s.catalogValue); localStorage.setItem(s.workspaceKey, s.workspaceValue);
    }
  }, seed);
  await installAgentMock(page);
  // Disallow external traffic and unhandled AI routes, even with an accidentally configured host key.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.hostname.match(/^(127\.0\.0\.1|localhost)$/) && !["data:", "blob:"].includes(url.protocol)) {
      await route.abort(); throw new Error(`invalid_run: external request ${url.origin}`);
    }
    if (url.pathname.startsWith("/api/ai/")) {
      await route.abort(); throw new Error(`invalid_run: unmocked AI request ${url.pathname}`);
    }
    await route.continue();
  });
  await page.goto("/");
  const assetIdentities = [];
  // Load real case binaries, verify exact frozen hashes, then install into the real local asset store.
  for (const asset of seed.assets) {
    const response = await page.request.get(asset.publicPath);
    if (!response.ok()) throw new Error(`invalid_run: case asset unavailable ${asset.assetId}`);
    const bytes = await response.body();
    if (hash(bytes) !== asset.contentHash || bytes.length !== asset.size) throw new Error(`invalid_run: case asset changed ${asset.assetId}`);
    assetIdentities.push({ ...asset, sha256: hash(bytes) });
    await page.evaluate(async ({ base64, asset }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("morpho-assets-v1", 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("asset-blobs")) r.result.createObjectStore("asset-blobs"); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction("asset-blobs", "readwrite"); tx.objectStore("asset-blobs").put(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: asset.mimeType }), asset.runtimeStorageKey); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error); }); db.close();
    }, { base64: bytes.toString("base64"), asset });
  }
  await page.goto(`/projects/${seed.projectId}`);
  await expect(page.locator(".tl-container")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true }); if (await notice.isVisible()) await notice.click();
  return { seed, assetIdentities, fixtureHash: hash(seed.workspaceValue) };
}
export async function selectP7(page: Page, seed: P7Seed, id: string, additive = false) {
  const w = await readWorkspace(page, seed);
  const instance = w.canvas.instances.find((i) => i.objectId === id);
  if (!instance) throw new Error(`No canvas instance ${id}`);
  const selector = `.tl-shape[data-shape-id="shape:${instance.id}"]`;
  await expect(page.locator(selector)).toBeVisible();
  // Actual pointer selection; pick exposed card area when panels overlap its centre.
  await page.waitForTimeout(200);
  const point = await page.evaluate((selector) => {
    const node = document.querySelector(selector)!; const box = node.getBoundingClientRect();
    const blocked = [...document.querySelectorAll(".tl-shape:has(.morpho-shape-host), .ai-panel, .floating-cluster, .left-rail, .selection-toolbar, .workspace-banner, .detail-popover, [data-workspace-surface]")].filter((other) => other !== node).map((other) => other.getBoundingClientRect());
    for (let y = Math.max(box.top + 10, 10); y < Math.min(box.bottom - 10, innerHeight - 10); y += 8) for (let x = Math.max(box.left + 10, 10); x < Math.min(box.right - 10, innerWidth - 10); x += 8) if (blocked.every((b) => x < b.left || x > b.right || y < b.top || y > b.bottom)) return { x, y };
    throw new Error(`No exposed card ${selector}`);
  }, selector);
  if (additive) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  if (additive) await page.keyboard.up("Shift");
  await expect.poll(async () => (await readWorkspace(page, seed)).ui.lastSelectionIds.includes(id)).toBe(true);
}
export async function assetIdentity(page: Page, workspace: MorphoWorkspace, assetId: string) {
  const asset = workspace.assets[assetId];
  return page.evaluate(async ({ asset, assetId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("morpho-assets-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const blob = await new Promise<Blob>((resolve, reject) => { const r = db.transaction("asset-blobs").objectStore("asset-blobs").get(asset.storageKey ?? assetId); r.onsuccess = () => resolve(r.result as Blob); r.onerror = () => reject(r.error); }); db.close();
    if (!blob) throw new Error(`Missing persisted binary ${assetId}`);
    const bytes = await blob.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { assetId, byteLength: bytes.byteLength, mimeType: blob.type, sha256: [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("") };
  }, { asset, assetId });
}
