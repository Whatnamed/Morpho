import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import type {
  Phase5AssetManifestEntry,
  Phase5SeedPayload,
  Phase5SeedProject
} from "../support/phase5SeedWorkspace";

const PHASE5_SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/phase5-seed.json");

let cached: Phase5SeedPayload | undefined;

/** Written by `e2e/globalSetup.ts` when the perf5 project is selected. */
export function phase5SeedPayload(): Phase5SeedPayload {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(PHASE5_SEED_PAYLOAD_PATH, "utf8")) as Phase5SeedPayload;
    } catch {
      throw new Error(
        `找不到 ${PHASE5_SEED_PAYLOAD_PATH}。种子只在 perf5 project 被选中时生成；` +
          `请用 npm run measure:perf5:browser 运行。`
      );
    }
  }
  return cached;
}

export function phase5Project(key: string): Phase5SeedProject {
  const project = phase5SeedPayload().projects.find((candidate) => candidate.key === key);
  if (!project) {
    throw new Error(`Phase 5 种子中没有项目 ${key}。`);
  }
  return project;
}

/**
 * Writes catalog + the listed project workspaces into localStorage from a cheap
 * route. Same reasoning as `seedPerfTier`: never push megabytes through an
 * addInitScript on the navigation being measured.
 */
export async function seedPhase5Projects(page: Page, keys: readonly string[]): Promise<void> {
  const payload = phase5SeedPayload();
  const wanted = new Set(keys);
  const projects = payload.projects.filter((project) => wanted.has(project.key));
  if (projects.length !== wanted.size) {
    throw new Error(`Phase 5 种子缺少项目：${[...wanted].filter((key) => !projects.some((p) => p.key === key)).join(", ")}`);
  }

  const written = await page.evaluate(
    (input: { catalogKey: string; catalogValue: string; entries: { key: string; workspaceKey: string; workspaceValue: string; workspaceValueLength: number }[] }) => {
      try {
        window.localStorage.clear();
        window.localStorage.setItem(input.catalogKey, input.catalogValue);
        for (const entry of input.entries) {
          window.localStorage.setItem(entry.workspaceKey, entry.workspaceValue);
        }
      } catch (error) {
        return { ok: false, reason: String(error), bad: "" };
      }
      for (const entry of input.entries) {
        const readBack = window.localStorage.getItem(entry.workspaceKey);
        if (readBack === null || readBack.length !== entry.workspaceValueLength) {
          return { ok: false, reason: "truncated", bad: entry.key };
        }
      }
      return { ok: true, reason: "", bad: "" };
    },
    {
      catalogKey: payload.catalogKey,
      catalogValue: payload.catalogValue,
      entries: projects.map((project) => ({
        key: project.key,
        workspaceKey: project.workspaceKey,
        workspaceValue: project.workspaceValue,
        workspaceValueLength: project.workspaceValueLength
      }))
    }
  );

  if (!written.ok) {
    throw new Error(`Phase 5 种子未完整写入（${written.bad}）：${written.reason}`);
  }
}

/**
 * Regenerates the deterministic synthetic PNGs from the manifest and writes them
 * into the real asset BlobStore (`morpho-assets-v1` / `asset-blobs`), so the
 * production URL cache hits real IndexedDB reads and the canvas decodes real bytes.
 *
 * Blob size is driven by content, not quota: a vertical gradient plus seeded sparse
 * noise plus index label lands photo-adjacent PNG sizes (recorded per run; the
 * report prints actual totals rather than assuming them).
 */
export async function seedPhase5AssetBlobs(
  page: Page,
  project: Phase5SeedProject
): Promise<{ count: number; totalBytes: number }> {
  if (project.assets.length === 0) {
    return { count: 0, totalBytes: 0 };
  }
  const result = await page.evaluate(async (manifest: Phase5AssetManifestEntry[]) => {
    const mulberry32 = (seed: number) => {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    const generate = async (entry: Phase5AssetManifestEntry): Promise<Blob> => {
      const { width, height, seed } = entry;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("OffscreenCanvas 2D context unavailable.");
      }
      const image = ctx.createImageData(width, height);
      const random = mulberry32(seed);
      const [r0, g0, b0] = [40 + Math.floor(random() * 80), 60 + Math.floor(random() * 80), 90 + Math.floor(random() * 80)];
      const [r1, g1, b1] = [180 + Math.floor(random() * 60), 140 + Math.floor(random() * 60), 110 + Math.floor(random() * 60)];
      let offset = 0;
      for (let y = 0; y < height; y += 1) {
        const bandSeed = mulberry32(seed + y * 31)();
        for (let x = 0; x < width; x += 1) {
          const t = (x / width) * 0.6 + (y / height) * 0.4;
          let r = r0 + (r1 - r0) * t;
          let g = g0 + (g1 - g0) * t;
          let b = b0 + (b1 - b0) * t;
          // Sparse noise: enough entropy to keep PNG size photo-adjacent, sparse
          // enough that generation itself stays cheap.
          const noise = random();
          if (noise > 0.86) {
            const level = bandSeed * 255;
            r = r * 0.5 + level * 0.5;
            g = g * 0.5 + level * 0.5;
            b = b * 0.5 + level * 0.5;
          }
          image.data[offset] = r;
          image.data[offset + 1] = g;
          image.data[offset + 2] = b;
          image.data[offset + 3] = 255;
          offset += 4;
        }
      }
      ctx.putImageData(image, 0, 0);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "bold 56px sans-serif";
      ctx.fillText(`#${seed & 0xffff}`, 28, 76);
      return canvas.convertToBlob({ type: "image/png" });
    };

    const db = await new Promise<IDBDatabase>((resolveDb, rejectDb) => {
      const request = indexedDB.open("morpho-assets-v1", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("asset-blobs")) {
          database.createObjectStore("asset-blobs");
        }
      };
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => rejectDb(request.error);
    });

    try {
      // All blobs are generated BEFORE the transaction opens: an IDB transaction
      // auto-commits once no request is pending, so awaiting canvas encoding inside
      // it would silently drop every put.
      const blobs = await Promise.all(manifest.map((entry) => generate(entry)));
      const bytes = blobs.reduce((total, blob) => total + blob.size, 0);
      await new Promise<void>((resolveTx, rejectTx) => {
        const tx = db.transaction("asset-blobs", "readwrite");
        const store = tx.objectStore("asset-blobs");
        manifest.forEach((entry, index) => {
          store.put(blobs[index], entry.storageKey);
        });
        tx.oncomplete = () => resolveTx();
        tx.onerror = () => rejectTx(tx.error);
        tx.onabort = () => rejectTx(tx.error);
      });
      return { count: manifest.length, totalBytes: bytes };
    } finally {
      db.close();
    }
  }, project.assets);

  if (result.count !== project.assets.length) {
    throw new Error(`合成图片写入数量不符：${result.count} / ${project.assets.length}`);
  }
  return result;
}
